import { buildXfadeFilter, sfxMixFilter, type TransitionType } from "../edit/plan.js";
import { buildOverlayFilter } from "../motion/plan.js";
import type { RenderTarget, TimelineMusic, TimelineScene, TimelineVisual } from "../schemas/timeline.js";

/** Bump when clip or mix rules change, so cached clips and renders are rebuilt. */
export const RENDER_FORMAT_VERSION = 1;
/** Placeholder background. Grey, not black, so blackdetect does not flag it. */
export const PLACEHOLDER_COLOR = "0x374151";
export const DUCK_RAMP_SEC = 0.25;
/** Voice intervals closer than this are merged, so music does not pump between sentences. */
export const DUCK_MERGE_GAP_SEC = 0.6;
export const LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11";
const SUPERSAMPLE = 2;

const num = (value: number) => {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Frames per visual. Sums to the scene's durationFrames; the last visual takes the remainder. */
export function splitFrames(scene: Pick<TimelineScene, "startSec" | "durationFrames" | "visuals">, fps: number): number[] {
  const total = scene.durationFrames;
  const count = scene.visuals.length;
  if (count <= 1) return [total];
  const frames: number[] = [];
  let used = 0;
  scene.visuals.forEach((visual, index) => {
    if (index === count - 1) {
      frames.push(Math.max(1, total - used));
      return;
    }
    const remainingSlots = count - index - 1;
    const wanted = Math.round((visual.endSec - visual.startSec) * fps);
    const value = clamp(wanted, 1, total - used - remainingSlots);
    frames.push(value);
    used += value;
  });
  return frames;
}

type Point = { zoom: number; x: number; y: number };

function point(raw: Record<string, number> | undefined): Point {
  return {
    zoom: clamp(Number.isFinite(raw?.zoom) ? raw!.zoom : 1, 1, 4),
    x: clamp(Number.isFinite(raw?.x) ? raw!.x : 0.5, 0, 1),
    y: clamp(Number.isFinite(raw?.y) ? raw!.y : 0.5, 0, 1),
  };
}

/**
 * zoompan expressions moving from motion.from to motion.to.
 * Smoothstep by default. `punch_in` uses ease-out over `easeFrames`, then holds.
 */
export function zoompanExprs(
  motion: TimelineVisual["motion"],
  frames: number,
  options?: { easing?: "smoothstep" | "easeOut"; easeFrames?: number },
): { z: string; x: string; y: string } {
  const from = point(motion?.from);
  const to = point(motion?.to);
  const span = Math.max(1, options?.easeFrames ?? frames);
  const p = span > 1 ? `min(on/${span - 1},1)` : "0";
  const ease = options?.easing === "easeOut"
    ? `(1-(1-(${p}))*(1-(${p})))`
    : `(${p})*(${p})*(3-2*(${p}))`;
  const lerp = (a: number, b: number) => (a === b ? num(a) : `(${num(a)}+(${num(b - a)})*${ease})`);
  return {
    z: lerp(from.zoom, to.zoom),
    x: `max(0,min(iw-iw/zoom,${lerp(from.x, to.x)}*iw-iw/zoom/2))`,
    y: `max(0,min(ih-ih/zoom,${lerp(from.y, to.y)}*ih-ih/zoom/2))`,
  };
}

export type ClipInput = { kind: "IMAGE"; path: string } | { kind: "PLACEHOLDER" };

/**
 * One scene → one silent clip. Returns the ffmpeg inputs and a filter script.
 * `resolvePath` turns timeline paths into absolute file paths.
 */
export function buildSceneClipPlan(
  scene: TimelineScene,
  target: RenderTarget,
  resolvePath: (path: string) => string,
  options?: { croppedPaths?: ReadonlySet<string> },
): { inputs: ClipInput[]; inputArgs: string[]; filter: string; frames: number } {
  const { width: w, height: h, fps } = target;
  const frames = splitFrames(scene, fps);
  const inputs: ClipInput[] = [];
  const inputArgs: string[] = [];
  const chains: string[] = [];
  scene.visuals.forEach((visual, index) => {
    const count = frames[index];
    const label = `[v${index}]`;
    if (visual.kind === "IMAGE" && visual.path) {
      const path = resolvePath(visual.path);
      inputs.push({ kind: "IMAGE", path });
      inputArgs.push("-i", path);
      const { z, x, y } = zoompanExprs(visual.motion, count);
      const alreadyCropped = options?.croppedPaths?.has(visual.path) === true;
      const focus = point(visual.motion?.from);
      const sw = w * SUPERSAMPLE;
      const sh = h * SUPERSAMPLE;
      const fit = alreadyCropped
        ? `scale=${w}:${h}:flags=lanczos,setsar=1,`
        : `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos,`
          + `crop=${sw}:${sh}:(iw-${sw})*${num(focus.x)}:(ih-${sh})*${num(focus.y)},setsar=1,`;
      chains.push(
        `[${index}:v]select='eq(n,0)',${fit}`
        + `zoompan=z='${z}':x='${x}':y='${y}':d=${count}:s=${w}x${h}:fps=${fps},`
        + `trim=end_frame=${count},setpts=PTS-STARTPTS${label}`,
      );
    } else {
      inputs.push({ kind: "PLACEHOLDER" });
      inputArgs.push("-f", "lavfi", "-i", `color=c=${PLACEHOLDER_COLOR}:s=${w}x${h}:r=${fps}`);
      chains.push(`[${index}:v]trim=end_frame=${count},setpts=PTS-STARTPTS,setsar=1${label}`);
    }
  });

  const total = scene.durationFrames;
  const durationSec = total / fps;
  const joined = scene.visuals.length > 1
    ? `${scene.visuals.map((_, index) => `[v${index}]`).join("")}concat=n=${scene.visuals.length}:v=1:a=0[cat]`
    : null;
  const source = joined ? "[cat]" : "[v0]";
  const post: string[] = [];
  if (scene.fadeInSec > 0) post.push(`fade=t=in:st=0:d=${num(scene.fadeInSec)}`);
  if (scene.fadeOutSec > 0) post.push(`fade=t=out:st=${num(Math.max(0, durationSec - scene.fadeOutSec))}:d=${num(scene.fadeOutSec)}`);
  post.push("format=yuv420p");
  const filter = [...chains, ...(joined ? [joined] : []), `${source}${post.join(",")}[out]`].join(";\n");
  return { inputs, inputArgs, filter, frames: total };
}

export const CLIP_OUTPUT_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-an"];

/** Merged voice intervals on the video clock, used for music ducking. */
export function voiceIntervals(scenes: TimelineScene[], mergeGapSec = DUCK_MERGE_GAP_SEC): [number, number][] {
  const raw = scenes
    .filter((scene) => scene.voice && scene.voice.durationSec > 0)
    .map((scene) => [scene.voice!.startSec, scene.voice!.startSec + scene.voice!.durationSec] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const interval of raw) {
    const last = merged[merged.length - 1];
    if (last && interval[0] - last[1] < mergeGapSec) last[1] = Math.max(last[1], interval[1]);
    else merged.push([interval[0], interval[1]]);
  }
  return merged;
}

/**
 * Deterministic ducking gain over known voice intervals: 1 outside, 10^(dB/20) inside,
 * with linear ramps. Intervals are merged with a gap wider than two ramps, so terms never overlap.
 * Returns null when there is nothing to duck.
 */
export function duckVolumeExpr(intervals: [number, number][], duckingDb: number, rampSec = DUCK_RAMP_SEC): string | null {
  if (!intervals.length || duckingDb >= 0) return null;
  const gain = 10 ** (duckingDb / 20);
  const terms = intervals.map(([a, b]) =>
    `clip((t-${num(a - rampSec)})/${num(rampSec)},0,1)*clip((${num(b + rampSec)}-t)/${num(rampSec)},0,1)`);
  return `1-${num(1 - gain)}*(${terms.join("+")})`;
}

export type FinalPlanInput = {
  totalDurationSec: number;
  scenes: TimelineScene[];
  music: TimelineMusic | null;
  /** Absolute path of the concat list file. */
  concatListPath: string;
  resolvePath: (path: string) => string;
  /** File name of the ASS file inside the render working directory, or null for no burn-in. */
  assFileName: string | null;
  /** Per-scene clips. Used instead of the concat list when a transition is not a cut. */
  sceneClips?: {
    path: string;
    sceneId: string;
    startSec: number;
    durationSec: number;
    transitionOut?: { type: TransitionType; durationSec: number } | null;
  }[];
  xfadeAvailable?: boolean;
  /** Transparent graphics drawn before subtitles. */
  graphics?: { path: string; startSec: number; endSec: number }[];
  /** Short effects mixed at a word start, already at −14 dB. */
  sfx?: { path: string; startSec: number }[];
};

/** The final pass: concat clips, burn subtitles, mix voice + ducked music, loudnorm. */
export function buildFinalPlan(input: FinalPlanInput): { inputArgs: string[]; filter: string; videoMap: string; reencodeVideo: boolean; warning: string | null } {
  const total = num(input.totalDurationSec);
  const clips = input.sceneClips ?? [];
  const crossfade = clips.length > 1 && clips.some((clip) => clip.transitionOut && clip.transitionOut.type !== "cut");
  const inputArgs: string[] = [];
  const lines: string[] = [];
  let next = 1;
  let picture = "[0:v]";
  let warning: string | null = null;
  if (crossfade) {
    for (const clip of clips) inputArgs.push("-i", clip.path);
    const joined = buildXfadeFilter(clips, { xfadeAvailable: input.xfadeAvailable !== false });
    warning = joined.warning;
    lines.push(joined.filter.replace("[vout]", "[joined]"));
    picture = "[joined]";
    next = clips.length;
  } else {
    inputArgs.push("-f", "concat", "-safe", "0", "-i", input.concatListPath);
  }
  const graphicStart = next;
  for (const graphic of input.graphics ?? []) {
    inputArgs.push("-i", input.resolvePath(graphic.path));
    next += 1;
  }
  if ((input.graphics ?? []).length > 0) {
    const overlay = buildOverlayFilter((input.graphics ?? []).map((graphic, index) => ({
      id: String(index),
      startSec: graphic.startSec,
      endSec: graphic.endSec,
      inputIndex: graphicStart + index,
    })));
    lines.push(overlay.filter);
    picture = overlay.videoMap;
  }

  let videoMap = "0:v";
  if (input.assFileName) {
    lines.push(`${picture}ass='${input.assFileName}'[vout]`);
    videoMap = "[vout]";
  } else if (picture !== "[0:v]") {
    videoMap = picture;
  }

  const voiced = input.scenes.filter((scene) => scene.voice && scene.voice.durationSec > 0);
  const voiceLabels: string[] = [];
  for (const scene of voiced) {
    inputArgs.push("-i", input.resolvePath(scene.voice!.path));
    const delayMs = Math.max(0, Math.round(scene.voice!.startSec * 1000));
    const label = `[a${next}]`;
    lines.push(`[${next}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays=${delayMs}:all=1${label}`);
    voiceLabels.push(label);
    next += 1;
  }
  if (voiceLabels.length === 0) {
    lines.push(`anullsrc=r=48000:cl=stereo,atrim=0:${total}[voice]`);
  } else if (voiceLabels.length === 1) {
    lines.push(`${voiceLabels[0]}anull[voice]`);
  } else {
    lines.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0[voice]`);
  }
  lines.push(`[voice]apad=whole_dur=${total},atrim=0:${total},asetpts=PTS-STARTPTS[voicep]`);

  const sfxLabels: string[] = [];
  for (const effect of input.sfx ?? []) {
    inputArgs.push("-i", input.resolvePath(effect.path));
    lines.push(sfxMixFilter(effect.startSec, next));
    sfxLabels.push(`[sfx${next}]`);
    next += 1;
  }
  let voiceLabel = "[voicep]";
  if (sfxLabels.length > 0) {
    lines.push(`[voicep]${sfxLabels.join("")}amix=inputs=${1 + sfxLabels.length}:normalize=0:duration=first:dropout_transition=0[voicebed]`);
    voiceLabel = "[voicebed]";
  }

  const music = input.music;
  if (music) {
    if (music.loop) inputArgs.push("-stream_loop", "-1");
    inputArgs.push("-i", input.resolvePath(music.path));
    const chain = [
      `atrim=start=${num(music.startOffsetSec)}`,
      "asetpts=PTS-STARTPTS",
      "aresample=48000",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      `atrim=0:${total}`,
      `volume=${num(music.volume)}`,
    ];
    const duck = duckVolumeExpr(voiceIntervals(input.scenes), music.duckingDb);
    if (duck) chain.push(`volume='${duck}':eval=frame`);
    if (music.fadeInSec > 0) chain.push(`afade=t=in:st=0:d=${num(music.fadeInSec)}`);
    if (music.fadeOutSec > 0) {
      chain.push(`afade=t=out:st=${num(Math.max(0, input.totalDurationSec - music.fadeOutSec))}:d=${num(music.fadeOutSec)}`);
    }
    lines.push(`[${next}:a]${chain.join(",")}[music]`);
    lines.push(`${voiceLabel}[music]amix=inputs=2:normalize=0:duration=first:dropout_transition=0[mix]`);
    lines.push(`[mix]${LOUDNORM},aresample=48000[aout]`);
  } else {
    lines.push(`${voiceLabel}${LOUDNORM},aresample=48000[aout]`);
  }

  return {
    inputArgs,
    filter: lines.join(";\n"),
    videoMap,
    reencodeVideo: Boolean(input.assFileName) || picture !== "[0:v]",
    warning,
  };
}

/** One `file '...'` line per clip; single quotes escaped the way the concat demuxer expects. */
export function concatListText(clipPaths: string[]): string {
  return clipPaths.map((path) => `file '${path.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

/** Seconds of output written so far, from an ffmpeg `-progress` chunk. */
export function parseProgressSeconds(chunk: string): number | null {
  const matches = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  if (!matches.length) return null;
  return Number(matches[matches.length - 1][1]) / 1_000_000;
}

export function parseBlackdetect(stderr: string): { startSec: number; endSec: number }[] {
  return [...stderr.matchAll(/black_start:(\d+(?:\.\d+)?)\s+black_end:(\d+(?:\.\d+)?)/g)]
    .map((match) => ({ startSec: Number(match[1]), endSec: Number(match[2]) }));
}

export type CreditsAsset = {
  title: string;
  author: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  sourceUrl: string | null;
  attributionText: string | null;
};

export type CreditsInput = {
  videoTitle: string;
  scenes: { order: number; label: string; visuals: CreditsAsset[] }[];
  music: (CreditsAsset & { artist?: string | null }) | null;
  licenseSummary: Record<string, number>;
};

function assetLines(asset: CreditsAsset): string[] {
  const lines = [`- ${asset.title || "(không tên)"}`];
  if (asset.author) lines.push(`  Tác giả: ${asset.author}`);
  lines.push(`  Giấy phép: ${asset.licenseName || "chưa rõ"}${asset.licenseUrl ? ` (${asset.licenseUrl})` : ""}`);
  if (asset.sourceUrl) lines.push(`  Nguồn: ${asset.sourceUrl}`);
  if (asset.attributionText) lines.push(`  Ghi công: ${asset.attributionText}`);
  return lines;
}

/** Plain-text credits for the video description. License is metadata, never a block. */
export function buildCreditsText(input: CreditsInput): string {
  const out = [`Credits — ${input.videoTitle}`, ""];
  out.push("HÌNH ẢNH");
  const withVisuals = input.scenes.filter((scene) => scene.visuals.length);
  if (!withVisuals.length) out.push("(không có hình từ nguồn ngoài)");
  for (const scene of [...withVisuals].sort((a, b) => a.order - b.order)) {
    out.push(`Cảnh ${scene.order + 1} · ${scene.label}`);
    for (const visual of scene.visuals) out.push(...assetLines(visual));
  }
  out.push("", "NHẠC NỀN");
  if (input.music) {
    out.push(...assetLines({ ...input.music, author: input.music.author ?? input.music.artist ?? null }));
  } else {
    out.push("(không có nhạc nền)");
  }
  const summary = Object.entries(input.licenseSummary).sort(([a], [b]) => a.localeCompare(b));
  if (summary.length) {
    out.push("", "TÓM TẮT GIẤY PHÉP");
    for (const [kind, count] of summary) out.push(`- ${kind}: ${count}`);
  }
  return out.join("\n") + "\n";
}
