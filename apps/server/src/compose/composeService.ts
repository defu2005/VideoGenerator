import {
  applyGraphicTiming,
  COMPOSE_VERSION,
  fitGraphicPayload,
  graphicDurationBounds,
  isGraphicKind,
  MIN_SHOT_SEC,
  TRANSITION_GUARD_SEC,
  assignFootage,
  computeStats,
  directivesForRecipe,
  cutCandidates,
  emptyFootageUse,
  footageFit,
  footageKey,
  footageRelevance,
  musicToSceneBeats,
  noteFootageUse,
  paceBand,
  paceSpan,
  pickInSec,
  rankFootage,
  sceneWords,
  shotFrames,
  validateScenePlan,
  type AspectRatio,
  type BeatGrid,
  type ComposePlan,
  type EditPresetId,
  type FootageRankOptions,
  type FootageUse,
  type GenreDirectives,
  type GenrePack,
  type KindSpan,
  type MotionPreset,
  type RenderTarget,
  type ScenePlan,
  type SceneWord,
  type Shot,
  type ShotKind,
  type TimelineMusic,
  type TimelineScene,
} from "@vg/shared";
import type { FootageHit } from "../providers/footage/types.js";
import { baselineDirector, type Director } from "./director.js";
import { renderComposedScene } from "./sceneClip.js";
import type { ComposeRenderContext } from "./render/context.js";
/** Searches per scene (the main query, then the alternatives) and hits kept for ranking. */
const MAX_FOOTAGE_QUERIES = 4;
const MAX_FOOTAGE_CANDIDATES = 18;
/** Ranked hits handed to the director per scene. */
const MAX_SCENE_FOOTAGE = 6;

type Clip = { hit: FootageHit; inSec: number };
/** How footage shots get their clip. `use` is shared by all scenes of the video. */
type FootagePicker = { text: string; queries: string[]; use: FootageUse; options: FootageRankOptions } | null;

type SceneRecord = {
  id: string;
  narration: string;
  visualQueries?: { primary: string; alternatives: string[] };
};

type VoiceRecord = {
  sceneId: string;
  words?: { startSec: number; endSec: number; text: string }[];
  cues?: { startSec: number; endSec: number; text: string }[];
  timingSource?: "provider" | "aligned" | "estimated";
};

export async function planProject(input: {
  timeline: { scenes: TimelineScene[]; music?: TimelineMusic | null };
  scenes: SceneRecord[];
  voiceTracks: VoiceRecord[];
  recipeId: string;
  /** Genre directives for the whole project. Built once here from `recipeId` (and `genres`) when left out. */
  directives?: GenreDirectives;
  /** Profile-level genre packs, tried before the built-in ones. */
  genres?: Record<string, GenrePack>;
  preset: EditPresetId;
  aspect: AspectRatio;
  director?: Director;
  footageSearch?: (query: string) => Promise<FootageHit[]>;
  beats?: BeatGrid | null;
  /** Short side of the render target, for the resolution score. */
  targetShortSide?: number;
  /** `false` keeps the provider's order and takes clips in turn (the 067a baseline; used by the eval). */
  rankFootage?: boolean;
  /** Spoken language, used to time compare / quote / list shots. Defaults to vi. */
  language?: string;
  /** Shots marked locked are copied back after the director runs. */
  lockedShots?: { sceneId: string; shots: Shot[] }[];
}): Promise<ComposePlan> {
  const ranking = input.rankFootage !== false;
  const band = paceBand(input.preset, input.aspect);
  const rankOptions: FootageRankOptions = { aspect: input.aspect, targetShortSide: input.targetShortSide };
  const director = input.director ?? baselineDirector;
  const byId = new Map(input.scenes.map((scene) => [scene.id, scene]));
  const voiceByScene = new Map(input.voiceTracks.map((track) => [track.sceneId, track]));
  const prepared = await Promise.all(input.timeline.scenes.map(async (scene, index) => {
    const record = byId.get(scene.sceneId);
    const spoken = sceneWords(scene, voiceByScene.get(scene.sceneId)
      ? { ...voiceByScene.get(scene.sceneId)!, cues: voiceByScene.get(scene.sceneId)!.cues ?? [] }
      : null);
    const queries = record?.visualQueries ? [record.visualQueries.primary, ...record.visualQueries.alternatives].filter(Boolean) : [];
    const footage = await footageFor(queries, input.footageSearch, ranking);
    return {
      scene,
      words: spoken.words,
      pool: footage,
      footage,
      stills: scene.visuals.flatMap((visual) => visual.path ? [{ candidateId: visual.candidateId ?? visual.path, path: visual.path, motion: visual.motionPreset ?? "static" as MotionPreset }] : []),
      text: record?.narration ?? scene.label,
      queries,
      index,
    };
  }));
  if (ranking) {
    // Off-topic footage is worse than a still: a scene keeps only the hits that match it, best first,
    // and a clip found for two scenes stays with the one it fits best. The shortest paced shot sizes the clips.
    const kept = assignFootage(
      prepared.map((item) => ({ text: item.text, queries: item.queries, hits: item.footage })),
      { ...rankOptions, shotSec: band.min },
      MAX_SCENE_FOOTAGE,
    );
    prepared.forEach((item, index) => { item.footage = kept[index] ?? []; });
  }
  const use = emptyFootageUse();
  const directives = input.directives ?? directivesForRecipe(input.recipeId, input.genres);
  const spans = await director.directScenes(prepared.map((item) => ({
    scene: { sceneId: item.scene.sceneId, index: item.index, count: prepared.length, text: item.text, durationSec: item.scene.durationSec },
    words: item.words,
    recipeId: input.recipeId,
    directives,
    aspect: input.aspect,
    stills: item.stills.map(({ candidateId, path }) => ({ candidateId, path })),
    footage: item.footage,
  })));
  const lockedByScene = new Map((input.lockedShots ?? []).map((item) => [item.sceneId, item.shots]));
  const scenePlans = prepared.map((item, index) => {
    const beats = input.beats && input.timeline.music
      ? musicToSceneBeats(input.beats, input.timeline.music, item.scene.startSec, item.scene.durationSec)
      : [];
    const planned = shotsFor(item.scene, spans[index] ?? [], item.words, item.stills, item.footage, beats, band,
      ranking ? { text: item.text, queries: item.queries, use, options: rankOptions } : null, input.language ?? "vi");
    const frameSum = shotFrames(planned).reduce((sum, value) => sum + value, 0);
    if (frameSum !== planned.durationFrames) planned.durationFrames = frameSum;
    if (frameSum !== item.scene.durationFrames) planned.warnings.push("Số khung làm tròn khác timeline.");
    const withLocks = keepLockedShots(planned, lockedByScene.get(item.scene.sceneId), item.words);
    const errors = validateScenePlan(withLocks, item.words);
    if (errors.length === 0 && withLocks.shots.length > 0) return withLocks;
    return fallback(item.scene, item.stills[0], errors);
  });
  const sceneBeats = prepared.map((item) => input.beats && input.timeline.music
    ? musicToSceneBeats(input.beats, input.timeline.music, item.scene.startSec, item.scene.durationSec)
    : null);
  const footageNotes = ranking ? prepared.flatMap((item, index) => {
    const used = new Set(scenePlans[index]!.shots.flatMap((shot) => (
      shot.source.kind === "footage" ? [footageKey(shot.source.license)] : []
    )));
    return item.pool.map((hit) => ({
      sceneId: item.scene.sceneId,
      clipId: footageKey(hit),
      relevance: Math.round(footageRelevance(item.text, item.queries, hit) * 1000) / 1000,
      fit: Math.round(footageFit(item.text, item.queries, hit, rankOptions) * 1000) / 1000,
      kept: used.has(footageKey(hit)),
      author: hit.author,
      licenseName: hit.licenseName,
      pageUrl: hit.pageUrl,
    }));
  }) : [];
  return {
    version: COMPOSE_VERSION,
    engine: "compose",
    preset: input.preset,
    aspect: input.aspect,
    scenes: scenePlans,
    ...(input.beats ? { beatGrid: input.beats } : {}),
    stats: computeStats({ scenes: scenePlans }, prepared.map((item) => item.words), sceneBeats),
    ...(footageNotes.length ? { footageNotes } : {}),
  };
}

function keepLockedShots(fresh: ScenePlan, previous: Shot[] | undefined, words: { startSec: number; endSec: number }[]): ScenePlan {
  const locked = (previous ?? []).filter((shot) => shot.locked).sort((a, b) => a.startSec - b.startSec);
  if (!locked.length || !previous) return fresh;
  const shots: Shot[] = [];
  let cursor = 0;
  const fill = (start: number, end: number): boolean => {
    if (end - start <= 0.001) return true;
    const donor = fresh.shots.find((shot) => shot.startSec < end - 0.02 && shot.endSec > start + 0.02);
    if (!donor || end - start < MIN_SHOT_SEC - 1e-6) return false;
    shots.push({ ...donor, id: `${fresh.sceneId}-fill-${shots.length}`, startSec: start, endSec: end, locked: false });
    return true;
  };
  let ok = true;
  for (const lock of locked) {
    if (lock.startSec < cursor - 0.001 || !fill(cursor, lock.startSec)) {
      ok = false;
      break;
    }
    shots.push({ ...lock, locked: true });
    cursor = lock.endSec;
  }
  if (ok && !fill(cursor, fresh.durationSec)) ok = false;
  const next: ScenePlan = { ...fresh, shots };
  if (ok && validateScenePlan(next, words).length === 0) return next;
  const prev: ScenePlan = { ...fresh, shots: previous };
  return validateScenePlan(prev, words).length === 0 ? prev : fresh;
}

export async function renderSceneClip(
  plan: ComposePlan,
  sceneId: string,
  target: RenderTarget,
  ctx: ComposeRenderContext,
  outPath: string,
): Promise<{ frames: number; warnings: string[]; graphicShots: { shotId: string; kind: Shot["kind"]; renderPath: "static" | "animated" | "reencoded" }[] }> {
  const scene = plan.scenes.find((item) => item.sceneId === sceneId);
  if (!scene) throw new Error(`Không có kế hoạch cho cảnh ${sceneId}`);
  return renderComposedScene(scene, target, ctx, outPath);
}

async function footageFor(queries: string[], search: ((query: string) => Promise<FootageHit[]>) | undefined, ranking: boolean): Promise<FootageHit[]> {
  if (!search || !queries.length) return [];
  // Ranking wants a wide pool from every query; without it the first 6 hits are the plan.
  const limit = ranking ? MAX_FOOTAGE_CANDIDATES : MAX_SCENE_FOOTAGE;
  const hits: FootageHit[] = [];
  const seen = new Set<string>();
  for (const query of queries.slice(0, ranking ? MAX_FOOTAGE_QUERIES : queries.length)) {
    if (hits.length >= limit) break;
    const found = await search(query);
    for (const hit of found) {
      const key = footageKey(hit);
      if (seen.has(key) || !hit.author.trim() || !hit.licenseName.trim()) continue;
      seen.add(key);
      hits.push(hit);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** The clip for one footage shot, or `null` when nothing fits and the shot must be a still. */
function chooseClip(footage: FootageHit[], cursor: number, lenSec: number, picker: FootagePicker): Clip | null {
  if (!picker) {
    const hit = footage[cursor];
    return hit ? { hit, inSec: hit.durationSec > 0.8 ? 0.5 : 0 } : null;
  }
  const fresh = rankFootage(picker.text, picker.queries, footage, picker.use, { ...picker.options, shotSec: lenSec })[0];
  if (fresh) {
    const inSec = pickInSec(fresh.durationSec, lenSec);
    if (inSec !== null) {
      noteFootageUse(picker.use, fresh, inSec, lenSec);
      return { hit: fresh, inSec };
    }
  }
  // No unused clip left: a long clip of this scene may give a second shot from its far end.
  for (const hit of footage) {
    const earlier = picker.use.clips.get(footageKey(hit));
    if (!earlier) continue;
    const inSec = pickInSec(hit.durationSec, lenSec, earlier);
    if (inSec === null) continue;
    noteFootageUse(picker.use, hit, inSec, lenSec);
    return { hit, inSec };
  }
  return null;
}

function shotsFor(
  scene: TimelineScene,
  spans: KindSpan[],
  words: SceneWord[],
  stills: { candidateId: string; path: string; motion: MotionPreset }[],
  footage: FootageHit[],
  beats: number[],
  band: { target: number; min: number; max: number },
  picker: FootagePicker,
  language: string,
): ScenePlan {
  const ranges = layout(spans.length ? spans : [{ kind: "still", wordStart: 0, wordEnd: words.length, reason: "baseline" }], words, scene.durationSec);
  const cuts = cutCandidates(words, scene.durationSec);
  const shots: Shot[] = [];
  let footageCursor = 0;
  let stillCursor = 0;
  for (const range of ranges) {
    const pieces = graphicDurationBounds(range.span.kind, range.span.payload)
      ? [range.start, range.end]
      : [range.start, ...paceSpan({
        startSec: range.start,
        endSec: range.end,
        cuts,
        beatsSec: beats,
        band,
        guardSec: TRANSITION_GUARD_SEC,
        sceneStartSec: 0,
        sceneEndSec: scene.durationSec,
      }), range.end];
    for (let index = 0; index < pieces.length - 1; index += 1) {
      const startSec = pieces[index]!;
      const endSec = pieces[index + 1]!;
      if (endSec - startSec < MIN_SHOT_SEC - 1e-6) continue;
      const clip = range.span.kind === "footage" ? chooseClip(footage, footageCursor, endSec - startSec, picker) : null;
      const shot = makeShot(scene.sceneId, shots.length, range.span, startSec, endSec, words, stills, stillCursor, clip, language);
      shots.push(shot);
      if (range.span.kind === "footage") footageCursor += 1;
      if (shot.kind === "still") stillCursor += 1;
    }
  }
  const covered = cover(scene, mergeSameStill(shots), stills);
  const fps = Math.max(1, Math.round(scene.durationFrames / scene.durationSec));
  return {
    sceneId: scene.sceneId,
    durationSec: scene.durationSec,
    durationFrames: scene.durationFrames,
    fps,
    shots: covered,
    warnings: [],
  };
}

function layout(spans: KindSpan[], words: SceneWord[], duration: number): { span: KindSpan; start: number; end: number }[] {
  const timed = spans.map((span) => ({ span, ...wordRange(span, words, duration) }));
  timed.sort((a, b) => a.start - b.start);
  for (let index = 0; index < timed.length; index += 1) {
    const item = timed[index]!;
    const bounds = graphicDurationBounds(item.span.kind, item.span.payload);
    if (!bounds) continue;
    const length = item.end - item.start;
    if (length > bounds.max) {
      item.end = item.start + bounds.max;
      const next = timed[index + 1];
      if (next) next.start = item.end;
      else if (timed[index - 1]) timed[index - 1]!.end = item.start;
    } else if (length < bounds.min) {
      const next = timed[index + 1];
      const need = bounds.min - length;
      if (next && next.end - next.start - need >= MIN_SHOT_SEC) {
        item.end += need;
        next.start = item.end;
      }
    }
  }
  if (!timed.length) return [];
  timed[0]!.start = 0;
  for (let index = 0; index < timed.length - 1; index += 1) timed[index + 1]!.start = timed[index]!.end;
  timed[timed.length - 1]!.end = duration;
  const clamped: { span: KindSpan; start: number; end: number }[] = [];
  for (const item of timed) {
    const bounds = graphicDurationBounds(item.span.kind, item.span.payload);
    if (bounds && item.end - item.start > bounds.max) {
      const cut = item.start + bounds.max;
      clamped.push({ span: item.span, start: item.start, end: cut });
      clamped.push({ span: { kind: "still", wordStart: item.span.wordStart, wordEnd: item.span.wordEnd, reason: item.span.reason }, start: cut, end: item.end });
    } else clamped.push(item);
  }
  return clamped.filter((item) => item.end - item.start > 0.05);
}

function wordRange(span: KindSpan, words: SceneWord[], duration: number): { start: number; end: number } {
  if (!words.length || span.wordEnd <= span.wordStart) return { start: 0, end: duration };
  const first = words[Math.min(span.wordStart, words.length - 1)]!;
  const last = words[Math.min(Math.max(span.wordEnd - 1, 0), words.length - 1)]!;
  return {
    start: span.wordStart <= 0 ? 0 : first.startSec,
    end: span.wordEnd >= words.length ? duration : last.endSec,
  };
}

function makeShot(
  sceneId: string,
  index: number,
  span: KindSpan,
  startSec: number,
  endSec: number,
  words: SceneWord[],
  stills: { candidateId: string; path: string; motion: MotionPreset }[],
  stillCursor: number,
  clip: Clip | null,
  language: string,
): Shot {
  const requested: ShotKind = span.kind === "footage" && !clip ? "still" : span.kind;
  const overlapping = words.filter((word) => word.endSec > startSec && word.startSec < endSec);
  const source = applyGraphicTiming(
    sourceFor(requested, span, stills, stillCursor, clip),
    overlapping.map((word) => ({ text: word.text, startSec: word.startSec })),
    startSec,
    endSec - startSec,
    language,
  );
  const kind: ShotKind = source.kind;
  return {
    id: `${sceneId}-${index}`,
    kind,
    startSec,
    endSec,
    ...(overlapping.length ? { wordRange: { start: overlapping[0]!.i, end: overlapping[overlapping.length - 1]!.i + 1 } } : {}),
    source,
    // "+F-still": the director asked for footage but no clip fits this shot.
    reason: span.kind === "footage" && !clip
      ? `${span.reason}+F-still`
      : kind !== span.kind
        ? `${span.reason}+bad-graphic`
        : span.reason,
  };
}

function sourceFor(
  kind: ShotKind,
  span: KindSpan,
  stills: { candidateId: string; path: string; motion: MotionPreset }[],
  stillCursor: number,
  clip: Clip | null,
): Shot["source"] {
  if (kind === "footage" && clip) {
    const { hit } = clip;
    return {
      kind: "footage",
      clipId: hit.clipId,
      path: hit.localPath ?? null,
      inSec: clip.inSec,
      license: {
        provider: hit.provider,
        clipId: hit.clipId,
        author: hit.author,
        licenseName: hit.licenseName,
        pageUrl: hit.pageUrl,
      },
    };
  }
  if (kind === "kinetic_text" || kind === "chart") {
    if (span.payload && span.payload.kind === kind) return span.payload;
    return kind === "chart"
      ? { kind: "chart", chart: "bar", title: "", labels: [" "], values: [1] }
      : { kind: "kinetic_text", lines: [" "], emphasis: [], style: "bold" };
  }
  if (isGraphicKind(kind)) {
    const fitted = fitGraphicPayload(kind, span.payload ?? {});
    if (fitted) return fitted;
  }
  const still = stills.length ? stills[stillCursor % stills.length]! : null;
  return { kind: "still", candidateId: still?.candidateId ?? null, path: still?.path ?? null, motion: still?.motion ?? "static" };
}

/**
 * A cut must change the picture. Still shots in a row that show the same image become one shot;
 * cutting to the same image only restarts its motion, which reads as a glitch.
 */
function mergeSameStill(shots: Shot[]): Shot[] {
  const out: Shot[] = [];
  for (const shot of shots) {
    const last = out.at(-1);
    if (last && last.source.kind === "still" && shot.source.kind === "still" && last.source.path !== null
      && last.source.path === shot.source.path && Math.abs(last.endSec - shot.startSec) < 1e-6) {
      last.endSec = shot.endSec;
      if (last.wordRange && shot.wordRange) last.wordRange = { start: last.wordRange.start, end: shot.wordRange.end };
      continue;
    }
    out.push(shot);
  }
  return out;
}

function cover(scene: TimelineScene, shots: Shot[], stills: { candidateId: string; path: string; motion: MotionPreset }[]): Shot[] {
  if (!shots.length) return [wholeStill(scene, stills[0])];
  const ordered = [...shots].sort((a, b) => a.startSec - b.startSec);
  ordered[0]!.startSec = 0;
  for (let index = 0; index < ordered.length - 1; index += 1) ordered[index]!.endSec = ordered[index + 1]!.startSec;
  ordered[ordered.length - 1]!.endSec = scene.durationSec;
  return ordered.filter((shot) => shot.endSec - shot.startSec >= MIN_SHOT_SEC - 1e-3);
}

function fallback(scene: TimelineScene, still: { candidateId: string; path: string; motion: MotionPreset } | undefined, errors: string[]): ScenePlan {
  const shot = wholeStill(scene, still);
  return {
    sceneId: scene.sceneId,
    durationSec: scene.durationSec,
    durationFrames: scene.durationFrames,
    fps: Math.max(1, Math.round(scene.durationFrames / scene.durationSec)),
    shots: [shot],
    warnings: [...errors, "Dùng một cảnh tĩnh vì kế hoạch không hợp lệ."],
  };
}

function wholeStill(scene: TimelineScene, still?: { candidateId: string; path: string; motion: MotionPreset }): Shot {
  return {
    id: `${scene.sceneId}-still`,
    kind: "still",
    startSec: 0,
    endSec: scene.durationSec,
    source: { kind: "still", candidateId: still?.candidateId ?? null, path: still?.path ?? null, motion: still?.motion ?? "static" },
    reason: "fallback",
  };
}
