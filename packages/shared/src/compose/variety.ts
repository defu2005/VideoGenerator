import { isGraphicKind } from "./graphicKind.js";
import type { KindSpan, ShotKind } from "./schema.js";

export type VarietyScene = {
  words: { text: string; startSec: number; endSec: number }[];
  spans: KindSpan[];
  hasFootage: boolean;
  hasStill: boolean;
};

export type VarietyChange = {
  scene: number;
  span: number;
  from: ShotKind;
  to: ShotKind;
  rule: "V1-run" | "V2-still" | "V3-graphic" | "V4-subtitle";
};

const HOOK = /R2-hook/;

function spanSec(scene: VarietyScene, wordStart: number, wordEnd: number): number {
  const start = scene.words[wordStart]?.startSec;
  const end = scene.words[wordEnd - 1]?.endSec;
  if (start === undefined || end === undefined) return 0;
  return Math.max(0, end - start);
}

function duration(scene: VarietyScene, span: KindSpan): number {
  return spanSec(scene, span.wordStart, span.wordEnd);
}

function runtime(scenes: VarietyScene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.spans.reduce((inner, span) => inner + duration(scene, span), 0), 0);
}

function over(used: number, total: number, limit: number): boolean {
  return total > 0 && used > total * limit + 1e-9;
}

function graphicSec(scenes: VarietyScene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.spans.reduce((inner, span) => (
    isGraphicKind(span.kind) ? inner + duration(scene, span) : inner
  ), 0), 0);
}

function stillSec(scenes: VarietyScene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.spans.reduce((inner, span) => (
    span.kind === "still" ? inner + duration(scene, span) : inner
  ), 0), 0);
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
}

function subtitleOverlap(scene: VarietyScene, span: KindSpan): number {
  if (span.payload?.kind !== "kinetic_text") return 0;
  const spoken = scene.words.slice(span.wordStart, span.wordEnd).flatMap((word) => tokens(word.text));
  const lines = span.payload.lines.flatMap((line) => tokens(line));
  if (spoken.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const token of lines) pool.set(token, (pool.get(token) ?? 0) + 1);
  let hit = 0;
  for (const token of spoken) {
    const count = pool.get(token) ?? 0;
    if (count > 0) {
      hit += 1;
      pool.set(token, count - 1);
    }
  }
  return hit / spoken.length;
}

function isSubtitleCopy(scene: VarietyScene, span: KindSpan): boolean {
  return span.kind === "kinetic_text" && duration(scene, span) > 3 && subtitleOverlap(scene, span) >= 0.8;
}

function otherKind(scene: VarietyScene, current: ShotKind): ShotKind | null {
  if (current !== "footage" && scene.hasFootage) return "footage";
  if (current !== "still" && scene.hasStill) return "still";
  return null;
}

function convert(span: KindSpan, to: ShotKind, rule: VarietyChange["rule"]): void {
  const from = span.kind;
  span.kind = to;
  delete span.payload;
  span.reason = `${span.reason}+${rule}`;
  void from;
}

function v2Applies(scenes: VarietyScene[]): boolean {
  return scenes.length > 0 && scenes.filter((scene) => scene.hasFootage).length / scenes.length >= 0.5;
}

function stillWouldExceed(scenes: VarietyScene[], sceneIndex: number, spanIndex: number): boolean {
  if (!v2Applies(scenes)) return false;
  const total = runtime(scenes);
  let still = stillSec(scenes);
  const span = scenes[sceneIndex]?.spans[spanIndex];
  if (!span || span.kind === "still") return over(still, total, 0.4);
  still += duration(scenes[sceneIndex]!, span);
  return over(still, total, 0.4);
}

export function checkVariety(scenes: VarietyScene[]): { rule: VarietyChange["rule"]; scene: number; span: number }[] {
  const found: { rule: VarietyChange["rule"]; scene: number; span: number }[] = [];
  const total = runtime(scenes);
  if (over(graphicSec(scenes), total, 0.3)) {
    scenes.forEach((scene, sceneIndex) => scene.spans.forEach((span, spanIndex) => {
      if (isGraphicKind(span.kind)) found.push({ rule: "V3-graphic", scene: sceneIndex, span: spanIndex });
    }));
  }
  scenes.forEach((scene, sceneIndex) => scene.spans.forEach((span, spanIndex) => {
    if (isSubtitleCopy(scene, span)) found.push({ rule: "V4-subtitle", scene: sceneIndex, span: spanIndex });
  }));
  if (v2Applies(scenes) && over(stillSec(scenes), total, 0.4)) {
    scenes.forEach((scene, sceneIndex) => scene.spans.forEach((span, spanIndex) => {
      if (span.kind === "still") found.push({ rule: "V2-still", scene: sceneIndex, span: spanIndex });
    }));
  }
  let runKind: ShotKind | null = null;
  let run = 0;
  scenes.forEach((scene, sceneIndex) => scene.spans.forEach((span, spanIndex) => {
    run = span.kind === runKind ? run + 1 : 1;
    runKind = span.kind;
    if (run >= 3) found.push({ rule: "V1-run", scene: sceneIndex, span: spanIndex });
  }));
  return found;
}

function fixV3(scenes: VarietyScene[], changes: VarietyChange[]): void {
  const ranked: { scene: number; span: number; rank: number; sec: number }[] = [];
  scenes.forEach((scene, sceneIndex) => scene.spans.forEach((span, spanIndex) => {
    if (!isGraphicKind(span.kind)) return;
    const hook = span.kind === "kinetic_text" && HOOK.test(span.reason);
    ranked.push({
      scene: sceneIndex,
      span: spanIndex,
      rank: span.kind === "kinetic_text" ? (hook ? 2 : 0) : 1,
      sec: duration(scene, span),
    });
  }));
  ranked.sort((a, b) => a.rank - b.rank || a.sec - b.sec || a.scene - b.scene || a.span - b.span);
  for (const item of ranked) {
    if (!over(graphicSec(scenes), runtime(scenes), 0.3)) return;
    const scene = scenes[item.scene]!;
    const span = scene.spans[item.span]!;
    const to = otherKind(scene, span.kind);
    if (!to) continue;
    const from = span.kind;
    convert(span, to, "V3-graphic");
    changes.push({ scene: item.scene, span: item.span, from, to, rule: "V3-graphic" });
  }
}

/**
 * Shortens a subtitle-copy span to ≤ 3 s. The words it drops go to a neighbour in the same
 * scene so the spans still cover every word: the next span when there is one, else the
 * previous span (then the span is trimmed from its start). A span alone in its scene is converted.
 */
function fixV4(scenes: VarietyScene[], changes: VarietyChange[]): void {
  scenes.forEach((scene, sceneIndex) => scene.spans.forEach((span, spanIndex) => {
    if (!isSubtitleCopy(scene, span)) return;
    const next = scene.spans[spanIndex + 1];
    const prev = scene.spans[spanIndex - 1];
    const convertSpan = () => {
      const to = otherKind(scene, span.kind);
      if (!to) return;
      const from = span.kind;
      convert(span, to, "V4-subtitle");
      changes.push({ scene: sceneIndex, span: spanIndex, from, to, rule: "V4-subtitle" });
    };
    if (next) {
      let end = span.wordEnd;
      while (end > span.wordStart + 1 && spanSec(scene, span.wordStart, end) > 3) end -= 1;
      if (spanSec(scene, span.wordStart, end) > 3) return convertSpan();
      if (end === span.wordEnd) return;
      span.wordEnd = end;
      next.wordStart = end;
    } else if (prev) {
      let start = span.wordStart;
      while (start < span.wordEnd - 1 && spanSec(scene, start, span.wordEnd) > 3) start += 1;
      if (spanSec(scene, start, span.wordEnd) > 3) return convertSpan();
      if (start === span.wordStart) return;
      span.wordStart = start;
      prev.wordEnd = start;
    } else {
      return convertSpan();
    }
    changes.push({ scene: sceneIndex, span: spanIndex, from: "kinetic_text", to: "kinetic_text", rule: "V4-subtitle" });
  }));
}

function fixV2(scenes: VarietyScene[], changes: VarietyChange[]): void {
  if (!v2Applies(scenes)) return;
  const stills: { scene: number; span: number; sec: number }[] = [];
  scenes.forEach((scene, sceneIndex) => {
    if (!scene.hasFootage) return;
    scene.spans.forEach((span, spanIndex) => {
      if (span.kind === "still") stills.push({ scene: sceneIndex, span: spanIndex, sec: duration(scene, span) });
    });
  });
  stills.sort((a, b) => b.sec - a.sec || a.scene - b.scene || a.span - b.span);
  for (const item of stills) {
    if (!over(stillSec(scenes), runtime(scenes), 0.4)) return;
    const span = scenes[item.scene]!.spans[item.span]!;
    if (span.kind !== "still") continue;
    const from = span.kind;
    convert(span, "footage", "V2-still");
    changes.push({ scene: item.scene, span: item.span, from, to: "footage", rule: "V2-still" });
  }
}

function fixV1(scenes: VarietyScene[], changes: VarietyChange[]): void {
  let runKind: ShotKind | null = null;
  let run = 0;
  scenes.forEach((scene, sceneIndex) => scene.spans.forEach((span, spanIndex) => {
    run = span.kind === runKind ? run + 1 : 1;
    runKind = span.kind;
    if (run < 3) return;
    const to = otherKind(scene, span.kind);
    if (!to || (to === "still" && stillWouldExceed(scenes, sceneIndex, spanIndex))) {
      return;
    }
    const from = span.kind;
    convert(span, to, "V1-run");
    changes.push({ scene: sceneIndex, span: spanIndex, from, to, rule: "V1-run" });
    runKind = to;
    run = 1;
  }));
}

function copyScenes(scenes: VarietyScene[]): VarietyScene[] {
  return scenes.map((scene) => ({
    words: scene.words.map((word) => ({ ...word })),
    hasFootage: scene.hasFootage,
    hasStill: scene.hasStill,
    spans: scene.spans.map((span) => ({
      ...span,
      ...(span.payload ? { payload: structuredClone(span.payload) } : {}),
    })),
  }));
}

export function enforceVariety(scenes: VarietyScene[]): { scenes: VarietyScene[]; changes: VarietyChange[] } {
  const next = copyScenes(scenes);
  const changes: VarietyChange[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    const before = JSON.stringify(next);
    fixV3(next, changes);
    fixV4(next, changes);
    fixV2(next, changes);
    fixV1(next, changes);
    if (JSON.stringify(next) === before || checkVariety(next).length === 0) break;
  }
  return { scenes: next, changes };
}
