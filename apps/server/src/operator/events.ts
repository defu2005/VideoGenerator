import { PROTECTED_PROJECT_ID, redactExportText } from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getAutomationPaused } from "../services/automationSettings.js";

export const OperatorEventKind = z.enum(["job_failed", "render_completed", "quota_wait", "approval_wait", "job_overdue"]);
export const OperatorEventRule = z.object({
  profileId: z.string().uuid(),
  kind: OperatorEventKind,
  wake: z.boolean(),
  telegram: z.boolean(),
}).strict().refine((rule) => rule.kind !== "approval_wait" || !rule.wake, "Sự kiện chờ duyệt chỉ dùng thông báo.");

type Rule = z.output<typeof OperatorEventRule>;
type Delivery = Rule & { enabled_at: string };
type DeliveryEvent = {
  id: string; project_id: string | null; job_id: string | null; run_id: string | null;
  wake_run_id: string | null; telegram_sent_at: string | null;
};
export type EventScope = { projectId: string; profileId: string };
const RULE_PREFIX = "operator.event-rule.";
const labels: Record<Rule["kind"], string> = {
  job_failed: "Job lỗi", render_completed: "Render hoàn tất", quota_wait: "Chờ quota", approval_wait: "Chờ duyệt", job_overdue: "Bước chạy quá giờ",
};

export function saveOperatorEventRule(sqlite: Database.Database, rule: Rule, now = new Date()): void {
  const key = `${RULE_PREFIX}${rule.profileId}.${rule.kind}`;
  if (!sqlite.prepare("SELECT 1 FROM profiles WHERE id = ?").get(rule.profileId)) {
    throw new AppError(404, "PROFILE_NOT_FOUND", "Không tìm thấy hồ sơ.");
  }
  sqlite.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(rule), now.toISOString());
}

export function listOperatorEventRules(sqlite: Database.Database): Delivery[] {
  const rows = sqlite.prepare("SELECT value, updated_at FROM app_settings WHERE key LIKE ? ORDER BY key")
    .all(`${RULE_PREFIX}%`) as Array<{ value: string; updated_at: string }>;
  return rows.map((row) => ({ ...OperatorEventRule.parse(JSON.parse(row.value)), enabled_at: row.updated_at }));
}

export function eventWakeRunId(id: string): string {
  return `event-${createHash("sha256").update(id).digest("hex").slice(0, 48)}`;
}

export function dispatchOperatorEvents(sqlite: Database.Database, deps: {
  wake: (input: { runId: string; scope: EventScope; prompt: string }) => { status: string };
  telegram: (message: string) => Promise<boolean>;
}): Promise<void> {
  return deliver();
  async function deliver() {
    const paused = getAutomationPaused(sqlite);
    for (const rule of listOperatorEventRules(sqlite)) {
      if (!rule.telegram && (!rule.wake || paused)) continue;
      const events = sqlite.prepare(
        `SELECT event.id, event.project_id, event.job_id, event.run_id, event.wake_run_id, event.telegram_sent_at
         FROM operator_events AS event JOIN profiles ON profiles.id = event.profile_id
         LEFT JOIN projects ON projects.id = event.project_id
         WHERE event.profile_id = ? AND event.kind = ? AND event.occurred_at >= ?
           AND profiles.archived_at IS NULL
           AND (event.project_id IS NULL OR (projects.profile_id = event.profile_id AND projects.archived_at IS NULL
             AND projects.id <> ?))
           AND ((? AND event.telegram_sent_at IS NULL) OR
             (? AND event.wake_run_id IS NULL AND event.run_id IS NULL AND event.project_id IS NOT NULL))
         ORDER BY event.occurred_at, event.id LIMIT 25`,
      ).all(rule.profileId, rule.kind, rule.enabled_at, PROTECTED_PROJECT_ID, rule.telegram ? 1 : 0,
        rule.wake && !paused && rule.kind !== "approval_wait" ? 1 : 0) as DeliveryEvent[];
      for (const event of events) {
        if (rule.wake && !paused && rule.kind !== "approval_wait" && !event.wake_run_id && !event.run_id && event.project_id) {
          const runId = eventWakeRunId(event.id);
          const exists = sqlite.prepare("SELECT 1 FROM operator_runs WHERE id = ?").get(runId);
          const projectId = event.project_id;
          const accepted = exists || deps.wake({
            runId, scope: { projectId, profileId: rule.profileId },
            prompt: `${labels[rule.kind]} ở dự án ${projectId}. Chỉ đọc trạng thái và tóm tắt hướng xử lý. Không thay đổi dữ liệu.`,
          }).status !== "refused";
          if (accepted) sqlite.prepare("UPDATE operator_events SET wake_run_id = ? WHERE id = ?").run(runId, event.id);
        }
        if (rule.telegram && !event.telegram_sent_at && await deps.telegram(`${labels[rule.kind]}. Xem sự kiện ${event.id} trong Agent operator.`)) {
          sqlite.prepare("UPDATE operator_events SET telegram_sent_at = ? WHERE id = ?").run(new Date().toISOString(), event.id);
        }
      }
    }
  }
}

export function collectOperatorEvents(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    // TASK-125: fires on the first overdue mark and on each escalate.
    // TODO(TASK-122): route job_overdue into an escalation (Hermes decides, then the user).
    sqlite.prepare(`
      INSERT OR IGNORE INTO operator_events (id, kind, profile_id, project_id, job_id, occurred_at)
      SELECT 'job_overdue:' || c.id, 'job_overdue', p.profile_id, c.project_id, c.job_id, c.at
      FROM stage_overdue_checks AS c JOIN projects AS p ON p.id = c.project_id
      WHERE c.project_id <> ? AND p.profile_id IS NOT NULL
        AND (c.check_no = 1 OR c.action = 'escalate') AND c.source IN ('ladder', 'llm', 'override')
    `).run(PROTECTED_PROJECT_ID);
    sqlite.prepare(`
      INSERT OR IGNORE INTO operator_events (id, kind, profile_id, project_id, job_id, occurred_at)
      SELECT kind || ':' || id || ':' || attempt, kind, profile_id, project_id, id, occurred_at
      FROM (
        SELECT jobs.id, jobs.attempt, jobs.project_id, projects.profile_id,
          CASE
            WHEN jobs.status = 'SUCCEEDED' AND jobs.stage = 'RENDER' THEN 'render_completed'
            WHEN json_extract(jobs.error, '$.code') IN ('LLM_QUOTA_WAIT', 'LLM_QUOTA_EXHAUSTED') THEN 'quota_wait'
            WHEN jobs.status = 'FAILED' THEN 'job_failed'
          END AS kind,
          coalesce(jobs.finished_at, jobs.started_at, jobs.created_at) AS occurred_at
        FROM jobs JOIN projects ON projects.id = jobs.project_id
        WHERE jobs.project_id <> ? AND (jobs.status IN ('SUCCEEDED', 'FAILED') OR jobs.error IS NOT NULL)
      ) WHERE kind IS NOT NULL
    `).run(PROTECTED_PROJECT_ID);
    sqlite.prepare(`
      UPDATE operator_events AS event SET run_id = (
        SELECT audit.run_id FROM assistant_pending_actions AS pending
        JOIN operator_tool_audit AS audit ON audit.pending_action_id = pending.id
        WHERE json_extract(pending.result, '$.activeJob.id') = event.job_id
          AND json_extract(pending.args, '$.projectId') = event.project_id
          AND audit.run_id IS NOT NULL
        ORDER BY audit.rowid DESC LIMIT 1
      ) WHERE event.run_id IS NULL AND event.job_id IS NOT NULL
    `).run();
    sqlite.prepare(`
      INSERT OR IGNORE INTO operator_events (id, kind, profile_id, project_id, pending_id, run_id, occurred_at)
      SELECT 'approval_wait:' || pending.id, 'approval_wait', coalesce(projects.profile_id, profiles.id), projects.id,
        pending.id, (SELECT audit.run_id FROM operator_tool_audit AS audit
          WHERE audit.pending_action_id = pending.id ORDER BY audit.rowid DESC LIMIT 1), pending.created_at
      FROM assistant_pending_actions AS pending
      LEFT JOIN projects ON projects.id = json_extract(pending.args, '$.projectId')
      LEFT JOIN profiles ON profiles.id = json_extract(pending.args, '$.profileId')
      WHERE pending.status = 'pending' AND instr(pending.args, ?) = 0
    `).run(PROTECTED_PROJECT_ID);
  }).immediate();
}

export function listOperatorEvents(sqlite: Database.Database) {
  return sqlite.prepare(
    `SELECT id, kind, profile_id AS profileId, project_id AS projectId, job_id AS jobId,
      pending_id AS pendingId, coalesce(run_id, wake_run_id) AS runId, detail, occurred_at AS occurredAt
      FROM operator_events ORDER BY occurred_at DESC, id DESC LIMIT 50`,
  ).all();
}

export function operatorEventTrace(sqlite: Database.Database, id: string) {
  const event = sqlite.prepare("SELECT *, coalesce(run_id, wake_run_id) AS trace_run_id FROM operator_events WHERE id = ?").get(id) as
    { job_id: string | null; trace_run_id: string | null; pending_id: string | null } | undefined;
  if (!event) throw new AppError(404, "OPERATOR_EVENT_NOT_FOUND", "Không tìm thấy sự kiện.");
  const job = event.job_id ? sqlite.prepare(
    `SELECT id, stage, status, attempt, error, usage FROM jobs WHERE id = ? AND project_id <> ?`,
  ).get(event.job_id, PROTECTED_PROJECT_ID) as
    { id: string; stage: string; status: string; attempt: number; error: string | null; usage: string | null } | undefined : undefined;
  const runId = event.trace_run_id;
  const run = runId ? sqlite.prepare(
    "SELECT id, runtime_id, model, status, outcome, workflow_id FROM operator_runs WHERE id = ?",
  ).get(runId) : undefined;
  const tools = runId ? sqlite.prepare(
    "SELECT tool, decision, pending_action_id, created_at FROM operator_tool_audit WHERE run_id = ? ORDER BY rowid LIMIT 50",
  ).all(runId) : [];
  const message = runId ? sqlite.prepare(
    "SELECT id, conversation_id, created_at FROM operator_messages WHERE run_id = ? AND role = 'user' ORDER BY rowid LIMIT 1",
  ).get(runId) : undefined;
  const pending = event.pending_id ? sqlite.prepare(
    "SELECT id, tool, status, expires_at FROM assistant_pending_actions WHERE id = ?",
  ).get(event.pending_id) : undefined;
  const runUsage = runId && !job ? sqlite.prepare(
    "SELECT usage FROM jobs WHERE id = ? AND stage = 'ASSISTANT'",
  ).get(runId) as { usage: string | null } | undefined : undefined;
  const rawUsage = job?.usage ?? runUsage?.usage;
  const usage = rawUsage ? JSON.parse(rawUsage) as {
    inputTokens?: number; outputTokens?: number; costUsd?: number;
    calls?: Array<{ task: string; provider: string; model: string; fallback: boolean; fallbackReason?: string }>;
  } : undefined;
  const error = job?.error ? JSON.parse(job.error) as { code: string; message: string } : undefined;
  return {
    event, run: run ?? null, message: message ?? null, pending: pending ?? null, tools,
    usage: !job && usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : null,
    job: job ? {
      id: job.id, stage: job.stage, status: job.status, attempt: job.attempt,
      error: error ? { code: error.code, message: redactExportText(error.message).slice(0, 800) } : null,
      usage: usage ? {
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd,
        calls: usage.calls?.slice(0, 50).map(({ task, provider, model, fallback, fallbackReason }) => ({
          task, provider, model, fallback, fallbackReason,
        })),
      } : null,
    } : null,
  };
}
