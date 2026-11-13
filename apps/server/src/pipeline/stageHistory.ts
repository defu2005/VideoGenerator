import type Database from "better-sqlite3";
import {
  ESTIMATE_RECENT_RUNS,
  PLANNED_TIMEOUT_STAGES,
  estimateStageMs,
  timeoutBriefFromSettings,
  type PlannedTimeoutStage,
  type StageEstimate,
  type StageEstimateBrief,
  type StageRun,
} from "@vg/shared";

/**
 * TASK-125. Real stage durations from this install: one indexed query per stage
 * (jobs_stage_status_finished_idx), cached for 5 minutes and cleared when a job completes.
 */

const CACHE_MS = 5 * 60_000;
const cache = new WeakMap<Database.Database, Map<string, { at: number; runs: StageRun[] }>>();

export function clearStageHistoryCache(sqlite: Database.Database): void {
  cache.delete(sqlite);
}

type Row = {
  stage: string;
  started_at: string;
  finished_at: string;
  node_id: string | null;
  settings: string | null;
};

function parseRow(row: Row): StageRun | null {
  const durationMs = Date.parse(row.finished_at) - Date.parse(row.started_at);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  let settings: Record<string, unknown> = {};
  try {
    settings = row.settings ? JSON.parse(row.settings) as Record<string, unknown> : {};
  } catch {
    settings = {};
  }
  const brief = timeoutBriefFromSettings(settings as Parameters<typeof timeoutBriefFromSettings>[0], "");
  const scenes = Math.max(1, Math.ceil(brief.targetDurationSec / (brief.sceneDurationSec > 0 ? brief.sceneDurationSec : 7)));
  const tts = (settings as { voice?: { provider?: string } }).voice?.provider;
  return {
    stage: row.stage,
    durationMs,
    scenes,
    targetSec: brief.targetDurationSec,
    budgetMode: brief.budgetMode,
    aspectRatio: brief.aspectRatio,
    nodeId: row.node_id ?? null,
    provider: tts ?? null,
    finishedAt: row.finished_at,
  };
}

export function loadStageRuns(sqlite: Database.Database, stage: string, now: Date = new Date()): StageRun[] {
  let perDb = cache.get(sqlite);
  if (!perDb) {
    perDb = new Map();
    cache.set(sqlite, perDb);
  }
  const hit = perDb.get(stage);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.runs;
  const rows = sqlite.prepare(
    `SELECT j.stage AS stage, j.started_at AS started_at, j.finished_at AS finished_at, j.node_id AS node_id, p.settings AS settings
       FROM jobs j JOIN projects p ON p.id = j.project_id
      WHERE j.stage = ? AND j.status = 'SUCCEEDED' AND j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
      ORDER BY j.finished_at DESC LIMIT ?`,
  ).all(stage, ESTIMATE_RECENT_RUNS * 2) as Row[];
  const runs = rows.map(parseRow).filter((run): run is StageRun => run !== null);
  perDb.set(stage, { at: now.getTime(), runs });
  return runs;
}

export function estimateStage(
  sqlite: Database.Database,
  brief: StageEstimateBrief,
  stage: PlannedTimeoutStage,
  now?: Date,
): StageEstimate {
  return estimateStageMs(loadStageRuns(sqlite, stage, now), brief, stage);
}

export function estimateAllStages(
  sqlite: Database.Database,
  brief: StageEstimateBrief,
  now?: Date,
): Record<PlannedTimeoutStage, StageEstimate> {
  const result = {} as Record<PlannedTimeoutStage, StageEstimate>;
  for (const stage of PLANNED_TIMEOUT_STAGES) result[stage] = estimateStage(sqlite, brief, stage, now);
  return result;
}
