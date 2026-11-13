import { createHash } from "node:crypto";
import { redactExportText } from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import type { RegistryInvokeResult } from "../registry/invoke.js";

type Receipt = Extract<RegistryInvokeResult, { kind: "result" | "pending" }>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function operatorActionKey(tool: string, args: unknown): string {
  return createHash("sha256").update(canonical([tool, args])).digest("hex");
}

function unknownOutcome(): AppError {
  return new AppError(409, "OPERATOR_OUTCOME_UNKNOWN", "Có thao tác chưa rõ kết quả. Kiểm tra trạng thái trước khi giao yêu cầu mới.");
}

function resolveReceipt(db: Database.Database, receipt: Receipt): Receipt {
  if (receipt.kind !== "pending") return receipt;
  const pending = db.prepare("SELECT status, result, expires_at FROM assistant_pending_actions WHERE id = ?")
    .get(receipt.pendingActionId) as { status: string; result: string | null; expires_at: string } | undefined;
  if (!pending || (pending.status === "confirmed" && pending.result === null)) throw unknownOutcome();
  const status = pending.status === "pending" && pending.expires_at <= new Date().toISOString() ? "expired" : pending.status;
  if (status === "pending") return receipt;
  return { kind: "result", risk: receipt.risk, summary: receipt.summaryVi,
    result: { pendingActionId: receipt.pendingActionId, status, detail: redactExportText(pending.result ?? "").slice(0, 500) } };
}

export function checkpointObservations(db: Database.Database, workflowId: string): string[] {
  const rows = db.prepare(
    "SELECT tool, receipt FROM operator_checkpoints WHERE workflow_id = ? ORDER BY rowid",
  ).all(workflowId) as Array<{ tool: string; receipt: string | null }>;
  return rows.map(({ tool, receipt }) => {
    if (!receipt) throw unknownOutcome();
    const resolved = resolveReceipt(db, JSON.parse(receipt) as Receipt);
    if (resolved.kind === "pending") {
      throw new AppError(409, "OPERATOR_WAITING_APPROVAL", "Hãy xử lý thao tác chờ duyệt trước khi tiếp tục.");
    }
    return JSON.stringify({ tool, checkpoint: resolved });
  }).slice(-12);
}

export async function withOperatorCheckpoint(
  db: Database.Database, workflowId: string, tool: string, args: unknown, execute: () => Promise<Receipt>,
): Promise<Receipt> {
  const key = operatorActionKey(tool, args);
  const claimed = db.prepare(
    "INSERT OR IGNORE INTO operator_checkpoints (workflow_id, action_key, tool, created_at) VALUES (?, ?, ?, ?)",
  ).run(workflowId, key, tool, new Date().toISOString()).changes;
  if (!claimed) {
    const row = db.prepare("SELECT receipt FROM operator_checkpoints WHERE workflow_id = ? AND action_key = ?")
      .get(workflowId, key) as { receipt: string | null };
    if (!row.receipt) throw unknownOutcome();
    return resolveReceipt(db, JSON.parse(row.receipt) as Receipt);
  }
  const receipt = await execute();
  const safe: Receipt = receipt.kind === "result"
    ? { ...receipt, summary: redactExportText(receipt.summary), result: redactExportText(JSON.stringify(receipt.result) ?? "").slice(0, 900) }
    : { ...receipt, summaryVi: redactExportText(receipt.summaryVi) };
  db.prepare("UPDATE operator_checkpoints SET receipt = ? WHERE workflow_id = ? AND action_key = ?")
    .run(JSON.stringify(safe), workflowId, key);
  return receipt;
}
