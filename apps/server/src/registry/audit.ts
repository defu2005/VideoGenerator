import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { redactOperatorText } from "@vg/shared";
import { noteAgentSeen } from "../reports/skillReportService.js";
import type { ToolSource } from "./policy.js";
import type { AuthActor } from "../auth/actor.js";
import { writeAudit } from "../auth/auditLog.js";

const SECRET_KEY = /^(api[_-]?key|.*token|password|secret|.*secret|credentials|paymentMethod|cardNumber|authorization)$/i;

/** Masks values under secret-looking keys so audit rows never hold credentials. */
export function maskSecretArgs(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => maskSecretArgs(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    SECRET_KEY.test(key) && child !== null && child !== undefined && child !== "" ? "[đã ẩn]" : maskSecretArgs(child, depth + 1),
  ]));
}

export function logToolAudit(
  sqlite: Database.Database,
  input: {
    source: ToolSource;
    tool: string;
    args: unknown;
    risk: string;
    decision: "executed" | "pending" | "refused";
    summary: string;
    pendingActionId?: string | null;
    runId?: string | null;
    at?: string;
    autonomyLevel?: string | null;
    grant?: string | null;
    origin?: string | null;
    reason?: string | null;
    undo?: unknown;
    agentKind?: string | null;
    agentName?: string | null;
    agentModel?: string | null;
    agentEnvironment?: string | null;
    actor?: AuthActor | null;
  },
): void {
  sqlite.prepare(
    `INSERT INTO operator_tool_audit
      (id, source, tool, args, risk, decision, summary, pending_action_id, run_id, created_at,
       agent_kind, agent_name, agent_model, agent_environment,
       autonomy_level, grant, origin, reason, undo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.source,
    input.tool,
    redactOperatorText(JSON.stringify(maskSecretArgs(input.args ?? {}))),
    input.risk,
    input.decision,
    redactOperatorText(input.summary).slice(0, 500),
    input.pendingActionId ?? null,
    input.runId ?? null,
    input.at ?? new Date().toISOString(),
    input.agentKind ?? null,
    input.agentName ?? null,
    input.agentModel ?? null,
    input.agentEnvironment ?? null,
    input.autonomyLevel ?? null,
    input.grant ?? null,
    input.origin ?? null,
    input.reason ?? null,
    input.undo == null ? null : JSON.stringify(input.undo),
  );
  writeAudit(sqlite, {
    workspaceId: input.actor?.workspaceId || null,
    actor: input.actor ?? null,
    action: `tool:${input.tool}`,
    targetType: "tool_audit",
    targetId: input.pendingActionId ?? null,
    outcome: input.decision === "refused" ? "denied" : "ok",
    source: input.source === "agent" ? "operator" : input.source,
    summary: `${input.decision}: ${input.summary}`,
    payload: input.args ?? {},
    at: input.at,
  });
  if (input.agentKind && input.agentName && input.agentEnvironment) {
    noteAgentSeen(sqlite, {
      kind: input.agentKind,
      name: input.agentName,
      model: input.agentModel ?? null,
      environment: input.agentEnvironment,
    });
  }
}
