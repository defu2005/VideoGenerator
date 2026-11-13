import { z } from "zod";

export const OperatorModelKindSchema = z.enum(["chat", "tick", "research", "eval"]);
export type OperatorModelKind = z.infer<typeof OperatorModelKindSchema>;

export const OperatorTelegramEngineSchema = z.enum(["assistant", "operator"]);
export type OperatorTelegramEngine = z.infer<typeof OperatorTelegramEngineSchema>;

const OperatorRuntimeIdSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{0,79}$/);
const OperatorRuntimeByChannelSchema = z.object({
  web: OperatorRuntimeIdSchema.default("cursor"),
  telegram: OperatorRuntimeIdSchema.default("cursor"),
  schedule: OperatorRuntimeIdSchema.default("cursor"),
}).strict();
export type OperatorRuntimeChannel = keyof z.infer<typeof OperatorRuntimeByChannelSchema>;

export const OperatorModelByKindSchema = z.object({
  chat: z.string().default(""),
  tick: z.string().default(""),
  research: z.string().default(""),
  eval: z.string().default(""),
}).strict();
export type OperatorModelByKind = z.infer<typeof OperatorModelByKindSchema>;

export const OperatorSettingsSchema = z.object({
  /** When true, the operator does not spawn at all. */
  killed: z.boolean().default(false),
  cursorPath: z.string().default(""),
  runtimeByChannel: OperatorRuntimeByChannelSchema.default({ web: "cursor", telegram: "cursor", schedule: "cursor" }),
  modelByKind: OperatorModelByKindSchema.default({ chat: "", tick: "", research: "", eval: "" }),
  manualModels: z.array(z.string().min(1).max(120)).max(40).default([]),
  /** Null means the scheduled tick is off. */
  tickCron: z.string().trim().min(1).max(80).nullable().default(null),
  maxRunsPerDay: z.number().int().min(1).max(500).default(30),
  runTimeoutMs: z.number().int().min(1000).max(3_600_000).default(15 * 60 * 1000),
  /** Unset means: operator when the kill switch is off, assistant when it is on. */
  telegramEngine: OperatorTelegramEngineSchema.optional(),
  snapshotMaxChars: z.number().int().min(400).max(50_000).default(6000),
}).strict();
export type OperatorSettings = z.infer<typeof OperatorSettingsSchema>;

export const DEFAULT_OPERATOR_SETTINGS: OperatorSettings = OperatorSettingsSchema.parse({});

export const SUGGESTED_TICK_CRON = "0 8 * * *";

export const OperatorSettingsUpdateSchema = z.object({
  killed: z.boolean().optional(),
  cursorPath: z.string().max(500).optional(),
  runtimeByChannel: z.object({
    web: OperatorRuntimeIdSchema.optional(),
    telegram: OperatorRuntimeIdSchema.optional(),
    schedule: OperatorRuntimeIdSchema.optional(),
  }).strict().optional(),
  modelByKind: OperatorModelByKindSchema.partial().optional(),
  manualModels: z.array(z.string().min(1).max(120)).max(40).optional(),
  tickCron: z.string().trim().min(1).max(80).nullable().optional(),
  maxRunsPerDay: z.number().int().min(1).max(500).optional(),
  runTimeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
  telegramEngine: OperatorTelegramEngineSchema.nullable().optional(),
  snapshotMaxChars: z.number().int().min(400).max(50_000).optional(),
}).strict();
export type OperatorSettingsUpdate = z.infer<typeof OperatorSettingsUpdateSchema>;

export function resolveTelegramEngine(settings: OperatorSettings): OperatorTelegramEngine {
  if (settings.telegramEngine) return settings.telegramEngine;
  return settings.killed ? "assistant" : "operator";
}

export const StandingOrderInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(4000),
  cron: z.string().trim().min(1).max(80).nullable().optional(),
  enabled: z.boolean().optional(),
}).strict();
export type StandingOrderInput = z.infer<typeof StandingOrderInputSchema>;

export const OperatorRunKindSchema = z.enum(["chat", "tick", "research", "eval", "order", "wake"]);
export type OperatorRunKind = z.infer<typeof OperatorRunKindSchema>;

export const LOGIN_HINT_VI = "Mở terminal và chạy `cursor-agent login`";
