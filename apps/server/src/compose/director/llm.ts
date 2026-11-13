import { z } from "zod";
import {
  applyVariantChoices,
  directivesForRecipe,
  fitGraphicPayload,
  getLangPack,
  graphicDurationBounds,
  isGraphicKind,
  MAX_GRAPHIC_SHOT_SEC,
  MIN_GRAPHIC_SHOT_SEC,
  parseNumbers,
  ShotKindSchema,
  type ComposeLangPack,
  type GenreDirectives,
  type KindSpan,
  type LlmVariantChoice,
  type ShotKind,
  type VariantOptions,
  type VariantPick,
} from "@vg/shared";
import { directivesOf, type Director, type DirectorInput } from "../director.js";
import { CHART_MAX_ITEMS, CHART_MIN_ITEMS, LINE_MAX_POINTS } from "./labels.js";
import { applyGraphicsMode, applyVariety, directByRules, kineticPayload, spanSec, usableFootage, type DirectorOptions } from "./rules.js";

/** Quality-mode director: the rule plan plus one LLM call for the whole video. Anything invalid keeps the rule result. */

export type LlmCall = (prompt: string) => Promise<string>;
export type LlmDirectorOptions = DirectorOptions & {
  onWarning?: (message: string) => void;
  /** Set in QUALITY mode only. Without it the prompt has no variant field. */
  variants?: VariantHook;
};

/** chars / 4 estimate; the scene texts are trimmed so the whole prompt stays under this. */
export const PROMPT_MAX_TOKENS = 2000;
const PROMPT_CHAR_BUDGET = PROMPT_MAX_TOKENS * 4 - 400;
const TEXT_MIN_CHARS = 60;
const TEXT_MAX_CHARS = 400;
const LINE_MAX_CHARS = 60;

const CODE: Record<ShotKind, string> = {
  kinetic_text: "k", chart: "c", footage: "f", still: "s",
  map: "m", compare: "v", quote_full: "q", list_full: "l",
};

/** The genre's own rules for the graphic kinds, from its directives instead of a recipe id. */
function kindRules(directives: GenreDirectives): string {
  const off = (kind: string) => directives.disabledKinds.includes(kind);
  const parts: string[] = [];
  parts.push(off("map")
    ? "Do not use m: this format has no maps."
    : `Use m when the scene names a country or a province${directives.forcedKinds.includes("map") ? " (maps are a signature of this format)" : ""}: payload focus is the place id, label at most 40 characters, zoom push, 2.5 to 7 seconds.`);
  parts.push(off("compare")
    ? "Do not use v: this format has no compare cards."
    : `Use v when the narration contrasts two things (so với, khác với, trước … sau, compared to, versus, before … after)${directives.compareFallback ? " or sets a claim against the facts" : ""}: left and right each have a label of at most 16 characters and text of at most 40, 2.5 to 6 seconds, or 2 seconds when reveal is together.`);
  parts.push(off("quote_full") ? "Do not use q: this format has no quote cards." : "Use q for a quoted sentence of 6 to 28 words that names a speaker, 3 to 10 seconds.");
  parts.push(off("list_full")
    ? "Do not use l: this format has no list cards."
    : `Use l for ${directives.listOpening ? "list items and numbered steps" : "a list or numbered steps"} with 3 to 6 items of at most 36 characters, lasting 0.8×n+0.8 seconds up to 12.`);
  return parts.join(" ");
}

const VARIANT_RULES = [
  "Optionally also choose the look of graphic shots. A scene line may carry v = its graphic shots in order, each as {id, o}: o lists the allowed looks as letter:axis=value pairs, and the first letter is the current pick.",
  "Change a look only when another one clearly fits the narration better. To do so, answer with {\"scenes\":[…],\"variants\":{\"<id>\":\"b\"}} instead of the bare array; variants is optional and a letter that is not offered is ignored.",
].join("\n");

const HEADER = (language: string, aspect: string, recipe: string, directives: GenreDirectives, withVariants: boolean) => [
  `You improve the shot plan of a narrated video. Video language: ${language}. Aspect: ${aspect}. Format: ${recipe}.`,
  "Each line below is one scene as JSON: sceneId; n = number of words; f = 1 when stock footage is available; s = number of still images; text = the narration (word i is the i-th space-separated token, counted from 0; \"…\" marks trimmed text); rule = the current plan as [kind, wordStart, wordEnd] with k = kinetic_text, c = chart, f = footage, s = still, m = map, v = compare, q = quote_full, l = list_full. A chart in the plan is followed by its payload.",
  "Change a scene only when the change clearly makes the video better: put a kinetic_text on the line viewers must remember, a chart where the narration compares numbers, footage on spoken description. Keep the plan where it is already good.",
  "Hard limits: the spans of a scene cover words 0..n in order, with no gap and no overlap; footage only when f = 1; at most 2 spans of the same kind in a row; a kinetic_text or chart lasts 1.5 to 6 seconds of speech (about 5 to 18 words), a kinetic_text is best at 5 to 8 words, and its lines use only words of that scene, written in the video language; a chart uses only numbers and labels stated in that scene, never invented ones; graphic kinds together stay under 30 % of the video. A map, compare, quote_full or list_full whose on-screen text does not fit is dropped.",
  kindRules(directives),
  ...(directives.llmNotes.length > 0 ? [`Notes for this format: ${directives.llmNotes.join(" ")}`] : []),
  "Answer with JSON only, no prose, and leave out scenes you do not change:",
  "[{\"sceneId\":\"…\",\"spans\":[{\"kind\":\"footage\",\"words\":[0,9]},{\"kind\":\"kinetic_text\",\"words\":[9,14],\"payload\":{\"lines\":[\"…\"],\"emphasis\":[0],\"style\":\"bold\"}},{\"kind\":\"chart\",\"words\":[14,22],\"payload\":{\"chart\":\"bar\",\"title\":\"…\",\"labels\":[\"…\",\"…\"],\"values\":[1,2],\"unit\":\"%\"}}]}]",
  "kinetic_text style is bold, typewriter or stack; chart is bar, line or pie.",
  ...(withVariants ? [VARIANT_RULES] : []),
].join("\n");

function trimText(input: DirectorInput, maxChars: number): string {
  const text = input.words.length ? input.words.map((word) => word.text).join(" ") : input.scene.text.trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1))}…`;
}

function compactRule(spans: KindSpan[]): unknown[] {
  return spans.map((span) => {
    const base: unknown[] = [CODE[span.kind], span.wordStart, span.wordEnd];
    if (span.payload?.kind === "chart") base.push({ chart: span.payload.chart, labels: span.payload.labels, values: span.payload.values });
    return base;
  });
}

/** QUALITY only: the picker's allowed looks for graphic shots. `id` is `${sceneId}#${n}`, n = position among the scene's graphic shots. */
export type VariantHook = {
  optionsFor: (shots: { id: string; templateId: string }[]) => VariantOptions[];
  onChoices: (choices: LlmVariantChoice[]) => void;
};

export function variantShotId(sceneId: string, n: number): string {
  return `${sceneId}#${n}`;
}

/** The graphic shots of the rule plan, in the order the render will see them. */
function graphicShotsOf(inputs: DirectorInput[], rule: KindSpan[][]): { id: string; templateId: string }[] {
  return inputs.flatMap((input, index) => (rule[index] ?? [])
    .filter((span) => isGraphicKind(span.kind))
    .map((span, n) => ({ id: variantShotId(input.scene.sceneId, n), templateId: span.kind })));
}

const LETTERS = ["a", "b", "c", "d"];

export function buildDirectorPrompt(
  inputs: DirectorInput[],
  rule: KindSpan[][],
  options: DirectorOptions = {},
  variants: VariantOptions[] = [],
): string {
  const first = inputs[0];
  const directives = first ? directivesOf(first) : directivesForRecipe("");
  const header = HEADER(options.language ?? "vi", first?.aspect ?? "16:9", first?.recipeId ?? directives.genreId, directives, variants.length > 0);
  const line = (input: DirectorInput, index: number, text: string) => {
    const own = variants.filter((item) => item.shotId.startsWith(`${input.scene.sceneId}#`));
    return JSON.stringify({
      sceneId: input.scene.sceneId,
      n: input.words.length,
      f: usableFootage(input) > 0 ? 1 : 0,
      s: input.stills.length,
      text,
      rule: compactRule(rule[index] ?? []),
      ...(own.length > 0 ? { v: own.map((item) => ({ id: item.shotId, o: item.options.slice(0, LETTERS.length).map((option, i) => `${LETTERS[i]}:${option.key}`) })) } : {}),
    });
  };
  const fixed = inputs.reduce((sum, input, index) => sum + line(input, index, "").length + 1, header.length + 1);
  const perScene = Math.floor((PROMPT_CHAR_BUDGET - fixed) / Math.max(1, inputs.length));
  const maxChars = Math.max(TEXT_MIN_CHARS, Math.min(TEXT_MAX_CHARS, perScene));
  return [header, ...inputs.map((input, index) => line(input, index, trimText(input, maxChars)))].join("\n");
}

const SpanSchema = z.object({
  kind: ShotKindSchema,
  words: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  payload: z.record(z.string(), z.unknown()).optional(),
});
const SceneSchema = z.object({ sceneId: z.string().min(1), spans: z.array(SpanSchema).min(1) });
const KineticSchema = z.object({
  lines: z.array(z.string().trim().min(1).max(LINE_MAX_CHARS)).min(1).max(3),
  emphasis: z.array(z.number().int().nonnegative()).optional(),
  style: z.enum(["bold", "typewriter", "stack"]).optional(),
});
const ChartSchema = z.object({
  chart: z.enum(["bar", "line", "pie"]),
  title: z.string().max(80).optional(),
  labels: z.array(z.string().trim().min(1).max(40)),
  values: z.array(z.number().finite()),
  unit: z.string().max(16).optional(),
});

function parseAnswer(raw: string): unknown[] | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const candidates = [text, text.slice(text.indexOf("["), text.lastIndexOf("]") + 1), text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        const scenes = (value as { scenes?: unknown }).scenes;
        return Array.isArray(scenes) ? scenes : [value];
      }
    } catch {
      // try the next shape
    }
  }
  return null;
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}%\s]+/gu, " ").split(/\s+/).filter(Boolean);
}

/** Numbers the scene really says, years included. */
function statedNumbers(input: DirectorInput, lang: ComposeLangPack): number[] {
  const texts = input.words.length ? input.words.map((word) => word.text) : input.scene.text.split(/\s+/).filter(Boolean);
  return parseNumbers(texts, lang).map((mention) => mention.value);
}

function stated(value: number, known: number[]): boolean {
  return known.some((item) => Math.abs(item - value) <= 1e-6 * Math.max(1, Math.abs(item)));
}

function plainKind(input: DirectorInput): "footage" | "still" {
  return usableFootage(input) > 0 ? "footage" : "still";
}

/** Turns one answered scene into spans, or returns the reason it is refused. */
function sceneSpans(
  input: DirectorInput,
  answer: z.infer<typeof SceneSchema>,
  rule: KindSpan[],
  lang: ComposeLangPack,
  warn: (message: string) => void,
): KindSpan[] | string {
  const count = input.words.length;
  if (count === 0) return "cảnh không có từ";
  let cursor = 0;
  const spans: KindSpan[] = [];
  const sceneTokens = new Set(tokens(input.words.map((word) => word.text).join(" ")));
  const known = statedNumbers(input, lang);
  for (const item of answer.spans) {
    const [start, end] = item.words;
    if (start !== cursor || end <= start || end > count) return `khoảng từ ${start}–${end} không liền mạch`;
    cursor = end;
    if (item.kind === "kinetic_text" || item.kind === "chart") {
      // planProject clamps a graphic to 1.5–6 s by cutting inside a word; such a scene would lose its whole plan.
      const sec = spanSec(input, start, end);
      if (sec < MIN_GRAPHIC_SHOT_SEC || sec > MAX_GRAPHIC_SHOT_SEC) return `đồ hoạ ${start}–${end} dài ${sec.toFixed(1)} giây, ngoài ${MIN_GRAPHIC_SHOT_SEC}–${MAX_GRAPHIC_SHOT_SEC} giây`;
    }
    const same = rule.find((span) => span.kind === item.kind && span.wordStart === start && span.wordEnd === end);
    const reason = same ? same.reason : "llm";
    if (item.kind === "footage") {
      if (usableFootage(input) === 0) return "footage cho cảnh không có clip";
      spans.push({ kind: "footage", wordStart: start, wordEnd: end, reason });
    } else if (item.kind === "still") {
      spans.push({ kind: "still", wordStart: start, wordEnd: end, reason });
    } else if (item.kind === "kinetic_text") {
      const parsed = KineticSchema.safeParse(item.payload ?? {});
      const own = parsed.success && parsed.data.lines.every((line) => tokens(line).every((token) => sceneTokens.has(token)));
      const derived = kineticPayload(input, start, end, lang, parsed.success ? parsed.data.style ?? "bold" : "bold");
      if (parsed.success && !own) warn(`Cảnh ${input.scene.sceneId}: chữ của LLM có từ ngoài lời thoại, dùng lời thoại.`);
      if (!own) spans.push({ kind: "kinetic_text", wordStart: start, wordEnd: end, reason, payload: derived });
      else {
        const shown = parsed.data.lines.join(" ").split(/\s+/).filter(Boolean).length;
        spans.push({
          kind: "kinetic_text",
          wordStart: start,
          wordEnd: end,
          reason,
          payload: {
            kind: "kinetic_text",
            lines: parsed.data.lines,
            emphasis: (parsed.data.emphasis ?? []).filter((index) => index < shown),
            style: parsed.data.style ?? "bold",
          },
        });
      }
    } else if (item.kind === "map" || item.kind === "compare" || item.kind === "quote_full" || item.kind === "list_full") {
      const sec = spanSec(input, start, end);
      const fitted = fitGraphicPayload(item.kind, item.payload ?? {});
      const bounds = fitted ? graphicDurationBounds(item.kind, fitted) : null;
      if (!fitted || !bounds || sec < bounds.min - 1e-9 || sec > bounds.max + 1e-9) {
        warn(`Cảnh ${input.scene.sceneId}: ${item.kind} không hợp lệ, dùng ảnh hoặc chữ.`);
        if (item.kind === "map" || sec < MIN_GRAPHIC_SHOT_SEC || sec > MAX_GRAPHIC_SHOT_SEC) {
          spans.push({ kind: plainKind(input), wordStart: start, wordEnd: end, reason: "llm+bad-graphic" });
        } else {
          spans.push({
            kind: "kinetic_text",
            wordStart: start,
            wordEnd: end,
            reason: "llm+bad-graphic",
            payload: kineticPayload(input, start, end, lang, item.kind === "list_full" ? "stack" : "bold"),
          });
        }
        continue;
      }
      spans.push({ kind: item.kind, wordStart: start, wordEnd: end, reason, payload: fitted });
    } else {
      if (same?.payload?.kind === "chart" && !item.payload) {
        spans.push({ ...same });
        continue;
      }
      const parsed = ChartSchema.safeParse(item.payload ?? {});
      if (!parsed.success || parsed.data.labels.length !== parsed.data.values.length) return "biểu đồ thiếu nhãn hoặc số";
      const kept = parsed.data.values.map((value, index) => ({ value, label: parsed.data.labels[index]! })).filter((pair) => stated(pair.value, known));
      const dropped = parsed.data.values.length - kept.length;
      if (dropped > 0) warn(`Cảnh ${input.scene.sceneId}: bỏ ${dropped} số không có trong lời thoại.`);
      const max = parsed.data.chart === "line" ? LINE_MAX_POINTS : CHART_MAX_ITEMS;
      if (kept.length < CHART_MIN_ITEMS || kept.length > max) {
        // Without real numbers there is no chart: the words get a plain picture instead.
        spans.push({ kind: plainKind(input), wordStart: start, wordEnd: end, reason: "llm+no-chart" });
        continue;
      }
      spans.push({
        kind: "chart",
        wordStart: start,
        wordEnd: end,
        reason,
        payload: {
          kind: "chart",
          chart: parsed.data.chart,
          title: parsed.data.title ?? "",
          labels: kept.map((pair) => pair.label),
          values: kept.map((pair) => pair.value),
          ...(parsed.data.unit ? { unit: parsed.data.unit } : {}),
        },
      });
    }
  }
  if (cursor !== count) return `chỉ phủ ${cursor}/${count} từ`;
  return spans;
}

export function mergeLlmAnswer(
  inputs: DirectorInput[],
  rule: KindSpan[][],
  raw: string,
  options: LlmDirectorOptions = {},
): KindSpan[][] {
  const warn = options.onWarning ?? (() => undefined);
  const lang = getLangPack(options.language ?? "vi");
  const answer = parseAnswer(raw);
  if (!answer) {
    warn("LLM đạo diễn trả về JSON không hợp lệ, dùng kết quả luật.");
    return rule;
  }
  const merged = rule.map((spans) => spans);
  let changed = false;
  for (const item of answer) {
    const parsed = SceneSchema.safeParse(item);
    const index = parsed.success ? inputs.findIndex((input) => input.scene.sceneId === parsed.data.sceneId) : -1;
    if (!parsed.success || index < 0) {
      warn("LLM đạo diễn: bỏ một cảnh sai định dạng hoặc sai sceneId.");
      continue;
    }
    const spans = sceneSpans(inputs[index]!, parsed.data, rule[index] ?? [], lang, warn);
    if (typeof spans === "string") {
      warn(`Cảnh ${parsed.data.sceneId}: ${spans}, dùng kết quả luật.`);
      continue;
    }
    merged[index] = spans;
    changed = true;
  }
  const next = changed ? applyVariety(inputs, merged, lang) : rule;
  return applyGraphicsMode(inputs, next, options.composeGraphics);
}

/** The `variants` object of the answer, or an empty record. */
function parseVariants(raw: string): Record<string, unknown> {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  for (const candidate of [text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)]) {
    if (!candidate) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      const variants = value && typeof value === "object" && !Array.isArray(value) ? (value as { variants?: unknown }).variants : undefined;
      if (variants && typeof variants === "object" && !Array.isArray(variants)) return variants as Record<string, unknown>;
    } catch {
      // try the next shape
    }
  }
  return {};
}

/**
 * The shots whose look the LLM changed. A letter (a–d) or a full key must be one of the offered
 * options; anything else keeps the rule pick, so the result is always valid for the picker.
 */
export function variantChoicesFromAnswer(raw: string, options: VariantOptions[]): LlmVariantChoice[] {
  const answer = parseVariants(raw);
  const resolved: Record<string, unknown> = {};
  for (const [id, wanted] of Object.entries(answer)) {
    const offered = options.find((item) => item.shotId === id)?.options ?? [];
    const letter = typeof wanted === "string" ? LETTERS.indexOf(wanted) : -1;
    resolved[id] = letter >= 0 ? offered[letter]?.key : wanted;
  }
  const rulePicks: VariantPick[] = options.flatMap((item) => {
    const best = item.options[0];
    return best ? [{ shotId: item.shotId, templateId: item.templateId, axes: best.axes, key: best.key, reused: false, relaxed: [] }] : [];
  });
  return applyVariantChoices(rulePicks, options, resolved).flatMap((pick, index) => {
    if (pick.key === rulePicks[index]!.key) return [];
    const at = pick.shotId.lastIndexOf("#");
    return [{ sceneId: pick.shotId.slice(0, at), n: Number(pick.shotId.slice(at + 1)), templateId: pick.templateId, key: pick.key }];
  });
}

export function createLlmDirector(llm: LlmCall, options: LlmDirectorOptions = {}): Director {
  return {
    id: "rule+llm",
    async directScenes(inputs) {
      const rule = directByRules(inputs, options);
      if (inputs.length === 0) return rule;
      const variantOptions = options.variants ? options.variants.optionsFor(graphicShotsOf(inputs, rule)).filter((item) => item.options.length > 1) : [];
      let raw: string;
      try {
        raw = await llm(buildDirectorPrompt(inputs, rule, options, variantOptions));
      } catch (error) {
        options.onWarning?.(`LLM đạo diễn lỗi (${error instanceof Error ? error.message : String(error)}), dùng kết quả luật.`);
        return rule;
      }
      if (options.variants && variantOptions.length > 0) options.variants.onChoices(variantChoicesFromAnswer(raw, variantOptions));
      return mergeLlmAnswer(inputs, rule, raw, options);
    },
  };
}
