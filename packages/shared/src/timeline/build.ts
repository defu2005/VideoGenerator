import { alternateMotions, fallbackEditPlan, type EditPresetId } from "../edit/plan.js";
import type { AspectRatio, LicenseKind } from "../enums.js";
import type {
  RenderTarget,
  Timeline,
  TimelineMusic,
  TimelineScene,
  TimelineVisual,
  TimelineWarning,
} from "../schemas/timeline.js";

/** Bump when the timeline shape or timing rules change, so old timelines are rebuilt. */
export const TIMELINE_FORMAT_VERSION = 1;
export const TIMELINE_FPS = 30;

/** Silence before the voice starts in each scene. */
export const VOICE_LEAD_SEC = 0.1;
/** Silence after the voice ends, before the next scene. */
export const VOICE_TAIL_SEC = 0.3;
export const MIN_SCENE_SEC = 1;
const VIDEO_FADE_IN_SEC = 0.5;
const VIDEO_FADE_OUT_SEC = 0.8;
const KENBURNS_ZOOM = 1.12;
export const COMMENTARY_STILL_MAX_SEC = 4;

const NON_COMMERCIAL = new Set<LicenseKind>(["CC_BY_NC", "CC_BY_NC_SA", "CC_BY_NC_ND"]);

export function renderTargetFor(aspectRatio: AspectRatio): RenderTarget {
  if (aspectRatio === "9:16") return { width: 1080, height: 1920, fps: TIMELINE_FPS };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080, fps: TIMELINE_FPS };
  return { width: 1920, height: 1080, fps: TIMELINE_FPS };
}

export type TimelineSceneInput = {
  id: string;
  order: number;
  label: string;
  noVisual: boolean;
  durationOverrideSec: number | null;
  estDurationSec: number | null;
  voice: { trackId: string; path: string; durationSec: number } | null;
  /** Ordered by slot. `ready` means approved with a downloaded file. */
  visuals: {
    candidateId: string;
    path: string | null;
    ready: boolean;
    licenseKind: LicenseKind | null;
    motion: TimelineVisual["motion"] | null;
    /** Copyrighted stills stay on screen for at most four seconds. */
    commentary?: boolean;
  }[];
};

export type TimelineMusicInput = Omit<TimelineMusic, "loop">;

export type TimelineBuildInput = {
  aspectRatio: AspectRatio;
  scenes: TimelineSceneInput[];
  musicEnabled: boolean;
  /** Approved track with a local file, or null. */
  music: TimelineMusicInput | null;
  /** Recipe edit preset. Omitted timelines keep the story rhythm. */
  editPreset?: EditPresetId;
};

export type TimelineBuildResult = Omit<Timeline, "subtitles"> & {
  /** Where each scene's voice starts on the video clock (used to retime subtitles). */
  voiceOffsets: Record<string, number>;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function defaultMotion(index: number): TimelineVisual["motion"] {
  const wide = { zoom: 1, x: 0.5, y: 0.5 };
  const close = { zoom: KENBURNS_ZOOM, x: 0.5, y: 0.5 };
  return index % 2 === 0
    ? { type: "kenburns", from: wide, to: close }
    : { type: "kenburns", from: close, to: wide };
}

function sceneLength(scene: TimelineSceneInput, warnings: TimelineWarning[]): number {
  const override = scene.durationOverrideSec && scene.durationOverrideSec > 0 ? scene.durationOverrideSec : null;
  if (scene.voice) {
    const needed = VOICE_LEAD_SEC + scene.voice.durationSec + VOICE_TAIL_SEC;
    if (override !== null && override < needed) {
      warnings.push({
        code: "DURATION_OVERRIDE_TOO_SHORT",
        sceneId: scene.id,
        message: `Cảnh ${scene.order + 1}: thời lượng đặt tay ${override}s ngắn hơn giọng đọc (${round3(needed)}s), dùng độ dài giọng.`,
      });
    }
    return Math.max(needed, override ?? 0, MIN_SCENE_SEC);
  }
  return Math.max(override ?? scene.estDurationSec ?? MIN_SCENE_SEC, MIN_SCENE_SEC);
}

/**
 * Pure: turns scenes, voice, visuals and music into one clock. 0 LLM calls.
 * Scene lengths are whole frames, fades sit inside each scene (never overlap),
 * so voice, subtitles and video stay in sync after concat.
 */
export function buildTimeline(input: TimelineBuildInput): TimelineBuildResult {
  const target = renderTargetFor(input.aspectRatio);
  const warnings: TimelineWarning[] = [];
  const licenseSummary: Record<string, number> = {};
  const countLicense = (kind: LicenseKind | null) => {
    const key = kind ?? "UNKNOWN";
    licenseSummary[key] = (licenseSummary[key] ?? 0) + 1;
  };
  const voiceOffsets: Record<string, number> = {};
  const ordered = [...input.scenes].sort((a, b) => a.order - b.order);

  let startFrame = 0;
  let visualIndex = 0;
  const scenes: TimelineScene[] = ordered.map((scene, index) => {
    const frames = Math.max(1, Math.ceil(sceneLength(scene, warnings) * target.fps - 1e-6));
    const startSec = startFrame / target.fps;
    const durationSec = frames / target.fps;
    startFrame += frames;

    const ready = scene.visuals.filter((visual) => visual.ready && visual.path);
    if (!ready.length && !scene.noVisual) {
      const pending = scene.visuals.length > 0;
      warnings.push({
        code: pending ? "VISUAL_NOT_APPROVED" : "VISUAL_MISSING",
        sceneId: scene.id,
        message: pending
          ? `Cảnh ${scene.order + 1}: hình chưa được duyệt hoặc chưa tải về, dùng khung trống.`
          : `Cảnh ${scene.order + 1}: chưa có hình, dùng khung trống.`,
      });
    }
    const slice = durationSec / Math.max(ready.length, 1);
    const visuals: TimelineVisual[] = ready.length
      ? ready.map((visual, slot) => {
        countLicense(visual.licenseKind);
        const naturalEnd = slot === ready.length - 1 ? startSec + durationSec : startSec + (slot + 1) * slice;
        const start = startSec + slot * slice;
        const end = visual.commentary ? Math.min(naturalEnd, start + COMMENTARY_STILL_MAX_SEC) : naturalEnd;
        return {
          kind: "IMAGE",
          candidateId: visual.candidateId,
          path: visual.path,
          startSec: round3(start),
          endSec: round3(end),
          motion: visual.motion ?? defaultMotion(visualIndex++),
          licenseKind: visual.licenseKind,
        };
      })
      : [{
        kind: "PLACEHOLDER",
        candidateId: null,
        path: null,
        startSec: round3(startSec),
        endSec: round3(startSec + durationSec),
        motion: defaultMotion(visualIndex++),
        licenseKind: null,
      }];

    const voiceStart = startSec + (scene.voice ? VOICE_LEAD_SEC : 0);
    if (scene.voice) voiceOffsets[scene.id] = round3(voiceStart);
    const maxFade = durationSec / 3;
    return {
      sceneId: scene.id,
      order: scene.order,
      label: scene.label,
      startSec: round3(startSec),
      endSec: round3(startSec + durationSec),
      durationSec: round3(durationSec),
      durationFrames: frames,
      voice: scene.voice
        ? {
          trackId: scene.voice.trackId,
          path: scene.voice.path,
          startSec: round3(voiceStart),
          durationSec: round3(scene.voice.durationSec),
        }
        : null,
      visuals,
      fadeInSec: index === 0 ? round3(Math.min(VIDEO_FADE_IN_SEC, maxFade)) : 0,
      fadeOutSec: index === ordered.length - 1 ? round3(Math.min(VIDEO_FADE_OUT_SEC, maxFade)) : 0,
    };
  });

  const editPlan = fallbackEditPlan({
    title: "",
    preset: input.editPreset ?? "story",
    aspect: input.aspectRatio,
    scenes: scenes.map((scene, index) => ({
      sceneId: scene.sceneId,
      startSec: scene.startSec,
      durationSec: scene.durationSec,
      hook: index === 0,
    })),
  });
  const motionByScene = new Map(alternateMotions(scenes.map((scene) => scene.sceneId)).map((item) => [item.sceneId, item.preset]));
  const transitionByScene = new Map(editPlan.transitions.map((item) => [item.afterSceneId, item]));
  for (const scene of scenes) {
    const preset = motionByScene.get(scene.sceneId);
    if (preset) scene.visuals = scene.visuals.map((visual, index) => index === 0 ? { ...visual, motionPreset: preset } : visual);
    const transition = transitionByScene.get(scene.sceneId);
    if (transition) scene.transitionOut = { type: transition.type, durationSec: transition.durationSec };
  }

  const totalDurationSec = round3(startFrame / target.fps);
  let music: TimelineMusic | null = null;
  if (input.musicEnabled && input.music) {
    const available = input.music.sourceDurationSec === null
      ? null
      : input.music.sourceDurationSec - input.music.startOffsetSec;
    const maxFade = totalDurationSec / 3;
    music = {
      ...input.music,
      loop: available !== null && available < totalDurationSec,
      fadeInSec: round3(Math.min(input.music.fadeInSec, maxFade)),
      fadeOutSec: round3(Math.min(input.music.fadeOutSec, maxFade)),
    };
    countLicense(input.music.licenseKind);
  } else if (input.musicEnabled) {
    warnings.push({ code: "MUSIC_NOT_READY", sceneId: null, message: "Nhạc nền đang bật nhưng chưa có bài được duyệt; video sẽ không có nhạc." });
  }

  const unknown = licenseSummary.UNKNOWN ?? 0;
  if (unknown) {
    warnings.push({ code: "LICENSE_UNKNOWN", sceneId: null, message: `${unknown} tài nguyên chưa rõ giấy phép.` });
  }
  const nonCommercial = Object.entries(licenseSummary)
    .filter(([kind]) => NON_COMMERCIAL.has(kind as LicenseKind))
    .reduce((sum, [, count]) => sum + count, 0);
  if (nonCommercial) {
    warnings.push({ code: "LICENSE_NON_COMMERCIAL", sceneId: null, message: `${nonCommercial} tài nguyên chỉ cho phép dùng phi thương mại (NC).` });
  }

  return {
    formatVersion: TIMELINE_FORMAT_VERSION,
    target,
    totalDurationSec,
    scenes,
    music,
    warnings,
    licenseSummary,
    editPlan,
    voiceOffsets,
  };
}
