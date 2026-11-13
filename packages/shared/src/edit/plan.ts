import { z } from "zod";

/** Curated ffmpeg xfade names, plus `cut` (no transition). */
export const TRANSITION_TYPES = [
  "cut", "fade", "fadeblack", "dissolve", "smoothleft", "smoothright",
  "slideup", "wipeleft", "circleopen", "zoomin", "radial", "hblur",
] as const;
export const TransitionTypeSchema = z.enum(TRANSITION_TYPES);
export type TransitionType = z.infer<typeof TransitionTypeSchema>;

export const MOTION_PRESETS = [
  "push_in", "pull_out", "pan_left", "pan_right", "pan_up", "punch_in", "static",
] as const;
export const MotionPresetSchema = z.enum(MOTION_PRESETS);
export type MotionPreset = z.infer<typeof MotionPresetSchema>;

export const SUBTITLE_STYLES = ["clean", "karaoke", "pop", "box"] as const;
export const SubtitleStyleIdSchema = z.enum(SUBTITLE_STYLES);
export type SubtitleStyleId = z.infer<typeof SubtitleStyleIdSchema>;

export const EDIT_PRESETS = ["calm", "energetic", "news", "story"] as const;
export const EditPresetIdSchema = z.enum(EDIT_PRESETS);
export type EditPresetId = z.infer<typeof EditPresetIdSchema>;

export const EMPHASIS_EFFECTS = ["punch_in", "callout", "flash", "sfx"] as const;
export const EmphasisEffectSchema = z.enum(EMPHASIS_EFFECTS);
export type EmphasisEffect = z.infer<typeof EmphasisEffectSchema>;

export const SFX_IDS = ["whoosh", "pop", "hit"] as const;
export type SfxId = (typeof SFX_IDS)[number];

/** −14 dB relative to the voice, as a linear gain. */
export const SFX_GAIN = 10 ** (-14 / 20);
export const EMPHASIS_MIN_GAP_SEC = 6;
export const FLASH_MIN_GAP_SEC = 60;
export const TRANSITION_GUARD_SEC = 0.8;
export const SUBTITLE_GAP_CLOSE_SEC = 0.6;
export const XFADE_GROUP_SIZE = 12;

export const TransitionSchema = z.object({
  afterSceneId: z.string(),
  type: TransitionTypeSchema,
  durationSec: z.number(),
}).strict();
export type EditTransition = z.infer<typeof TransitionSchema>;

export const EditPlanSchema = z.object({
  preset: EditPresetIdSchema,
  transitions: z.array(TransitionSchema),
  motions: z.array(z.object({ sceneId: z.string(), preset: MotionPresetSchema }).strict()),
  emphasis: z.array(z.object({
    sceneId: z.string(),
    wordIndexStart: z.number().int().nonnegative(),
    wordIndexEnd: z.number().int().nonnegative(),
    effects: z.array(EmphasisEffectSchema).min(1),
    calloutText: z.string().max(24).optional(),
    startSec: z.number().nonnegative().optional(),
  }).strict()),
  subtitleStyle: SubtitleStyleIdSchema,
  source: z.enum(["llm", "fallback", "user"]),
}).strict();
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const EditSettingsSchema = z.object({
  preset: EditPresetIdSchema.optional(),
  subtitleStyle: SubtitleStyleIdSchema.optional(),
  fontSize: z.number().int().min(12).max(160).optional(),
  highlightColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  sfx: z.boolean().optional(),
  /** Minimum seconds between emphasis points. */
  emphasisEverySec: z.number().min(6).max(60).optional(),
  engine: z.enum(["legacy", "compose"]).optional(),
  directorMode: z.enum(["eco", "quality"]).optional(),
}).strict();
export type EditSettings = z.infer<typeof EditSettingsSchema>;

/** A project that never picked an engine renders with compose. `legacy` stays selectable. */
export function resolveEditEngine(engine: EditSettings["engine"]): "legacy" | "compose" {
  return engine ?? "compose";
}

export const EDIT_PRESET_LABELS: Record<EditPresetId, string> = {
  calm: "Điềm tĩnh",
  energetic: "Nhanh",
  news: "Tin tức",
  story: "Kể chuyện",
};

export const SUBTITLE_STYLE_LABELS: Record<SubtitleStyleId, string> = {
  clean: "Sạch",
  karaoke: "Karaoke",
  pop: "Pop",
  box: "Hộp",
};

export const MOTION_LABELS: Record<MotionPreset, string> = {
  push_in: "Đẩy vào",
  pull_out: "Kéo ra",
  pan_left: "Lia trái",
  pan_right: "Lia phải",
  pan_up: "Lia lên",
  punch_in: "Phóng nhanh",
  static: "Đứng yên",
};

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  cut: "Cắt",
  fade: "Mờ",
  fadeblack: "Mờ đen",
  dissolve: "Hoà",
  smoothleft: "Trượt trái",
  smoothright: "Trượt phải",
  slideup: "Trượt lên",
  wipeleft: "Gạt trái",
  circleopen: "Mở tròn",
  zoomin: "Phóng",
  radial: "Xoay",
  hblur: "Mờ ngang",
};

type PresetDefaults = {
  subtitleStyle: SubtitleStyleId;
  sfx: boolean;
  emphasisEverySec: number;
  topicTransition: TransitionType;
  hookTransition: TransitionType;
};

const PRESET_DEFAULTS: Record<EditPresetId, PresetDefaults> = {
  calm: { subtitleStyle: "clean", sfx: false, emphasisEverySec: 20, topicTransition: "dissolve", hookTransition: "fade" },
  energetic: { subtitleStyle: "pop", sfx: true, emphasisEverySec: 8, topicTransition: "smoothleft", hookTransition: "smoothleft" },
  news: { subtitleStyle: "box", sfx: false, emphasisEverySec: 8, topicTransition: "wipeleft", hookTransition: "wipeleft" },
  story: { subtitleStyle: "karaoke", sfx: true, emphasisEverySec: 8, topicTransition: "fade", hookTransition: "zoomin" },
};

export function presetDefaults(preset: EditPresetId): PresetDefaults {
  return PRESET_DEFAULTS[preset];
}

export function defaultSubtitleStyle(aspect: "16:9" | "9:16" | "1:1"): SubtitleStyleId {
  return aspect === "9:16" ? "pop" : "karaoke";
}

export function clampTransitionDuration(durationSec: number): number {
  if (!Number.isFinite(durationSec)) return 0.4;
  return Math.min(0.8, Math.max(0.25, Math.round(durationSec * 1000) / 1000));
}

/** Profile preset, then project overrides. */
export function resolveEditSettings(input: {
  aspect?: "16:9" | "9:16" | "1:1";
  profile?: EditSettings | null;
  project?: EditSettings | null;
}): { preset: EditPresetId; subtitleStyle: SubtitleStyleId; sfx: boolean; emphasisEverySec: number; highlightColor: string; fontSize?: number } {
  const preset = input.project?.preset ?? input.profile?.preset ?? "story";
  const defaults = presetDefaults(preset);
  const subtitleStyle = input.project?.subtitleStyle
    ?? input.profile?.subtitleStyle
    ?? (input.aspect ? defaultSubtitleStyle(input.aspect) : defaults.subtitleStyle);
  const sfx = input.project?.sfx ?? input.profile?.sfx ?? defaults.sfx;
  const emphasisEverySec = input.project?.emphasisEverySec ?? input.profile?.emphasisEverySec ?? defaults.emphasisEverySec;
  const highlightColor = input.project?.highlightColor ?? input.profile?.highlightColor ?? "#F5C518";
  const fontSize = input.project?.fontSize ?? input.profile?.fontSize;
  return { preset, subtitleStyle, sfx, emphasisEverySec, highlightColor, ...(fontSize ? { fontSize } : {}) };
}

export type RhythmScene = { sceneId: string; topicChange?: boolean };

/** Cut most of the time, a soft transition at topic changes, a dynamic one after the hook. */
export function defaultRhythm(scenes: RhythmScene[], preset: EditPresetId = "story"): EditTransition[] {
  const defaults = presetDefaults(preset);
  const transitions: EditTransition[] = [];
  let runType: TransitionType | null = null;
  let run = 0;
  for (let index = 0; index < scenes.length - 1; index += 1) {
    let type: TransitionType = "cut";
    if (index === 0) type = defaults.hookTransition;
    else if (scenes[index + 1]?.topicChange || scenes[index]?.topicChange) type = defaults.topicTransition;
    if (type !== "cut" && type === runType && run >= 2) type = "cut";
    if (type === "cut") {
      runType = null;
      run = 0;
    } else if (type === runType) run += 1;
    else {
      runType = type;
      run = 1;
    }
    transitions.push({
      afterSceneId: scenes[index].sceneId,
      type,
      durationSec: type === "cut" ? 0 : 0.4,
    });
  }
  return transitions;
}

const PAN_PRESETS = new Set<MotionPreset>(["pan_left", "pan_right", "pan_up"]);

/** Neighbouring scenes never share a pan direction. */
export function alternateMotions(sceneIds: string[]): { sceneId: string; preset: MotionPreset }[] {
  const cycle: MotionPreset[] = ["push_in", "pan_left", "pull_out", "pan_right", "static", "pan_up"];
  const used: MotionPreset[] = [];
  return sceneIds.map((sceneId) => {
    let preset = cycle[used.length % cycle.length];
    const previous = used[used.length - 1];
    if (previous && PAN_PRESETS.has(preset) && preset === previous) {
      preset = cycle[(used.length + 1) % cycle.length];
    }
    used.push(preset);
    return { sceneId, preset };
  });
}

export function motionEndpoints(preset: MotionPreset): { from: { zoom: number; x: number; y: number }; to: { zoom: number; x: number; y: number } } {
  const mid = { zoom: 1, x: 0.5, y: 0.5 };
  if (preset === "push_in") return { from: mid, to: { zoom: 1.12, x: 0.5, y: 0.5 } };
  if (preset === "pull_out") return { from: { zoom: 1.12, x: 0.5, y: 0.5 }, to: mid };
  if (preset === "pan_left") return { from: { zoom: 1.08, x: 0.62, y: 0.5 }, to: { zoom: 1.08, x: 0.38, y: 0.5 } };
  if (preset === "pan_right") return { from: { zoom: 1.08, x: 0.38, y: 0.5 }, to: { zoom: 1.08, x: 0.62, y: 0.5 } };
  if (preset === "pan_up") return { from: { zoom: 1.08, x: 0.5, y: 0.62 }, to: { zoom: 1.08, x: 0.5, y: 0.38 } };
  if (preset === "punch_in") return { from: mid, to: { zoom: 1.12, x: 0.5, y: 0.5 } };
  return { from: { zoom: 1.0, x: 0.5, y: 0.5 }, to: { zoom: 1.02, x: 0.5, y: 0.5 } };
}

export type EmphasisWord = { text: string; startSec: number };

const TRIGGER = /bí mật|sự thật|quan trọng|không ngờ/i;

export function fallbackEmphasis(input: {
  sceneId: string;
  words: EmphasisWord[];
  title: string;
  hook?: boolean;
}): EditPlan["emphasis"] {
  const titleWords = new Set(input.title.toLowerCase().split(/\s+/).filter((word) => word.length > 2));
  const picked: EditPlan["emphasis"] = [];
  const seen = new Set<number>();
  const push = (index: number, effects: EmphasisEffect[], calloutText?: string) => {
    if (seen.has(index)) return;
    seen.add(index);
    picked.push({
      sceneId: input.sceneId,
      wordIndexStart: index,
      wordIndexEnd: index,
      effects,
      ...(calloutText ? { calloutText: calloutText.slice(0, 24) } : {}),
      startSec: input.words[index]?.startSec ?? 0,
    });
  };
  input.words.forEach((word, index) => {
    if (/\d/.test(word.text)) push(index, ["callout", "sfx"], word.text.replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 24));
    else if (titleWords.has(word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))) push(index, ["callout"], word.text.slice(0, 24));
  });
  input.words.forEach((word, index) => {
    if (TRIGGER.test(word.text) && input.words[index + 1]) push(index + 1, ["punch_in", "callout"], input.words[index + 1].text.slice(0, 24));
  });
  if (input.hook && input.words.length > 0) {
    const lastSentenceStart = input.words.findIndex((word, index) => index > 0 && /[.!?]$/.test(input.words[index - 1]?.text ?? ""));
    const index = lastSentenceStart > 0 ? lastSentenceStart : input.words.length - 1;
    push(index, ["punch_in"]);
  }
  return picked;
}

export type EmphasisScene = { sceneId: string; startSec: number; durationSec: number; incomingTransition?: TransitionType };

export function clampEmphasis(
  points: EditPlan["emphasis"],
  scenes: EmphasisScene[],
  everySec = EMPHASIS_MIN_GAP_SEC,
): EditPlan["emphasis"] {
  const byScene = new Map(scenes.map((scene) => [scene.sceneId, scene]));
  const sorted = [...points].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
  const kept: EditPlan["emphasis"] = [];
  let lastAt = -Infinity;
  let lastFlash = -Infinity;
  for (const point of sorted) {
    const scene = byScene.get(point.sceneId);
    if (!scene) continue;
    const at = point.startSec ?? scene.startSec;
    if (at - lastAt < everySec) continue;
    const intoScene = at - scene.startSec;
    if (scene.incomingTransition && scene.incomingTransition !== "cut" && intoScene < TRANSITION_GUARD_SEC) continue;
    const effects = point.effects.filter((effect) => effect !== "flash" || at - lastFlash >= FLASH_MIN_GAP_SEC);
    if (effects.length === 0) continue;
    if (effects.includes("flash")) lastFlash = at;
    kept.push({ ...point, effects, startSec: at });
    lastAt = at;
  }
  return kept;
}

export function validateEditPlan(
  raw: unknown,
  scenes: EmphasisScene[],
  preset: EditPresetId = "story",
  options?: { emphasisEverySec?: number; subtitleStyle?: SubtitleStyleId },
): EditPlan {
  const known = new Set(scenes.map((scene) => scene.sceneId));
  const parsed = z.object({
    transitions: z.array(z.unknown()).optional(),
    motions: z.array(z.unknown()).optional(),
    emphasis: z.array(z.unknown()).optional(),
    subtitleStyle: z.unknown().optional(),
  }).safeParse(raw);
  const body = parsed.success ? parsed.data : {};
  const rhythm = defaultRhythm(scenes.map((scene) => ({ sceneId: scene.sceneId })), preset);
  const transitions = rhythm.map((item) => {
    const found = (body.transitions ?? []).map((entry) => TransitionSchema.safeParse(entry)).find((entry) => entry.success && entry.data.afterSceneId === item.afterSceneId);
    if (!found?.success || !known.has(found.data.afterSceneId)) return item;
    return {
      afterSceneId: found.data.afterSceneId,
      type: found.data.type,
      durationSec: found.data.type === "cut" ? 0 : clampTransitionDuration(found.data.durationSec),
    };
  });
  const motions = alternateMotions(scenes.map((scene) => scene.sceneId)).map((item) => {
    const found = (body.motions ?? []).map((entry) => z.object({ sceneId: z.string(), preset: MotionPresetSchema }).safeParse(entry))
      .find((entry) => entry.success && entry.data.sceneId === item.sceneId);
    return found?.success && known.has(found.data.sceneId) ? found.data : item;
  });
  const emphasis = clampEmphasis(
    (body.emphasis ?? []).flatMap((entry) => {
      const point = z.object({
        sceneId: z.string(),
        wordIndexStart: z.number().int().nonnegative(),
        wordIndexEnd: z.number().int().nonnegative(),
        effects: z.array(EmphasisEffectSchema).min(1),
        calloutText: z.string().optional(),
        startSec: z.number().nonnegative().optional(),
      }).safeParse(entry);
      if (!point.success || !known.has(point.data.sceneId)) return [];
      return [{
        ...point.data,
        wordIndexEnd: Math.max(point.data.wordIndexStart, point.data.wordIndexEnd),
        ...(point.data.calloutText ? { calloutText: point.data.calloutText.slice(0, 24) } : {}),
      }];
    }),
    scenes,
    options?.emphasisEverySec ?? presetDefaults(preset).emphasisEverySec,
  );
  const style = SubtitleStyleIdSchema.safeParse(options?.subtitleStyle ?? body.subtitleStyle);
  return {
    preset,
    transitions,
    motions,
    emphasis,
    subtitleStyle: style.success ? style.data : presetDefaults(preset).subtitleStyle,
    source: "fallback",
  };
}

export function fallbackEditPlan(input: {
  scenes: (EmphasisScene & { words?: EmphasisWord[]; hook?: boolean; topicChange?: boolean })[];
  title: string;
  preset?: EditPresetId;
  aspect?: "16:9" | "9:16" | "1:1";
  emphasisEverySec?: number;
  subtitleStyle?: SubtitleStyleId;
}): EditPlan {
  const preset = input.preset ?? "story";
  const transitions = defaultRhythm(input.scenes, preset);
  const incoming = new Map<string, TransitionType>();
  input.scenes.forEach((scene, index) => {
    if (index === 0) return;
    incoming.set(scene.sceneId, transitions[index - 1]?.type ?? "cut");
  });
  const emphasis = clampEmphasis(
    input.scenes.flatMap((scene) => fallbackEmphasis({
      sceneId: scene.sceneId,
      words: scene.words ?? [],
      title: input.title,
      hook: scene.hook,
    }).map((point) => ({ ...point }))),
    input.scenes.map((scene) => ({ ...scene, incomingTransition: incoming.get(scene.sceneId) })),
    input.emphasisEverySec ?? presetDefaults(preset).emphasisEverySec,
  );
  const subtitleStyle = input.subtitleStyle
    ?? (input.aspect ? defaultSubtitleStyle(input.aspect) : presetDefaults(preset).subtitleStyle);
  return {
    preset,
    transitions,
    motions: alternateMotions(input.scenes.map((scene) => scene.sceneId)),
    emphasis,
    subtitleStyle,
    source: "fallback",
  };
}

export type XfadeClip = {
  sceneId: string;
  startSec: number;
  durationSec: number;
  transitionOut?: { type: TransitionType; durationSec: number } | null;
};

export function transitionTailSec(clip: XfadeClip): number {
  const transition = clip.transitionOut;
  if (!transition || transition.type === "cut") return 0;
  return clampTransitionDuration(transition.durationSec);
}

/** xfade offset is the incoming scene's timeline start, minus the group's origin. */
export function xfadeOffsetSec(incomingStartSec: number, groupOriginSec = 0): number {
  return Math.max(0, Math.round((incomingStartSec - groupOriginSec) * 1000) / 1000);
}

export function buildXfadeFilter(clips: XfadeClip[], options: { xfadeAvailable: boolean; fps?: number }): {
  filter: string;
  groups: number;
  warning: string | null;
  outputStarts: { sceneId: string; startSec: number }[];
} {
  const fps = options.fps ?? 30;
  const outputStarts = clips.map((clip) => ({ sceneId: clip.sceneId, startSec: clip.startSec }));
  const withinFrame = outputStarts.every((item, index) => Math.abs(item.startSec - clips[index].startSec) < 1 / fps);
  if (!withinFrame) throw new Error("voice sync drifted");
  if (!options.xfadeAvailable || clips.length < 2) {
    return {
      filter: clips.map((_, index) => `[${index}:v]`).join("") + `concat=n=${Math.max(1, clips.length)}:v=1:a=0[vout]`,
      groups: 1,
      warning: options.xfadeAvailable ? null : "ffmpeg không có xfade, dùng nối cảnh thường.",
      outputStarts,
    };
  }
  const groups: string[] = [];
  const groupCount = Math.ceil(clips.length / XFADE_GROUP_SIZE);
  for (let group = 0; group < groupCount; group += 1) {
    const slice = clips.slice(group * XFADE_GROUP_SIZE, (group + 1) * XFADE_GROUP_SIZE);
    const origin = slice[0]?.startSec ?? 0;
    const base = group * XFADE_GROUP_SIZE;
    let current = `[${base}:v]`;
    const lines: string[] = [];
    if (transitionTailSec(slice[0]) > 0) {
      lines.push(`[${base}:v]tpad=stop_mode=clone:stop_duration=${transitionTailSec(slice[0])}[t${base}]`);
      current = `[t${base}]`;
    }
    for (let index = 0; index < slice.length - 1; index += 1) {
      const clip = slice[index];
      const next = slice[index + 1];
      const tail = transitionTailSec(clip);
      const out = `[x${base + index}]`;
      const nextLabel = `[${base + index + 1}:v]`;
      if (tail === 0 || !clip.transitionOut || clip.transitionOut.type === "cut") {
        lines.push(`${current}${nextLabel}concat=n=2:v=1:a=0${out}`);
      } else {
        const offset = xfadeOffsetSec(next.startSec, origin);
        lines.push(`${current}${nextLabel}xfade=transition=${clip.transitionOut.type}:duration=${tail}:offset=${offset}${out}`);
      }
      current = out;
    }
    lines.push(`${current}null[g${group}]`);
    groups.push(lines.join(";"));
  }
  const join = groupCount === 1
    ? ""
    : `;${Array.from({ length: groupCount }, (_, index) => `[g${index}]`).join("")}concat=n=${groupCount}:v=1:a=0[vout]`;
  const filter = groupCount === 1
    ? groups[0].replace("[g0]", "[vout]")
    : `${groups.join(";")}${join}`;
  return { filter, groups: groupCount, warning: null, outputStarts };
}

export function sfxForEffect(effect: EmphasisEffect): SfxId | null {
  if (effect === "sfx") return "pop";
  if (effect === "punch_in") return "whoosh";
  if (effect === "flash") return "hit";
  return null;
}

/** Mix one SFX at the word start, −14 dB, no ducking. */
export function sfxMixFilter(wordStartSec: number, inputIndex: number): string {
  const delayMs = Math.max(0, Math.round(wordStartSec * 1000));
  const gain = Math.round(SFX_GAIN * 10000) / 10000;
  return `[${inputIndex}:a]aresample=48000,volume=${gain},adelay=delays=${delayMs}:all=1[sfx${inputIndex}]`;
}

export function previewWindow(sceneStartSec: number, totalDurationSec: number, lengthSec = 10): { startSec: number; endSec: number } {
  const startSec = Math.max(0, Math.round((sceneStartSec - 1) * 1000) / 1000);
  const endSec = Math.min(totalDurationSec, Math.round((startSec + lengthSec) * 1000) / 1000);
  return { startSec, endSec };
}

export type TimedWord = { text: string; startSec: number; endSec: number; estimated?: boolean };

export function closeSubtitleGaps<T extends { startSec: number; endSec: number }>(cues: T[], gapSec = SUBTITLE_GAP_CLOSE_SEC): T[] {
  const sorted = [...cues].sort((a, b) => a.startSec - b.startSec);
  return sorted.map((cue, index) => {
    const next = sorted[index + 1];
    if (!next) return { ...cue };
    const gap = next.startSec - cue.endSec;
    if (gap >= 0 && gap < gapSec) return { ...cue, endSec: next.startSec };
    return { ...cue };
  });
}

function assTime(value: number): string {
  const totalCs = Math.max(0, Math.round(value * 100));
  const hours = Math.floor(totalCs / 360_000);
  const minutes = Math.floor((totalCs % 360_000) / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const centis = totalCs % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

/** Karaoke `\k` centiseconds. They sum to the cue length. Estimated timings highlight the whole cue. */
export function karaokeAssText(words: TimedWord[], cueStart: number, cueEnd: number, estimated = false): string {
  const cueCs = Math.max(1, Math.round((cueEnd - cueStart) * 100));
  const safe = (text: string) => text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
  if (estimated || words.length === 0) return `{\\k${cueCs}}${safe(words.map((word) => word.text).join(" "))}`.trim();
  const parts = words.map((word) => {
    const cs = Math.max(1, Math.round((word.endSec - word.startSec) * 100));
    return `{\\kf${cs}}${safe(word.text)}`;
  });
  const sum = parts.reduce((total, part) => total + Number(part.match(/\\kf(\d+)/)?.[1] ?? 0), 0);
  if (sum < cueCs) parts.push(`{\\kf${cueCs - sum}}`);
  return parts.join(" ");
}

export function popAssText(words: TimedWord[]): string {
  const safe = (text: string) => text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
  return words.slice(0, 3).map((word) => `{\\t(0,120,\\fscx105\\fscy105)\\t(120,200,\\fscx100\\fscy100)}${safe(word.text)}`).join(" ");
}

/** Callout sits in the top band so it stays clear of the bottom subtitle margin. */
function assClock(sec: number): string {
  const centiseconds = Math.max(0, Math.round(sec * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

/** ASS callout lines. A successful kinetic graphic removes them; a failed one restores them. */
export function calloutAssLines(input: {
  points: Array<{ sceneId: string; wordIndexStart: number; effects: EmphasisEffect[]; calloutText?: string }>;
  scenes: Array<{ sceneId: string; startSec: number }>;
  wordsByScene: Record<string, Array<{ text: string; startSec: number; endSec: number }>>;
  kineticFailed: boolean;
  motionEnabled: boolean;
}): string {
  const lines: string[] = [];
  for (const point of input.points) {
    const effects = input.motionEnabled
      ? (input.kineticFailed
        ? (point.effects.includes("callout") ? point.effects : [...point.effects, "callout" as const])
        : point.effects.filter((effect) => effect !== "callout"))
      : point.effects;
    if (!effects.includes("callout")) continue;
    const scene = input.scenes.find((item) => item.sceneId === point.sceneId);
    const word = input.wordsByScene[point.sceneId]?.[point.wordIndexStart];
    const text = (point.calloutText || word?.text || "").replace(/[{}]/g, "").trim().slice(0, 24);
    if (!scene || !word || !text) continue;
    const start = scene.startSec + word.startSec;
    const end = scene.startSec + Math.max(word.endSec, word.startSec + 0.4);
    lines.push(`Dialogue: 1,${assClock(start)},${assClock(end)},Callout,,0,0,0,,${text}`);
  }
  return lines.join("\n");
}

export function calloutMarginV(playHeight: number, subtitleMarginV: number): number {
  const top = Math.round(playHeight * 0.08);
  const lowest = playHeight - subtitleMarginV - Math.round(playHeight * 0.12);
  return Math.min(top, Math.max(0, lowest));
}

export function hexToAssColour(hex: string): string {
  const match = hex.replace("#", "");
  const r = match.slice(0, 2);
  const g = match.slice(2, 4);
  const b = match.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}
