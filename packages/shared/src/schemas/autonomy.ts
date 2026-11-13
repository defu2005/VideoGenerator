import { z } from "zod";
import { PIPELINE_STAGES, PipelineStageSchema } from "../enums.js";

export const AutonomyLevelSchema = z.enum(["off", "assist", "supervised", "autonomous"]);
export const AutonomyGrantsSchema = z.object({
  approveGates: z.array(PipelineStageSchema).max(PIPELINE_STAGES.length),
  publish: z.enum(["never", "private", "unlisted", "public"]),
  enableAutomation: z.boolean(),
  providers: z.boolean(),
  omniroute: z.enum(["off", "read", "write"]),
  comments: z.enum(["off", "reply", "reply_and_hide"]),
  topics: z.boolean(),
  strategy: z.boolean(),
  retries: z.boolean(),
  computerUse: z.boolean(),
}).strict();
/** Quality repair limits (TASK-121). Autonomy keys: tools may not change them. */
export const RepairSettingsSchema = z.object({
  maxAttemptsPerProject: z.number().int().min(0).max(12),
  maxRendersPerProject: z.number().int().min(0).max(4),
  maxUsdPerProject: z.number().finite().nonnegative().nullable(),
  onExhausted: z.enum(["shelve", "ask"]),
}).strict();
export type RepairSettings = z.infer<typeof RepairSettingsSchema>;

export function defaultRepairSettings(level: z.infer<typeof AutonomyLevelSchema>): RepairSettings {
  return {
    maxAttemptsPerProject: 6,
    maxRendersPerProject: 2,
    maxUsdPerProject: null,
    onExhausted: level === "autonomous" ? "shelve" : "ask",
  };
}

export const AutonomySettingsSchema = z.object({
  level: AutonomyLevelSchema,
  grants: AutonomyGrantsSchema,
  repair: RepairSettingsSchema.optional(),
}).strict();
export const AutonomyOverrideSchema = AutonomySettingsSchema.partial().extend({
  grants: AutonomyGrantsSchema.partial().optional(),
});
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;
export type AutonomyGrants = z.infer<typeof AutonomyGrantsSchema>;
export type AutonomySettings = z.infer<typeof AutonomySettingsSchema>;

export const AutonomyBudgetSchema = z.object({
  dailyUsd: z.number().finite().nonnegative().nullable(),
  monthlyUsd: z.number().finite().nonnegative().nullable(),
  maxRendersPerDay: z.number().int().nonnegative().nullable(),
  maxPublishesPerDayPerAccount: z.number().int().nonnegative().nullable(),
  maxOperatorRunsPerDay: z.number().int().nonnegative().nullable(),
  maxQuestionsPerDay: z.number().int().nonnegative(),
}).strict();
export type AutonomyBudget = z.infer<typeof AutonomyBudgetSchema>;
export const DEFAULT_AUTONOMY_BUDGET: AutonomyBudget = {
  dailyUsd: null, monthlyUsd: null, maxRendersPerDay: null, maxPublishesPerDayPerAccount: null,
  maxOperatorRunsPerDay: null, maxQuestionsPerDay: 3,
};

const empty: AutonomyGrants = {
  approveGates: [], publish: "never", enableAutomation: false, providers: false,
  omniroute: "off", comments: "off", topics: false, strategy: false, retries: false, computerUse: false,
};
export const AUTONOMY_PRESETS = {
  off: empty,
  assist: empty,
  supervised: { ...empty, approveGates: ["TOPIC", "RESEARCH", "SCRIPT"], publish: "private", providers: true, topics: true, retries: true },
  autonomous: {
    ...empty, approveGates: [...PIPELINE_STAGES], publish: "public", enableAutomation: true,
    providers: true, omniroute: "write", comments: "reply_and_hide", topics: true, strategy: true, retries: true,
  },
} satisfies Record<AutonomyLevel, AutonomyGrants>;

function lower<T>(values: readonly T[], a: T, b: T): T {
  return values[Math.min(values.indexOf(a), values.indexOf(b))]!;
}

export function intersectAutonomy(a: AutonomySettings, b: AutonomySettings): AutonomySettings {
  return {
    level: lower(AutonomyLevelSchema.options, a.level, b.level),
    grants: {
      approveGates: a.grants.approveGates.filter((stage) => b.grants.approveGates.includes(stage)),
      publish: lower(AutonomyGrantsSchema.shape.publish.options, a.grants.publish, b.grants.publish),
      enableAutomation: a.grants.enableAutomation && b.grants.enableAutomation,
      providers: a.grants.providers && b.grants.providers,
      omniroute: lower(AutonomyGrantsSchema.shape.omniroute.options, a.grants.omniroute, b.grants.omniroute),
      comments: lower(AutonomyGrantsSchema.shape.comments.options, a.grants.comments, b.grants.comments),
      topics: a.grants.topics && b.grants.topics,
      strategy: a.grants.strategy && b.grants.strategy,
      retries: a.grants.retries && b.grants.retries,
      computerUse: a.grants.computerUse && b.grants.computerUse,
    },
  };
}

/** Null requires human review even with every grant. */
export const TOOL_GRANTS: Readonly<Partial<Record<string, keyof AutonomyGrants | null>>> = {
  add_revenue_entry: null, update_profile_direction: "strategy", set_profile_automation: "enableAutomation",
  resume_automation_all: "enableAutomation", run_pipeline: "retries", decide_overdue: "retries", approve_gate: "approveGates",
  publish_project: "publish", cancel_publication: "retries", apply_models: "providers",
  update_llm_settings: "providers", suggest_topics: "topics", approve_topics: "topics", reject_topics: "topics",
  delete_topic: "topics", delete_project: null, apply_insight: "strategy", clear_llm_cooldown: "retries",
  reply_comment: "comments", hide_comment: "comments", make_shorts: null, make_translation: null,
  apply_review_proposal: null, undo_timeline_edit: null, computer_act: "computerUse",
  propose_route_change: "providers", apply_routing_proposal: "providers", update_omniroute_combos: "omniroute",
  mark_change_reviewed: null, update_stage_timeouts: null, crop_scene_images: null, dedupe_scene_visuals: null,
  propose_knowledge_change: null, import_knowledge: null,
  resolve_change_event: null, report_change: null,
  omniroute_set_provider_state: "omniroute", omniroute_upsert_combo: "omniroute", omniroute_delete_combo: "omniroute",
  repair_script: "retries", repair_scene: "retries", repair_render_stage: "retries", set_node_drain: null,
  // TASK-111: the look of a channel is the user's call until they decide otherwise.
  set_style_pack: null,
};

export const GoalSpecSchema = z.object({
  videosPerDay: z.number().nonnegative().optional(),
  videosPerWeek: z.number().nonnegative().optional(),
  platforms: z.array(z.string().max(40)).max(8).default([]),
  formats: z.array(z.enum(["long", "shorts"])).max(4).default(["long"]),
  minQualityScore: z.number().min(0).max(10).default(7),
  topicFocus: z.array(z.string().max(200)).max(20).default([]),
  avoid: z.array(z.string().max(200)).max(20).default([]),
  deadline: z.string().max(40).nullable().optional(),
  kpi: z.object({
    views: z.number().nonnegative().optional(),
    subscribers: z.number().nonnegative().optional(),
    retention: z.number().min(0).max(1).optional(),
  }).strict().optional(),
  plan: z.record(z.string(), z.unknown()).optional(),
  publishTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
}).strict();
export type GoalSpec = z.infer<typeof GoalSpecSchema>;

export const YOUTUBE_SAFE_UPLOADS_PER_DAY = 6;

/** Warn when the user's words ask for more uploads than the platform quota allows. */
export function goalCapacityWarning(spec: GoalSpec, uploadsPerDay = YOUTUBE_SAFE_UPLOADS_PER_DAY): string | null {
  const perDay = spec.videosPerDay ?? (spec.videosPerWeek != null ? spec.videosPerWeek / 7 : 0);
  if (perDay > uploadsPerDay) {
    return `Mục tiêu ${perDay} video/ngày vượt khoảng ${uploadsPerDay} lượt đăng YouTube an toàn mỗi ngày. Kế hoạch sẽ dừng ở ${uploadsPerDay}.`;
  }
  return null;
}

export function capGoalVideos(spec: GoalSpec, uploadsPerDay = YOUTUBE_SAFE_UPLOADS_PER_DAY): number {
  const asked = spec.videosPerDay ?? (spec.videosPerWeek != null ? Math.ceil(spec.videosPerWeek / 7) : 1);
  return Math.max(1, Math.min(uploadsPerDay, Math.floor(asked) || 1));
}

export const PreferenceScopeSchema = z.enum(["script", "tts", "render", "thumbnail", "metadata", "publish", "comments", "routing"]);
export type PreferenceScope = z.infer<typeof PreferenceScopeSchema>;

export const RequestKindSchema = z.enum(["needs_key", "reconnect_account", "platform_app", "budget", "approve", "info"]);
export type RequestKind = z.infer<typeof RequestKindSchema>;

const APP_ROUTES = [/^\/settings\/keys(?:\?|$)/, /^\/settings\/connections(?:\?|$)/, /^\/accounts(?:\?|$)/, /^\/settings\/notifications(?:\?|$)/, /^\/operator(?:\?|$)/, /^\/profiles\/[^/]+\/autonomy(?:\?|$)/, /^\/projects\/[^/]+\/overview(?:\?|$)/];

export function actionUrlAllowed(url: string, omniOrigin?: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//") && APP_ROUTES.some((pattern) => pattern.test(url))) return true;
  if (!omniOrigin) return false;
  try {
    const target = new URL(url);
    const origin = new URL(omniOrigin);
    return target.origin === origin.origin && target.pathname.startsWith("/dashboard/");
  } catch {
    return false;
  }
}

const SENSITIVE = /chính trị|politics|bầu cử|election|chữa|cure|thuốc|tragedy|thảm họa|trẻ em|minor|trẻ vị thành niên/i;

export function topicIsSensitive(text: string): boolean {
  return SENSITIVE.test(text);
}

export function untrustedTextHasInstructions(text: string): boolean {
  return /ignore (your |the )?rules|bỏ qua (mọi )?quy tắc|publish now|đăng ngay|add_topic|publish_project/i.test(text);
}

export type ScriptGateInput = {
  score: number | null;
  minQualityScore: number;
  guidelinePass: boolean;
  blockingFacts: number;
  reviseRound: number;
};

/** `maxRevise` is 2 unless the `retries` grant raises it to the repair budget. */
export function scriptGateDecision(input: ScriptGateInput, maxRevise = 2): "approve" | "revise" | "hold" {
  if (input.score == null) return "hold";
  if (input.score >= input.minQualityScore && input.guidelinePass && input.blockingFacts === 0) return "approve";
  if (input.reviseRound < maxRevise) return "revise";
  return "hold";
}

export function renderGateOk(input: {
  exists: boolean;
  durationSec: number;
  targetSec: number;
  silent: boolean;
  subtitlesInSync: boolean;
  freezeSegments?: number;
  blackSegments?: number;
}): boolean {
  if (!input.exists || input.silent || !input.subtitlesInSync || input.targetSec <= 0) return false;
  if ((input.freezeSegments ?? 0) > 0 || (input.blackSegments ?? 0) > 0) return false;
  const ratio = input.durationSec / input.targetSec;
  return ratio >= 0.85 && ratio <= 1.15;
}

export function autopilotVisibility(grant: AutonomyGrants["publish"], profileAuto: AutonomyGrants["publish"], sensitive: boolean): AutonomyGrants["publish"] {
  const order = ["never", "private", "unlisted", "public"] as const;
  const limited = order[Math.min(order.indexOf(grant), order.indexOf(profileAuto))]!;
  return sensitive && limited === "public" ? "private" : limited;
}

export function fairShareTurn(profileIds: string[], cursor: number): { profileId: string; next: number } {
  if (profileIds.length === 0) return { profileId: "", next: 0 };
  const index = ((cursor % profileIds.length) + profileIds.length) % profileIds.length;
  return { profileId: profileIds[index]!, next: index + 1 };
}

export function quietHoursHold(now: Date, timeZone: string, start = "23:00", end = "07:00"): boolean {
  const local = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const [h, m] = local.split(":").map(Number);
  const minute = h! * 60 + m!;
  const from = sh! * 60 + sm!;
  const to = eh! * 60 + em!;
  return from > to ? minute >= from || minute < to : minute >= from && minute < to;
}
