import {
  graphicDurationBounds,
  isGraphicKind,
  MAX_GRAPHIC_SHOT_SEC,
  MIN_GRAPHIC_SHOT_SEC,
  comparableGroups,
  enforceVariety,
  findContrastWord,
  getLangPack,
  parseNumbers,
  startsWithOrdinal,
  type BudgetFeatures,
  type ComposeLangPack,
  type KindSpan,
  type SceneWord,
  type ShotKind,
  type ShotSource,
  type VarietyScene,
} from "@vg/shared";
import { directivesOf, type Director, type DirectorInput } from "../director.js";
import { graphicKindPiece } from "./kinds070.js";
import { pickChart, type ChartPick } from "./labels.js";

/** Rule director (ECO, 0 LLM calls): R1–R6, then the variety pass. Same input, same output. */

export type KineticPayload = Extract<ShotSource, { kind: "kinetic_text" }>;
export type DirectorOptions = {
  /** Video language (`project.settings.language`). Unknown codes use digits only: R3 and R6 word lists stay empty. */
  language?: string;
  /** `off` turns graphic spans into footage or still and appends `+mode-off`. */
  composeGraphics?: BudgetFeatures["composeGraphics"];
};

/**
 * R2: the hook covers at most this much speech. A graphic shot cannot be shorter than 1.5 s
 * (`validateScenePlan`), so the 9:16 opening ends on the first word end at or after 1.5 s,
 * and never later than the second value.
 */
export const HOOK_MAX_SEC = 2.5;
export const HOOK_PORTRAIT_FIRST_MAX_SEC = 2.1;
/** A kinetic text that repeats the subtitle for longer than this looks like the subtitle shown twice (V4). */
export const KINETIC_MAX_SEC = 3;
export const KINETIC_MAX_WORDS = 8;
/** A chart needs this long to be read; the span grows to the sentence edges to reach it. */
export const CHART_READ_SEC = 2.5;
/** Plain picture between two graphics, so they do not sit back to back. */
export const GRAPHIC_GAP_SEC = 1;
/** Graphics may fill at most this share of one scene (the hook and the chart come first, R6 last). */
export const SCENE_GRAPHIC_SHARE = 0.5;
/** Body chunk lengths. A still is shorter than footage so alternating them keeps stills under 40 % of the runtime. */
export const BODY_CHUNK_SEC = {
  "16:9": { footage: 3.2, still: 2.2 },
  "9:16": { footage: 2.4, still: 1.7 },
} as const;
/** Stills are paced to this share of the elapsed time, plus a small slack, so the 40 % limit holds at the end. */
export const STILL_PACE_SHARE = 0.36;
const STILL_PACE_SLACK_SEC = 0.5;
/** A clip shorter than this cannot fill a shot. */
export const MIN_FOOTAGE_SEC = 2;
const GOOD_GAP_SEC = 0.15;
const MIN_BODY_SEC = 0.8;
const MIN_TAIL_SEC = 1.2;

type Piece = { kind: ShotKind; start: number; end: number; reason: string; payload: ShotSource };
type Flow = { prev: ShotKind | null; run: number; elapsed: number; stillSec: number };

export function usableFootage(input: DirectorInput): number {
  return input.footage.filter((hit) => hit.durationSec >= MIN_FOOTAGE_SEC).length;
}

/** A shot starts where the one before it ends: on the end of the previous word (`layout` in composeService). */
function startSec(words: SceneWord[], index: number): number {
  return index <= 0 ? 0 : words[Math.min(index, words.length) - 1]!.endSec;
}

/** Exact length of the shot a span becomes in `planProject`. */
export function spanSec(input: DirectorInput, start: number, end: number): number {
  const words = input.words;
  if (!words.length || end <= start) return 0;
  const stop = end >= words.length ? Math.max(input.scene.durationSec, words[words.length - 1]!.endSec) : words[end - 1]!.endSec;
  return Math.max(0, stop - startSec(words, start));
}

function cleanToken(text: string, last: boolean): string {
  const core = text.replace(/^["'“”‘’(\[]+/u, "").replace(/["'“”‘’)\]]+$/u, "");
  return last ? core.replace(/[,;:.…]+$/u, "") : core.replace(/[,;:]+$/u, "").replace(/\.+$/u, "");
}

/** Splits words into balanced lines, breaking after a clause mark when one is near the middle. */
export function toLines(tokens: string[], maxLines: number): string[] {
  const words = tokens.map((token, index) => cleanToken(token, index === tokens.length - 1)).filter(Boolean);
  const chars = words.join(" ").length;
  const count = Math.max(1, Math.min(maxLines, words.length, Math.ceil(chars / 16)));
  const lines: string[] = [];
  let cursor = 0;
  for (let line = 0; line < count; line += 1) {
    const left = count - line;
    if (left === 1) {
      lines.push(words.slice(cursor).join(" "));
      break;
    }
    const rest = words.slice(cursor).join(" ").length;
    const target = rest / left;
    let end = cursor + 1;
    let length = words[cursor]!.length;
    while (end < words.length - (left - 1) && length + 1 + words[end]!.length <= target + 3) {
      length += 1 + words[end]!.length;
      end += 1;
    }
    const clause = tokens.slice(cursor, end + 1).findLastIndex((token) => /[,;:]$/u.test(token));
    if (clause >= 0 && clause + 1 >= (end - cursor) - 1 && cursor + clause + 1 <= words.length - (left - 1)) end = cursor + clause + 1;
    lines.push(words.slice(cursor, end).join(" "));
    cursor = end;
  }
  return lines.filter(Boolean);
}

/**
 * The word the eye should land on: the numbers when the text has any, otherwise the end of the phrase,
 * where a spoken line puts its weight. A short last word takes the word before it along ("tiết kiệm", "do it").
 */
function emphasisFor(texts: string[], lang: ComposeLangPack): number[] {
  const numbers = parseNumbers(texts, lang).flatMap((mention) => Array.from({ length: mention.wordEnd - mention.wordStart }, (_, i) => mention.wordStart + i));
  if (numbers.length) return numbers.filter((index) => index < texts.length);
  const last = texts.length - 1;
  if (last < 0) return [];
  const short = cleanToken(texts[last]!, true).replace(/[!?]+$/u, "").length <= 4;
  return short && texts.length >= 3 ? [last - 1, last] : [last];
}

export function kineticPayload(
  input: DirectorInput,
  start: number,
  end: number,
  lang: ComposeLangPack,
  style: KineticPayload["style"],
  emphasis?: number[],
): KineticPayload {
  const words = input.words.slice(start, end);
  const texts = words.map((word) => word.text);
  const lines = toLines(texts, input.aspect === "9:16" ? 3 : 2);
  const shown = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const from = startSec(input.words, start);
  return {
    kind: "kinetic_text",
    lines: lines.length ? lines : [" "],
    emphasis: (emphasis ?? emphasisFor(texts, lang)).filter((index) => index < shown),
    style,
    ...(shown === words.length && shown > 0 ? { wordTimes: words.map((word) => Math.max(0, Math.round((word.startSec - from) * 1000) / 1000)) } : {}),
  };
}

/**
 * The opening graphic. `text` is what the screen shows, `span` is how long the shot lasts.
 * The shot must last 1.5 s or more, so it ends on a word end between 1.5 s and the limit.
 * The text is a whole phrase where it can be: the furthest clause end inside the limit. A phrase shorter
 * than 1.5 s ("Bạn có biết,") stays on screen while the voice goes on, instead of taking half of the next phrase.
 */
function openingRange(input: DirectorInput, limitSec: number, needClause: boolean, shortest: boolean): { text: number; span: number } | null {
  const words = input.words;
  const inside: number[] = [];
  for (let end = 1; end <= Math.min(words.length, KINETIC_MAX_WORDS); end += 1) {
    if (spanSec(input, 0, end) > limitSec + 1e-6) break;
    inside.push(end);
  }
  const fits = inside.filter((end) => spanSec(input, 0, end) >= MIN_GRAPHIC_SHOT_SEC);
  if (fits.length === 0) return null;
  const clauses = inside.filter((end) => words[end - 1]!.punct);
  if (shortest) return { text: clauses.findLast((end) => end <= fits[0]!) ?? fits[0]!, span: fits[0]! };
  const clause = clauses.at(-1);
  if (clause) return { text: clause, span: Math.max(clause, fits[0]!) };
  if (needClause) return null;
  const pause = fits.find((end) => words[end] && words[end]!.startSec - words[end - 1]!.endSec >= GOOD_GAP_SEC);
  return { text: pause ?? fits[0]!, span: pause ?? fits[0]! };
}

function opening(input: DirectorInput, lang: ComposeLangPack): Piece | null {
  const texts = input.words.map((word) => word.text);
  const first = input.scene.index === 0;
  const ordinal = startsWithOrdinal(texts, lang);
  const directives = directivesOf(input);
  const list = ordinal || (directives.listOpening && !first);
  const hook = !list && (first || directives.hookEveryScene);
  if (!list && !hook) return null;
  const portraitFirst = first && input.aspect === "9:16";
  const limit = portraitFirst ? HOOK_PORTRAIT_FIRST_MAX_SEC : list ? KINETIC_MAX_SEC : HOOK_MAX_SEC;
  const range = openingRange(input, limit, list && !ordinal, portraitFirst);
  if (!range) return null;
  if (list) {
    const head = input.words.slice(0, range.text).findIndex((word) => word.punct);
    const ordinalWords = ordinal ? Array.from({ length: Math.min(3, head >= 0 ? head + 1 : 2, range.text) }, (_, i) => i) : undefined;
    return { kind: "kinetic_text", start: 0, end: range.span, reason: "R3-list", payload: kineticPayload(input, 0, range.text, lang, "stack", ordinalWords) };
  }
  return { kind: "kinetic_text", start: 0, end: range.span, reason: "R2-hook", payload: kineticPayload(input, 0, range.text, lang, "bold") };
}

function sentences(words: SceneWord[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  words.forEach((word, index) => {
    if (word.sentenceEnd || index === words.length - 1) {
      out.push({ start, end: index + 1 });
      start = index + 1;
    }
  });
  return out;
}

function chartPiece(input: DirectorInput, lang: ComposeLangPack, floor: number): Piece | null {
  const texts = input.words.map((word) => word.text);
  const mentions = parseNumbers(texts, lang);
  if (mentions.length < 2) return null;
  const pick: ChartPick | null = pickChart(comparableGroups(mentions), mentions, texts, lang);
  if (!pick || pick.firstNumberWord < floor) return null;
  let start = Math.max(pick.wordStart, floor);
  let end = pick.wordEnd;
  const all = sentences(input.words);
  const closing = all.find((item) => item.end >= end);
  if (closing && spanSec(input, start, closing.end) <= MAX_GRAPHIC_SHOT_SEC) end = closing.end;
  const leading = all.find((item) => item.end > start);
  if (spanSec(input, start, end) < CHART_READ_SEC && leading) {
    const earlier = Math.max(leading.start, floor);
    if (spanSec(input, earlier, end) <= MAX_GRAPHIC_SHOT_SEC) start = earlier;
  }
  while (spanSec(input, start, end) < MIN_GRAPHIC_SHOT_SEC && end < input.words.length) end += 1;
  while (spanSec(input, start, end) < MIN_GRAPHIC_SHOT_SEC && start > floor) start -= 1;
  const sec = spanSec(input, start, end);
  // Outside 1.5–6 s the planner would cut inside a word, so the numbers stay with a plain picture.
  if (sec < MIN_GRAPHIC_SHOT_SEC || sec > MAX_GRAPHIC_SHOT_SEC) return null;
  return { kind: "chart", start, end, reason: "R1-numbers", payload: pick.payload };
}

/** The last short sentence that lands a point: it ends with "!" or opens with a contrast word. */
function emphasisPiece(input: DirectorInput, lang: ComposeLangPack, taken: Piece[]): Piece | null {
  const sceneSec = Math.max(input.scene.durationSec, 0.001);
  const used = taken.reduce((sum, piece) => sum + spanSec(input, piece.start, piece.end), 0);
  const all = sentences(input.words);
  for (let index = all.length - 1; index >= 1; index -= 1) {
    const { start, end } = all[index]!;
    const count = end - start;
    const sec = spanSec(input, start, end);
    if (count < 2 || count > KINETIC_MAX_WORDS || sec < MIN_GRAPHIC_SHOT_SEC || sec > KINETIC_MAX_SEC) continue;
    const texts = input.words.slice(start, end).map((word) => word.text);
    const shout = /!["'”’)]*$/u.test(texts[texts.length - 1]!);
    const contrast = findContrastWord(texts, lang)?.index === 0;
    if (!shout && !contrast) continue;
    const clear = taken.every((piece) => (
      piece.end <= start ? spanSec(input, piece.end, start) >= GRAPHIC_GAP_SEC : piece.start >= end && spanSec(input, end, piece.start) >= GRAPHIC_GAP_SEC
    ));
    if (!clear || (used + sec) / sceneSec > SCENE_GRAPHIC_SHARE) continue;
    return { kind: "kinetic_text", start, end, reason: "R6-emphasis", payload: kineticPayload(input, start, end, lang, shout ? "bold" : "typewriter") };
  }
  return null;
}

function note(flow: Flow, kind: ShotKind, sec: number): void {
  flow.run = flow.prev === kind ? flow.run + 1 : 1;
  flow.prev = kind;
  flow.elapsed += sec;
  if (kind === "still") flow.stillSec += sec;
}

function bodyKind(flow: Flow, footageLeft: number, hasStill: boolean, stillSec: number): "footage" | "still" {
  if (footageLeft <= 0) return "still";
  if (!hasStill) return "footage";
  if (flow.prev !== "footage") return "footage";
  const paced = flow.stillSec + stillSec <= STILL_PACE_SHARE * (flow.elapsed + stillSec) + STILL_PACE_SLACK_SEC;
  return paced || flow.run >= 2 ? "still" : "footage";
}

/**
 * End of a body chunk: the word end nearest the target length, with a preference for a sentence end,
 * then a clause end, then a pause. It never leaves a tail too short for a shot of its own.
 */
function chunkEnd(input: DirectorInput, start: number, limit: number, target: number): number {
  const words = input.words;
  if (spanSec(input, start, limit) <= target * 1.5) return limit;
  let best = limit;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let end = start + 1; end < limit; end += 1) {
    const sec = spanSec(input, start, end);
    if (sec < target * 0.6) continue;
    if (sec > target * 1.5) break;
    if (spanSec(input, end, limit) < MIN_TAIL_SEC) continue;
    const word = words[end - 1]!;
    const pause = words[end]!.startSec - word.endSec >= GOOD_GAP_SEC;
    const bonus = word.sentenceEnd ? 0.5 : word.punct ? 0.35 : pause ? 0.2 : 0;
    const cost = Math.abs(sec - target) / target - bonus;
    if (cost < bestCost) {
      bestCost = cost;
      best = end;
    }
  }
  return best;
}

function fillBody(input: DirectorInput, start: number, end: number, flow: Flow, state: { footageUsed: number }, out: KindSpan[]): void {
  const sizes = BODY_CHUNK_SEC[input.aspect === "9:16" ? "9:16" : "16:9"];
  const hits = usableFootage(input);
  if (hits === 0 && input.stills.length >= 2 && end - start >= 2 && spanSec(input, start, end) >= MIN_BODY_SEC * 2) {
    let mid = -1;
    let best = Number.POSITIVE_INFINITY;
    const half = spanSec(input, start, end) / 2;
    for (let cursor = start + 1; cursor < end; cursor += 1) {
      const left = spanSec(input, start, cursor);
      const right = spanSec(input, cursor, end);
      if (left < MIN_BODY_SEC || right < MIN_BODY_SEC) continue;
      const cost = Math.abs(left - half);
      if (cost < best) {
        best = cost;
        mid = cursor;
      }
    }
    if (mid > start) {
      out.push({ kind: "still", wordStart: start, wordEnd: mid, reason: "R5-still" });
      out.push({ kind: "still", wordStart: mid, wordEnd: end, reason: "R5-still" });
      note(flow, "still", spanSec(input, start, end));
      return;
    }
  }
  if (hits === 0 || input.stills.length === 0) {
    // One kind only: a single span, which planProject paces into shots. Chunks here would only add same-kind spans in a row.
    const kind = hits === 0 ? "still" as const : "footage" as const;
    out.push({ kind, wordStart: start, wordEnd: end, reason: kind === "footage" ? "R4-footage" : "R5-still" });
    note(flow, kind, spanSec(input, start, end));
    return;
  }
  let cursor = start;
  while (cursor < end) {
    const kind = bodyKind(flow, hits - state.footageUsed, input.stills.length > 0, sizes.still);
    const stop = chunkEnd(input, cursor, end, sizes[kind]);
    out.push({ kind, wordStart: cursor, wordEnd: stop, reason: kind === "footage" ? "R4-footage" : "R5-still" });
    if (kind === "footage") state.footageUsed += 1;
    note(flow, kind, spanSec(input, cursor, stop));
    cursor = stop;
  }
}

function roomFor(input: DirectorInput, pieces: Piece[], extra: Piece): boolean {
  for (const piece of pieces) {
    if (extra.start < piece.end && piece.start < extra.end) return false;
    if (piece.end <= extra.start && extra.start > piece.end && spanSec(input, piece.end, extra.start) < GRAPHIC_GAP_SEC) return false;
    if (extra.end <= piece.start && piece.start > extra.end && spanSec(input, extra.end, piece.start) < GRAPHIC_GAP_SEC) return false;
  }
  const sec = spanSec(input, extra.start, extra.end);
  const bounds = graphicDurationBounds(extra.kind, extra.payload);
  if (!bounds || sec < bounds.min - 0.05 || sec > bounds.max + 0.05) return false;
  const sceneSec = Math.max(input.scene.durationSec, 0.001);
  const used = pieces.reduce((sum, piece) => sum + spanSec(input, piece.start, piece.end), 0);
  return (used + sec) / sceneSec <= SCENE_GRAPHIC_SHARE;
}

function directScene(input: DirectorInput, lang: ComposeLangPack, flow: Flow, options: DirectorOptions): KindSpan[] {
  const count = input.words.length;
  if (count === 0) {
    const kind = usableFootage(input) > 0 ? "footage" as const : "still" as const;
    note(flow, kind, input.scene.durationSec);
    return [{ kind, wordStart: 0, wordEnd: 0, reason: kind === "footage" ? "R4-footage" : "R5-still" }];
  }
  const pieces: Piece[] = [];
  let open = opening(input, lang);
  let chart = chartPiece(input, lang, 0);
  if (open && chart && chart.start < open.end) {
    // The first shot of the video is always the hook. Elsewhere the chart is the stronger picture.
    const later = chartPiece(input, lang, open.end);
    if (later) chart = later;
    else if (input.scene.index === 0) chart = null;
    else open = null;
  }
  if (open) pieces.push(open);
  if (chart) pieces.push(chart);
  if (options.composeGraphics !== "off") {
    const reserved = pieces.filter((piece) => piece.reason === "R2-hook" || piece.reason === "R3-list");
    const extra = graphicKindPiece(input, lang, pieces.filter((piece) => !reserved.includes(piece)));
    if (extra) {
      const openingIndex = extra.kind === "list_full"
        ? pieces.findIndex((piece) => piece.reason === "R2-hook" || piece.reason === "R3-list")
        : -1;
      const listed = openingIndex >= 0 ? pieces[openingIndex] : undefined;
      const overlapsOpening = Boolean(listed && listed.start < extra.end && extra.start < listed.end);
      const withoutOpening = overlapsOpening ? pieces.filter((_, index) => index !== openingIndex) : pieces;
      if (roomFor(input, withoutOpening, extra)) {
        if (overlapsOpening) pieces.splice(openingIndex, 1);
        pieces.push(extra);
      }
    }
  }
  const punch = emphasisPiece(input, lang, pieces);
  if (punch) pieces.push(punch);
  pieces.sort((a, b) => a.start - b.start);
  // A gap too short for a shot joins the graphic before it when that keeps the graphic inside its limit;
  // otherwise the graphic gives up its last words, so the gap grows into a real shot.
  const cap = (piece: Piece) => {
    if (piece.kind === "chart") return MAX_GRAPHIC_SHOT_SEC;
    if (piece.kind === "kinetic_text") return KINETIC_MAX_SEC + MIN_BODY_SEC;
    return graphicDurationBounds(piece.kind, piece.payload)?.max ?? KINETIC_MAX_SEC + MIN_BODY_SEC;
  };
  pieces.forEach((piece, index) => {
    const gapEnd = pieces[index + 1]?.start ?? count;
    if (gapEnd <= piece.end || spanSec(input, piece.end, gapEnd) >= MIN_BODY_SEC) return;
    if (spanSec(input, piece.start, gapEnd) <= cap(piece)) {
      piece.end = gapEnd;
      return;
    }
    if (piece.kind !== "chart") return;
    while (piece.end - 1 > piece.start && spanSec(input, piece.end, gapEnd) < GRAPHIC_GAP_SEC && spanSec(input, piece.start, piece.end - 1) >= MIN_GRAPHIC_SHOT_SEC) piece.end -= 1;
  });
  const head = pieces[0];
  if (head && head.start > 0 && spanSec(input, 0, head.start) < MIN_BODY_SEC && spanSec(input, 0, head.end) <= cap(head)) head.start = 0;

  const spans: KindSpan[] = [];
  const state = { footageUsed: 0 };
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.start > cursor) fillBody(input, cursor, piece.start, flow, state, spans);
    spans.push({ kind: piece.kind, wordStart: piece.start, wordEnd: piece.end, reason: piece.reason, payload: piece.payload });
    note(flow, piece.kind, spanSec(input, piece.start, piece.end));
    cursor = piece.end;
  }
  if (cursor < count) fillBody(input, cursor, count, flow, state, spans);
  return spans;
}

/**
 * Runs the variety pass (V1–V4) over the whole video and repairs what it changed:
 * a kinetic text the pass shortened gets lines that match its new words.
 */
export function applyVariety(inputs: DirectorInput[], spans: KindSpan[][], lang: ComposeLangPack): KindSpan[][] {
  const scenes: VarietyScene[] = inputs.map((input, index) => ({
    words: input.words.map((word) => ({ text: word.text, startSec: word.startSec, endSec: word.endSec })),
    spans: spans[index] ?? [],
    hasFootage: usableFootage(input) > 0,
    hasStill: input.stills.length > 0 || usableFootage(input) === 0,
  }));
  const fixed = enforceVariety(scenes).scenes;
  return fixed.map((scene, index) => scene.spans.map((span) => {
    if (span.kind !== "kinetic_text" || span.payload?.kind !== "kinetic_text" || !span.reason.includes("V4-subtitle")) return span;
    return { ...span, payload: kineticPayload(inputs[index]!, span.wordStart, span.wordEnd, lang, span.payload.style) };
  }));
}

/**
 * Drops graphic payloads and keeps the word range, the same way the variety pass converts a span.
 * Footage when the scene has a usable clip, otherwise a still.
 */
export function applyGraphicsMode(inputs: DirectorInput[], spans: KindSpan[][], mode: DirectorOptions["composeGraphics"]): KindSpan[][] {
  if (mode !== "off") return spans;
  return spans.map((sceneSpans, index) => sceneSpans.map((span) => {
    if (!isGraphicKind(span.kind)) return span;
    const to: ShotKind = usableFootage(inputs[index]!) > 0 ? "footage" : "still";
    return { kind: to, wordStart: span.wordStart, wordEnd: span.wordEnd, reason: `${span.reason}+mode-off` };
  }));
}

export function directByRules(inputs: DirectorInput[], options: DirectorOptions = {}): KindSpan[][] {
  const lang = getLangPack(options.language ?? "vi");
  const flow: Flow = { prev: null, run: 0, elapsed: 0, stillSec: 0 };
  const ordered = [...inputs].sort((a, b) => a.scene.index - b.scene.index);
  const byScene = new Map(ordered.map((input) => [input, directScene(input, lang, flow, options)]));
  const varied = applyVariety(inputs, inputs.map((input) => byScene.get(input) ?? []), lang);
  return applyGraphicsMode(inputs, varied, options.composeGraphics);
}

export function createRuleDirector(options: DirectorOptions = {}): Director {
  return {
    id: "rule",
    directScenes: (inputs) => Promise.resolve(directByRules(inputs, options)),
  };
}

/** The app default language is `vi`; pass the project language through `createRuleDirector` for others. */
export const ruleDirector: Director = createRuleDirector();
