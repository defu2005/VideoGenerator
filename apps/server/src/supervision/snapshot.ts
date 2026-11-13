import type Database from "better-sqlite3";
import { currentDuty, listInstances } from "./duty.js";
import { listEscalations, openEscalationCount } from "./escalations.js";
import { listLiveLeases } from "./leases.js";
import { getOperatorPause } from "./pause.js";

export const SNAPSHOT_MAX_BYTES = 3000;
const STUCK_JOB_MS = 30 * 60_000;
const PENDING_OLD_MS = 2 * 3_600_000;

export type Anomaly = { kind: string; severity: "warn" | "high"; ref: string; detail: string };

const short = (text: string, max = 110) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const count = (sqlite: Database.Database, sql: string, ...params: unknown[]) =>
  (sqlite.prepare(sql).get(...params) as { n: number }).n;

/** Flag set by the Telegram poller when another process polls with the same bot token. */
export function telegramConflict(sqlite: Database.Database): boolean {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'telegram.conflict'").get() as { value: string } | undefined;
  return row?.value === "1";
}

export function setTelegramConflict(sqlite: Database.Database, conflict: boolean): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('telegram.conflict', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(conflict ? "1" : "0", new Date().toISOString());
}

/** Built by code, never by a model. `anomalies` is an empty list when everything is calm. */
export function buildSupervisionSnapshot(sqlite: Database.Database, now = new Date()): Record<string, unknown> {
  const nowIso = now.toISOString();
  const anomalies: Anomaly[] = [];

  const stuck = sqlite.prepare(
    `SELECT id, project_id, stage, COALESCE(heartbeat_at, started_at, created_at) AS beat FROM jobs
     WHERE status = 'RUNNING' AND COALESCE(heartbeat_at, started_at, created_at) < ? LIMIT 5`,
  ).all(new Date(now.getTime() - STUCK_JOB_MS).toISOString()) as Array<{ id: string; project_id: string | null; stage: string; beat: string }>;
  for (const job of stuck) {
    anomalies.push({ kind: "stuck_job", severity: "high", ref: `job:${job.id}`, detail: short(`${job.stage} không có nhịp từ ${job.beat}`) });
  }
  const failedPubs = sqlite.prepare(
    "SELECT id, last_error FROM publications WHERE status = 'FAILED' AND updated_at > ? LIMIT 5",
  ).all(new Date(now.getTime() - 24 * 3_600_000).toISOString()) as Array<{ id: string; last_error: string | null }>;
  for (const pub of failedPubs) {
    anomalies.push({ kind: "publish_failure", severity: "high", ref: `publication:${pub.id}`, detail: short(pub.last_error ?? "Đăng thất bại") });
  }
  const oldPending = sqlite.prepare(
    "SELECT id, summary FROM assistant_pending_actions WHERE status = 'pending' AND created_at < ? LIMIT 3",
  ).all(new Date(now.getTime() - PENDING_OLD_MS).toISOString()) as Array<{ id: string; summary: string }>;
  for (const action of oldPending) {
    anomalies.push({ kind: "pending_old", severity: "warn", ref: `pending:${action.id}`, detail: short(action.summary) });
  }
  const heldRow = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'autonomy.heldGates'").get() as { value: string } | undefined;
  let held: Array<{ projectId: string; check: string }> = [];
  try { held = heldRow ? JSON.parse(heldRow.value) as typeof held : []; } catch { held = []; }
  for (const gate of held.slice(0, 5)) {
    anomalies.push({ kind: "held_quality_gate", severity: "warn", ref: `project:${gate.projectId}`, detail: short(`Cổng chất lượng bị giữ: ${gate.check}`) });
  }
  const failedRuns = count(sqlite, "SELECT COUNT(*) AS n FROM operator_runs WHERE status = 'failed' AND created_at > ?",
    new Date(now.getTime() - 6 * 3_600_000).toISOString());
  if (failedRuns >= 3) anomalies.push({ kind: "operator_failing", severity: "warn", ref: "operator", detail: `${failedRuns} lượt operator lỗi trong 6 giờ` });
  const findings = sqlite.prepare(
    "SELECT kind, dedupe_key FROM supervisor_findings WHERE status = 'open' AND severity IN ('error','high') LIMIT 3",
  ).all() as Array<{ kind: string; dedupe_key: string }>;
  for (const finding of findings) anomalies.push({ kind: "finding", severity: "high", ref: short(finding.dedupe_key, 60), detail: finding.kind });
  if (telegramConflict(sqlite)) {
    anomalies.push({ kind: "telegram_conflict", severity: "warn", ref: "telegram", detail: "Hai tiến trình cùng đọc bot Telegram (HTTP 409)." });
  }

  const duty = currentDuty(sqlite, now);
  const pause = getOperatorPause(sqlite, now);
  const escalations = openEscalationCount(sqlite);
  const snapshot = {
    at: nowIso,
    duty: duty ? { holder: duty.instance, expiresAt: duty.expiresAt } : null,
    operator: {
      pause: pause ? { by: pause.by, until: pause.until, reason: short(pause.reason, 80) } : null,
      running: count(sqlite, "SELECT COUNT(*) AS n FROM operator_runs WHERE status = 'running'"),
      queued: count(sqlite, "SELECT COUNT(*) AS n FROM operator_runs WHERE status = 'queued'"),
    },
    jobs: {
      running: count(sqlite, "SELECT COUNT(*) AS n FROM jobs WHERE status = 'RUNNING'"),
      queued: count(sqlite, "SELECT COUNT(*) AS n FROM jobs WHERE status = 'QUEUED'"),
    },
    pendingActions: count(sqlite, "SELECT COUNT(*) AS n FROM assistant_pending_actions WHERE status = 'pending'"),
    leases: listLiveLeases(sqlite, now).length,
    escalations: {
      ...escalations,
      items: listEscalations(sqlite, { toKind: "hermes", statuses: ["open", "claimed"], limit: 5 })
        .map((item) => ({ id: item.id, kind: item.kind, ref: item.objectRef, deadlineAt: item.deadlineAt })),
    },
    telegram: { conflict: telegramConflict(sqlite) },
    anomalies,
  };
  // Keep the whole thing small: drop the least important rows until it fits.
  while (JSON.stringify(snapshot).length > SNAPSHOT_MAX_BYTES && snapshot.anomalies.length > 0) snapshot.anomalies.pop();
  while (JSON.stringify(snapshot).length > SNAPSHOT_MAX_BYTES && snapshot.escalations.items.length > 0) snapshot.escalations.items.pop();
  return snapshot;
}

export function formatHermesStatus(sqlite: Database.Database, now = new Date()): string {
  const duty = currentDuty(sqlite, now);
  const dutyText = duty
    ? `🛡️ <b>Trực nhật:</b> <code>${duty.instance}</code> (hết hạn: ${new Date(duty.expiresAt).toLocaleTimeString("vi-VN")})`
    : "🛡️ <b>Trực nhật:</b> Không có instance nào.";

  const instances = listInstances(sqlite, now);
  const instancesText = instances.length
    ? instances.slice(0, 5).map((i) => `• <code>${i.instance}</code>: ${new Date(i.lastSeenAt).toLocaleTimeString("vi-VN")}${i.onDuty ? " (trực)" : ""}`).join("\n")
    : "Chưa có instance nào.";

  const openCount = openEscalationCount(sqlite);
  const openEsc = listEscalations(sqlite, { toKind: "hermes", statuses: ["open", "claimed"], limit: 5 });
  const escText = openCount.hermes > 0
    ? `${openCount.hermes} việc chờ xử lý:\n` + openEsc.map((e) => `• [${e.kind}] ${e.summary}`).join("\n")
    : "0 việc mở.";

  const actions = sqlite.prepare(`
    SELECT tool, summary, decision, created_at FROM operator_tool_audit
    WHERE agent_kind = 'hermes'
    ORDER BY created_at DESC LIMIT 5
  `).all() as Array<{ tool: string; summary: string; decision: string; created_at: string }>;
  const actionsText = actions.length
    ? actions.map((a) => `• <b>${a.tool}</b> (${a.decision}): ${a.summary}`).join("\n")
    : "Chưa có thao tác gần đây.";

  return [
    "<b>Trạng thái Hermes Supervisor</b>",
    dutyText,
    "",
    "<b>Instance gần đây:</b>",
    instancesText,
    "",
    "<b>Chuyển giao (Escalations):</b>",
    escText,
    "",
    "<b>5 thao tác gần nhất của Hermes:</b>",
    actionsText,
  ].join("\n");
}
