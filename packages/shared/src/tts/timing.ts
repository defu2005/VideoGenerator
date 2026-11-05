import { splitSentences } from "../scenes/sentences.js";

export type TimedSpan = { startSec: number; endSec: number; text: string };

export function roundSec(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function splitNarration(text: string, maxChars: number, language = "vi"): string[] {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  const limit = Math.max(1, maxChars);
  if (trimmed.length <= limit) return [trimmed];
  const sentences = splitSentences(trimmed, language);
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  for (const sentence of sentences.length > 0 ? sentences : [trimmed]) {
    if (sentence.length > limit) {
      flush();
      parts.push(...splitLongSentence(sentence, limit));
      continue;
    }
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > limit && current) {
      flush();
      current = sentence;
    } else {
      current = next;
    }
  }
  flush();
  return parts;
}

function splitLongSentence(sentence: string, limit: number): string[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > limit) {
      if (current) parts.push(current);
      for (let index = 0; index < word.length; index += limit) parts.push(word.slice(index, index + limit));
      current = "";
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > limit && current) {
      parts.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function combineChunkTimings(parts: Array<{ durationSec: number; words: TimedSpan[]; cues: TimedSpan[] }>): {
  durationSec: number;
  words: TimedSpan[];
  cues: TimedSpan[];
} {
  let offset = 0;
  const words: TimedSpan[] = [];
  const cues: TimedSpan[] = [];
  for (const part of parts) {
    words.push(...offsetTimed(part.words, offset));
    cues.push(...offsetTimed(part.cues, offset));
    offset += part.durationSec;
  }
  return { durationSec: roundSec(offset), words, cues };
}

export function offsetTimed<T extends { startSec: number; endSec: number }>(items: T[], offsetSec: number): T[] {
  if (offsetSec === 0) return items.map((item) => ({ ...item }));
  return items.map((item) => ({
    ...item,
    startSec: roundSec(item.startSec + offsetSec),
    endSec: roundSec(item.endSec + offsetSec),
  }));
}

export function cuesFromWords(words: TimedSpan[]): TimedSpan[] {
  const cues: TimedSpan[] = [];
  let buffer: TimedSpan[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    cues.push({
      startSec: buffer[0]!.startSec,
      endSec: buffer[buffer.length - 1]!.endSec,
      text: buffer.map((word) => word.text).join(" "),
    });
    buffer = [];
  };
  for (const word of words) {
    buffer.push(word);
    if (/[.!?…。！？]$/u.test(word.text)) flush();
  }
  flush();
  return cues;
}

export function syllableWeight(token: string, language: string): number {
  if (language.trim().toLowerCase().startsWith("vi")) return 1;
  const groups = token.toLowerCase().match(/[aeiouyăâêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]+/giu);
  return Math.max(1, groups?.length ?? 1);
}

export function parseSilenceLog(stderr: string, durationSec: number): Array<{ startSec: number; endSec: number }> {
  const duration = Math.max(durationSec, 0);
  const silences: Array<{ startSec: number; endSec: number }> = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    const end = line.match(/silence_end:\s*([0-9.]+)/);
    if (start) open = Number(start[1]);
    if (end && open !== null) {
      silences.push({ startSec: open, endSec: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null) silences.push({ startSec: open, endSec: duration });
  const voiced: Array<{ startSec: number; endSec: number }> = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.startSec > cursor + 0.01) voiced.push({ startSec: cursor, endSec: silence.startSec });
    cursor = Math.max(cursor, silence.endSec);
  }
  if (duration > cursor + 0.01) voiced.push({ startSec: cursor, endSec: duration });
  return voiced.length > 0 ? voiced : [{ startSec: 0, endSec: Math.max(duration, 0.01) }];
}

export function estimateWords(input: {
  text: string;
  language: string;
  durationSec: number;
  segments: Array<{ startSec: number; endSec: number }>;
}): TimedSpan[] {
  const sentences = splitSentences(input.text, input.language).filter(Boolean);
  const source = sentences.length > 0 ? sentences : [input.text.trim()].filter(Boolean);
  if (source.length === 0) return [];
  const segments = input.segments.length > 0 ? input.segments : [{ startSec: 0, endSec: input.durationSec }];
  const words: TimedSpan[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const segment = segments[Math.min(index, segments.length - 1)]!;
    const share = source.length > segments.length && index >= segments.length - 1
      ? splitLastWindow(segment, source.length - (segments.length - 1), index - (segments.length - 1))
      : segment;
    words.push(...spreadSentence(source[index]!, share.startSec, share.endSec, input.language));
  }
  return coverDuration(words, input.durationSec);
}

function splitLastWindow(
  segment: { startSec: number; endSec: number },
  count: number,
  offset: number,
): { startSec: number; endSec: number } {
  const span = Math.max(0, segment.endSec - segment.startSec);
  const slice = span / Math.max(count, 1);
  return {
    startSec: segment.startSec + slice * offset,
    endSec: offset === count - 1 ? segment.endSec : segment.startSec + slice * (offset + 1),
  };
}

export function spreadSentence(sentence: string, startSec: number, endSec: number, language: string): TimedSpan[] {
  const tokens = sentence.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const weights = tokens.map((token) => syllableWeight(token, language));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const span = Math.max(0, endSec - startSec);
  let cursor = startSec;
  return tokens.map((token, index) => {
    const end = index === tokens.length - 1 ? endSec : cursor + span * (weights[index]! / total);
    const word = { startSec: roundSec(cursor), endSec: roundSec(end), text: token };
    cursor = end;
    return word;
  });
}

export function coverDuration(words: TimedSpan[], durationSec: number): TimedSpan[] {
  if (words.length === 0) return [];
  const duration = Math.max(durationSec, 0.001);
  const out = words.map((word) => ({ ...word }));
  out[0]!.startSec = 0;
  for (let index = 0; index < out.length - 1; index += 1) {
    const nextStart = Math.max(out[index]!.startSec, out[index + 1]!.startSec);
    out[index]!.endSec = roundSec(nextStart);
    out[index + 1]!.startSec = out[index]!.endSec;
  }
  out[out.length - 1]!.endSec = roundSec(Math.max(out[out.length - 1]!.startSec, duration));
  for (const word of out) {
    if (word.endSec < word.startSec) word.endSec = word.startSec;
  }
  return out;
}

function foldToken(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function alignScriptWords(script: string, recognized: TimedSpan[], durationSec: number): TimedSpan[] {
  const scriptWords = script.trim().split(/\s+/).filter(Boolean);
  if (scriptWords.length === 0) return [];
  const recognizedWords = recognized.filter((word) => word.text.trim());
  const pairs = alignIndices(
    scriptWords.map(foldToken),
    recognizedWords.map((word) => foldToken(word.text)),
  );
  const draft: Array<TimedSpan | null> = scriptWords.map((text, index) => {
    const match = pairs[index];
    if (match === undefined || match === null) return null;
    const source = recognizedWords[match];
    if (!source) return null;
    return { startSec: source.startSec, endSec: source.endSec, text };
  });
  const duration = Math.max(durationSec, 0.001);
  let previousEnd = 0;
  const filled: TimedSpan[] = draft.map((word, index) => {
    if (word) {
      previousEnd = word.endSec;
      return word;
    }
    let nextStart = duration;
    for (let look = index + 1; look < draft.length; look += 1) {
      const ahead = draft[look];
      if (ahead) {
        nextStart = ahead.startSec;
        break;
      }
    }
    const start = previousEnd;
    const end = Math.max(start, nextStart);
    previousEnd = end;
    return { startSec: start, endSec: end, text: scriptWords[index]! };
  });
  return coverDuration(filled.map((word) => ({
    ...word,
    startSec: roundSec(word.startSec),
    endSec: roundSec(word.endSec),
  })), duration);
}

function alignIndices(left: string[], right: string[]): Array<number | null> {
  const rows = left.length;
  const columns = right.length;
  const scores: number[][] = Array.from({ length: rows + 1 }, () => Array(columns + 1).fill(0));
  for (let row = 0; row <= rows; row += 1) scores[row]![0] = row;
  for (let column = 0; column <= columns; column += 1) scores[0]![column] = column;
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      scores[row]![column] = Math.min(
        scores[row - 1]![column]! + 1,
        scores[row]![column - 1]! + 1,
        scores[row - 1]![column - 1]! + cost,
      );
    }
  }
  const map: Array<number | null> = Array(rows).fill(null);
  let row = rows;
  let column = columns;
  while (row > 0 && column > 0) {
    const cost = left[row - 1] === right[column - 1] ? 0 : 1;
    if (scores[row]![column] === scores[row - 1]![column - 1]! + cost) {
      map[row - 1] = column - 1;
      row -= 1;
      column -= 1;
    } else if (scores[row]![column] === scores[row - 1]![column]! + 1) {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return map;
}

export function timingsCover(words: TimedSpan[], durationSec: number): boolean {
  if (words.length === 0) return durationSec <= 0;
  if (Math.abs(words[0]!.startSec) > 0.001) return false;
  if (Math.abs(words[words.length - 1]!.endSec - durationSec) > 0.001) return false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (word.endSec < word.startSec - 0.001) return false;
    const next = words[index + 1];
    if (next && next.startSec + 0.001 < word.endSec) return false;
  }
  return true;
}
