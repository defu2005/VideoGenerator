import { z } from "zod";
import type { ProfileAutomation } from "../schemas/automation.js";
import { pickNextFreePublishSlot, type PlannedSlot } from "../automation/slots.js";
import type { SubtitleCue } from "../subtitles/index.js";
import { escapeDrawtextPath } from "../thumbnails/index.js";
import { LOUDNORM } from "../render/plan.js";

export const CLIP_PAD_BEFORE_SEC = 0.15;
export const CLIP_PAD_AFTER_SEC = 0.25;
export const CLIP_FADE_SEC = 0.15;
export const HOOK_OVERLAY_SEC = 2;
export const CLIP_WIDTH = 1080;
export const CLIP_HEIGHT = 1920;
export const CLIP_MIN_SEC = 15;
export const CLIP_DEFAULT_MIN_SEC = 20;
export const CLIP_DEFAULT_MAX_SEC = 45;
export const CLIP_DEFAULT_COUNT = 3;
export const CLIP_MAX_COUNT = 8;
export const SHORTS_PLATFORM_MAX_SEC = 60;
export const FB_REELS_MAX_SEC = 90;
export const SPEECH_HINT = "Cần file phụ đề hoặc cấu hình công cụ nhận dạng giọng nói";
export const OWNERSHIP_LABEL = "Tôi sở hữu hoặc có quyền dùng video này";
export const MAX_EXTERNAL_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

export const ReframeModeSchema = z.enum(["center", "blur-fill", "smart"]);
export type ReframeMode = z.infer<typeof ReframeModeSchema>;

export const SpeechToolSchema = z.enum(["whisper", "whisper.cpp", "faster-whisper"]);
export type SpeechTool = z.infer<typeof SpeechToolSchema>;

export const SpeechToTextSettingsSchema = z.object({
  tool: SpeechToolSchema.nullable().default(null),
  path: z.string().max(500).default(""),
  args: z.string().max(500).default(""),
  detected: z.boolean().default(false),
}).strict();
export type SpeechToTextSettings = z.infer<typeof SpeechToTextSettingsSchema>;

export const DEFAULT_SPEECH_SETTINGS: SpeechToTextSettings = SpeechToTextSettingsSchema.parse({});

export function speechToTextConfigured(settings: SpeechToTextSettings): boolean {
  return Boolean(settings.tool && settings.path.trim() && settings.detected);
}

export const ClipPickClipSchema = z.object({
  start: z.number(),
  end: z.number(),
  hook: z.string().max(60),
  title: z.string().min(1).max(120),
  reason: z.string().max(500),
  score: z.number().min(0).max(100),
}).strict();

export const ClipPickSchema = z.object({
  clips: z.array(ClipPickClipSchema).max(CLIP_MAX_COUNT),
}).strict();
export type ClipPick = z.infer<typeof ClipPickSchema>;

export const ClipProposalStatusSchema = z.enum(["proposed", "queued", "rendering", "done", "failed"]);
export type ClipProposalStatus = z.infer<typeof ClipProposalStatusSchema>;

export const ClipProposalSchema = z.object({
  id: z.string().uuid(),
  start: z.number(),
  end: z.number(),
  hook: z.string().max(60),
  title: z.string().min(1).max(120),
  reason: z.string(),
  score: z.number().min(0).max(100),
  reframe: ReframeModeSchema,
  snippet: z.string(),
  selected: z.boolean(),
  childProjectId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  status: ClipProposalStatusSchema,
  error: z.string().nullable(),
}).strict();
export type ClipProposal = z.infer<typeof ClipProposalSchema>;

export type TranscriptSentence = { start: number; end: number; text: string };

export type ClipRange = {
  start: number;
  end: number;
  hook: string;
  title: string;
  reason: string;
  score: number;
};

const MID_THOUGHT = /^(và|nhưng|thì|còn)\b/iu;
const STOP_WORDS = new Set(
  "và là của một các cho với trong trên được này đó thì nhưng còn the a an of to and for in on at by from".split(" "),
);

export function platformClipMaxSec(platform: string | undefined): number {
  return platform === "facebook_reels" ? FB_REELS_MAX_SEC : SHORTS_PLATFORM_MAX_SEC;
}

export function clampClipOptions(input: {
  count?: number;
  minSec?: number;
  maxSec?: number;
  platform?: string;
}): { count: number; minSec: number; maxSec: number } {
  const cap = platformClipMaxSec(input.platform);
  const minSec = clamp(input.minSec ?? CLIP_DEFAULT_MIN_SEC, CLIP_MIN_SEC, cap);
  let maxSec = clamp(input.maxSec ?? CLIP_DEFAULT_MAX_SEC, CLIP_MIN_SEC, cap);
  if (maxSec < minSec) maxSec = minSec;
  const count = clamp(Math.round(input.count ?? CLIP_DEFAULT_COUNT), 1, CLIP_MAX_COUNT);
  return { count, minSec, maxSec };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** First sentence begins mid-thought (conjunction or a lowercase continuation). */
export function startsMidThought(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (MID_THOUGHT.test(trimmed)) return true;
  const first = [...trimmed][0] ?? "";
  if (!first) return true;
  return first !== first.toLocaleUpperCase("vi");
}

export function hookCoversMidThought(hook: string): boolean {
  return hook.trim().length > 0;
}

function sentenceIndexAt(time: number, sentences: TranscriptSentence[], edge: "start" | "end"): number {
  if (!sentences.length) return -1;
  if (edge === "start") {
    const containing = sentences.findIndex((sentence) => time >= sentence.start - 0.001 && time < sentence.end - 0.001);
    if (containing >= 0) return containing;
    const next = sentences.findIndex((sentence) => sentence.start >= time - 0.001);
    return next >= 0 ? next : sentences.length - 1;
  }
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index]!;
    if (time > sentence.start + 0.001 && time <= sentence.end + 0.001) return index;
  }
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    if (sentences[index]!.end <= time + 0.001) return index;
  }
  return 0;
}

function fitLength(
  startIdx: number,
  endIdx: number,
  sentences: TranscriptSentence[],
  minSec: number,
  maxSec: number,
): { start: number; end: number; startIdx: number; endIdx: number } | null {
  let end = Math.max(startIdx, endIdx);
  const start = startIdx;
  while (sentences[end]!.end - sentences[start]!.start < minSec && end < sentences.length - 1) end += 1;
  while (sentences[end]!.end - sentences[start]!.start > maxSec && end > start) end -= 1;
  const duration = sentences[end]!.end - sentences[start]!.start;
  if (duration + 0.001 < minSec || duration - 0.001 > maxSec) return null;
  return { start: sentences[start]!.start, end: sentences[end]!.end, startIdx: start, endIdx: end };
}

function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (overlap <= 0) return 0;
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  if (shorter <= 0) return 1;
  return overlap / shorter;
}

function snippetFor(start: number, end: number, sentences: TranscriptSentence[]): string {
  return sentences
    .filter((sentence) => sentence.end > start && sentence.start < end)
    .map((sentence) => sentence.text.trim())
    .join(" ")
    .slice(0, 280);
}

/**
 * Snap clip edges to sentence boundaries, enforce length, drop heavy overlaps
 * and mid-thought openings that the hook does not cover.
 */
export function validateClipPicks(input: {
  clips: ClipRange[];
  sentences: TranscriptSentence[];
  minSec: number;
  maxSec: number;
  limit: number;
}): ClipRange[] {
  const sentences = [...input.sentences].filter((sentence) => sentence.end > sentence.start && sentence.text.trim())
    .sort((a, b) => a.start - b.start);
  if (!sentences.length) return [];
  const snapped: ClipRange[] = [];
  for (const clip of input.clips) {
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.end <= clip.start) continue;
    const startIdx = sentenceIndexAt(clip.start, sentences, "start");
    const endIdx = sentenceIndexAt(clip.end, sentences, "end");
    if (startIdx < 0 || endIdx < 0) continue;
    const fitted = fitLength(startIdx, endIdx, sentences, input.minSec, input.maxSec);
    if (!fitted) continue;
    const opening = sentences[fitted.startIdx]!.text;
    const hook = [...clip.hook.trim()].slice(0, 60).join("");
    if (startsMidThought(opening) && !hookCoversMidThought(hook)) continue;
    const title = clip.title.trim().slice(0, 120) || opening.slice(0, 80) || "Short";
    snapped.push({
      start: Number(fitted.start.toFixed(3)),
      end: Number(fitted.end.toFixed(3)),
      hook: hook || [...opening.trim()].slice(0, 60).join(""),
      title,
      reason: clip.reason.trim().slice(0, 500) || "Đoạn phù hợp để cắt Short.",
      score: clamp(clip.score, 0, 100),
    });
  }
  snapped.sort((a, b) => b.score - a.score || a.start - b.start);
  const kept: ClipRange[] = [];
  for (const clip of snapped) {
    if (kept.some((other) => overlapRatio(clip, other) > 0.2)) continue;
    kept.push(clip);
    if (kept.length >= input.limit) break;
  }
  return kept.sort((a, b) => a.start - b.start);
}

function keywordDensity(text: string): number {
  const words = text.toLocaleLowerCase("vi").split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  if (!words.length) return 0;
  const content = words.filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  return new Set(content).size / words.length;
}

/** Code picker used when the clipPick budget feature is off or the LLM returns nothing. */
export function fallbackClipPicks(input: {
  sentences: TranscriptSentence[];
  sceneStarts: number[];
  minSec: number;
  maxSec: number;
  count: number;
}): ClipRange[] {
  const sentences = [...input.sentences].filter((sentence) => sentence.end > sentence.start && sentence.text.trim())
    .sort((a, b) => a.start - b.start);
  if (!sentences.length) return [];
  const seeds = input.sceneStarts.length
    ? input.sceneStarts
    : sentences.map((sentence) => sentence.start);
  const target = (input.minSec + input.maxSec) / 2;
  const raw: ClipRange[] = [];
  for (const sceneStart of seeds) {
    const startIdx = sentenceIndexAt(sceneStart, sentences, "start");
    if (startIdx < 0) continue;
    if (startsMidThought(sentences[startIdx]!.text)) continue;
    let endIdx = startIdx;
    while (endIdx < sentences.length - 1 && sentences[endIdx]!.end - sentences[startIdx]!.start < target) endIdx += 1;
    while (endIdx > startIdx && sentences[endIdx]!.end - sentences[startIdx]!.start > input.maxSec) endIdx -= 1;
    const fitted = fitLength(startIdx, endIdx, sentences, input.minSec, input.maxSec);
    if (!fitted) continue;
    const text = sentences.slice(fitted.startIdx, fitted.endIdx + 1).map((sentence) => sentence.text).join(" ");
    const density = keywordDensity(text);
    const opening = sentences[fitted.startIdx]!.text.trim();
    raw.push({
      start: fitted.start,
      end: fitted.end,
      hook: [...opening].slice(0, 60).join(""),
      title: [...opening].slice(0, 80).join("") || "Short",
      reason: "Câu gần đầu cảnh, mật độ từ khóa cao.",
      score: Math.round(clamp(density, 0, 1) * 100),
    });
  }
  return validateClipPicks({
    clips: raw,
    sentences,
    minSec: input.minSec,
    maxSec: input.maxSec,
    limit: input.count,
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Keep timestamps. Long middles become short summaries so the prompt stays within the token budget. */
export function condenseTranscript(sentences: TranscriptSentence[], maxTokens = 6000): string {
  const lines = sentences.map((sentence) => `${sentence.start.toFixed(1)}-${sentence.end.toFixed(1)} ${sentence.text.trim()}`);
  const full = lines.join("\n");
  if (estimateTokens(full) <= maxTokens) return full;
  const head = Math.max(1, Math.floor(sentences.length * 0.2));
  const tail = Math.max(1, Math.floor(sentences.length * 0.1));
  const middle = sentences.slice(head, Math.max(head, sentences.length - tail));
  const chunks: string[] = [];
  for (let index = 0; index < middle.length; index += 8) {
    const group = middle.slice(index, index + 8);
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const words = group.map((sentence) => sentence.text.trim()).join(" ").split(/\s+/).slice(0, 12).join(" ");
    chunks.push(`${first.start.toFixed(1)}-${last.end.toFixed(1)} ${words}…`);
  }
  return [
    ...lines.slice(0, head),
    ...chunks,
    ...lines.slice(sentences.length - tail),
  ].join("\n");
}

export function shiftSubtitleCues(cues: SubtitleCue[], clipStart: number, clipEnd?: number): SubtitleCue[] {
  return cues
    .filter((cue) => cue.text.trim() && cue.endSec > clipStart && (clipEnd === undefined || cue.startSec < clipEnd))
    .map((cue) => ({
      ...cue,
      startSec: Math.max(0, Number((cue.startSec - clipStart).toFixed(3))),
      endSec: Number((cue.endSec - clipStart).toFixed(3)),
    }))
    .filter((cue) => cue.endSec > cue.startSec);
}

/** Shift by -start, then delay by the lead pad so cues match a cut that begins 0.15s early. */
export function alignCuesToCut(cues: SubtitleCue[], clipStart: number, clipEnd: number): SubtitleCue[] {
  const lead = Math.min(CLIP_PAD_BEFORE_SEC, clipStart);
  return shiftSubtitleCues(cues, clipStart, clipEnd).map((cue) => ({
    ...cue,
    startSec: Number((cue.startSec + lead).toFixed(3)),
    endSec: Number((cue.endSec + lead).toFixed(3)),
  }));
}

export function hookOverlayWindow(): { startSec: number; endSec: number } {
  return { startSec: 0, endSec: HOOK_OVERLAY_SEC };
}

export function sceneWantsBlurFill(text: string): boolean {
  return /infographic|text overlay|biểu đồ|bieu do|chart|slide|chữ trên|overlay chữ|text slide/i.test(text);
}

export type ReframeSegment = { start: number; end: number; mode: ReframeMode; focusX?: number };

export function reframeSegments(input: {
  clipStart: number;
  clipEnd: number;
  mode: ReframeMode;
  scenes: Array<{ start: number; end: number; blurFill: boolean; focusX?: number }>;
}): ReframeSegment[] {
  if (input.mode === "blur-fill" || input.scenes.length === 0) {
    return [{ start: input.clipStart, end: input.clipEnd, mode: input.mode }];
  }
  const segments: ReframeSegment[] = [];
  for (const scene of input.scenes) {
    const start = Math.max(input.clipStart, scene.start);
    const end = Math.min(input.clipEnd, scene.end);
    if (end - start < 0.05) continue;
    const mode: ReframeMode = scene.blurFill ? "blur-fill" : input.mode;
    const focusX = mode === "smart" ? scene.focusX : undefined;
    const previous = segments[segments.length - 1];
    if (previous && previous.mode === mode && previous.focusX === focusX && Math.abs(previous.end - start) < 0.05) {
      previous.end = end;
    } else {
      segments.push({ start, end, mode, ...(focusX === undefined ? {} : { focusX }) });
    }
  }
  if (!segments.length) return [{ start: input.clipStart, end: input.clipEnd, mode: input.mode }];
  segments[0]!.start = input.clipStart;
  segments[segments.length - 1]!.end = input.clipEnd;
  return segments;
}

function num(value: number): string {
  return value.toFixed(3);
}

function cropFilter(mode: ReframeMode, focusX?: number): string {
  if (mode === "blur-fill") {
    return [
      "split[a][b]",
      "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=24[bg]",
      "[b]scale=1080:-2[fg]",
      "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1",
    ].join(";");
  }
  const x = mode === "smart" && focusX !== undefined
    ? `(iw-ih*9/16)*${clamp(focusX, 0, 1).toFixed(4)}`
    : "(iw-ih*9/16)/2";
  return `crop=ih*9/16:ih:${x}:0,scale=${CLIP_WIDTH}:${CLIP_HEIGHT},setsar=1`;
}

function hookDrawtext(fontFile: string, textFile: string): string {
  const font = escapeDrawtextPath(fontFile);
  const file = escapeDrawtextPath(textFile);
  return `drawtext=fontfile='${font}':textfile='${file}':expansion=none:fontsize=64:fontcolor=white:borderw=4:bordercolor=black@0.85:shadowx=3:shadowy=3:shadowcolor=black@0.55:x=(w-text_w)/2:y=h*0.18:enable='between(t,0,${HOOK_OVERLAY_SEC})'`;
}

export function clipCutWindow(clipStart: number, clipEnd: number, mediaDurationSec?: number): {
  cutStart: number;
  cutEnd: number;
  durationSec: number;
} {
  const cutStart = Math.max(0, clipStart - CLIP_PAD_BEFORE_SEC);
  let cutEnd = clipEnd + CLIP_PAD_AFTER_SEC;
  if (mediaDurationSec !== undefined && Number.isFinite(mediaDurationSec)) cutEnd = Math.min(mediaDurationSec, cutEnd);
  if (cutEnd <= cutStart) cutEnd = cutStart + Math.max(0.4, clipEnd - clipStart);
  return { cutStart, cutEnd, durationSec: cutEnd - cutStart };
}

export function buildClipFfmpegArgs(input: {
  inputPath: string;
  outputPath: string;
  clipStart: number;
  clipEnd: number;
  mode: ReframeMode;
  focusX?: number;
  segments?: ReframeSegment[];
  subtitlePath?: string;
  hookTextPath?: string;
  fontFile?: string;
  mediaDurationSec?: number;
}): { args: string[]; cutStart: number; cutEnd: number; durationSec: number; filter: string } {
  const { cutStart, cutEnd, durationSec } = clipCutWindow(input.clipStart, input.clipEnd, input.mediaDurationSec);
  const segments = (input.segments && input.segments.length > 1) ? input.segments : null;
  let filter: string;
  if (!segments) {
    const chain = cropFilter(input.mode, input.focusX);
    filter = input.mode === "blur-fill"
      ? `[0:v]${chain}[base]`
      : `[0:v]${chain}[base]`;
  } else {
    const parts: string[] = [];
    const labels: string[] = [];
    segments.forEach((segment, index) => {
      const relStart = Math.max(0, segment.start - cutStart);
      const relEnd = Math.max(relStart + 0.05, segment.end - cutStart);
      const label = `[v${index}]`;
      labels.push(label);
      const chain = cropFilter(segment.mode, segment.focusX);
      if (segment.mode === "blur-fill") {
        parts.push(`[0:v]trim=start=${num(relStart)}:end=${num(relEnd)},setpts=PTS-STARTPTS,split[a${index}][b${index}]`);
        parts.push(`[a${index}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=24[bg${index}]`);
        parts.push(`[b${index}]scale=1080:-2[fg${index}]`);
        parts.push(`[bg${index}][fg${index}]overlay=(W-w)/2:(H-h)/2,setsar=1${label}`);
      } else {
        parts.push(`[0:v]trim=start=${num(relStart)}:end=${num(relEnd)},setpts=PTS-STARTPTS,${chain}${label}`);
      }
    });
    parts.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[base]`);
    filter = parts.join(";");
  }
  let video = "[base]";
  if (input.subtitlePath) {
    filter += `;${video}ass='${escapeDrawtextPath(input.subtitlePath)}'[sub]`;
    video = "[sub]";
  }
  if (input.hookTextPath && input.fontFile) {
    filter += `;${video}${hookDrawtext(input.fontFile, input.hookTextPath)}[vout]`;
    video = "[vout]";
  } else if (video !== "[vout]") {
    filter += `;${video}null[vout]`;
  }
  const fade = Math.min(CLIP_FADE_SEC, durationSec / 2);
  const fadeOut = Math.max(0, durationSec - fade);
  const audio = `afade=t=in:st=0:d=${num(fade)},afade=t=out:st=${num(fadeOut)}:d=${num(fade)},${LOUDNORM}`;
  const args = [
    "-y",
    "-ss", num(cutStart),
    "-to", num(cutEnd),
    "-i", input.inputPath,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-map", "0:a?",
    "-af", audio,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    input.outputPath,
  ];
  return { args, cutStart, cutEnd, durationSec, filter };
}

function parseTimestamp(raw: string): number {
  const cleaned = raw.trim().replace(",", ".");
  const parts = cleaned.split(":");
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function parseSrt(text: string): TranscriptSentence[] {
  const blocks = text.replace(/^\uFEFF/, "").replace(/\r/g, "").split(/\n\s*\n/);
  const cues: TranscriptSentence[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const [startRaw, endRaw] = lines[timeIndex]!.split("-->");
    const body = lines.slice(timeIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!body || !startRaw || !endRaw) continue;
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw.trim().split(/\s+/)[0] ?? endRaw);
    if (!(end > start)) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}

export function parseVtt(text: string): TranscriptSentence[] {
  const stripped = text.replace(/^\uFEFF/, "").replace(/\r/g, "").replace(/^WEBVTT[^\n]*\n+/i, "");
  return parseSrt(stripped);
}

export function parseTranscriptFile(text: string, format?: "srt" | "vtt" | "plain"): TranscriptSentence[] {
  const sample = text.slice(0, 40);
  if (format === "vtt" || /^WEBVTT/i.test(sample)) return parseVtt(text);
  if (format === "srt" || text.includes("-->")) return parseSrt(text);
  return [];
}

const VERTICAL_PLATFORMS = new Set(["youtube", "tiktok", "facebook_reels", "instagram_reels"]);

export function isVerticalClipAccount(account: { platform: string; format: string; enabled?: boolean }): boolean {
  if (account.enabled === false) return false;
  if (account.format !== "vertical") return false;
  return VERTICAL_PLATFORMS.has(account.platform);
}

/** Free profile slots that start strictly after the parent's publish time. */
export function spreadClipSlots(input: {
  now: Date;
  after: Date | null;
  count: number;
  automation: Pick<ProfileAutomation, "timezone" | "publishTimes" | "videosPerDay">;
  assignedSlotIsos: readonly string[];
  daysAhead?: number;
}): PlannedSlot[] {
  const cursorBase = input.after && input.after.getTime() > input.now.getTime() ? input.after : input.now;
  const assigned = [...input.assignedSlotIsos];
  const slots: PlannedSlot[] = [];
  let cursor = cursorBase;
  for (let index = 0; index < input.count; index += 1) {
    const slot = pickNextFreePublishSlot({
      now: cursor,
      automation: input.automation,
      assignedSlotIsos: assigned,
      minAheadMs: 1000,
      daysAhead: input.daysAhead ?? 21,
    });
    if (!slot) break;
    slots.push(slot);
    assigned.push(slot.at.toISOString());
    cursor = slot.at;
  }
  return slots;
}
