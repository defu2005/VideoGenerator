import { z } from "zod";
import type { AssistantToolContext, AssistantToolDef } from "../assistant/tools.js";
import { listAgentEvents } from "../events/agentBus.js";
import { operatorToolHooks, type OperatorSupervisorHooks } from "../operator/hooks.js";
import { undoAudit } from "../operator/undo.js";
import { AppError } from "../lib/errors.js";
import { currentDuty, dutyHeartbeat, isOnDuty } from "./duty.js";
import {
  claimEscalation, forwardEscalationToUser, listEscalations, resolveEscalation,
} from "./escalations.js";
import type { TrustedAgent } from "./identity.js";
import { clearPauseBy, MAX_HERMES_PAUSE_MIN, pauseByHermes } from "./pause.js";
import { buildSupervisionSnapshot } from "./snapshot.js";

/** The caller's trusted identity, filled in by the registry from the machine key. */
export function agentOf(ctx: AssistantToolContext): TrustedAgent {
  const agent = ctx.agent;
  const kind = agent?.kind ?? "other";
  const name = agent?.name ?? "unknown";
  return {
    kind: kind as TrustedAgent["kind"], name, model: agent?.model ?? null, environment: agent?.environment ?? "unknown",
    instance: agent?.instance ?? `${kind}/${name}`, canSupervise: agent?.canSupervise === true, trusted: true,
  };
}

export type NotOnDuty = { ok: false; code: "NOT_ON_DUTY"; message: string; holder: string | null };

function guard(ctx: AssistantToolContext): { agent: TrustedAgent } | { refused: NotOnDuty } {
  const agent = agentOf(ctx);
  if (agent.canSupervise && isOnDuty(ctx.sqlite, agent.instance)) return { agent };
  return {
    refused: {
      ok: false, code: "NOT_ON_DUTY", holder: currentDuty(ctx.sqlite)?.instance ?? null,
      message: "Chỉ Hermes đang trực mới dùng được công cụ giám sát. Gọi hermes_duty_heartbeat trước.",
    },
  };
}

function operatorHooks(): OperatorSupervisorHooks {
  const hooks = operatorToolHooks()?.supervisor;
  if (!hooks) throw new AppError(503, "OPERATOR_OFF", "Operator chưa sẵn sàng.");
  return hooks;
}

const NOTIFY_WINDOW_MS = 60 * 60_000;
const NOTIFY_MAX_PER_WINDOW = 6;
const notifyTimes: number[] = [];
export function resetNotifyRateLimit(): void { notifyTimes.length = 0; }

const empty = z.object({}).strict();
const id = z.string().min(1).max(80);

const heartbeatArgs = z.object({ instance: z.string().trim().min(1).max(60), version: z.string().trim().max(40).optional() }).strict();
const listArgs = z.object({ limit: z.number().int().min(1).max(50).default(15) }).strict();
const runArgs = z.object({ runId: id }).strict();
const pauseArgs = z.object({
  reason: z.string().trim().min(1).max(300),
  untilMinutes: z.number().int().min(1).max(MAX_HERMES_PAUSE_MIN).default(60),
}).strict();
const enqueueArgs = z.object({
  instruction: z.string().trim().min(1).max(2000),
  profileId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
}).strict();
const orderArgs = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(2000),
  cron: z.string().trim().max(60).nullable().optional(),
}).strict();
const orderIdArgs = z.object({ id: id }).strict();
const overrideArgs = z.object({ auditId: id, reason: z.string().trim().min(1).max(300) }).strict();
const escListArgs = z.object({
  status: z.enum(["open", "claimed", "resolved", "forwarded"]).optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
const escIdArgs = z.object({ id: id }).strict();
const escResolveArgs = z.object({
  id: id,
  outcome: z.enum(["fixed", "no_action", "cannot_fix"]),
  note: z.string().trim().min(1).max(500),
}).strict();
const escForwardArgs = z.object({ id: id, note: z.string().trim().min(1).max(500) }).strict();
const pollArgs = z.object({
  sinceId: z.string().max(80).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  kinds: z.array(z.string().max(60)).max(20).optional(),
}).strict();
const notifyArgs = z.object({
  text: z.string().trim().min(1).max(1500),
  severity: z.enum(["info", "warn", "urgent"]).default("info"),
}).strict();

function supervised<A extends z.ZodTypeAny>(
  def: { name: string; description: string; risk: "read" | "safe"; argsSchema: A; summarize: (args: z.infer<A>) => string },
  run: (args: z.infer<A>, ctx: AssistantToolContext, agent: TrustedAgent) => unknown | Promise<unknown>,
): AssistantToolDef {
  return {
    name: def.name,
    description: def.description,
    risk: def.risk,
    argsSchema: def.argsSchema,
    summarize: (args) => def.summarize(args as z.infer<A>),
    execute: async (args, ctx) => {
      const checked = guard(ctx);
      if ("refused" in checked) return checked.refused;
      return run(def.argsSchema.parse(args) as z.infer<A>, ctx, checked.agent);
    },
  };
}

/** TASK-122: the tools a supervising agent (Hermes) uses. All but the heartbeat need the caller to be on duty. */
export const supervisionToolDefs: AssistantToolDef[] = [
  {
    name: "hermes_duty_heartbeat",
    description: "Hermes báo còn sống và xin trực. Trả về onDuty, holder, expiresAt. Gọi mỗi vài phút; 3 phút không gọi là mất trực.",
    risk: "safe",
    argsSchema: heartbeatArgs,
    summarize: () => "Báo trực Hermes",
    execute: async (args, ctx) => {
      const { version } = heartbeatArgs.parse(args);
      return dutyHeartbeat(ctx.sqlite, agentOf(ctx), version ?? null);
    },
  },
  supervised({
    name: "supervision_snapshot", description: "Ảnh chụp trạng thái cho giám sát (dưới 3 KB, do code dựng) kèm danh sách bất thường.",
    risk: "read", argsSchema: empty, summarize: () => "Ảnh chụp giám sát",
  }, (_args, ctx) => buildSupervisionSnapshot(ctx.sqlite)),
  supervised({
    name: "operator_runs_list", description: "Các lượt chạy gần đây của operator.", risk: "read", argsSchema: listArgs,
    summarize: () => "Xem lượt operator",
  }, (args) => ({ runs: operatorHooks().listRuns(args.limit) })),
  supervised({
    name: "operator_run_get", description: "Chi tiết một lượt chạy của operator.", risk: "read", argsSchema: runArgs,
    summarize: () => "Xem một lượt operator",
  }, (args) => {
    const run = operatorHooks().getRun(args.runId);
    if (!run) throw new AppError(404, "RUN", "Không thấy lượt chạy.");
    return { run };
  }),
  supervised({
    name: "operator_pause", description: "Tạm dừng operator tối đa 360 phút. Người dùng dừng thì Hermes không ghi đè.",
    risk: "safe", argsSchema: pauseArgs, summarize: (args) => `Tạm dừng operator ${args.untilMinutes} phút`,
  }, (args, ctx, agent) => pauseByHermes(ctx.sqlite, agent.instance, args.untilMinutes, args.reason)),
  supervised({
    name: "operator_resume", description: "Bỏ lệnh tạm dừng do Hermes đặt. Lệnh dừng của người dùng thì không bỏ được.",
    risk: "safe", argsSchema: empty, summarize: () => "Cho operator chạy lại",
  }, (_args, ctx) => clearPauseBy(ctx.sqlite, "hermes")),
  supervised({
    name: "operator_stop_run", description: "Dừng một lượt operator đang chạy hoặc đang chờ.", risk: "safe", argsSchema: runArgs,
    summarize: () => "Dừng một lượt operator",
  }, (args) => operatorHooks().stopRun(args.runId)),
  supervised({
    name: "operator_new_session", description: "Mở phiên operator mới (ghi chú trong notes/ vẫn giữ).", risk: "safe", argsSchema: empty,
    summarize: () => "Mở phiên operator mới",
  }, () => { operatorHooks().newSession(); return { ok: true }; }),
  supervised({
    name: "operator_enqueue", description: "Giao việc cho operator (gắn nhãn Hermes). Bị từ chối khi operator đang tạm dừng.",
    risk: "safe", argsSchema: enqueueArgs, summarize: () => "Giao việc cho operator",
  }, (args, _ctx, agent) => operatorHooks().enqueue({ ...args, assignedBy: `hermes/${agent.name}` })),
  supervised({
    name: "operator_orders_list", description: "Các lệnh thường trực của operator.", risk: "read", argsSchema: empty,
    summarize: () => "Xem lệnh thường trực",
  }, () => ({ orders: operatorHooks().listOrders() })),
  supervised({
    name: "operator_order_upsert", description: "Tạo hoặc sửa một lệnh thường trực của operator.", risk: "safe", argsSchema: orderArgs,
    summarize: (args) => `Lưu lệnh thường trực: ${args.title}`,
  }, (args) => operatorHooks().upsertOrder({ ...args, enabled: true })),
  supervised({
    name: "operator_order_disable", description: "Tắt một lệnh thường trực.", risk: "safe", argsSchema: orderIdArgs,
    summarize: () => "Tắt lệnh thường trực",
  }, (args) => { operatorHooks().disableOrder(args.id); return { ok: true }; }),
  supervised({
    name: "operator_override", description: "Hoàn tác một thao tác của operator trong nhật ký, kèm lý do.", risk: "safe",
    argsSchema: overrideArgs, summarize: () => "Hoàn tác thao tác operator",
  }, (args, ctx) => undoAudit(ctx.sqlite, args.auditId)),
  supervised({
    name: "escalation_list", description: "Việc được chuyển cho Hermes.", risk: "read", argsSchema: escListArgs,
    summarize: () => "Xem việc chuyển giao",
  }, (args, ctx) => ({
    items: listEscalations(ctx.sqlite, { toKind: "hermes", statuses: args.status ? [args.status] : ["open", "claimed"], limit: args.limit }),
  })),
  supervised({
    name: "escalation_claim", description: "Nhận xử lý một việc được chuyển.", risk: "safe", argsSchema: escIdArgs,
    summarize: () => "Nhận việc chuyển giao",
  }, (args, ctx, agent) => claimEscalation(ctx.sqlite, args.id, agent.instance)),
  supervised({
    name: "escalation_resolve", description: "Đóng một việc đã xử lý kèm kết quả và ghi chú.", risk: "safe", argsSchema: escResolveArgs,
    summarize: () => "Đóng việc chuyển giao",
  }, (args, ctx, agent) => resolveEscalation(ctx.sqlite, args.id, agent.instance, args.outcome, args.note)),
  supervised({
    name: "escalation_forward_to_user", description: "Chuyển việc cho người dùng khi Hermes không tự quyết được.", risk: "safe",
    argsSchema: escForwardArgs, summarize: () => "Chuyển việc cho người dùng",
  }, (args, ctx, agent) => forwardEscalationToUser(ctx.sqlite, args.id, agent.instance, args.note)),
  supervised({
    name: "agent_events_poll", description: "Lấy sự kiện mới sau sinceId, theo thứ tự cũ đến mới.", risk: "read", argsSchema: pollArgs,
    summarize: () => "Lấy sự kiện mới",
  }, (args) => {
    const all = listAgentEvents({ since: args.sinceId, types: args.kinds, limit: 500 });
    const events = all.slice(0, args.limit);
    return { events, lastId: events.at(-1)?.id ?? args.sinceId ?? null, more: all.length > events.length };
  }),
  supervised({
    name: "notify_user", description: "Gửi một tin Telegram cho người dùng qua bot của app (gắn nhãn Hermes, tối đa 6 tin mỗi giờ).",
    risk: "safe", argsSchema: notifyArgs, summarize: () => "Báo người dùng qua Telegram",
  }, async (args) => {
    const now = Date.now();
    while (notifyTimes.length && now - notifyTimes[0]! > NOTIFY_WINDOW_MS) notifyTimes.shift();
    if (notifyTimes.length >= NOTIFY_MAX_PER_WINDOW) {
      return { ok: false, code: "RATE_LIMITED", message: "Đã gửi 6 tin trong giờ qua, hãy gộp lại." };
    }
    const icon = args.severity === "urgent" ? "🚨" : args.severity === "warn" ? "⚠️" : "ℹ️";
    const sent = await operatorHooks().sendTelegram(`🤖 Hermes ${icon} ${args.text}`);
    if (sent) notifyTimes.push(now);
    return { ok: sent, ...(sent ? {} : { code: "TELEGRAM_OFF", message: "Telegram chưa bật." }) };
  }),
];
