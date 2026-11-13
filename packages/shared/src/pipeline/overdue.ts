import { z } from "zod";

/**
 * TASK-125. A stage that passes its limit is not killed by the clock. Code collects facts, the in-app
 * checker may only `wait` or `escalate`, and Hermes (or the user) decides to stop. Every number here is
 * a code constant, not a setting an agent can change.
 */

export const OVERDUE_MIN_SPACING_MS = 2 * 60_000;
/** Spacing between checks: 2, 5, 10, 20, then every 30 min. There is no cap on the count. */
export const OVERDUE_CHECK_SPACING_MS = [2, 5, 10, 20, 30].map((minutes) => minutes * 60_000) as readonly number[];
export const OVERDUE_NOSIGNAL_ESCALATE_MS = 10 * 60_000;
export const OVERDUE_NOTICE_AFTER_MS = 30 * 60_000;
export const OVERDUE_NOTICE_REPEAT_MS = 2 * 60 * 60_000;
export const OVERDUE_ACTIVITY_WINDOW_MS = 2 * 60_000;
export const OVERDUE_LOG_LINES = 30;

export const OnOverdueSchema = z.enum(["check", "abort", "notify_only"]);
export type OnOverdue = z.infer<typeof OnOverdueSchema>;
export const ON_OVERDUE_LABELS_VI: Record<OnOverdue, string> = {
  check: "Kiểm tra rồi quyết định (khuyên dùng)",
  abort: "Dừng như cũ (hết giờ là dừng)",
  notify_only: "Chỉ báo cho tôi",
};

export const OverdueStateSchema = z.enum(["checking", "waiting_decision"]);
export type OverdueState = z.infer<typeof OverdueStateSchema>;

/** What the in-app checker may pick. It has no abort action. */
export const OverdueCheckActionSchema = z.enum(["wait", "escalate"]);
export type OverdueCheckAction = z.infer<typeof OverdueCheckActionSchema>;

export const OverdueCheckChoiceSchema = z.object({
  action: OverdueCheckActionSchema,
  extendMs: z.number().int().positive().optional(),
  reason: z.string().min(1).max(400),
}).strict();
export type OverdueCheckChoice = z.infer<typeof OverdueCheckChoiceSchema>;

/** What Hermes or the user may pick through `decide_overdue`. */
export const OverdueDecisionActionSchema = z.enum(["wait", "abort_retry", "abort_fail", "ask_user"]);
export type OverdueDecisionAction = z.infer<typeof OverdueDecisionActionSchema>;
export const OVERDUE_ABORT_ACTIONS: readonly OverdueDecisionAction[] = ["abort_retry", "abort_fail"];

export const OverdueSourceSchema = z.enum(["ladder", "llm", "override", "hermes", "user"]);
export type OverdueSource = z.infer<typeof OverdueSourceSchema>;

export const OverdueFactsSchema = z.object({
  stage: z.string(),
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  elapsedMs: z.number(),
  expectedMs: z.number(),
  limitMs: z.number(),
  /** elapsed / expected, e.g. 2.4 means "2.4× mức trung bình". */
  overRatio: z.number(),
  progress: z.number(),
  progressAtLimit: z.number().nullable(),
  /** Time since the last progress report, null when the stage never reported. */
  sinceProgressMs: z.number().nullable(),
  trend: z.enum(["up", "flat", "none"]),
  bytesWrittenLast2Min: z.number().nullable(),
  childAlive: z.boolean().nullable(),
  childNote: z.string().nullable(),
  llmInFlight: z.boolean().nullable(),
  quotaWait: z.boolean().nullable(),
  /** How long no work signal was seen at all. 0 when a signal is moving now. */
  noSignalMs: z.number(),
  logTail: z.array(z.string()),
  historyNote: z.string().nullable(),
  remote: z.boolean(),
}).strict();
export type OverdueFacts = z.infer<typeof OverdueFactsSchema>;

/** True when anything says the stage is still working. */
export function workSignalsMoving(facts: OverdueFacts): boolean {
  if (facts.trend === "up") return true;
  if (facts.sinceProgressMs !== null && facts.sinceProgressMs < OVERDUE_ACTIVITY_WINDOW_MS && facts.progress < 100) return true;
  if ((facts.bytesWrittenLast2Min ?? 0) > 0) return true;
  if (facts.childAlive === true) return true;
  if (facts.llmInFlight === true || facts.quotaWait === true) return true;
  return false;
}

export function overdueCheckSpacingMs(checkNo: number): number {
  const index = Math.min(Math.max(0, checkNo - 1), OVERDUE_CHECK_SPACING_MS.length - 1);
  return OVERDUE_CHECK_SPACING_MS[index]!;
}

/** The `extendMs` the in-app checker may ask for: [2 min, 50 % of the limit]. */
export function clampCheckerExtendMs(limitMs: number, wanted?: number | null): number {
  const high = Math.max(OVERDUE_MIN_SPACING_MS, Math.round(limitMs * 0.5));
  const value = wanted && Number.isFinite(wanted) ? wanted : high;
  return Math.round(Math.min(high, Math.max(OVERDUE_MIN_SPACING_MS, value)));
}

/** The `extendMs` Hermes or the user may ask for: [5 min, 2 × limit]. */
export function clampDecisionExtendMs(limitMs: number, wanted?: number | null): number {
  const high = Math.max(5 * 60_000, Math.round(limitMs * 2));
  const value = wanted && Number.isFinite(wanted) ? wanted : Math.round(limitMs * 0.5);
  return Math.round(Math.min(high, Math.max(5 * 60_000, value)));
}

/** Default ladder, no LLM: work moving → wait, anything else → escalate. */
export function overdueLadder(facts: OverdueFacts): OverdueCheckChoice {
  if (workSignalsMoving(facts)) {
    return { action: "wait", extendMs: clampCheckerExtendMs(facts.limitMs), reason: "Bước vẫn đang có dấu hiệu làm việc, chờ thêm." };
  }
  return { action: "escalate", reason: "Không thấy dấu hiệu làm việc, cần người hoặc Hermes xem." };
}

/** Code re-checks a model choice. Returns the choice to use and why it changed, if it did. */
export function overdueOverride(
  choice: OverdueCheckChoice,
  facts: OverdueFacts,
): { choice: OverdueCheckChoice; overridden: string | null } {
  if (choice.action === "wait" && !workSignalsMoving(facts) && facts.noSignalMs >= OVERDUE_NOSIGNAL_ESCALATE_MS) {
    return {
      choice: { action: "escalate", reason: "Không có dấu hiệu làm việc từ 10 phút nay, chuyển cho Hermes." },
      overridden: "wait_without_signals",
    };
  }
  if (choice.action === "wait") {
    return { choice: { ...choice, extendMs: clampCheckerExtendMs(facts.limitMs, choice.extendMs) }, overridden: null };
  }
  return { choice: { action: "escalate", reason: choice.reason }, overridden: null };
}

export const OverdueCheckRowSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  attempt: z.number().int(),
  projectId: z.string(),
  stage: z.string(),
  checkNo: z.number().int(),
  at: z.string(),
  facts: OverdueFactsSchema.nullable(),
  action: z.string(),
  extendMs: z.number().nullable(),
  source: OverdueSourceSchema,
  actor: z.string().nullable(),
  reason: z.string(),
  costUsd: z.number(),
}).strict();
export type OverdueCheckRow = z.infer<typeof OverdueCheckRowSchema>;

export const DecideOverdueArgsSchema = z.object({
  jobId: z.string().min(1),
  action: OverdueDecisionActionSchema,
  reason: z.string().min(8).max(600),
  extendMs: z.number().int().positive().optional(),
}).strict();
export type DecideOverdueArgs = z.infer<typeof DecideOverdueArgsSchema>;

/** The shape of an overdue job the API and tools return. */
export const OverdueJobSchema = z.object({
  jobId: z.string(),
  projectId: z.string(),
  projectTitle: z.string(),
  stage: z.string(),
  attempt: z.number().int(),
  state: OverdueStateSchema,
  elapsedMs: z.number(),
  expectedMs: z.number().nullable(),
  limitMs: z.number().nullable(),
  overdueAt: z.string(),
  nextCheckAt: z.string().nullable(),
  lastAction: z.string().nullable(),
  lastReason: z.string().nullable(),
  queuedBehind: z.number().int(),
}).strict();
export type OverdueJob = z.infer<typeof OverdueJobSchema>;

export const OVERDUE_LABEL_VI = "Quá thời gian dự kiến — đang kiểm tra";
