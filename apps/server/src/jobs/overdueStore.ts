import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  OVERDUE_ACTIVITY_WINDOW_MS,
  OVERDUE_LOG_LINES,
  redactExportText,
  type OverdueCheckRow,
  type OverdueFacts,
  type OverdueJob,
  type OverdueSource,
  type OverdueState,
} from "@vg/shared";
import { scopeSql } from "../auth/requestContext.js";

/**
 * TASK-125. Overdue columns live outside `updateJob` (like the lease columns), so a normal status
 * update never touches them. Check rows are append-only.
 */

export function markOverdue(
  sqlite: Database.Database,
  jobId: string,
  input: { at: string; nextCheckAt: string | null; state: OverdueState },
): void {
  sqlite.prepare(
    "UPDATE jobs SET overdue_at = COALESCE(overdue_at, ?), next_check_at = ?, overdue_state = ? WHERE id = ?",
  ).run(input.at, input.nextCheckAt, input.state, jobId);
}

export function setOverdueState(
  sqlite: Database.Database,
  jobId: string,
  input: { nextCheckAt: string | null; state: OverdueState },
): void {
  sqlite.prepare("UPDATE jobs SET next_check_at = ?, overdue_state = ? WHERE id = ?").run(input.nextCheckAt, input.state, jobId);
}

export function clearOverdue(sqlite: Database.Database, jobId: string): void {
  sqlite.prepare("UPDATE jobs SET overdue_at = NULL, next_check_at = NULL, overdue_state = NULL WHERE id = ?").run(jobId);
}

export type OverdueMark = { overdueAt: string; nextCheckAt: string | null; state: OverdueState } | null;

export function readOverdueMark(sqlite: Database.Database, jobId: string): OverdueMark {
  const row = sqlite.prepare("SELECT overdue_at, next_check_at, overdue_state FROM jobs WHERE id = ? AND status = 'RUNNING'")
    .get(jobId) as { overdue_at: string | null; next_check_at: string | null; overdue_state: string | null } | undefined;
  if (!row?.overdue_at) return null;
  return {
    overdueAt: row.overdue_at,
    nextCheckAt: row.next_check_at,
    state: row.overdue_state === "waiting_decision" ? "waiting_decision" : "checking",
  };
}

export type NewOverdueCheck = {
  jobId: string;
  attempt: number;
  projectId: string;
  stage: string;
  checkNo: number;
  at: string;
  facts: OverdueFacts | null;
  action: string;
  extendMs: number | null;
  source: OverdueSource;
  actor: string | null;
  reason: string;
  costUsd: number;
};

export function recordOverdueCheck(sqlite: Database.Database, input: NewOverdueCheck): string {
  const id = randomUUID();
  const workspace = sqlite.prepare("SELECT workspace_id AS w FROM projects WHERE id = ?").get(input.projectId) as { w: string | null } | undefined;
  sqlite.prepare(
    `INSERT INTO stage_overdue_checks
       (id, job_id, attempt, project_id, workspace_id, stage, check_no, at, facts, action, extend_ms, source, actor, reason, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.jobId, input.attempt, input.projectId, workspace?.w ?? null, input.stage, input.checkNo, input.at,
    input.facts ? JSON.stringify(input.facts) : null, input.action, input.extendMs, input.source, input.actor,
    input.reason.slice(0, 600), input.costUsd,
  );
  return id;
}

type CheckRowDb = {
  id: string; job_id: string; attempt: number; project_id: string; stage: string; check_no: number; at: string;
  facts: string | null; action: string; extend_ms: number | null; source: string; actor: string | null; reason: string; cost_usd: number;
};

function toRow(row: CheckRowDb): OverdueCheckRow {
  let facts: OverdueFacts | null = null;
  try {
    facts = row.facts ? JSON.parse(row.facts) as OverdueFacts : null;
  } catch {
    facts = null;
  }
  return {
    id: row.id, jobId: row.job_id, attempt: row.attempt, projectId: row.project_id, stage: row.stage,
    checkNo: row.check_no, at: row.at, facts, action: row.action, extendMs: row.extend_ms,
    source: row.source as OverdueSource, actor: row.actor, reason: row.reason, costUsd: row.cost_usd,
  };
}

/** Check history of one job, oldest first, limited to the caller's workspace. */
export function listOverdueChecks(sqlite: Database.Database, jobId: string, limit = 200): OverdueCheckRow[] {
  const scope = scopeSql("workspace_id");
  const rows = sqlite.prepare(
    `SELECT * FROM stage_overdue_checks WHERE job_id = ? AND ${scope.sql} ORDER BY at ASC, rowid ASC LIMIT ?`,
  ).all(jobId, ...scope.args, limit) as CheckRowDb[];
  return rows.map(toRow);
}

export function lastOverdueCheck(sqlite: Database.Database, jobId: string): OverdueCheckRow | null {
  const row = sqlite.prepare("SELECT * FROM stage_overdue_checks WHERE job_id = ? ORDER BY at DESC, rowid DESC LIMIT 1")
    .get(jobId) as CheckRowDb | undefined;
  return row ? toRow(row) : null;
}

type JobDbRow = {
  id: string; project_id: string; stage: string; attempt: number; started_at: string | null;
  overdue_at: string; next_check_at: string | null; overdue_state: string | null; title: string; settings: string | null;
};

function planEntry(settings: string | null, stage: string): { expectedMs: number | null; limitMs: number | null } {
  try {
    const entry = (JSON.parse(settings ?? "{}") as { stageTimeouts?: { stages?: Record<string, { timeoutMs?: number; expectedMs?: number }> } })
      .stageTimeouts?.stages?.[stage];
    return { expectedMs: entry?.expectedMs ?? null, limitMs: entry?.timeoutMs ?? null };
  } catch {
    return { expectedMs: null, limitMs: null };
  }
}

function toOverdueJob(sqlite: Database.Database, row: JobDbRow, now: Date): OverdueJob {
  const last = lastOverdueCheck(sqlite, row.id);
  const plan = planEntry(row.settings, row.stage);
  const queued = sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'QUEUED' AND stage = ?").get(row.stage) as { n: number };
  return {
    jobId: row.id,
    projectId: row.project_id,
    projectTitle: row.title,
    stage: row.stage,
    attempt: row.attempt,
    state: row.overdue_state === "waiting_decision" ? "waiting_decision" : "checking",
    elapsedMs: row.started_at ? Math.max(0, now.getTime() - Date.parse(row.started_at)) : 0,
    expectedMs: last?.facts?.expectedMs ?? plan.expectedMs,
    limitMs: last?.facts?.limitMs ?? plan.limitMs,
    overdueAt: row.overdue_at,
    nextCheckAt: row.next_check_at,
    lastAction: last?.action ?? null,
    lastReason: last?.reason ?? null,
    queuedBehind: queued.n,
  };
}

const JOB_SELECT = `SELECT j.id, j.project_id, j.stage, j.attempt, j.started_at, j.overdue_at, j.next_check_at, j.overdue_state,
    p.title AS title, p.settings AS settings
  FROM jobs j JOIN projects p ON p.id = j.project_id`;

export function listOverdueJobs(sqlite: Database.Database, now: Date = new Date()): OverdueJob[] {
  const scope = scopeSql("p.workspace_id");
  const rows = sqlite.prepare(
    `${JOB_SELECT} WHERE j.status = 'RUNNING' AND j.overdue_at IS NOT NULL AND ${scope.sql} ORDER BY j.overdue_at ASC LIMIT 100`,
  ).all(...scope.args) as JobDbRow[];
  return rows.map((row) => toOverdueJob(sqlite, row, now));
}

export function getOverdueJob(sqlite: Database.Database, jobId: string, now: Date = new Date()): OverdueJob | null {
  const scope = scopeSql("p.workspace_id");
  const row = sqlite.prepare(
    `${JOB_SELECT} WHERE j.id = ? AND j.status = 'RUNNING' AND j.overdue_at IS NOT NULL AND ${scope.sql}`,
  ).get(jobId, ...scope.args) as JobDbRow | undefined;
  return row ? toOverdueJob(sqlite, row, now) : null;
}

// ------------------------------------------------------------------ facts

/** What one running stage did lately. Executors can add child / LLM facts through `setActivity`. */
export class ActivityTracker {
  private readonly samples: Array<{ at: number; progress: number }> = [];
  private readonly messages: string[] = [];
  private activity: { childAlive: boolean | null; childNote: string | null; llmInFlight: boolean | null; quotaWait: boolean | null } = {
    childAlive: null, childNote: null, llmInFlight: null, quotaWait: null,
  };
  progress = 0;
  lastProgressAt: number | null = null;
  progressAtLimit: number | null = null;
  private lastSignalAt: number;

  constructor(startedAtMs: number) {
    this.lastSignalAt = startedAtMs;
  }

  note(progress: number, message: string | undefined, nowMs: number): void {
    this.progress = progress;
    this.lastProgressAt = nowMs;
    this.lastSignalAt = nowMs;
    this.samples.push({ at: nowMs, progress });
    if (this.samples.length > 40) this.samples.shift();
    if (message) {
      this.messages.push(redactExportText(message).slice(0, 200));
      if (this.messages.length > OVERDUE_LOG_LINES) this.messages.shift();
    }
  }

  setActivity(partial: Partial<typeof this.activity>): void {
    this.activity = { ...this.activity, ...partial };
  }

  snapshot(nowMs: number): {
    trend: "up" | "flat" | "none"; sinceProgressMs: number | null; logTail: string[];
    childAlive: boolean | null; childNote: string | null; llmInFlight: boolean | null; quotaWait: boolean | null;
  } {
    let trend: "up" | "flat" | "none" = "none";
    if (this.samples.length > 0) {
      const recent = this.samples.filter((sample) => nowMs - sample.at <= OVERDUE_ACTIVITY_WINDOW_MS);
      const before = [...this.samples].reverse().find((sample) => nowMs - sample.at > OVERDUE_ACTIVITY_WINDOW_MS);
      const baseline = before?.progress ?? recent[0]?.progress ?? this.progress;
      trend = recent.length > 0 && Math.max(...recent.map((sample) => sample.progress)) > baseline ? "up" : "flat";
    }
    return {
      trend,
      sinceProgressMs: this.lastProgressAt === null ? null : Math.max(0, nowMs - this.lastProgressAt),
      logTail: [...this.messages],
      ...this.activity,
    };
  }

  markSignal(nowMs: number): void {
    this.lastSignalAt = nowMs;
  }

  noSignalMs(nowMs: number): number {
    return Math.max(0, nowMs - this.lastSignalAt);
  }
}

const WALK_FILE_CAP = 2_000;

/** Bytes of files changed in the last 2 minutes under a directory. Stops after 2,000 files. Null when unreadable. */
export async function bytesWrittenRecently(dir: string, nowMs: number): Promise<number | null> {
  let files = 0;
  let bytes = 0;
  let ok = false;
  const walk = async (current: string, depth: number): Promise<void> => {
    if (files >= WALK_FILE_CAP || depth > 6) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
      ok = true;
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files >= WALK_FILE_CAP) return;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
      } else if (entry.isFile()) {
        files += 1;
        try {
          const info = await stat(path);
          if (nowMs - info.mtimeMs <= OVERDUE_ACTIVITY_WINDOW_MS) bytes += info.size;
        } catch {
          /* file vanished */
        }
      }
    }
  };
  await walk(dir, 0);
  return ok ? bytes : null;
}
