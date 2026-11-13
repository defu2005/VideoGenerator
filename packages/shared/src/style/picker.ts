import { axisChoices, templateManifest, type TemplateManifest } from "./axes.js";
import { styleHash } from "./pack.js";
import type { StyleAspect, StyleTokens } from "./tokens.js";

/**
 * Variant engine (TASK-106): picks one value per axis for every graphic shot.
 *
 * - Deterministic: the same seed, shots, style and history give the same picks.
 * - Stays in the channel's style: only values `axisChoices` allows.
 * - Rotates: a combination used in the channel's last `window` videos is not used again
 *   while an unused one exists; inside one video it avoids repeating itself and avoids
 *   handing two neighbouring shots the same look.
 * - A value fixed on the shot (by the user or the director) is never changed.
 */

export type VariantShot = {
  id: string;
  templateId: string;
  /** Axis values already fixed for this shot. They win over everything, even the style. */
  pinned?: Record<string, string>;
};

/** What one earlier video of the channel used. Newest video first in `LookHistory.videos`. */
export type LookHistory = {
  videos: { videoId: string; combos: { templateId: string; key: string }[] }[];
};

export type VariantPick = {
  shotId: string;
  templateId: string;
  axes: Record<string, string>;
  /** Canonical text of `axes`: `axis=value` pairs sorted by axis, joined by `;`. */
  key: string;
  /** True when every allowed combination was already used in the window. */
  reused: boolean;
  /** Steps `axisChoices` had to skip, as `axis:step`. */
  relaxed: string[];
};

export type VariantInput = {
  /** Video-level seed, for example `${channelId}|${projectId}`. */
  seed: string;
  shots: VariantShot[];
  tokens: StyleTokens;
  aspect: StyleAspect;
  /** `pack.seed ?? pack.id`. Fixes the channel's home values. */
  packSeed: string;
  history?: LookHistory;
  /** How many recent videos must not repeat a combination. */
  window?: number;
  manifests?: Record<string, TemplateManifest>;
};

export const DEFAULT_VARIANT_WINDOW = 5;
const MAX_COMBOS = 240;

export function variantKey(axes: Record<string, string>): string {
  return Object.keys(axes).sort().map((axis) => `${axis}=${axes[axis]}`).join(";");
}

/** 0 ≤ x < 1 from a string. */
function unit(text: string): number {
  return parseInt(styleHash(text), 16) / 0x100000000;
}

type Candidate = { axes: Record<string, string>; key: string };

function combinations(lists: { axis: string; values: string[] }[]): Record<string, string>[] {
  let out: Record<string, string>[] = [{}];
  for (const list of lists) {
    const next: Record<string, string>[] = [];
    for (const partial of out) {
      for (const value of list.values) {
        next.push({ ...partial, [list.axis]: value });
        if (next.length >= MAX_COMBOS) break;
      }
      if (next.length >= MAX_COMBOS) break;
    }
    out = next;
  }
  return out;
}

function candidatesFor(shot: VariantShot, input: VariantInput): { candidates: Candidate[]; relaxed: string[] } {
  const manifest = templateManifest(shot.templateId, input.manifests);
  if (!manifest) return { candidates: [{ axes: {}, key: "" }], relaxed: ["manifest"] };
  const relaxed: string[] = [];
  const lists = manifest.axes.map((axis) => {
    const pinned = shot.pinned?.[axis.id];
    if (pinned !== undefined && axis.values.some((value) => value.id === pinned)) return { axis: axis.id, values: [pinned] };
    const choice = axisChoices(manifest, axis, { tokens: input.tokens, aspect: input.aspect, packSeed: input.packSeed });
    for (const step of choice.relaxed) relaxed.push(`${axis.id}:${step}`);
    return { axis: axis.id, values: choice.values };
  });
  const candidates = combinations(lists).map((axes) => ({ axes, key: variantKey(axes) }));
  return { candidates, relaxed };
}

type Score = [recent: number, sameVideo: number, neighbour: number, wear: number, lastSeen: number, jitter: number];

function compare(a: Score, b: Score): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

type State = {
  /** `template|key` → uses in this video. */
  used: Map<string, number>;
  /** `axis=value` → uses in this video. */
  wear: Map<string, number>;
  previous: Record<string, string> | null;
};

function rank(shot: VariantShot, input: VariantInput, state: State): { ranked: { candidate: Candidate; score: Score }[]; relaxed: string[] } {
  const { candidates, relaxed } = candidatesFor(shot, input);
  const window = input.window ?? DEFAULT_VARIANT_WINDOW;
  const videos = input.history?.videos ?? [];
  const ranked = candidates.map((candidate) => {
    const id = `${shot.templateId}|${candidate.key}`;
    // Age of the newest video that used this combination: 0 is the last video.
    const age = videos.findIndex((video) => video.combos.some((combo) => combo.templateId === shot.templateId && combo.key === candidate.key));
    const entries = Object.entries(candidate.axes);
    const neighbour = state.previous ? entries.filter(([axis, value]) => state.previous![axis] === value).length : 0;
    const wear = entries.reduce((sum, [axis, value]) => sum + (state.wear.get(`${axis}=${value}`) ?? 0), 0);
    const score: Score = [
      age >= 0 && age < window ? 1 : 0,
      state.used.get(id) ?? 0,
      neighbour,
      wear,
      age < 0 ? 0 : 1 / (1 + age),
      unit(`${input.seed}|${shot.id}|${id}`),
    ];
    return { candidate, score };
  });
  ranked.sort((a, b) => compare(a.score, b.score));
  return { ranked, relaxed };
}

function note(state: State, shot: VariantShot, candidate: Candidate): void {
  const id = `${shot.templateId}|${candidate.key}`;
  state.used.set(id, (state.used.get(id) ?? 0) + 1);
  for (const [axis, value] of Object.entries(candidate.axes)) {
    state.wear.set(`${axis}=${value}`, (state.wear.get(`${axis}=${value}`) ?? 0) + 1);
  }
  state.previous = candidate.axes;
}

function toPick(shot: VariantShot, candidate: Candidate, score: Score, relaxed: string[]): VariantPick {
  return { shotId: shot.id, templateId: shot.templateId, axes: candidate.axes, key: candidate.key, reused: score[0] === 1, relaxed };
}

/** One pick per shot, in shot order. */
export function pickVariants(input: VariantInput): VariantPick[] {
  const state: State = { used: new Map(), wear: new Map(), previous: null };
  return input.shots.map((shot) => {
    const { ranked, relaxed } = rank(shot, input, state);
    const best = ranked[0]!;
    note(state, shot, best.candidate);
    return toPick(shot, best.candidate, best.score, relaxed);
  });
}

export type VariantOptions = { shotId: string; templateId: string; options: { key: string; axes: Record<string, string> }[] };

/**
 * For QUALITY mode: the best `limit` valid combinations per shot, rule pick first. The LLM may
 * only choose among these, so it cannot leave the channel's style or break the rotation rule
 * when a fresh combination exists.
 */
export function variantOptions(input: VariantInput, limit = 4): VariantOptions[] {
  const state: State = { used: new Map(), wear: new Map(), previous: null };
  return input.shots.map((shot) => {
    const { ranked } = rank(shot, input, state);
    const fresh = ranked.filter((item) => item.score[0] === 0);
    const pool = fresh.length > 0 ? fresh : ranked;
    note(state, shot, ranked[0]!.candidate);
    return { shotId: shot.id, templateId: shot.templateId, options: pool.slice(0, Math.max(1, limit)).map((item) => item.candidate) };
  });
}

/**
 * Applies an LLM answer (`shotId → key`) on top of the rule picks. An answer that is not one
 * of the offered options is ignored, so the result is always valid.
 */
export function applyVariantChoices(picks: VariantPick[], options: VariantOptions[], answer: Record<string, unknown>): VariantPick[] {
  return picks.map((pick) => {
    const wanted = answer[pick.shotId];
    const offered = options.find((item) => item.shotId === pick.shotId)?.options ?? [];
    const chosen = typeof wanted === "string" ? offered.find((option) => option.key === wanted) : undefined;
    if (!chosen || chosen.key === pick.key) return pick;
    return { ...pick, axes: chosen.axes, key: chosen.key };
  });
}

/** The history entry a finished video adds. */
export function lookHistoryEntry(videoId: string, picks: VariantPick[]): LookHistory["videos"][number] {
  return { videoId, combos: picks.map((pick) => ({ templateId: pick.templateId, key: pick.key })) };
}
