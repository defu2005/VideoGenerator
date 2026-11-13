import {
  fitGraphicPayload,
  quoteWords,
  startsWithOrdinal,
  type ComposeLangPack,
  type SceneWord,
  type ShotSource,
} from "@vg/shared";
import { directivesOf, type DirectorInput } from "../director.js";
import { mapCatalog } from "../render/mapGeo.js";

/** A graphic the rule director may insert. The variety pass still enforces the 30 % cap. */
export type GraphicPiece = {
  kind: "map" | "compare" | "quote_full" | "list_full";
  start: number;
  end: number;
  reason: string;
  payload: ShotSource;
};

type PlaceHit = { id: string; level: number; label: string; parent?: string; phrase: string };

let placesCache: PlaceHit[] | null = null;

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
}

function token(text: string): string {
  return fold(text).replace(/[^a-z0-9]+/g, "");
}

function spanSec(input: DirectorInput, start: number, end: number): number {
  const words = input.words;
  if (!words.length || end <= start) return 0;
  const stop = end >= words.length ? Math.max(input.scene.durationSec, words[words.length - 1]!.endSec) : words[end - 1]!.endSec;
  const begin = start <= 0 ? 0 : words[Math.min(start, words.length) - 1]!.endSec;
  return Math.max(0, stop - begin);
}

function fitRange(input: DirectorInput, start: number, end: number, min: number, max: number): { start: number; end: number } | null {
  let left = start;
  let right = end;
  while (spanSec(input, left, right) < min && right < input.words.length) right += 1;
  while (spanSec(input, left, right) < min && left > 0) left -= 1;
  while (spanSec(input, left, right) > max && right - 1 > start) right -= 1;
  while (spanSec(input, left, right) > max && left + 1 < end) left += 1;
  const sec = spanSec(input, left, right);
  if (left >= right || sec < min - 0.05 || sec > max + 0.05) return null;
  return { start: left, end: right };
}

function places(): PlaceHit[] {
  if (placesCache) return placesCache;
  try {
    const { world, provinces } = mapCatalog();
    const hits: PlaceHit[] = [];
    for (const feature of [...world, ...provinces]) {
      const props = feature.properties;
      const label = (props.name_vi || props.name_en || props.name || "").trim().slice(0, 40);
      const names = [props.name, props.name_en, props.name_vi].filter((name): name is string => Boolean(name?.trim()));
      for (const name of names) {
        const phrase = fold(name).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
        if (phrase.replace(/ /g, "").length < 4) continue;
        hits.push({ id: props.id, level: props.level ?? 0, label, parent: props.parent, phrase });
      }
    }
    hits.sort((a, b) => b.phrase.length - a.phrase.length);
    placesCache = hits;
  } catch {
    placesCache = [];
  }
  return placesCache;
}

function wordAt(tokens: string[], phrase: string): number {
  const joined = ` ${tokens.join(" ")} `;
  const at = joined.indexOf(` ${phrase} `);
  if (at < 0) return -1;
  return joined.slice(0, at).trim().split(/\s+/).filter(Boolean).length;
}

function mapPiece(input: DirectorInput): GraphicPiece | null {
  if (directivesOf(input).disabledKinds.includes("map")) return null;
  const tokens = input.words.map((word) => token(word.text)).filter(Boolean);
  const joined = ` ${tokens.join(" ")} `;
  const place = places().find((item) => joined.includes(` ${item.phrase} `));
  if (!place) return null;
  const at = wordAt(tokens, place.phrase);
  if (at < 0) return null;
  const range = fitRange(input, at, Math.min(input.words.length, at + place.phrase.split(" ").length), 2.5, 7);
  if (!range) return null;
  const payload = fitGraphicPayload("map", {
    kind: "map",
    focus: place.id,
    label: place.label,
    zoom: "push",
    highlight: "fill",
    neighbours: place.level === 0,
    ...(place.level > 0 ? { from: place.parent || "VN" } : {}),
  });
  if (!payload) return null;
  return { kind: "map", start: range.start, end: range.end, reason: "R7-map", payload };
}

function findWords(tokens: string[], phrase: string[]): number {
  for (let index = 0; index <= tokens.length - phrase.length; index += 1) {
    if (phrase.every((part, offset) => tokens[index + offset] === part)) return index;
  }
  return -1;
}

function side(words: string[]): { label: string; text: string } | null {
  const clean = words.map((word) => word.replace(/[,;:.!?…"“”]+$/gu, "").replace(/^["“”]+/gu, "")).filter(Boolean);
  if (!clean.length) return null;
  let label = clean.slice(0, 2).join(" ");
  if (label.length > 16) label = clean[0]!.slice(0, 16).trim();
  let text = clean.join(" ");
  if (text.length > 40) text = text.slice(0, 40).trim();
  if (!label || !text) return null;
  return { label, text };
}

function comparePiece(input: DirectorInput, lang: ComposeLangPack): GraphicPiece | null {
  const directives = directivesOf(input);
  if (directives.disabledKinds.includes("compare")) return null;
  const tokens = input.words.map((word) => token(word.text));
  const vi = lang.code === "vi";
  const pairs: { at: number; size: number; style: "versus" | "before_after" | "myth_fact"; rightAt: number }[] = [];
  const versus = vi ? [["so", "voi"], ["khac", "voi"]] : [["compared", "to"], ["versus"]];
  for (const phrase of versus) {
    const at = findWords(tokens, phrase);
    if (at >= 0) pairs.push({ at, size: phrase.length, style: "versus", rightAt: at + phrase.length });
  }
  const before = findWords(tokens, vi ? ["truoc"] : ["before"]);
  const after = before < 0 ? -1 : tokens.findIndex((item, index) => index > before && item === (vi ? "sau" : "after"));
  if (before >= 0 && after > before) pairs.push({ at: before, size: 1, style: "before_after", rightAt: after + 1 });
  if (!pairs.length && directives.compareFallback && input.words.length >= 4) {
    const mid = Math.floor(input.words.length / 2);
    pairs.push({ at: mid, size: 0, style: "myth_fact", rightAt: mid });
  }
  const found = pairs[0];
  if (!found) return null;
  const leftWords = input.words.slice(Math.max(0, found.at - 6), found.at).map((word) => word.text);
  const rightWords = input.words.slice(found.rightAt, Math.min(input.words.length, found.rightAt + 6)).map((word) => word.text);
  const left = side(leftWords);
  const right = side(rightWords);
  if (!left || !right) return null;
  const coreStart = found.size === 0 ? 0 : found.at;
  const coreEnd = found.size === 0 ? input.words.length : Math.min(input.words.length, found.rightAt + 4);
  let reveal: "sequence" | "together" = "sequence";
  let range = fitRange(input, coreStart, coreEnd, 2.5, 6);
  if (!range) {
    range = fitRange(input, coreStart, coreEnd, 2, 6);
    reveal = "together";
  }
  if (!range) return null;
  const payload = fitGraphicPayload("compare", {
    kind: "compare",
    left,
    right,
    style: found.style,
    reveal,
    winner: "none",
  });
  if (!payload) return null;
  return { kind: "compare", start: range.start, end: range.end, reason: "R8-compare", payload };
}

function quotePiece(input: DirectorInput, lang: ComposeLangPack): GraphicPiece | null {
  if (directivesOf(input).disabledKinds.includes("quote_full")) return null;
  if (!lang.quoteMarks.length) return null;
  for (const [open, close] of lang.quoteMarks) {
    const start = input.words.findIndex((word) => word.text.includes(open));
    if (start < 0) continue;
    const endWord = input.words.findIndex((word, index) => index >= start && word.text.includes(close));
    if (endWord < start) continue;
    const quote = input.words.slice(start, endWord + 1).map((word) => word.text).join(" ")
      .replaceAll(open, "").replaceAll(close, "").replace(/[“”"]/gu, "").trim();
    const count = quoteWords(quote).length;
    if (count < 6 || count > 28 || quote.length > 160) continue;
    const before = input.words.slice(Math.max(0, start - 5), start).map((word) => word.text.replace(/[:：,]+$/u, ""));
    const beforeText = before.join(" ");
    const said = beforeText.match(/([\p{L}.]+(?:\s+[\p{L}.]+){0,3})\s+(?:nói|said|says|wrote)$/iu);
    const after = input.words.slice(endWord + 1, endWord + 5).map((word) => word.text).join(" ");
    const signed = after.match(/^(?:—|–|-)\s*([\p{L}.]+(?:\s+[\p{L}.]+){0,3})/u);
    const speaker = (said?.[1] ?? signed?.[1] ?? "").replace(/[.,]+$/u, "").trim().slice(0, 32);
    if (!speaker) continue;
    const range = fitRange(input, said ? Math.max(0, start - before.length) : start, endWord + 1, 3, 10);
    if (!range) continue;
    const payload = fitGraphicPayload("quote_full", { kind: "quote_full", quote, speaker, reveal: "appear" });
    if (!payload) continue;
    return { kind: "quote_full", start: range.start, end: range.end, reason: "R9-quote", payload };
  }
  return null;
}

function sentences(words: SceneWord[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  words.forEach((word, index) => {
    if (!word.sentenceEnd && index < words.length - 1) return;
    out.push({ start, end: index + 1 });
    start = index + 1;
  });
  return out;
}

function itemText(words: string[], lang: ComposeLangPack): string {
  const cleaned = words.map((word) => word.replace(/[,;:.!?…]+$/u, ""));
  let rest = cleaned;
  if (/^\d{1,3}[.)]$/.test(words[0] ?? "")) rest = cleaned.slice(1);
  else {
    for (let size = Math.min(3, cleaned.length - 1); size >= 1; size -= 1) {
      if (startsWithOrdinal(cleaned.slice(0, size), lang)) {
        rest = cleaned.slice(size);
        break;
      }
    }
  }
  return rest.join(" ").trim();
}

function listPiece(input: DirectorInput, lang: ComposeLangPack): GraphicPiece | null {
  if (directivesOf(input).disabledKinds.includes("list_full")) return null;
  const groups = sentences(input.words);
  const found: { start: number; end: number; text: string }[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    let { start, end } = groups[index]!;
    let slice = input.words.slice(start, end).map((word) => word.text);
    const cleaned = slice.map((word) => word.replace(/[,;:.!?…]+$/u, ""));
    if (!startsWithOrdinal(cleaned, lang) && !/^\d{1,3}[.)]$/.test(slice[0] ?? "")) continue;
    let text = itemText(slice, lang);
    const next = groups[index + 1];
    if (!text && next) {
      end = next.end;
      index += 1;
      slice = input.words.slice(start, end).map((word) => word.text);
      text = itemText(slice, lang);
    }
    if (!text || text.length > 36) continue;
    found.push({ start, end, text });
  }
  if (found.length < 3) return null;
  for (let count = Math.min(6, found.length); count >= 3; count -= 1) {
    const chosen = found.slice(0, count);
    const min = 0.8 * count + 0.8;
    const range = fitRange(input, chosen[0]!.start, chosen[count - 1]!.end, min, 12);
    if (!range) continue;
    const payload = fitGraphicPayload("list_full", {
      kind: "list_full",
      items: chosen.map((item) => item.text),
      highlight: "bar",
      marker: "number",
    });
    if (!payload) continue;
    return { kind: "list_full", start: range.start, end: range.end, reason: "R10-list", payload };
  }
  return null;
}

function overlaps(start: number, end: number, taken: { start: number; end: number }[]): boolean {
  return taken.some((piece) => start < piece.end && piece.start < end);
}

/** First matching kind that does not sit on a graphic already chosen for this scene. */
export function graphicKindPiece(input: DirectorInput, lang: ComposeLangPack, taken: { start: number; end: number }[] = []): GraphicPiece | null {
  const candidates = [quotePiece(input, lang), listPiece(input, lang), comparePiece(input, lang), mapPiece(input)].filter((item): item is GraphicPiece => item !== null);
  return candidates.find((item) => !overlaps(item.start, item.end, taken)) ?? null;
}
