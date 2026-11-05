import { z } from "zod";

/** YouTube custom-thumbnail size limit. */
export const YOUTUBE_THUMB_MAX_BYTES = 2 * 1024 * 1024;
export const THUMBNAIL_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const THUMBNAIL_TEXT_MAX = 32;
export const THUMBNAIL_CANDIDATE_MAX = 8;
/** Do not sample inside the opening fade (the render fades are about 0.5 s). */
export const THUMBNAIL_FADE_SKIP_SEC = 0.5;

export const ThumbnailPositionSchema = z.enum(["top", "bottom", "center"]);
export type ThumbnailPosition = z.infer<typeof ThumbnailPositionSchema>;

export const ThumbnailSourceSchema = z.enum(["ai", "auto", "manual"]);
export type ThumbnailSource = z.infer<typeof ThumbnailSourceSchema>;

export const ThumbnailMetaSchema = z.object({
  frameTimeSec: z.number().nonnegative(),
  text: z.string().max(THUMBNAIL_TEXT_MAX),
  position: ThumbnailPositionSchema,
  source: ThumbnailSourceSchema,
  subjectX: z.number().min(0).max(1).optional(),
  subjectY: z.number().min(0).max(1).optional(),
  /** Candidate id when the frame came from the extracted set. */
  frameId: z.string().optional(),
  /** Render file this auto pick was built from. Manual picks ignore a later render of the same file. */
  videoPath: z.string().optional(),
}).strict();
export type ThumbnailMeta = z.infer<typeof ThumbnailMetaSchema>;

export const ThumbnailCandidateSchema = z.object({
  id: z.string(),
  sceneId: z.string(),
  timeSec: z.number().nonnegative(),
  score: z.number(),
}).strict();
export type ThumbnailCandidate = z.infer<typeof ThumbnailCandidateSchema>;

export const ThumbnailStateSchema = z.object({
  hasLandscape: z.boolean(),
  hasCover: z.boolean(),
  meta: ThumbnailMetaSchema.omit({ videoPath: true }).nullable(),
  candidates: z.array(ThumbnailCandidateSchema),
}).strict();
export type ThumbnailState = z.infer<typeof ThumbnailStateSchema>;

export const ThumbnailRecomposeBodySchema = z.object({
  frameId: z.string().min(1).max(40),
  text: z.string().max(THUMBNAIL_TEXT_MAX),
  position: ThumbnailPositionSchema,
}).strict();
export type ThumbnailRecomposeBody = z.infer<typeof ThumbnailRecomposeBodySchema>;

/** Vision answer for the thumbnailPick task. Text is clamped to 32 characters after parse. */
export const ThumbnailPickSchema = z.object({
  frameIndex: z.number().int().min(0).max(3),
  text: z.string().min(1).max(80),
  position: ThumbnailPositionSchema,
  subjectX: z.number().min(0).max(1).optional(),
  subjectY: z.number().min(0).max(1).optional(),
}).strict();
export type ThumbnailPick = z.infer<typeof ThumbnailPickSchema>;

export const LANDSCAPE_THUMB = { width: 1280, height: 720 } as const;
export const VERTICAL_COVER = { width: 1080, height: 1920 } as const;

export type ThumbnailSceneTiming = {
  sceneId: string;
  order: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  fadeInSec: number;
};

export type FrameCandidateTime = {
  sceneId: string;
  timeSec: number;
  kind: "hook" | "scene";
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Up to 8 sample times: the hook (first scene) at +1.0 s, plus one frame per scene
 * at 40% of its duration, moved past the first 0.5 s of a fade-in.
 */
export function candidateFrameTimes(scenes: readonly ThumbnailSceneTiming[]): FrameCandidateTime[] {
  const ordered = [...scenes].sort((a, b) => a.order - b.order || a.startSec - b.startSec);
  const picks: FrameCandidateTime[] = [];
  const hook = ordered[0];
  if (hook && hook.durationSec > 0.2) {
    const hookTime = Math.min(hook.startSec + 1, Math.max(hook.startSec, hook.endSec - 0.05));
    if (hookTime > hook.startSec + 0.02) {
      picks.push({ sceneId: hook.sceneId, timeSec: round3(hookTime), kind: "hook" });
    }
  }
  for (const scene of ordered) {
    if (picks.length >= THUMBNAIL_CANDIDATE_MAX) break;
    const fadeSkip = Math.min(THUMBNAIL_FADE_SKIP_SEC, Math.max(0, scene.fadeInSec));
    let offset = scene.durationSec * 0.4;
    if (offset < fadeSkip) offset = fadeSkip;
    if (offset >= scene.durationSec) offset = Math.max(0, scene.durationSec - 0.05);
    const timeSec = round3(Math.min(scene.startSec + offset, Math.max(scene.startSec, scene.endSec - 0.05)));
    const duplicate = picks.some((item) => item.sceneId === scene.sceneId && Math.abs(item.timeSec - timeSec) < 0.05);
    if (duplicate) continue;
    picks.push({ sceneId: scene.sceneId, timeSec, kind: "scene" });
  }
  return picks.slice(0, THUMBNAIL_CANDIDATE_MAX);
}

export type FrameMetrics = {
  /** Mean luma 0–255. */
  meanLuma: number;
  /** Higher is sharper. */
  sharpness: number;
  /** 0 = one flat colour, higher = more colour variation. */
  colorSpread: number;
};

/** Null when the frame is black, blank, or mostly one colour. */
export function scoreFrame(metrics: FrameMetrics): number | null {
  if (!Number.isFinite(metrics.meanLuma) || metrics.meanLuma < 18) return null;
  if (!Number.isFinite(metrics.colorSpread) || metrics.colorSpread < 0.08) return null;
  let brightness = 1;
  if (metrics.meanLuma < 60) brightness = metrics.meanLuma / 60;
  else if (metrics.meanLuma > 200) brightness = Math.max(0, (255 - metrics.meanLuma) / 55);
  if (brightness <= 0.05) return null;
  const sharpness = Number.isFinite(metrics.sharpness) ? Math.max(0, metrics.sharpness) : 0;
  return sharpness * brightness * Math.min(1, metrics.colorSpread);
}

export function rankByScore<T extends { metrics: FrameMetrics }>(frames: readonly T[]): Array<T & { score: number }> {
  return frames
    .map((frame) => ({ ...frame, score: scoreFrame(frame.metrics) }))
    .filter((frame): frame is T & { score: number } => frame.score !== null)
    .sort((a, b) => b.score - a.score);
}

function probeNumbers(log: string, key: string): number[] {
  const escaped = key.replaceAll(".", "\\.");
  const re = new RegExp(`lavfi\\.${escaped}=([0-9]+(?:\\.[0-9]+)?)`, "g");
  return [...log.matchAll(re)].map((match) => Number(match[1])).filter((value) => Number.isFinite(value));
}

/**
 * Read lavfi.signalstats / lavfi.blur lines from ffmpeg metadata or filter logs.
 * blurdetect prints lavfi.blur where a larger value is blurrier (often about 0..10, and
 * well above 1). A single extracted frame always has YDIF 0, so that is not a sharpness
 * fallback. Without blur, use a later signalstats YAVG (edgedetect) or YHIGH-YLOW.
 */
export function parseFrameProbe(log: string): FrameMetrics | null {
  const num = (key: string) => probeNumbers(log, key)[0] ?? null;
  const yavgs = probeNumbers(log, "signalstats.YAVG");
  const meanLuma = yavgs[0] ?? null;
  if (meanLuma === null) return null;
  const ydif = num("signalstats.YDIF") ?? 0;
  const saturation = num("signalstats.SATAVG") ?? 0;
  const yhigh = num("signalstats.YHIGH");
  const ylow = num("signalstats.YLOW");
  const contrast = yhigh !== null && ylow !== null ? Math.max(0, yhigh - ylow) : 0;
  const blur = num("blur");
  const edgeAvg = yavgs[1] ?? null;
  const sharpness = blur !== null
    ? 100 / (1 + Math.max(0, blur))
    : edgeAvg !== null && edgeAvg > 0
      ? edgeAvg
      : contrast > 0
        ? contrast
        : ydif;
  const colorSpread = Math.max(saturation / 100, ydif / 40);
  return { meanLuma, sharpness, colorSpread };
}

/** ffmpeg accepts forward slashes; the drive colon still has to be escaped. */
export function escapeDrawtextPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replaceAll(":", "\\:");
}

export type ThumbnailTextFile = {
  path: string;
  text: string;
};

export function clampThumbnailText(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const chosen = cleaned || fallback.replace(/\s+/g, " ").trim() || "Video";
  return [...chosen].slice(0, THUMBNAIL_TEXT_MAX).join("");
}

export function fallbackThumbnailChoice(input: { thumbnailText: readonly string[]; title: string }): {
  text: string;
  position: "bottom";
  source: "auto";
} {
  const idea = input.thumbnailText.find((item) => item.trim()) ?? input.title;
  return { text: clampThumbnailText(idea, input.title), position: "bottom", source: "auto" };
}

/** Next mjpeg `-q:v` (2 = best, 31 = smallest). Null when the file already fits or q cannot drop further. */
export function nextJpegQscale(qscale: number, bytes: number, limit = YOUTUBE_THUMB_MAX_BYTES): number | null {
  if (bytes <= limit) return null;
  if (qscale >= 31) return null;
  return Math.min(31, qscale + 4);
}

/** Walk qscale until `measure` reports a file within the YouTube limit. */
export function jpegQscaleUntilFit(
  measure: (qscale: number) => number,
  start = 2,
  limit = YOUTUBE_THUMB_MAX_BYTES,
): { qscale: number; bytes: number } {
  let qscale = start;
  let bytes = measure(qscale);
  for (let step = 0; step < 12; step += 1) {
    const next = nextJpegQscale(qscale, bytes, limit);
    if (next === null) return { qscale, bytes };
    qscale = next;
    bytes = measure(qscale);
  }
  return { qscale, bytes };
}

function charWidth(ch: string, fontSize: number): number {
  if (ch === " ") return fontSize * 0.28;
  return fontSize * 0.58;
}

function textWidth(value: string, fontSize: number): number {
  return [...value].reduce((sum, ch) => sum + charWidth(ch, fontSize), 0);
}

function wrapToTwoLines(text: string, maxWidthPx: number, fontSize: number): [string] | [string, string] | null {
  if (textWidth(text, fontSize) <= maxWidthPx) return [text];
  const words = text.split(" ");
  let line1 = "";
  let index = 0;
  for (; index < words.length; index += 1) {
    const next = line1 ? `${line1} ${words[index]}` : words[index]!;
    if (line1 && textWidth(next, fontSize) > maxWidthPx) break;
    line1 = next;
  }
  const line2 = words.slice(index).join(" ");
  if (!line2) return [line1];
  if (textWidth(line2, fontSize) <= maxWidthPx) return [line1, line2];
  return null;
}

export function fitOverlayText(text: string, frameWidth: number): {
  lines: string[];
  fontSize: number;
  highlight: string;
} {
  const cleaned = clampThumbnailText(text, "Video");
  const words = cleaned.split(" ").filter(Boolean);
  const rawHighlight = words.reduce((best, word) => (word.length > best.length ? word : best), words[0] ?? cleaned);
  const highlight = rawHighlight.replace(/[^\p{L}\p{N}]+$/u, "") || rawHighlight;
  const maxWidth = frameWidth * 0.86;
  for (let fontSize = Math.max(36, Math.round(frameWidth / 10)); fontSize >= 28; fontSize -= 4) {
    const lines = wrapToTwoLines(cleaned, maxWidth, fontSize);
    if (lines) return { lines: [...lines], fontSize, highlight };
  }
  const mid = Math.ceil(cleaned.length / 2);
  return { lines: [cleaned.slice(0, mid).trim(), cleaned.slice(mid).trim()].filter(Boolean), fontSize: 28, highlight };
}

export function thumbnailUploadError(file: { type: string; size: number }): string | null {
  const type = file.type.toLowerCase();
  if (type !== "image/png" && type !== "image/jpeg") return "Chỉ nhận PNG hoặc JPG.";
  if (file.size > THUMBNAIL_UPLOAD_MAX_BYTES) return "Ảnh tối đa 5 MB.";
  return null;
}

export function sniffImageType(bytes: Uint8Array): "png" | "jpeg" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) return "png";
  return null;
}

function brandToFfmpeg(hex: string): string {
  const match = /^#([0-9A-Fa-f]{6})$/.exec(hex.trim());
  return match ? `0x${match[1]}` : "0x3B82F6";
}

/**
 * Scale/crop plus a dark band and outlined text. One word uses the profile colour.
 * Overlay copy is not inlined. Inside single quotes ffmpeg treats the next `'` as
 * the end of the value, and `%` / `\` are expanded, so the caller writes each part
 * as UTF-8 at `textFilePath(n)` and the filter uses `textfile` with `expansion=none`.
 * Empty `text` means scale and crop only (user upload).
 */
export function buildThumbnailVideoFilter(input: {
  text: string;
  position: ThumbnailPosition;
  fontFile: string;
  width: number;
  height: number;
  brandColor: string;
  subjectX?: number;
  subjectY?: number;
  textFilePath: (index: number) => string;
}): { filter: string; textFiles: ThumbnailTextFile[] } {
  const sx = input.subjectX ?? 0.5;
  const sy = input.subjectY ?? 0.5;
  const crop = [
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=increase`,
    `crop=${input.width}:${input.height}:(iw-${input.width})*${sx.toFixed(3)}:(ih-${input.height})*${sy.toFixed(3)}`,
  ].join(",");
  const cleaned = input.text.replace(/\s+/g, " ").trim();
  if (!cleaned) return { filter: crop, textFiles: [] };

  const layout = fitOverlayText(cleaned, input.width);
  const band = input.position === "top"
    ? "drawbox=x=0:y=0:w=iw:h=ih*0.42:color=black@0.45:t=fill"
    : input.position === "center"
      ? "drawbox=x=0:y=ih*0.32:w=iw:h=ih*0.36:color=black@0.45:t=fill"
      : "drawbox=x=0:y=ih*0.55:w=iw:h=ih*0.45:color=black@0.45:t=fill";
  const font = escapeDrawtextPath(input.fontFile);
  const lineH = Math.round(layout.fontSize * 1.25);
  const blockH = lineH * layout.lines.length;
  const baseY = input.position === "top"
    ? 48
    : input.position === "center"
      ? `(h-${blockH})/2`
      : `h-${blockH}-48`;
  const brand = brandToFfmpeg(input.brandColor);
  const draws: string[] = [];
  const textFiles: ThumbnailTextFile[] = [];
  layout.lines.forEach((line, lineIndex) => {
    const y = lineIndex === 0 ? baseY : `${baseY}+${lineIndex * lineH}`;
    const idx = line.indexOf(layout.highlight);
    const parts = idx < 0
      ? [{ text: line, highlight: false }]
      : [
        { text: line.slice(0, idx), highlight: false },
        { text: layout.highlight, highlight: true },
        { text: line.slice(idx + layout.highlight.length), highlight: false },
      ].filter((part) => part.text.length > 0);
    const lineW = textWidth(line, layout.fontSize);
    let cursor = 0;
    for (const part of parts) {
      const partW = textWidth(part.text, layout.fontSize);
      const x = `(w-${Math.round(lineW)})/2+${Math.round(cursor)}`;
      cursor += partW;
      const path = input.textFilePath(textFiles.length);
      textFiles.push({ path, text: part.text });
      draws.push(
        `drawtext=fontfile='${font}':textfile='${escapeDrawtextPath(path)}':expansion=none:fontsize=${layout.fontSize}`
        + `:fontcolor=${part.highlight ? brand : "white"}:borderw=4:bordercolor=black@0.85`
        + `:shadowx=3:shadowy=3:shadowcolor=black@0.55:x=${x}:y=${y}`,
      );
    }
  });
  return { filter: [crop, band, ...draws].join(","), textFiles };
}
