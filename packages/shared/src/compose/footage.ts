import type { AspectRatio } from "../enums.js";

/** The fields of a footage hit that ranking reads. The server's `FootageHit` fits this shape. */
export type RankableFootage = {
  provider: string;
  clipId: string;
  width: number;
  height: number;
  durationSec: number;
  author: string;
  pageUrl: string;
  tags: string[];
  files?: { width: number; height: number }[];
};

/** What the video has used so far. `clips` holds the windows cut from each clip. */
export type FootageUse = {
  clips: Map<string, { inSec: number; lenSec: number }[]>;
  authors: Map<string, number>;
};

export type FootageRankOptions = {
  aspect: AspectRatio;
  /** Length of the shot to fill. Before the shots are known, pass the pacing target. */
  shotSec?: number;
  /** Short side of the render target. Without it, resolution is not scored. */
  targetShortSide?: number;
  /** Overrides `FOOTAGE_MIN_SCORE`. */
  minScore?: number;
};

/**
 * A hit below this fit (relevance × technical fit) is dropped, and the span becomes a still.
 * Relevance is the mean of "how much of the query the clip covers" and "how many of the clip's tags are
 * about the scene". With Pixabay's usual 3 tags, 0.45 asks for about two matching things: it keeps
 * "woman, phone, sofa" for "person scrolling smartphone" and drops "waterfall, water, nature" for "glass of water".
 */
export const FOOTAGE_MIN_SCORE = 0.45;
/** The first and last part of a stock clip are skipped (camera settling, fades). */
export const FOOTAGE_EDGE_SEC = 0.5;
/** Two shots cut from one clip must be at least this far apart, or they look like a repeat. */
export const FOOTAGE_REUSE_GAP_SEC = 1;
/** A third clip by the same author is ranked down by this factor. It never drops a clip. */
export const FOOTAGE_AUTHOR_LIMIT = 2;
const AUTHOR_FACTOR = 0.8;
/** A hit with no tags and no URL words gives no evidence either way: trust the provider's search a little. */
const NO_EVIDENCE_RELEVANCE = 0.5;
const ALT_QUERY_WEIGHT = 0.85;
const SECOND_QUERY_BONUS = 0.1;
const SCENE_WORD_BONUS = 0.05;
/** Tag evidence is full at this many on-topic tags, so a clip with a long tag list is not marked down. */
const FULL_TAG_EVIDENCE = 3;
const STYLE_WEIGHT = 0.4;
const WRONG_SHAPE_FACTOR = 0.75;
const SHORT_CLIP_FACTOR = 0.8;
const LOW_RES_FLOOR = 0.6;
/** The renderer accepts a clip this much shorter than the shot before it holds the last frame. */
const FIT_TOLERANCE_SEC = 0.05;
const SYNTHETIC_FACTOR = 0.7;

const STOP = new Set([
  "a", "an", "the", "of", "in", "on", "at", "with", "and", "or", "for", "to", "from", "by", "is", "are", "as", "its", "their",
  "his", "her", "into", "over", "under", "near", "while", "during", "that", "this", "it", "be", "being", "up", "id",
  // words every stock clip can carry
  "video", "videos", "footage", "clip", "stock", "background", "hd", "4k", "uhd", "shot", "scene", "view", "free",
]);
/** Words about how a clip is filmed, not what it shows. They count, but much less than a subject word. */
const STYLE = new Set([
  "aerial", "drone", "slow", "motion", "timelapse", "lapse", "time", "closeup", "close", "macro", "pov", "cinematic",
  "wide", "angle", "top", "overhead", "blur", "bokeh", "loop",
]);
const SYNTHETIC = new Set(["animation", "animated", "cartoon", "3d", "render", "cgi", "illustration", "graphic", "abstract", "particle"]);
const SYNONYMS: string[][] = [
  ["sea", "ocean"],
  ["city", "urban", "downtown", "cityscape", "metropolis"],
  ["person", "people", "man", "woman", "human", "men", "women", "guy", "girl", "boy"],
  ["kid", "child", "children", "toddler"],
  ["car", "vehicle", "automobile", "traffic"],
  ["phone", "smartphone", "mobile", "cellphone", "iphone"],
  ["computer", "laptop", "pc"],
  ["money", "cash", "currency", "dollar", "banknote"],
  ["forest", "wood", "jungle", "tree"],
  ["office", "workplace", "workspace"],
  ["doctor", "physician", "medical"],
  ["food", "meal", "dish", "cuisine"],
  ["exercise", "workout", "fitness", "gym", "stretch"],
  ["sleep", "asleep", "bed", "nap"],
  ["cafe", "coffeehouse", "coffeeshop"],
  ["village", "countryside", "rural"],
];
const CANON = new Map<string, string>();
for (const group of SYNONYMS) for (const word of group) CANON.set(word, group[0]!);

/** The forms a word may match under: singular, and for an "-ing" word its base with and without a final "e". */
function forms(word: string): string[] {
  let base = word;
  if (base.length > 4 && base.endsWith("ies")) base = `${base.slice(0, -3)}y`;
  else if (base.length > 4 && /(s|x|z|ch|sh)es$/.test(base)) base = base.slice(0, -2);
  else if (base.length > 3 && base.endsWith("s") && !base.endsWith("ss")) base = base.slice(0, -1);
  const out = [base];
  if (base.length > 5 && base.endsWith("ing")) {
    let root = base.slice(0, -3);
    if (root.at(-1) === root.at(-2) && !/[aeiouls]/.test(root.at(-1)!)) root = root.slice(0, -1);
    out.push(root, `${root}e`);
  }
  return [...new Set(out.flatMap((form) => [form, CANON.get(form) ?? form]))];
}

function tokens(text: string): string[] {
  return text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP.has(word) && !/^\d+$/.test(word));
}

/** The clip's tags as word lists. Pexels has no tags, so the words of its URL slug stand in, one tag each. */
function hitTags(hit: RankableFootage): string[][] {
  const tags = hit.tags.map(tokens).filter((words) => words.length > 0);
  if (tags.length) return tags;
  const slug = hit.pageUrl.split(/[?#]/)[0]!.split("/").filter(Boolean).at(-1) ?? "";
  return /[a-z]-/i.test(slug) ? tokens(slug).map((word) => [word]) : [];
}

function has(words: Set<string>, word: string): boolean {
  return forms(word).some((form) => words.has(form));
}

function weightOf(word: string): number {
  return STYLE.has(word) ? STYLE_WEIGHT : 1;
}

/** Share of the query's words that the clip carries. */
function coverage(query: string, words: Set<string>): number {
  let total = 0;
  let matched = 0;
  for (const word of new Set(tokens(query))) {
    total += weightOf(word);
    if (has(words, word)) matched += weightOf(word);
  }
  return total > 0 ? matched / total : 0;
}

/** Share of the clip's tags that are about something the queries ask for. */
function tagEvidence(tags: string[][], queries: string[]): number {
  const asked = new Set(queries.flatMap(tokens).flatMap(forms));
  let matched = 0;
  for (const tag of tags) {
    matched += Math.max(0, ...tag.filter((word) => has(asked, word)).map(weightOf));
  }
  return Math.min(1, matched / Math.min(tags.length, FULL_TAG_EVIDENCE));
}

/** 0–1: how well the hit's tags (or URL words) match the scene's visual queries. The first query is the main one. */
export function footageRelevance(sceneText: string, queries: string[], hit: RankableFootage): number {
  const tags = hitTags(hit);
  if (tags.length === 0) return NO_EVIDENCE_RELEVANCE;
  const words = new Set(tags.flat().flatMap(forms));
  const scores = queries
    .map((query, index) => coverage(query, words) * (index === 0 ? 1 : ALT_QUERY_WEIGHT))
    .sort((a, b) => b - a);
  const covered = Math.min(1, (scores[0] ?? 0) + SECOND_QUERY_BONUS * (scores[1] ?? 0));
  let relevance = (covered + tagEvidence(tags, queries)) / 2;
  // Names said in the scene that the clip also carries (brands, places; any content word in an English video).
  // Only plain a–z words of 4+ letters count, so a Vietnamese word without its marks cannot match by accident.
  const said = new Set(sceneText.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((word) => /^[a-z0-9]{4,}$/.test(word) && !STOP.has(word) && !STYLE.has(word)));
  let named = 0;
  for (const word of said) if (has(words, word)) named += 1;
  relevance += SCENE_WORD_BONUS * Math.min(named, 2);
  const asked = queries.flatMap(tokens);
  const synthetic = [...SYNTHETIC].some((word) => words.has(word)) && !asked.some((word) => SYNTHETIC.has(word));
  if (synthetic) relevance *= SYNTHETIC_FACTOR;
  return Math.min(1, relevance);
}

function shapeFactor(hit: RankableFootage, aspect: AspectRatio): number {
  if (hit.width <= 0 || hit.height <= 0) return WRONG_SHAPE_FACTOR;
  const ratio = hit.width / hit.height;
  if (aspect === "9:16") return ratio < 1 ? 1 : WRONG_SHAPE_FACTOR;
  if (aspect === "1:1") return ratio > 0.7 && ratio < 1.45 ? 1 : 0.9;
  return ratio >= 1 ? 1 : WRONG_SHAPE_FACTOR;
}

function resolutionFactor(hit: RankableFootage, targetShortSide?: number): number {
  if (!targetShortSide) return 1;
  const sides = [hit, ...(hit.files ?? [])].map((file) => Math.min(file.width, file.height));
  const best = Math.max(...sides);
  return best >= targetShortSide ? 1 : Math.max(LOW_RES_FLOOR, best / targetShortSide);
}

function durationFactor(hit: RankableFootage, shotSec?: number): number {
  if (!shotSec) return 1;
  if (hit.durationSec >= shotSec + 2 * FOOTAGE_EDGE_SEC) return 1;
  // Long enough to play without a frozen end, but the edges cannot be skipped.
  return hit.durationSec >= shotSec - FIT_TOLERANCE_SEC ? SHORT_CLIP_FACTOR : 0;
}

/**
 * Relevance × how well the picture suits the frame (shape, resolution), 0–1. The threshold is applied to this
 * value. Clip length and author are not part of it: they order the hits but say nothing about the topic.
 */
export function footageFit(sceneText: string, queries: string[], hit: RankableFootage, options: FootageRankOptions): number {
  return footageRelevance(sceneText, queries, hit)
    * shapeFactor(hit, options.aspect)
    * resolutionFactor(hit, options.targetShortSide);
}

export function footageKey(hit: Pick<RankableFootage, "provider" | "clipId">): string {
  return `${hit.provider}:${hit.clipId}`;
}

export function emptyFootageUse(): FootageUse {
  return { clips: new Map(), authors: new Map() };
}

/**
 * Best hits first. Left out: hits already used in the video, hits below the threshold, and clips shorter than
 * the shot. So an empty result means "use a still". A clip with no room to skip its edges, or by an author
 * used twice already, is ranked down, never dropped.
 */
export function rankFootage<T extends RankableFootage>(
  sceneText: string,
  queries: string[],
  hits: T[],
  used: FootageUse,
  options: FootageRankOptions = { aspect: "16:9" },
): T[] {
  const min = options.minScore ?? FOOTAGE_MIN_SCORE;
  const seen = new Set<string>();
  const scored: { hit: T; order: number; score: number }[] = [];
  hits.forEach((hit, order) => {
    const key = footageKey(hit);
    if (seen.has(key) || used.clips.has(key)) return;
    seen.add(key);
    const fit = footageFit(sceneText, queries, hit, options);
    const room = durationFactor(hit, options.shotSec);
    if (fit < min || room === 0) return;
    const crowded = (used.authors.get(hit.author) ?? 0) >= FOOTAGE_AUTHOR_LIMIT;
    scored.push({ hit, order, score: fit * room * (crowded ? AUTHOR_FACTOR : 1) });
  });
  // Ties keep the provider's order, so the same input always gives the same list.
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((item) => item.hit);
}

/**
 * Shares the clips out so that two scenes never plan around the same clip. It works in rounds: every scene
 * asks for its best clip that is still free; when two scenes ask for the same clip, the better fit gets it
 * (the earlier scene on a tie) and the other asks again in the next round. One scene cannot take every clip
 * while its neighbour, which found the same clips, is left with stills.
 */
export function assignFootage<T extends RankableFootage>(
  scenes: { text: string; queries: string[]; hits: T[] }[],
  options: FootageRankOptions,
  perScene = 6,
): T[][] {
  const wanted = scenes.map((scene) => rankFootage(scene.text, scene.queries, scene.hits, emptyFootageUse(), options)
    .map((hit) => ({ hit, fit: footageFit(scene.text, scene.queries, hit, options) })));
  const taken = new Set<string>();
  const out: T[][] = scenes.map(() => []);
  for (;;) {
    const asks = new Map<string, { scene: number; hit: T; fit: number }>();
    wanted.forEach((list, scene) => {
      if (out[scene]!.length >= perScene) return;
      const next = list.find((item) => !taken.has(footageKey(item.hit)));
      if (!next) return;
      const key = footageKey(next.hit);
      const rival = asks.get(key);
      if (!rival || next.fit > rival.fit + 1e-9) asks.set(key, { scene, ...next });
    });
    if (asks.size === 0) return out;
    for (const [key, ask] of asks) {
      taken.add(key);
      out[ask.scene]!.push(ask.hit);
    }
  }
}

/**
 * Where to start in the clip. The first shot starts after the skipped edge; a second shot from the same
 * clip takes the far end, so the two show different parts. `null` means the clip has no room.
 */
export function pickInSec(durationSec: number, shotSec: number, earlier: { inSec: number; lenSec: number }[] = []): number | null {
  const round = (value: number) => Math.round(value * 100) / 100;
  if (earlier.length === 0) {
    if (durationSec >= shotSec + 2 * FOOTAGE_EDGE_SEC) return FOOTAGE_EDGE_SEC;
    return durationSec >= shotSec - FIT_TOLERANCE_SEC ? round(Math.max(0, (durationSec - shotSec) / 2)) : null;
  }
  if (earlier.length > 1) return null;
  const first = earlier[0]!;
  const start = durationSec - FOOTAGE_EDGE_SEC - shotSec;
  return start >= first.inSec + first.lenSec + FOOTAGE_REUSE_GAP_SEC ? round(start) : null;
}

export function noteFootageUse(used: FootageUse, hit: Pick<RankableFootage, "provider" | "clipId" | "author">, inSec: number, lenSec: number): void {
  const key = footageKey(hit);
  const windows = used.clips.get(key);
  if (windows) windows.push({ inSec, lenSec });
  else {
    used.clips.set(key, [{ inSec, lenSec }]);
    used.authors.set(hit.author, (used.authors.get(hit.author) ?? 0) + 1);
  }
}
