import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { publishAgentEvent } from "../events/agentBus.js";
import { currentDuty } from "./duty.js";

export const PROTECTED_PROJECT_ID = "56374fb2-54cf-48ff-9441-2e6c653295d4";
export const MAX_HOPS = 3;
export const DEFAULT_HERMES_DEADLINE_MIN = 30;

/** Things an agent can fix. They go to Hermes while it is on duty. */
export const AGENT_SOLVABLE_KINDS = [
  "held_quality_gate", "repair_exhausted", "stuck_job", "provider_failing", "publish_failure", "unclear_instruction",
] as const;
/** Things only the user may decide. They never go to Hermes. */
export const USER_ONLY_KINDS = [
  "pending_confirm_action", "secrets", "money", "permissions", "delete", "protected_project", "user_requested",
] as const;

export type EscalationTo = "hermes" | "user";
export type EscalationStatus = "open" | "claimed" | "resolved" | "forwarded";

export type EscalationRoute = { to: EscalationTo; reason: string };

/**
 * The one routing function. User-only kinds, the protected project, anything the user asked to see, an unknown kind
 * and a loop (3 hops) go straight to the user. Agent-solvable kinds go to Hermes only when it is on duty.
 */
export function routeEscalation(input: {
  kind: string; projectId?: string | null; hermesOnDuty: boolean; userRequested?: boolean; hops?: number;
}): EscalationRoute {
  if (input.userRequested) return { to: "user", reason: "Người dùng muốn tự xem." };
  if (input.projectId === PROTECTED_PROJECT_ID) return { to: "user", reason: "Dự án được bảo vệ." };
  if ((USER_ONLY_KINDS as readonly string[]).includes(input.kind)) return { to: "user", reason: "Chỉ người dùng được quyết định." };
  if ((input.hops ?? 0) >= MAX_HOPS) return { to: "user", reason: "Đã chuyển qua lại 3 lần." };
  if (!(AGENT_SOLVABLE_KINDS as readonly string[]).includes(input.kind)) return { to: "user", reason: "Loại việc chưa được giao cho agent." };
  if (!input.hermesOnDuty) return { to: "user", reason: "Hermes chưa trực." };
  return { to: "hermes", reason: "Agent xử lý được." };
}

export type Escalation = {
  id: string; fromKind: string; fromInstance: string; toKind: EscalationTo; kind: string; objectRef: string;
  summary: string; evidence: Record<string, unknown>; status: EscalationStatus; deadlineAt: string | null;
  hops: number; claimedBy: string | null; resolvedBy: string | null; outcome: string | null; note: string | null;
  createdAt: string; updatedAt: string;
};

type Raw = {
  id: string; from_kind: string; from_instance: string; to_kind: string; kind: string; object_ref: string; summary: string;
  evidence: string; status: string; deadline_at: string | null; hops: number; claimed_by: string | null; resolved_by: string | null;
  outcome: string | null; note: string | null; created_at: string; updated_at: string;
};

function toEscalation(row: Raw): Escalation {
  let evidence: Record<string, unknown> = {};
  try { evidence = JSON.parse(row.evidence) as Record<string, unknown>; } catch { /* keep empty */ }
  return {
    id: row.id, fromKind: row.from_kind, fromInstance: row.from_instance, toKind: row.to_kind as EscalationTo, kind: row.kind,
    objectRef: row.object_ref, summary: row.summary, evidence, status: row.status as EscalationStatus, deadlineAt: row.deadline_at,
    hops: row.hops, claimedBy: row.claimed_by, resolvedBy: row.resolved_by, outcome: row.outcome, note: row.note,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function hermesDeadlineMinutes(sqlite: Database.Database): number {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'escalation.hermesDeadlineMin'").get() as { value: string } | undefined;
  const value = Number(row?.value);
  return Number.isFinite(value) && value >= 1 && value <= 1440 ? value : DEFAULT_HERMES_DEADLINE_MIN;
}

export function getEscalation(sqlite: Database.Database, id: string): Escalation | null {
  const row = sqlite.prepare("SELECT * FROM agent_escalations WHERE id = ?").get(id) as Raw | undefined;
  return row ? toEscalation(row) : null;
}

export function listEscalations(
  sqlite: Database.Database, filter: { toKind?: EscalationTo; statuses?: EscalationStatus[]; limit?: number } = {},
): Escalation[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.toKind) { where.push("to_kind = ?"); params.push(filter.toKind); }
  if (filter.statuses?.length) { where.push(`status IN (${filter.statuses.map(() => "?").join(",")})`); params.push(...filter.statuses); }
  const rows = sqlite.prepare(
    `SELECT * FROM agent_escalations ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`,
  ).all(...params, Math.min(filter.limit ?? 50, 200)) as Raw[];
  return rows.map(toEscalation);
}

/** Opens an escalation and routes it. A live one for the same object is returned as is, a recently closed one comes back with one more hop. */
export function openEscalation(
  sqlite: Database.Database,
  input: {
    fromKind: string; fromInstance: string; kind: string; objectRef?: string; projectId?: string | null;
    summary: string; evidence?: Record<string, unknown>; userRequested?: boolean;
  },
  now = new Date(),
): Escalation {
  const objectRef = input.objectRef ?? "";
  const live = sqlite.prepare(
    "SELECT * FROM agent_escalations WHERE kind = ? AND object_ref = ? AND status IN ('open','claimed') LIMIT 1",
  ).get(input.kind, objectRef) as Raw | undefined;
  if (live) return toEscalation(live);
  const recent = sqlite.prepare(
    "SELECT hops FROM agent_escalations WHERE kind = ? AND object_ref = ? AND updated_at > ? ORDER BY updated_at DESC LIMIT 1",
  ).get(input.kind, objectRef, new Date(now.getTime() - 24 * 3_600_000).toISOString()) as { hops: number } | undefined;
  const hops = recent ? recent.hops + 1 : 0;
  const route = routeEscalation({
    kind: input.kind, projectId: input.projectId, userRequested: input.userRequested, hops,
    hermesOnDuty: currentDuty(sqlite, now) !== null,
  });
  const id = randomUUID();
  const nowIso = now.toISOString();
  const deadline = route.to === "hermes" ? new Date(now.getTime() + hermesDeadlineMinutes(sqlite) * 60_000).toISOString() : null;
  sqlite.prepare(
    `INSERT INTO agent_escalations (id, from_kind, from_instance, to_kind, kind, object_ref, summary, evidence, status, deadline_at, hops, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
  ).run(id, input.fromKind, input.fromInstance, route.to, input.kind, objectRef, input.summary.slice(0, 500),
    JSON.stringify(input.evidence ?? {}), deadline, hops, route.to === "user" ? route.reason : null, nowIso, nowIso);
  publishAgentEvent({
    type: "escalation.opened",
    summary: `${route.to === "hermes" ? "Chuyển Hermes" : "Cần bạn"}: ${input.summary.slice(0, 200)}`,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  });
  return getEscalation(sqlite, id)!;
}

export function claimEscalation(sqlite: Database.Database, id: string, instance: string, now = new Date()): { ok: true; escalation: Escalation } | { ok: false; message: string } {
  const item = getEscalation(sqlite, id);
  if (!item) return { ok: false, message: "Không tìm thấy việc chuyển giao." };
  if (item.toKind !== "hermes") return { ok: false, message: "Việc này đã thuộc về người dùng." };
  if (item.status === "claimed" && item.claimedBy !== instance) return { ok: false, message: `Đã được ${item.claimedBy} nhận.` };
  if (item.status !== "open" && item.status !== "claimed") return { ok: false, message: "Việc này đã đóng." };
  sqlite.prepare("UPDATE agent_escalations SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE id = ?").run(instance, now.toISOString(), id);
  return { ok: true, escalation: getEscalation(sqlite, id)! };
}

export function resolveEscalation(
  sqlite: Database.Database, id: string, instance: string, outcome: string, note: string, now = new Date(),
): { ok: true; escalation: Escalation } | { ok: false; message: string } {
  const item = getEscalation(sqlite, id);
  if (!item) return { ok: false, message: "Không tìm thấy việc chuyển giao." };
  if (item.toKind !== "hermes") return { ok: false, message: "Việc này thuộc về người dùng, Hermes không đóng được." };
  if (item.status === "resolved" || item.status === "forwarded") return { ok: false, message: "Việc này đã đóng." };
  sqlite.prepare("UPDATE agent_escalations SET status = 'resolved', resolved_by = ?, outcome = ?, note = ?, updated_at = ? WHERE id = ?")
    .run(instance, outcome.slice(0, 40), note.slice(0, 500), now.toISOString(), id);
  return { ok: true, escalation: getEscalation(sqlite, id)! };
}

export function forwardEscalationToUser(
  sqlite: Database.Database, id: string, by: string, note: string, now = new Date(),
): { ok: true; escalation: Escalation } | { ok: false; message: string } {
  const item = getEscalation(sqlite, id);
  if (!item) return { ok: false, message: "Không tìm thấy việc chuyển giao." };
  if (item.status === "resolved") return { ok: false, message: "Việc này đã xử lý xong." };
  sqlite.prepare(
    "UPDATE agent_escalations SET to_kind = 'user', status = 'forwarded', hops = hops + 1, resolved_by = ?, note = ?, updated_at = ? WHERE id = ?",
  ).run(by, note.slice(0, 500), now.toISOString(), id);
  return { ok: true, escalation: getEscalation(sqlite, id)! };
}

/** Passed deadlines go to the user ("Hermes chưa xử lý kịp"); with nobody on duty every Hermes item goes. */
export function sweepEscalations(sqlite: Database.Database, now = new Date()): Escalation[] {
  const dutyLive = currentDuty(sqlite, now) !== null;
  const rows = sqlite.prepare("SELECT * FROM agent_escalations WHERE to_kind = 'hermes' AND status IN ('open','claimed')").all() as Raw[];
  const forwarded: Escalation[] = [];
  for (const row of rows) {
    const late = row.deadline_at !== null && row.deadline_at <= now.toISOString();
    if (!late && dutyLive) continue;
    const result = forwardEscalationToUser(sqlite, row.id, "system", late ? "Hermes chưa xử lý kịp" : "Hermes không còn trực", now);
    if (result.ok) forwarded.push(result.escalation);
  }
  return forwarded;
}

export function openEscalationCount(sqlite: Database.Database): { hermes: number; user: number } {
  const rows = sqlite.prepare(
    "SELECT to_kind, COUNT(*) AS n FROM agent_escalations WHERE status IN ('open','claimed','forwarded') GROUP BY to_kind",
  ).all() as Array<{ to_kind: string; n: number }>;
  return { hermes: rows.find((r) => r.to_kind === "hermes")?.n ?? 0, user: rows.find((r) => r.to_kind === "user")?.n ?? 0 };
}
