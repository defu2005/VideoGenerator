import { hamming, type AspectRatio, type Shot } from "@vg/shared";

/**
 * TASK-139: facts computed by code (no LLM) and returned with every preview.
 * The functions here are pure so tests can call them without ffmpeg.
 */

export type SafeAreaResult = { overflow: boolean; reasons: string[]; method: "estimated" | "dom" };

export type TextRect = { left: number; top: number; right: number; bottom: number };

export function measuredSafeArea(box: TextRect, rects: TextRect[]): SafeAreaResult {
  const overflow = rects.some((rect) => rect.left < box.left - 1 || rect.top < box.top - 1
    || rect.right > box.right + 1 || rect.bottom > box.bottom + 1);
  return { method: "dom", overflow, reasons: overflow ? ["Vị trí chữ thực tế vượt vùng an toàn của mẫu."] : [] };
}

export type ShotFacts = {
  sceneId: string;
  sceneIndex: number;
  shotId: string;
  kind: Shot["kind"];
  /** Template of a graphic shot (one template family per kind). Null for footage and stills. */
  template: string | null;
  footageId: string | null;
  startSec: number;
  endSec: number;
  /** Video-clock start of the shot. */
  videoStartSec: number;
  textOnScreen: string[];
  textChars: number;
  charsPerSecond: number | null;
  safeArea: SafeAreaResult;
  /** 0–255 average of the middle frame. Null when the frame was not measured. */
  luma: number | null;
  lumaFlag: "dark" | "bright" | null;
  phash: string | null;
  meanColor?: [number, number, number];
  /** Hamming distance (0–64) to the previous shot; null for the first shot or when unhashed. */
  distanceToPrev: number | null;
  nearDuplicateOfPrev: boolean;
};

export const DARK_LUMA = 30;
export const BRIGHT_LUMA = 225;
/** Two dHash values this close (out of 64 bits) read as the same picture. */
export const NEAR_DUPLICATE_BITS = 6;
const NEAR_DUPLICATE_COLOR_DISTANCE = 48;
/** Reading speed beyond this is hard to follow, in characters per second. */
export const MAX_READABLE_CPS = 21;

/** Title-safe margins as fractions of the frame. Portrait keeps room for the platform UI at the bottom. */
export function safeMargins(aspect: AspectRatio): { x: number; top: number; bottom: number } {
  if (aspect === "9:16") return { x: 0.06, top: 0.08, bottom: 0.18 };
  if (aspect === "1:1") return { x: 0.06, top: 0.06, bottom: 0.08 };
  return { x: 0.05, top: 0.05, bottom: 0.08 };
}

/** The lines a viewer reads on screen for this shot. Footage and stills carry none. */
export function shotTextLines(source: Shot["source"]): string[] {
  const keep = (values: (string | undefined)[]) => values.filter((value): value is string => typeof value === "string" && value.trim() !== "");
  switch (source.kind) {
    case "kinetic_text": return keep(source.lines);
    case "chart": return keep([source.title, ...source.labels]);
    case "quote_full": return keep([source.quote, source.speaker, source.role]);
    case "list_full": return keep([source.title, ...source.items]);
    case "diagram": return keep([source.title, ...source.nodes.map((node) => node.label)]);
    case "timeline": return keep([source.title, ...source.events.flatMap((event) => [event.date, event.label])]);
    case "map": return keep([source.label, source.sublabel]);
    case "compare": return keep([source.left.label, source.left.text, source.right.label, source.right.text]);
    default: return [];
  }
}

/**
 * Heuristic: lay the text out at the font size the templates use (about 5.5% of the frame height,
 * 0.52 em per character) and check it against the title-safe box. A word wider than the box cannot
 * wrap, and too many wrapped lines run out of height.
 */
export function safeAreaCheck(lines: string[], aspect: AspectRatio, frame: { width: number; height: number }): SafeAreaResult {
  const reasons: string[] = [];
  if (!lines.length) return { method: "estimated", overflow: false, reasons };
  const margins = safeMargins(aspect);
  const safeWidth = frame.width * (1 - 2 * margins.x);
  const safeHeight = frame.height * (1 - margins.top - margins.bottom);
  const fontPx = frame.height * 0.055;
  const charPx = fontPx * 0.52;
  let wrapped = 0;
  for (const line of lines) {
    const words = line.split(/\s+/).filter(Boolean);
    const widest = Math.max(0, ...words.map((word) => word.length));
    if (widest * charPx > safeWidth) reasons.push(`Từ "${words.find((word) => word.length === widest)?.slice(0, 24)}…" rộng hơn vùng an toàn.`);
    wrapped += Math.max(1, Math.ceil((line.length * charPx) / safeWidth));
  }
  if (wrapped * fontPx * 1.25 > safeHeight) reasons.push(`Chữ cần ${wrapped} dòng, vượt chiều cao vùng an toàn.`);
  return { method: "estimated", overflow: reasons.length > 0, reasons };
}

export function lumaFlag(luma: number | null): "dark" | "bright" | null {
  if (luma === null) return null;
  if (luma < DARK_LUMA) return "dark";
  if (luma > BRIGHT_LUMA) return "bright";
  return null;
}

/** Fills the neighbour distance of each shot in order. Mutates the entries it is given. */
export function markNearDuplicates(shots: Pick<ShotFacts, "phash" | "distanceToPrev" | "nearDuplicateOfPrev" | "meanColor">[]): void {
  for (let index = 0; index < shots.length; index += 1) {
    const current = shots[index]!;
    const previous = index > 0 ? shots[index - 1]! : null;
    if (!previous || !current.phash || !previous.phash) {
      current.distanceToPrev = null;
      current.nearDuplicateOfPrev = false;
      continue;
    }
    current.distanceToPrev = hamming(BigInt(`0x${current.phash}`), BigInt(`0x${previous.phash}`));
    const a = previous.meanColor;
    const b = current.meanColor;
    const colorDistance = a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 0;
    current.nearDuplicateOfPrev = current.distanceToPrev <= NEAR_DUPLICATE_BITS
      && colorDistance <= NEAR_DUPLICATE_COLOR_DISTANCE;
  }
}

export function baseShotFacts(input: {
  shot: Shot;
  sceneId: string;
  sceneIndex: number;
  videoStartSec: number;
  aspect: AspectRatio;
  frame: { width: number; height: number };
}): ShotFacts {
  const { shot } = input;
  const lines = shotTextLines(shot.source);
  const textChars = lines.reduce((sum, line) => sum + line.length, 0);
  const duration = Math.max(0.001, shot.endSec - shot.startSec);
  return {
    sceneId: input.sceneId,
    sceneIndex: input.sceneIndex,
    shotId: shot.id,
    kind: shot.kind,
    template: shot.source.kind === "footage" || shot.source.kind === "still" ? null : shot.source.kind,
    footageId: shot.source.kind === "footage" ? shot.source.clipId : null,
    startSec: shot.startSec,
    endSec: shot.endSec,
    videoStartSec: input.videoStartSec,
    textOnScreen: lines,
    textChars,
    charsPerSecond: textChars > 0 ? Math.round((textChars / duration) * 10) / 10 : null,
    safeArea: safeAreaCheck(lines, input.aspect, input.frame),
    luma: null,
    lumaFlag: null,
    phash: null,
    distanceToPrev: null,
    nearDuplicateOfPrev: false,
  };
}

/** One line per problem, for the agent and the UI. */
export function factWarnings(shots: ShotFacts[]): string[] {
  const out: string[] = [];
  for (const shot of shots) {
    const where = `Cảnh ${shot.sceneIndex + 1} · ${shot.kind} ${shot.startSec.toFixed(1)}s`;
    if (shot.safeArea.overflow) out.push(`${where}: chữ tràn vùng an toàn — ${shot.safeArea.reasons.join(" ")}`);
    if (shot.lumaFlag === "dark") out.push(`${where}: khung hình quá tối (độ sáng ${Math.round(shot.luma ?? 0)}).`);
    if (shot.lumaFlag === "bright") out.push(`${where}: khung hình cháy sáng (độ sáng ${Math.round(shot.luma ?? 0)}).`);
    if (shot.nearDuplicateOfPrev) out.push(`${where}: gần giống cảnh quay liền trước (khác ${shot.distanceToPrev} bit).`);
    if (shot.charsPerSecond !== null && shot.charsPerSecond > MAX_READABLE_CPS) out.push(`${where}: chữ ${shot.charsPerSecond} ký tự/giây, khó đọc kịp.`);
  }
  return out;
}
