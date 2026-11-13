import { z } from "zod";

export const MOTION_TEMPLATE_IDS = [
  "title_card",
  "kinetic_word",
  "number_counter",
  "lower_third",
  "list_item",
  "quote_card",
  "bar_chart",
  "progress_bar",
  "end_card",
] as const;
export const MotionTemplateIdSchema = z.enum(MOTION_TEMPLATE_IDS);
export type MotionTemplateId = z.infer<typeof MotionTemplateIdSchema>;

export const MotionSafeAreaSchema = z.enum(["top", "center", "lower", "full"]);
export type MotionSafeArea = z.infer<typeof MotionSafeAreaSchema>;

export type MotionVariableSpec = {
  name: string;
  type: "string" | "number" | "color";
  maxLength?: number;
  default: string | number;
};

export type MotionTemplateSpec = {
  id: MotionTemplateId;
  version: number;
  nameVi: string;
  descriptionVi: string;
  kinds: ("overlay" | "fullscreen")[];
  minDurationSec: number;
  maxDurationSec: number;
  defaultDurationSec: number;
  safeArea: MotionSafeArea;
  variables: MotionVariableSpec[];
};

export const MOTION_TEMPLATES: MotionTemplateSpec[] = [
  {
    id: "title_card", version: 1, nameVi: "Thẻ tiêu đề", descriptionVi: "Tiêu đề mở đầu, tối đa hai dòng.",
    kinds: ["overlay", "fullscreen"], minDurationSec: 2, maxDurationSec: 6, defaultDurationSec: 3, safeArea: "center",
    variables: [
      { name: "title", type: "string", maxLength: 48, default: "" },
      { name: "subtitle", type: "string", maxLength: 48, default: "" },
      { name: "color", type: "color", default: "#F8FAFC" },
    ],
  },
  {
    id: "kinetic_word", version: 1, nameVi: "Chữ động", descriptionVi: "Một tới ba chữ lớn thay cho chú thích ASS.",
    kinds: ["overlay"], minDurationSec: 0.8, maxDurationSec: 4, defaultDurationSec: 1.6, safeArea: "center",
    variables: [
      { name: "text", type: "string", maxLength: 24, default: "" },
      { name: "color", type: "color", default: "#F5C518" },
    ],
  },
  {
    id: "number_counter", version: 1, nameVi: "Số đếm", descriptionVi: "Đếm tới một giá trị, có tiền tố và hậu tố.",
    kinds: ["overlay"], minDurationSec: 1.5, maxDurationSec: 5, defaultDurationSec: 2.5, safeArea: "center",
    variables: [
      { name: "value", type: "number", default: 0 },
      { name: "prefix", type: "string", maxLength: 8, default: "" },
      { name: "suffix", type: "string", maxLength: 8, default: "" },
      { name: "label", type: "string", maxLength: 32, default: "" },
      { name: "color", type: "color", default: "#F8FAFC" },
    ],
  },
  {
    id: "lower_third", version: 1, nameVi: "Tên dưới", descriptionVi: "Tên hoặc nguồn và một dòng phụ.",
    kinds: ["overlay"], minDurationSec: 2, maxDurationSec: 8, defaultDurationSec: 4, safeArea: "lower",
    variables: [
      { name: "name", type: "string", maxLength: 32, default: "" },
      { name: "sub", type: "string", maxLength: 40, default: "" },
      { name: "color", type: "color", default: "#38BDF8" },
    ],
  },
  {
    id: "list_item", version: 1, nameVi: "Mục danh sách", descriptionVi: "Huy hiệu số và tiêu đề mục.",
    kinds: ["overlay"], minDurationSec: 1.5, maxDurationSec: 6, defaultDurationSec: 3, safeArea: "lower",
    variables: [
      { name: "badge", type: "string", maxLength: 8, default: "#1" },
      { name: "title", type: "string", maxLength: 40, default: "" },
      { name: "color", type: "color", default: "#F8FAFC" },
    ],
  },
  {
    id: "quote_card", version: 1, nameVi: "Trích dẫn", descriptionVi: "Câu trích và tên người nói.",
    kinds: ["overlay"], minDurationSec: 2, maxDurationSec: 8, defaultDurationSec: 4, safeArea: "center",
    variables: [
      { name: "quote", type: "string", maxLength: 80, default: "" },
      { name: "author", type: "string", maxLength: 32, default: "" },
      { name: "color", type: "color", default: "#F8FAFC" },
    ],
  },
  {
    id: "bar_chart", version: 1, nameVi: "Biểu đồ cột", descriptionVi: "Hai tới năm cột, giá trị đã chuẩn hoá.",
    kinds: ["overlay"], minDurationSec: 2, maxDurationSec: 8, defaultDurationSec: 4, safeArea: "center",
    variables: [
      { name: "labels", type: "string", maxLength: 80, default: "" },
      { name: "values", type: "string", maxLength: 40, default: "" },
      { name: "color", type: "color", default: "#38BDF8" },
    ],
  },
  {
    id: "progress_bar", version: 1, nameVi: "Thanh tiến độ", descriptionVi: "Thanh mỏng trên cùng suốt video dọc.",
    kinds: ["overlay"], minDurationSec: 1, maxDurationSec: 3600, defaultDurationSec: 30, safeArea: "top",
    variables: [{ name: "color", type: "color", default: "#F5C518" }],
  },
  {
    id: "end_card", version: 1, nameVi: "Thẻ kết", descriptionVi: "Lời kêu gọi theo dõi và tên kênh, 3 giây cuối.",
    kinds: ["overlay", "fullscreen"], minDurationSec: 2, maxDurationSec: 4, defaultDurationSec: 3, safeArea: "full",
    variables: [
      { name: "line", type: "string", maxLength: 40, default: "Theo dõi để xem thêm" },
      { name: "channel", type: "string", maxLength: 32, default: "" },
      { name: "color", type: "color", default: "#F8FAFC" },
    ],
  },
];

export function motionTemplate(id: string): MotionTemplateSpec | undefined {
  return MOTION_TEMPLATES.find((item) => item.id === id);
}

export const MotionGraphicsSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  templates: z.array(MotionTemplateIdSchema).default([...MOTION_TEMPLATE_IDS]),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#0F172A"),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#F5C518"),
  font: z.enum(["be-vietnam-pro", "system"]).default("be-vietnam-pro"),
  endCard: z.boolean().default(true),
  channelName: z.string().max(32).optional(),
}).strict();
export type MotionGraphicsSettings = z.infer<typeof MotionGraphicsSettingsSchema>;

export const TimelineGraphicSchema = z.object({
  id: z.string(),
  templateId: MotionTemplateIdSchema,
  sceneId: z.string().nullable(),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  anchor: z.object({
    wordIndexStart: z.number().int().nonnegative(),
    wordIndexEnd: z.number().int().nonnegative(),
  }).strict().optional(),
  variables: z.record(z.string(), z.union([z.string(), z.number()])),
  layer: z.enum(["overlay", "fullscreen"]),
  source: z.enum(["llm", "fallback", "user"]),
}).strict();
export type TimelineGraphic = z.infer<typeof TimelineGraphicSchema>;

/** NFC first, then cut by code point so a precomposed Vietnamese letter stays whole. */
export function truncateMotionText(value: string, maxLength: number): string {
  const text = value.normalize("NFC");
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return chars.slice(0, maxLength).join("").normalize("NFC");
}

export function normalizeBarValues(raw: string): number[] {
  const numbers = raw.split(/[,|]/).map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value >= 0);
  const peak = Math.max(1, ...numbers);
  return numbers.slice(0, 5).map((value) => Math.round((value / peak) * 1000) / 1000);
}
