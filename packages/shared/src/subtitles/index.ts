export type SubtitleCue = {
  index?: number;
  sceneId?: string;
  startSec: number;
  endSec: number;
  text: string;
  edited?: boolean;
};

export type SubtitleOptions = {
  aspectRatio?: "16:9" | "9:16" | "1:1";
  maxCharsPerLine?: number;
  maxLines?: number;
  minChunkDurationSec?: number;
};

export function defaultMaxCharsPerLine(aspectRatio?: SubtitleOptions["aspectRatio"]): number {
  const ratio = aspectRatio ?? "16:9";
  if (ratio === "9:16") return 28;
  if (ratio === "1:1") return 32;
  return 42;
}

const DEFAULT_MAX_CHARS: Record<NonNullable<SubtitleOptions["aspectRatio"]>, number> = {
  "16:9": 42,
  "9:16": 28,
  "1:1": 32,
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pickBreak(text: string, start: number, limit: number): number {
  const end = Math.min(text.length, start + limit);
  for (let index = end; index > start; index -= 1) {
    const char = text[index - 1];
    if (/[.!?。！？,;:]/.test(char)) return index;
    if (/\s/.test(char) && index < text.length && !/\s/.test(text[index])) return index;
  }
  for (let index = end; index > start; index -= 1) {
    if (/\s/.test(text[index - 1])) return index;
  }
  return end;
}

function splitIntoSegments(text: string, maxCharsPerChunk: number): string[] {
  const trimmed = normalizeText(text);
  if (!trimmed) return [];
  if (trimmed.length <= maxCharsPerChunk) return [trimmed];

  const parts: string[] = [];
  const sentences = trimmed.split(/(?<=[.!?。！？])\s+|\n+/).filter(Boolean);

  for (const sentence of sentences) {
    if (sentence.length <= maxCharsPerChunk) {
      parts.push(sentence);
      continue;
    }

    const words = sentence.split(/\s+/).filter(Boolean);
    let current = words[0] ?? "";
    for (let index = 1; index < words.length; index += 1) {
      const word = words[index];
      const candidate = `${current} ${word}`;
      if (current.length + 1 + word.length <= maxCharsPerChunk) {
        current = candidate;
      } else {
        parts.push(current);
        current = word;
      }
    }
    if (current) parts.push(current);
  }

  if (parts.length === 0) return [trimmed];
  return parts.map((part) => normalizeText(part)).filter(Boolean);
}

function formatTime(value: number): string {
  const totalMs = Math.round(value * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

export function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const trimmed = normalizeText(text);
  const safeMaxChars = Math.max(1, maxCharsPerLine);
  if (!trimmed) return [];
  if (trimmed.length <= safeMaxChars) return [trimmed];

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [trimmed];

  let best: { score: number; lines: string[] } | null = null;
  for (let cut = 1; cut < words.length; cut += 1) {
    const left = words.slice(0, cut).join(" ");
    const right = words.slice(cut).join(" ");
    const leftLength = left.length;
    const rightLength = right.length;
    const withinLimit = leftLength <= safeMaxChars && rightLength <= safeMaxChars;
    if (!withinLimit) continue;
    const score = Math.abs(leftLength - rightLength);
    if (!best || score < best.score) {
      best = { score, lines: [left, right] };
    }
  }

  if (best) return best.lines;
  // No 2-line split fits: fill lines greedily so no line exceeds the limit
  // (callers detect > maxLines and split the cue further).
  return splitIntoSegments(trimmed, safeMaxChars);
}

export function splitCue(cue: SubtitleCue, opts: SubtitleOptions = {}): SubtitleCue[] {
  const text = normalizeText(cue.text);
  if (!text) return [];
  const fallback = defaultMaxCharsPerLine(opts.aspectRatio);
  const maxCharsPerLine = Number.isFinite(opts.maxCharsPerLine) && Number(opts.maxCharsPerLine) > 0 ? Number(opts.maxCharsPerLine) : fallback;
  const maxLines = opts.maxLines ?? 2;
  const totalText = text.length;
  // Shrink the chunk size until every chunk wraps into maxLines lines of at most maxCharsPerLine.
  const fits = (segment: string) => {
    return wrapLines(segment, maxCharsPerLine, maxLines).length <= maxLines;
  };
  let chunkLimit = Math.max(1, maxCharsPerLine * maxLines);
  let segments = splitIntoSegments(text, chunkLimit);
  while (!segments.every(fits) && chunkLimit > maxCharsPerLine) {
    chunkLimit -= 2;
    segments = splitIntoSegments(text, chunkLimit);
  }
  if (segments.length === 1) {
    return [{ ...cue, text: segments[0], startSec: cue.startSec, endSec: cue.endSec }];
  }

  const totalDuration = Math.max(0.001, cue.endSec - cue.startSec);
  const totalChars = segments.reduce((sum, segment) => sum + segment.length, 0) || 1;
  const output: SubtitleCue[] = [];
  let cursor = cue.startSec;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const share = segment.length / totalChars;
    const rawEnd = cue.startSec + totalDuration * share;
    const minDuration = segments.length > 1 && totalDuration >= segments.length ? 1.0 : 0;
    const end = index === segments.length - 1
      ? cue.endSec
      : Math.max(rawEnd, cursor + minDuration);

    const safeEnd = Math.min(end, cue.endSec);
    output.push({
      ...cue,
      index: cue.index,
      sceneId: cue.sceneId,
      text: segment,
      startSec: Number(cursor.toFixed(3)),
      endSec: Number(Math.max(safeEnd, cursor + 0.1).toFixed(3)),
      edited: cue.edited,
    });

    cursor = Number(Math.max(safeEnd, cursor + 0.1).toFixed(3));
  }

  if (output.length > 0) {
    output[0].startSec = cue.startSec;
    output.at(-1)!.endSec = cue.endSec;
  }

  return output.filter((piece) => piece.text.trim().length > 0);
}

export function cuesWithoutTimings(narration: string, durationSec: number, opts: SubtitleOptions = {}): SubtitleCue[] {
  const text = normalizeText(narration);
  if (!text || !Number.isFinite(durationSec) || durationSec <= 0) return [];
  const sentenceParts = text
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
  const pieces = sentenceParts.length > 0 ? sentenceParts : text.split(/\s+/).filter(Boolean);
  const totalChars = pieces.reduce((sum, piece) => sum + piece.length, 0);
  if (totalChars === 0) return [];
  const cues: SubtitleCue[] = [];
  let cursor = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    const share = piece.length / totalChars;
    const startSec = cursor;
    const endSec = index === pieces.length - 1 ? durationSec : durationSec * share + cursor;
    const pieceCues = splitCue({ text: piece, startSec, endSec }, opts);
    for (const cue of pieceCues) {
      cues.push({
        ...cue,
        index: cues.length,
        text: cue.text,
      });
    }
    cursor = endSec;
  }
  if (cues.length === 0) {
    return [{ startSec: 0, endSec: durationSec, text, index: 0 }];
  }
  return cues.map((cue, index) => ({ ...cue, index, startSec: Number(cue.startSec.toFixed(3)), endSec: Number(Math.min(cue.endSec, durationSec).toFixed(3)) }));
}

export function toSrt(cues: SubtitleCue[]): string {
  const normalized = [...cues].filter((cue) => cue.text.trim()).sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
  const lines: string[] = [];
  normalized.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${formatTime(cue.startSec)} --> ${formatTime(cue.endSec)}`);
    lines.push(cue.text.trim());
    lines.push("");
  });
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}

function escapeAssText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\N")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

export function toAss(cues: SubtitleCue[], style: Record<string, unknown> = {}): string {
  const aspectRatio = (style.aspectRatio as string | undefined) ?? "16:9";
  const defaultSizes: Record<string, { width: number; height: number }> = {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1080, height: 1080 },
  };
  const dims = defaultSizes[aspectRatio] ?? defaultSizes["16:9"];
  const width = Number(style.width ?? dims.width);
  const height = Number(style.height ?? dims.height);
  const fontName = String(style.fontName ?? "Arial");
  const rawFontSize = Number(style.fontSize);
  const fontSize = Number.isFinite(rawFontSize) && rawFontSize > 0 ? rawFontSize : Math.round(height * 0.05);
  const marginBottom = Number(style.marginBottom ?? Math.round(height * 0.08));
  const textColor = String(style.textColor ?? "&H00FFFFFF");
  const outlineColor = String(style.outlineColor ?? "&H00000000");

  const header = [
    "[Script Info]",
    "Title: Video subtitles",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${fontSize},${textColor},&H00000000,${outlineColor},&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,100,100,${marginBottom},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const dialogs = cues
    .filter((cue) => cue.text.trim())
    .sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
    .map((cue) => `Dialogue: 0,${formatTime(cue.startSec)},${formatTime(cue.endSec)},Default,,0,0,0,,${escapeAssText(cue.text.trim())}`)
    .join("\n");

  return `${header}\n${dialogs}\n`;
}
