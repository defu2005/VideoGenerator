import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { redactOperatorText } from "@vg/shared";
import type { ToolSource } from "./policy.js";

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
  },
): void {
  sqlite.prepare(
    `INSERT INTO operator_tool_audit
      (id, source, tool, args, risk, decision, summary, pending_action_id, run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.source,
    input.tool,
    redactOperatorText(JSON.stringify(input.args ?? {})),
    input.risk,
    input.decision,
    redactOperatorText(input.summary).slice(0, 500),
    input.pendingActionId ?? null,
    input.runId ?? null,
    input.at ?? new Date().toISOString(),
  );
}
