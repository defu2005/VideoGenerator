import type { AssistantPendingAction } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { AssistantToolContext } from "../assistant/tools.js";
import { ALWAYS_CONFIRM_TOOLS, ASSISTANT_TOOLS, summarizeTool } from "../assistant/tools.js";
import { logToolAudit } from "./audit.js";
import { withOperatorCheckpoint } from "../operator/checkpoints.js";
import type { EventScope } from "../operator/events.js";
import { getAutomationPaused } from "../services/automationSettings.js";
import { agentMayChange } from "../operator/autopilot.js";
import { effectiveAutonomy } from "../operator/autonomy.js";
import { claimOperatorAction, recordOperatorActionFailure } from "../operator/loopGuard.js";
import { TOOL_GRANTS } from "@vg/shared";
import type { AuthActor } from "../auth/actor.js";
import { can, FORBIDDEN_MESSAGE } from "../auth/policy.js";
import { TOOL_ACTIONS, toolResource } from "../auth/toolActions.js";
import { autonomyDecision, effectiveRisk, hardBlockMessage, shouldCreatePending, type ToolSource } from "./policy.js";
import { acquireLease, holderRank, readIdempotent, resourceOf, userBreakLease, writeIdempotent, takeLeaseLoss } from "../supervision/leases.js";
import { isOnDuty } from "../supervision/duty.js";

export type ToolOrigin = "user" | "schedule" | "wake" | "supervisor";

const EVENT_READ_TOOLS = new Set(["get_project", "get_pipeline"]);

export type RegistryInvokeResult =
  | { kind: "result"; result: unknown; summary: string; risk: string }
  | { kind: "pending"; pendingActionId: string; summaryVi: string; risk: string }
  | { kind: "refused"; message: string; risk: string };

export async function invokeRegistryTool(input: {
  name: string;
  args: unknown;
  source: ToolSource;
  ctx: AssistantToolContext;
  /** Who the call is for: the chatting user, the API key's user, or the workspace system actor. */
  actor: AuthActor;
  autoConfirm?: boolean;
  runId?: string | null;
  origin?: ToolOrigin;
  workflowId?: string;
  eventScope?: EventScope;
  createPending: (pending: { tool: string; args: unknown; summary: string; actor: AuthActor }) => Pick<AssistantPendingAction, "id" | "summary">;
}): Promise<RegistryInvokeResult> {
  const blocked = hardBlockMessage(input.name, input.args);
  const tool = ASSISTANT_TOOLS[input.name];
  const risk = effectiveRisk(tool?.risk);
  const grant = TOOL_GRANTS[input.name];
  const auditBase = {
    source: input.source,
    tool: input.name,
    risk,
    runId: input.runId,
    origin: input.origin ?? null,
    grant: typeof grant === "string" ? grant : null,
    agentKind: input.ctx.agent?.kind ?? null,
    agentName: input.ctx.agent?.name ?? null,
    agentModel: input.ctx.agent?.model ?? null,
    agentEnvironment: input.ctx.agent?.environment ?? null,
    actor: input.actor,
  };
  if (blocked) {
    logToolAudit(input.ctx.sqlite, {
      ...auditBase,
      args: input.args,
      decision: "refused",
      summary: blocked,
    });
    return { kind: "refused", message: blocked, risk };
  }
  if (!tool) {
    throw new AppError(400, "UNKNOWN_TOOL", `Công cụ không tồn tại: ${input.name}`);
  }
  const rawArgs = input.args && typeof input.args === "object" && !Array.isArray(input.args)
    ? { ...(input.args as Record<string, unknown>) }
    : input.args;
  let idempotencyKey: string | undefined;
  if (rawArgs && typeof rawArgs === "object" && "idempotencyKey" in rawArgs) {
    if (typeof (rawArgs as Record<string, unknown>).idempotencyKey === "string") {
      idempotencyKey = (rawArgs as Record<string, unknown>).idempotencyKey as string;
    }
    delete (rawArgs as Record<string, unknown>).idempotencyKey;
  }
  let parsed: unknown;
  try {
    parsed = tool.argsSchema.parse(rawArgs ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tham số không hợp lệ";
    throw new AppError(400, "INVALID_TOOL_ARGS", message);
  }
  const callerInstance = input.ctx.agent?.instance ?? (input.source === "operator" ? "operator/app" : (input.actor.kind === "user" ? "user" : "unknown"));
  if (idempotencyKey && risk !== "read") {
    const stored = readIdempotent(input.ctx.sqlite, callerInstance, idempotencyKey);
    if (stored) {
      return { kind: "result", result: stored.result, summary: summarizeTool(input.name, parsed), risk };
    }
  }
  if (input.runId) {
    const loss = takeLeaseLoss(input.ctx.sqlite, input.runId);
    if (loss) {
      const message = `Hermes đã tiếp quản ${loss.resource} (${loss.by}).`;
      logToolAudit(input.ctx.sqlite, { ...auditBase, args: parsed, decision: "refused", summary: message });
      return { kind: "refused", message, risk };
    }
  }
  if (risk !== "read") {
    const ref = resourceOf(input.name, parsed);
    if (ref) {
      if (input.source === "assistant" || input.origin === "user" || input.actor.kind === "user") {
        userBreakLease(input.ctx.sqlite, ref);
      } else {
        const agentKind = input.ctx.agent?.kind ?? (input.source === "operator" ? "operator" : "other");
        const onDuty = input.ctx.agent?.canSupervise ? isOnDuty(input.ctx.sqlite, callerInstance) : false;
        const rank = holderRank(agentKind, onDuty);
        const acquired = acquireLease(input.ctx.sqlite, ref, {
          kind: agentKind,
          instance: callerInstance,
          rank,
          runId: input.runId ?? input.ctx.runId ?? null,
        });
        if (!acquired.ok) {
          const leasedResult = {
            code: "LEASED",
            holder: acquired.holder.instance,
            reason: `Tài nguyên ${ref.kind}:${ref.id} đang bị giữ bởi ${acquired.holder.instance}.`,
            expiresAt: acquired.holder.expiresAt,
          };
          return {
            kind: "result",
            result: leasedResult,
            summary: `Tài nguyên đang bị khóa bởi ${acquired.holder.instance}`,
            risk,
          };
        }
      }
    }
  }
  const needed = TOOL_ACTIONS[input.name];
  const decision = needed
    ? can(input.actor, needed, toolResource(input.ctx.sqlite, parsed))
    : { ok: false as const, status: 403 as const, reason: FORBIDDEN_MESSAGE };
  if (!decision.ok) {
    const message = decision.status === 404 ? "Không tìm thấy." : FORBIDDEN_MESSAGE;
    logToolAudit(input.ctx.sqlite, { ...auditBase, args: parsed, decision: "refused", summary: message });
    return { kind: "refused", message, risk };
  }
  if (input.eventScope && (getAutomationPaused(input.ctx.sqlite) || !EVENT_READ_TOOLS.has(input.name) || risk !== "read"
      || (parsed as { projectId?: string } | null)?.projectId !== input.eventScope.projectId
      || !input.ctx.sqlite.prepare(
        `SELECT 1 FROM projects JOIN profiles ON profiles.id = projects.profile_id
         WHERE projects.id = ? AND profiles.id = ? AND projects.archived_at IS NULL AND profiles.archived_at IS NULL`,
      ).get(input.eventScope.projectId, input.eventScope.profileId))) {
    throw new AppError(403, "OPERATOR_EVENT_SCOPE", "Lượt theo sự kiện chỉ được đọc trạng thái của dự án liên quan.");
  }
  const summary = summarizeTool(input.name, parsed);
  const reason = typeof (parsed as { reason?: unknown }).reason === "string" ? (parsed as { reason: string }).reason.trim() : "";
  const unattended = input.origin === "schedule" || input.origin === "wake" || input.origin === "supervisor";
  if (unattended && risk === "confirm" && !reason) {
    const message = "Lượt không có người dùng phải ghi lý do trước khi gọi thao tác cần xác nhận.";
    logToolAudit(input.ctx.sqlite, { ...auditBase, args: parsed, decision: "refused", summary: message });
    return { kind: "refused", message, risk };
  }
  const settingKey = objectKeyForTool(input.name, parsed);
  const profileUpdate = parsed as { profileId?: string; market?: string | null };
  const marketKey = input.name === "update_profile_direction" && profileUpdate.market !== undefined
    ? `profile:${profileUpdate.profileId}:market` : null;
  const locked = [settingKey, marketKey].some((key) => key !== null && !agentMayChange(input.ctx.sqlite, key));
  const autonomy = risk === "confirm" && input.source !== "agent" && !getAutomationPaused(input.ctx.sqlite)
    ? effectiveAutonomy(input.ctx.sqlite, parsed) : undefined;
  const needsPending = locked || shouldCreatePending({
    name: input.name,
    args: parsed,
    risk: tool.risk,
    source: input.source,
    autoConfirm: input.autoConfirm === true,
    alwaysConfirm: ALWAYS_CONFIRM_TOOLS.has(input.name),
    autonomy,
  });
  const pendingSummary = locked ? "Bạn vừa sửa mục này, agent chờ 24 giờ." : summary;
  async function execute(): Promise<Exclude<RegistryInvokeResult, { kind: "refused" }>> {
    if (needsPending) {
      const pending = input.createPending({ tool: input.name, args: parsed, summary: pendingSummary, actor: input.actor });
      logToolAudit(input.ctx.sqlite, {
        ...auditBase, args: parsed, decision: "pending", summary, pendingActionId: pending.id, reason: reason || null,
      });
      return { kind: "pending", pendingActionId: pending.id, summaryVi: pending.summary, risk };
    }
    const autonomyRun = !needsPending && Boolean(autonomy && autonomyDecision(input.name, parsed, autonomy) === "run");
    const gated = autonomyRun || input.source === "agent";
    const result = await tool!.execute(parsed, { ...input.ctx, runId: input.runId ?? input.ctx.runId, autonomyRun, gated });
    if (idempotencyKey) {
      writeIdempotent(input.ctx.sqlite, callerInstance, idempotencyKey, input.name, result);
    }
    logToolAudit(input.ctx.sqlite, {
      ...auditBase, args: parsed, decision: "executed", summary, reason: reason || null,
      autonomyLevel: risk === "confirm" ? effectiveAutonomy(input.ctx.sqlite, parsed).level : null,
    });
    return { kind: "result", result, summary, risk };
  }
  const run = () => input.source === "operator" && input.workflowId && (risk !== "read" || needsPending)
    ? withOperatorCheckpoint(input.ctx.sqlite, input.workflowId, input.name, parsed, execute) : execute();
  if (input.source !== "operator" || !input.runId) return run();
  const claim = claimOperatorAction(input.ctx.sqlite, input.runId, input.name, parsed);
  if ("message" in claim) {
    logToolAudit(input.ctx.sqlite, { ...auditBase, args: parsed, decision: "refused", summary: claim.message });
    return { kind: "refused", message: claim.message, risk };
  }
  try {
    return await run();
  } catch (error) {
    recordOperatorActionFailure(input.ctx.sqlite, claim.attemptId);
    throw error;
  }
}

function objectKeyForTool(name: string, args: unknown): string | null {
  const parsed = args as { profileId?: string; projectId?: string; direction?: string } | null;
  if (name === "set_profile_automation" && parsed?.profileId) return `profile:${parsed.profileId}:automation`;
  if (name === "update_profile_direction" && parsed?.profileId && parsed.direction !== undefined) return `profile:${parsed.profileId}:guidelines`;
  if (name === "update_llm_settings") return "llm:routing";
  if (name === "update_stage_timeouts" && parsed?.projectId) return `project:${parsed.projectId}:timeouts`;
  return null;
}
