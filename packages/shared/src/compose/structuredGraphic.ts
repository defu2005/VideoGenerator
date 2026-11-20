import { z } from "zod";

const label = z.string().trim().min(1).max(36);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/);
export const DiagramSourceSchema = z.object({
  kind: z.literal("diagram"),
  title: z.string().trim().max(50).optional(),
  nodes: z.array(z.object({ id, label }).strict()).min(2).max(7),
  edges: z.array(z.object({ from: id, to: id, label: z.string().trim().max(24).optional() }).strict()).min(1).max(14),
  layout: z.enum(["flow", "cycle", "hub"]),
  itemTimes: z.array(z.number().finite().nonnegative()).optional(),
}).strict().superRefine((value, context) => {
  const ids = new Set(value.nodes.map((node) => node.id));
  if (ids.size !== value.nodes.length) context.addIssue({ code: "custom", path: ["nodes"], message: "Mỗi nút cần một id riêng." });
  value.edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) context.addIssue({ code: "custom", path: ["edges", index], message: "Liên kết cần hai nút khác nhau có trong sơ đồ." });
  });
  if (value.itemTimes && value.itemTimes.length !== value.nodes.length) context.addIssue({ code: "custom", path: ["itemTimes"], message: "Thời điểm phải khớp số nút." });
});

export const TimelineSourceSchema = z.object({
  kind: z.literal("timeline"),
  title: z.string().trim().max(50).optional(),
  events: z.array(z.object({ date: z.string().trim().min(1).max(24), label, imagePath: z.string().trim().min(1).max(1000).optional() }).strict()).min(3).max(8),
  itemTimes: z.array(z.number().finite().nonnegative()).optional(),
}).strict().superRefine((value, context) => {
  if (value.itemTimes && value.itemTimes.length !== value.events.length) context.addIssue({ code: "custom", path: ["itemTimes"], message: "Thời điểm phải khớp số sự kiện." });
});
export type DiagramSource = z.infer<typeof DiagramSourceSchema>;
export type TimelineSource = z.infer<typeof TimelineSourceSchema>;

export type DatedEvent = { date: string; label: string; wordStart: number; wordEnd: number };
const DATE = /\b(?:\d{1,2}[/.\-]\d{1,2}[/.\-](?:1\d{3}|20\d{2})|1\d{3}|20\d{2})\b/gu;

/** Literal dated statements only. Dates in one clause are not mistaken for several separate events. */
export function datedEvents(words: Array<{ text: string }>): DatedEvent[] {
  const result: DatedEvent[] = [];
  let start = 0;
  while (start < words.length) {
    let end = start + 1;
    while (end < words.length && !/[.!?;…]$/u.test(words[end - 1]!.text)) {
      if (/^(?:năm|in)$/iu.test(words[end]!.text) && /^(?:1\d{3}|20\d{2})(?:[,.])?$/.test(words[end + 1]?.text ?? "")) break;
      end++;
    }
    const text = words.slice(start, end).map((word) => word.text).join(" ");
    const matches = [...text.matchAll(DATE)];
    if (matches.length === 1) {
      const date = matches[0]![0];
      const rest = text.replace(date, "").replace(/^(?:năm|vào năm|in|year)\s+/iu, "").replace(/^[\s,.:;–-]+|[\s,.:;!?…]+$/gu, "");
      const label = rest.length <= 36 ? rest : rest.slice(0, 37).replace(/\s+\S*$/, "").trim();
      if (label) result.push({ date, label, wordStart: start, wordEnd: end });
    }
    start = end;
  }
  return result.slice(0, 8);
}

export function processLanguage(text: string): boolean {
  return /(?:\bdẫn\s+đến\b|\bgồm\b|\bbước\b|\bquy\s+trình\b|\bleads?\s+to\b|\bconsists?\s+of\b|\bstep\b|\bprocess\b)/iu.test(text);
}

function stamp(date: string): number | null {
  if (/^(?:1\d{3}|20\d{2})$/.test(date)) return Date.UTC(Number(date), 0, 1);
  const parts = /^(\d{1,2})[/.\-](\d{1,2})[/.\-]((?:1\d{3}|20\d{2}))$/.exec(date);
  if (!parts) return null;
  const day = Number(parts[1]), month = Number(parts[2]), year = Number(parts[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCDate() === day && value.getUTCMonth() === month - 1 ? value.getTime() : null;
}

/** Proportional time when readable, equal spacing when dates are imprecise, repeated or crowded. */
export function timelineScale(events: Array<{ date: string }>): { scale: "time" | "sequence"; positions: number[] } {
  const values = events.map((event) => stamp(event.date));
  const all = values.every((value): value is number => value !== null);
  if (all && new Set(values).size === values.length && values.length > 1 && values.every((value, index) => index === 0 || value > values[index - 1]!)) {
    const low = Math.min(...values), high = Math.max(...values);
    const positions = values.map((value) => (value - low) / (high - low));
    const sorted = [...positions].sort((a, b) => a - b);
    if (sorted.every((value, index) => index === 0 || value - sorted[index - 1]! >= 0.55 / events.length)) return { scale: "time", positions };
  }
  return { scale: "sequence", positions: events.map((_, index) => index / Math.max(1, events.length - 1)) };
}

/** Match full phrases to speech. A missing phrase keeps the caller's fallback timings. */
export function structuredGraphicTimes(labels: string[], words: Array<{ text: string; startSec: number }>, shotStart: number, durationSec: number): number[] | null {
  const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const tokens = words.map((word) => fold(word.text));
  const result: number[] = [];
  for (const label of labels) {
    const parts = label.split(/\s+/).map(fold).filter(Boolean);
    const at = tokens.findIndex((_, index) => parts.length > 0 && parts.every((part, offset) => tokens[index + offset] === part));
    if (at < 0) return null;
    result.push(Math.round(Math.max(0, Math.min(durationSec - 0.2, words[at]!.startSec - shotStart)) * 1000) / 1000);
  }
  return result;
}
