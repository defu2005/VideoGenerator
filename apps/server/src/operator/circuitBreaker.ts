import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { PipelineStageSchema, type PipelineStage } from "@vg/shared";
import { z } from "zod";

const HOUR = 3_600_000;
const PREFIX = "autonomy.breaker.";
const State = z.object({
  history: z.array(z.boolean()).max(10),
  retryAt: z.string().nullable(),
  delayMs: z.number().int().nonnegative(),
  trialJobId: z.string().nullable(),
});
type State = z.infer<typeof State>;
const initial: State = { history: [], retryAt: null, delayMs: 0, trialJobId: null };

function key(profileId: string, stage: PipelineStage): string {
  return `${PREFIX}${profileId}.${stage}`;
}

function read(db: Database.Database, profileId: string, stage: PipelineStage): State {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key(profileId, stage)) as { value: string } | undefined;
  return row ? State.parse(JSON.parse(row.value)) : initial;
}

function write(db: Database.Database, id: string, state: State, at: string): void {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(id, JSON.stringify(state), at);
}

function trialRunning(db: Database.Database, jobId: string | null): boolean {
  return Boolean(jobId && db.prepare("SELECT 1 FROM jobs WHERE id = ? AND status = 'RUNNING'").get(jobId));
}

export function breakerAllowsStart(db: Database.Database, profileId: string, stage: PipelineStage, now: Date): boolean {
  const state = read(db, profileId, stage);
  return state.retryAt === null || (state.retryAt <= now.toISOString() && !trialRunning(db, state.trialJobId));
}

/** Called in the same transaction that marks the job RUNNING. */
export function claimBreakerTrial(db: Database.Database, profileId: string, stage: PipelineStage, jobId: string, now: Date): boolean {
  if (!breakerAllowsStart(db, profileId, stage, now)) return false;
  const state = read(db, profileId, stage);
  if (state.retryAt) write(db, key(profileId, stage), { ...state, trialJobId: jobId }, now.toISOString());
  return true;
}

/** Records an executed attempt, excluding waits that never made progress. */
export function recordBreakerOutcome(
  db: Database.Database, profileId: string, stage: PipelineStage, jobId: string, succeeded: boolean, now: Date,
): string | undefined {
  const id = key(profileId, stage);
  const state = read(db, profileId, stage);
  const at = now.toISOString();
  const dedupeKey = `breaker_open:${profileId}:${stage}`;
  if (state.retryAt && state.trialJobId !== jobId) return undefined;
  if (state.retryAt && succeeded) {
    write(db, id, initial, at);
    db.prepare(`UPDATE supervisor_findings SET status = 'resolved', last_seen_at = ?, resolution = ?
      WHERE dedupe_key = ? AND status != 'resolved'`).run(at, "Lượt thử thành công.", dedupeKey);
    return undefined;
  }
  const history = [...state.history, succeeded].slice(-10);
  const opens = state.retryAt !== null
    || (history.length >= 3 && history.slice(-3).every((success) => !success))
    || (history.length === 10 && history.filter((success) => !success).length > 5);
  if (!opens) {
    write(db, id, { ...initial, history }, at);
    return undefined;
  }
  const delayMs = Math.min(24 * HOUR, state.delayMs ? 2 * state.delayMs : HOUR);
  const retryAt = new Date(now.getTime() + delayMs).toISOString();
  write(db, id, { history, retryAt, delayMs, trialJobId: null }, at);
  db.prepare(`INSERT INTO supervisor_findings
    (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
    VALUES (?, ?, 'breaker_open', 'warn', ?, ?, ?, ?, 'open')
    ON CONFLICT(dedupe_key) DO UPDATE SET detail = excluded.detail, last_seen_at = excluded.last_seen_at,
      first_seen_at = CASE WHEN status = 'resolved' THEN excluded.first_seen_at ELSE first_seen_at END,
      status = 'open', resolution = NULL`)
    .run(randomUUID(), profileId, dedupeKey, JSON.stringify({ stage, retryAt, delayMs }), at, at);
  return retryAt;
}

export function listCircuitBreakers(db: Database.Database, profileId?: string, now = new Date()) {
  const prefix = profileId ? `${PREFIX}${profileId}.` : PREFIX;
  const rows = db.prepare("SELECT key, value FROM app_settings WHERE key >= ? AND key < ? ORDER BY key")
    .all(prefix, `${prefix}\uffff`) as { key: string; value: string }[];
  return rows.map((row) => {
    const [owner, rawStage] = row.key.slice(PREFIX.length).split(".");
    const state = State.parse(JSON.parse(row.value));
    return {
      profileId: owner,
      stage: PipelineStageSchema.parse(rawStage),
      state: state.retryAt === null ? "closed" : state.retryAt <= now.toISOString() ? "half_open" : "open",
      retryAt: state.retryAt,
      trialRunning: trialRunning(db, state.trialJobId),
    };
  });
}
