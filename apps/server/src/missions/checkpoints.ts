import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { assertTransition, canTransition, emitMissionStateChanged, getMission, type MissionState } from "./missions.js";

// TASK-129c slice 2: checkpoints after publishing, the user gate (waiting_user), and reminders.
// The tick takes `now` and an injected measure function, so it works with nobody on duty and tests need no network.

const HOUR = 3_600_000;
export const CHECKPOINTS = [
  { kind: "2h", ms: 2 * HOUR },
  { kind: "24h", ms: 24 * HOUR },
  { kind: "72h", ms: 72 * HOUR },
  { kind: "7d", ms: 7 * 24 * HOUR },
] as const;
export const PING_INTERVAL_MS = 6 * HOUR;

export type MissionView = ReturnType<typeof getMission>;
export type CheckpointResult = { report: string; metrics: Record<string, unknown> };
/** Returns null when the numbers are not ready yet; the tick retries on its next run. */
export type MeasureFn = (mission: MissionView, kind: string, publishedAt: string) => Promise<CheckpointResult | null>;

export function setState(sqlite: Database.Database, workspaceId: string, id: string, from: MissionState, to: MissionState, at: string): void {
  assertTransition(from, to);
  const info = sqlite.prepare("UPDATE missions SET state = ?, updated_at = ? WHERE id = ? AND state = ?").run(to, at, id, from);
  if (info.changes === 1) emitMissionStateChanged(workspaceId, id, from, to);
}

/** Records that a scheduled mission went out. Starts the checkpoint clock from `now`. */
export function recordPublished(sqlite: Database.Database, workspaceId: string, id: string, now = new Date()): MissionView {
  const mission = getMission(sqlite, workspaceId, id);
  const at = now.toISOString();
  sqlite.transaction(() => {
    sqlite.prepare("INSERT OR IGNORE INTO mission_checkpoints (mission_id, kind, at) VALUES (?, 'published', ?)").run(id, at);
    setState(sqlite, workspaceId, id, mission.state as MissionState, "published", at);
  })();
  return getMission(sqlite, workspaceId, id);
}

/**
 * Called when a publication goes out. If it belongs to a mission that is scheduled, the mission is recorded as published.
 * Later publications of the same mission find it already published and do nothing. Ordinary publications are ignored.
 */
export function recordPublicationPublished(sqlite: Database.Database, publicationId: string, now = new Date()): void {
  const link = sqlite.prepare(
    "SELECT m.id AS id, m.workspace_id AS workspace_id, m.state AS state FROM publications p JOIN missions m ON m.id = p.mission_id WHERE p.id = ?",
  ).get(publicationId) as { id: string; workspace_id: string; state: string } | undefined;
  if (!link || link.state !== "scheduled") return;
  recordPublished(sqlite, link.workspace_id, link.id, now);
}

const LIVE_PUBLICATION_STATUSES = ["QUEUED", "SCHEDULED", "UPLOADING", "PUBLISHED"] as const;

/**
 * Producing → scheduled, but only once every project in the mission has a live linked publication
 * (queued, scheduled, uploading or published). Until then the call is a no-op, so calling it after each
 * project's publications is safe. Publications that already went out before the move are recorded as published
 * so their checkpoint clock is not lost. Any other state is left alone. Only the app calls this, never an agent.
 */
export function markMissionScheduled(sqlite: Database.Database, workspaceId: string, id: string, now = new Date()): MissionView {
  const mission = getMission(sqlite, workspaceId, id);
  if (mission.state !== "producing") return mission;
  const marks = LIVE_PUBLICATION_STATUSES.map(() => "?").join(",");
  const covered = new Set((sqlite.prepare(
    `SELECT DISTINCT project_id AS projectId FROM publications WHERE mission_id = ? AND status IN (${marks})`,
  ).all(id, ...LIVE_PUBLICATION_STATUSES) as Array<{ projectId: string }>).map((r) => r.projectId));
  if (!mission.projectIds.every((projectId) => covered.has(projectId))) return mission;
  sqlite.transaction(() => {
    setState(sqlite, workspaceId, id, "producing", "scheduled", now.toISOString());
    // Clock starts at the earliest video that already went out, not at scheduling time.
    const first = sqlite.prepare("SELECT MIN(COALESCE(published_at, updated_at)) AS at FROM publications WHERE mission_id = ? AND status = 'PUBLISHED'")
      .get(id) as { at: string | null };
    if (first.at) recordPublished(sqlite, workspaceId, id, new Date(first.at));
  })();
  return getMission(sqlite, workspaceId, id);
}

/**
 * The user approved a gate of this project. Resumes every waiting mission that includes it, but only when no other
 * project in that mission is still at a gate that needs a person. Called from the user's approve route only, never by agents.
 * Returns the mission ids resumed.
 */
export function resumeMissionsForProject(sqlite: Database.Database, projectId: string, now = new Date()): string[] {
  const rows = sqlite.prepare("SELECT id, workspace_id AS workspaceId, project_ids AS projectIds FROM missions WHERE state = 'waiting_user'")
    .all() as Array<{ id: string; workspaceId: string; projectIds: string }>;
  const resumed: string[] = [];
  for (const row of rows) {
    const projectIds = JSON.parse(row.projectIds) as string[];
    if (!projectIds.includes(projectId)) continue;
    // Checks every project, including this one: approving one gate must not resume while another gate still waits.
    const stillBlocked = projectIds.some((other) =>
      Boolean(sqlite.prepare("SELECT 1 FROM project_stages WHERE project_id = ? AND state = 'WAITING_USER' LIMIT 1").get(other)));
    if (stillBlocked) continue;
    resumeMissionByUser(sqlite, row.workspaceId, row.id, now);
    resumed.push(row.id);
  }
  return resumed;
}

/**
 * A project in a producing mission reached a gate that needs a person (not an AUTO project). Holds every such mission.
 * Returns the mission ids that were put on hold. Missions in other states are not changed.
 */
export function holdMissionsForProject(sqlite: Database.Database, projectId: string, now = new Date()): string[] {
  const rows = sqlite.prepare("SELECT id, workspace_id AS workspaceId, project_ids AS projectIds FROM missions WHERE state = 'producing'")
    .all() as Array<{ id: string; workspaceId: string; projectIds: string }>;
  const held: string[] = [];
  for (const row of rows) {
    const projectIds = JSON.parse(row.projectIds) as string[];
    if (!projectIds.includes(projectId)) continue;
    enterWaitingUser(sqlite, row.workspaceId, row.id, now);
    held.push(row.id);
  }
  return held;
}

/** The pipeline holds a producing mission when a non-AUTO project reaches a gate (project mode decides, not the mission level). Only the user resumes it. */
export function enterWaitingUser(sqlite: Database.Database, workspaceId: string, id: string, now = new Date()): MissionView {
  const mission = getMission(sqlite, workspaceId, id);
  setState(sqlite, workspaceId, id, mission.state as MissionState, "waiting_user", now.toISOString());
  return getMission(sqlite, workspaceId, id);
}

/**
 * The user clears a gate: waiting_user → producing. Agents cannot do this (the agent move is planning → producing only).
 * Also clears the ping row, so the next wait pings at once instead of waiting out the old 6 h.
 */
export function resumeMissionByUser(sqlite: Database.Database, workspaceId: string, id: string, now = new Date()): MissionView {
  const mission = getMission(sqlite, workspaceId, id);
  if (mission.state !== "waiting_user") throw new AppError(409, "MISSION_ILLEGAL_TRANSITION", "Mission không đang chờ người dùng.");
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM mission_checkpoints WHERE mission_id = ? AND kind = 'ping'").run(id);
    setState(sqlite, workspaceId, id, "waiting_user", "producing", now.toISOString());
  })();
  return getMission(sqlite, workspaceId, id);
}

/**
 * Missions waiting on the user that are due a reminder. Pure: records nothing.
 * The caller sends the reminder and then calls markPinged; a failed send is retried after the reminder backoff (RETRY_BACKOFF_MS).
 */
export function missionsToPing(sqlite: Database.Database, now = new Date()): string[] {
  const waiting = sqlite.prepare("SELECT id FROM missions WHERE state = 'waiting_user'").all() as Array<{ id: string }>;
  const last = sqlite.prepare("SELECT at FROM mission_checkpoints WHERE mission_id = ? AND kind = 'ping'");
  return waiting
    .filter(({ id }) => {
      const previous = last.get(id) as { at: string } | undefined;
      return !previous || now.getTime() - Date.parse(previous.at) >= PING_INTERVAL_MS;
    })
    .map(({ id }) => id);
}

/** Records that a reminder for this mission went out. Call only after the send succeeded. */
export function markPinged(sqlite: Database.Database, id: string, now = new Date()): void {
  sqlite.prepare("INSERT INTO mission_checkpoints (mission_id, kind, at) VALUES (?, 'ping', ?) ON CONFLICT(mission_id, kind) DO UPDATE SET at = excluded.at")
    .run(id, now.toISOString());
}

let tickRunning = false;

/**
 * One tick. For each published or measuring mission, fires every checkpoint that is due, in order.
 * Idempotent: a checkpoint row is written once; only the call that actually inserted it reports it as fired.
 * A null or throwing measurement stops that mission until the next tick; other missions still run.
 * Overlapping ticks in this process return at once. Never approves anything and never changes autonomy.
 */
export async function advanceMissions(sqlite: Database.Database, now: Date, measure: MeasureFn): Promise<Array<{ missionId: string; kind: string }>> {
  if (tickRunning) return [];
  tickRunning = true;
  try {
    const fired: Array<{ missionId: string; kind: string }> = [];
    const candidates = sqlite.prepare(
      "SELECT m.id AS id, m.workspace_id AS workspace_id, c.at AS published_at FROM missions m JOIN mission_checkpoints c ON c.mission_id = m.id AND c.kind = 'published' WHERE m.state IN ('published', 'measuring')",
    ).all() as Array<{ id: string; workspace_id: string; published_at: string }>;
    const done = sqlite.prepare("SELECT kind FROM mission_checkpoints WHERE mission_id = ?");
    for (const row of candidates) {
      try {
        const have = new Set((done.all(row.id) as Array<{ kind: string }>).map((r) => r.kind));
        for (const checkpoint of CHECKPOINTS) {
          if (have.has(checkpoint.kind)) continue;
          if (now.getTime() < Date.parse(row.published_at) + checkpoint.ms) break;
          const mission = getMission(sqlite, row.workspace_id, row.id);
          const result = await measure(mission, checkpoint.kind, row.published_at);
          if (!result) break;
          const inserted = sqlite.transaction(() => {
            const info = sqlite.prepare("INSERT OR IGNORE INTO mission_checkpoints (mission_id, kind, at, metrics, report) VALUES (?, ?, ?, ?, ?)")
              .run(row.id, checkpoint.kind, now.toISOString(), JSON.stringify(result.metrics), result.report);
            if (info.changes === 0) return false;
            const state = getMission(sqlite, row.workspace_id, row.id).state as MissionState;
            if (state === "published" && canTransition("published", "measuring")) setState(sqlite, row.workspace_id, row.id, "published", "measuring", now.toISOString());
            if (checkpoint.kind === "7d" && canTransition("measuring", "done")) setState(sqlite, row.workspace_id, row.id, "measuring", "done", now.toISOString());
            return true;
          })();
          if (!inserted) break;
          fired.push({ missionId: row.id, kind: checkpoint.kind });
        }
      } catch {
        // One mission failing (measure threw, DB error) must not stop the others. It is retried next tick.
        continue;
      }
    }
    return fired;
  } finally {
    tickRunning = false;
  }
}

/**
 * Spec TASK-129 §4 item 3: a confirm-risk action on a project holds that project's producing missions.
 * Mission tools (`mission_*`) have no project to hold. Never throws: a bookkeeping failure must not block the action.
 */
function projectIdOfAction(tool: string, argsJson: string): string | null {
  if (tool.startsWith("mission_")) return null;
  try {
    const args = JSON.parse(argsJson) as { projectId?: unknown };
    return typeof args.projectId === "string" && args.projectId ? args.projectId : null;
  } catch {
    return null;
  }
}

export function holdForPendingAction(sqlite: Database.Database, tool: string, argsJson: string, now = new Date()): string[] {
  const projectId = projectIdOfAction(tool, argsJson);
  if (!projectId) return [];
  try {
    return holdMissionsForProject(sqlite, projectId, now);
  } catch {
    return [];
  }
}

/**
 * Called after a confirm (only when the tool succeeded) or a reject. Resumes the project's held missions,
 * but only when no other pending action still targets that project. An expired action leaves the mission waiting.
 */
export function releaseAfterPendingAction(sqlite: Database.Database, actionId: string, tool: string, argsJson: string, now = new Date()): string[] {
  const projectId = projectIdOfAction(tool, argsJson);
  if (!projectId) return [];
  try {
    const others = sqlite.prepare("SELECT tool, args FROM assistant_pending_actions WHERE status = 'pending' AND id <> ?").all(actionId) as Array<{ tool: string; args: string }>;
    const stillBlocked = others.some((row) => projectIdOfAction(row.tool, row.args) === projectId);
    if (stillBlocked) return [];
    return resumeMissionsForProject(sqlite, projectId, now);
  } catch {
    return [];
  }
}
