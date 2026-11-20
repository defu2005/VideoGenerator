import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { openEscalation } from "../supervision/escalations.js";

/**
 * TASK-148c: per-stage quality ledger. One row per finished stage run, written from the orchestrator
 * completion path. Trends compare the last `days` with the `days` before. Alerts open an escalation,
 * never change prompts, models or settings.
 */

export const QUALITY_ALERT_DROP = 0.2;
export const QUALITY_ALERT_MIN_RUNS = 5;

export type StageQualityInput = {
  projectId: string;
  profileId: string | null;
  stage: string;
  jobId: string | null;
  executor?: string;
  modelRoute?: string | null;
  retries?: number;
  durationMs?: number;
  costUsd?: number;
  metrics: Record<string, number | string | boolean | null>;
  now?: Date;
};

export function recordStageQuality(sqlite: Database.Database, input: StageQualityInput): void {
  sqlite.prepare(
    `INSERT INTO stage_quality (id, created_at, project_id, profile_id, stage, job_id, executor, model_route, retries, duration_ms, cost_usd, metrics)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(), (input.now ?? new Date()).toISOString(), input.projectId, input.profileId, input.stage, input.jobId,
    input.executor ?? "app", input.modelRoute ?? null, input.retries ?? 0, input.durationMs ?? 0, input.costUsd ?? 0,
    JSON.stringify(input.metrics),
  );
}

/** Quality score for SCRIPT: the critic total stored with the latest draft of the project. */
export function scriptQualityMetrics(sqlite: Database.Database, projectId: string): Record<string, number | null> {
  const row = sqlite.prepare("SELECT critique FROM script_drafts WHERE project_id = ?").get(projectId) as { critique: string | null } | undefined;
  if (!row?.critique) return { quality_score: null };
  try {
    const parsed = JSON.parse(row.critique) as { total?: unknown };
    return { quality_score: typeof parsed.total === "number" ? parsed.total : null };
  } catch {
    return { quality_score: null };
  }
}

export type StageQualityTrend = {
  stage: string;
  metric: string;
  days: number;
  current: { runs: number; mean: number | null };
  previous: { runs: number; mean: number | null };
  changePct: number | null;
};

/** Rolling mean of one metric for the last `days` against the `days` before. */
export function stageQualityTrend(
  sqlite: Database.Database,
  input: { profileId?: string | null; stage: string; metric?: string; days?: number; now?: Date },
): StageQualityTrend {
  const metric = input.metric ?? "quality_score";
  const days = input.days ?? 14;
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  const since = new Date(now.getTime() - 2 * days * 86_400_000).toISOString();
  const profileClause = input.profileId === undefined ? "" : "AND profile_id IS ?";
  const args = input.profileId === undefined ? [] : [input.profileId];
  const rows = sqlite.prepare(
    `SELECT created_at AS createdAt, json_extract(metrics, '$.' || ?) AS value FROM stage_quality
     WHERE stage = ? AND created_at >= ? ${profileClause}`,
  ).all(metric, input.stage, since, ...args) as Array<{ createdAt: string; value: number | null }>;
  const summarize = (inWindow: (createdAt: string) => boolean) => {
    const values = rows.filter((row) => inWindow(row.createdAt) && typeof row.value === "number").map((row) => row.value as number);
    const runs = rows.filter((row) => inWindow(row.createdAt)).length;
    return { runs, mean: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null };
  };
  const current = summarize((createdAt) => createdAt >= from);
  const previous = summarize((createdAt) => createdAt < from);
  const changePct = current.mean !== null && previous.mean !== null && previous.mean !== 0
    ? Math.round(((current.mean - previous.mean) / previous.mean) * 1000) / 10
    : null;
  return { stage: input.stage, metric, days, current, previous, changePct };
}

/**
 * Opens one escalation when a stage's metric drops more than 20 % over 14 days with at least 5 runs.
 * Deduped per stage and metric per ISO week through the escalation object reference.
 */
export function checkStageQualityAlerts(
  sqlite: Database.Database,
  input: { stages: string[]; metric?: string; now?: Date },
): Array<{ stage: string; changePct: number; opened: boolean }> {
  const now = input.now ?? new Date();
  const metric = input.metric ?? "quality_score";
  const out: Array<{ stage: string; changePct: number; opened: boolean }> = [];
  for (const stage of input.stages) {
    const trend = stageQualityTrend(sqlite, { stage, metric, days: 14, now });
    if (trend.changePct === null || trend.current.runs < QUALITY_ALERT_MIN_RUNS) continue;
    if (trend.changePct > -QUALITY_ALERT_DROP * 100) continue;
    const week = `${now.getUTCFullYear()}-W${Math.ceil(((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)}`;
    openEscalation(sqlite, {
      fromKind: "stage-quality",
      fromInstance: "app",
      kind: "stage_quality_drop",
      objectRef: `${stage}:${metric}:${week}`,
      summary: `${stage} ${metric} giảm ${Math.abs(trend.changePct)}% trong 14 ngày (${trend.current.runs} lần chạy).`,
      evidence: { trend },
    }, now);
    out.push({ stage, changePct: trend.changePct, opened: true });
  }
  return out;
}
