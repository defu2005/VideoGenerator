import type Database from "better-sqlite3";
import { currentActor } from "../auth/requestContext.js";
import { can } from "../auth/policy.js";

const PREFIX = "stage.agent.releases.";
/** The supervisor is instance-wide; a reader still sees only jobs in its own scope. */
export function canReadStageFinding(db: Database.Database, jobId: unknown) {
  const actor = currentActor();
  if (!actor) return true;
  if (typeof jobId !== "string") return false;
  const row = db.prepare("SELECT p.workspace_id,p.profile_id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=?").get(jobId) as { workspace_id: string | null; profile_id: string | null } | undefined;
  return Boolean(row && (row.workspace_id !== null || actor.ownsUnassigned) && can(actor, "project.read", { workspaceId: row.workspace_id, profileId: row.profile_id }).ok);
}
/** Existing app_settings holds a small per-job counter; the fence remains exclusively in jobs. */
export function recordStageRelease(db: Database.Database, jobId: string, now: Date) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key=?").get(PREFIX + jobId) as { value: string } | undefined;
  let count = 0;
  try { count = Number(JSON.parse(row?.value ?? "{}").count) || 0; } catch { /* A damaged counter starts fresh. */ }
  db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .run(PREFIX + jobId, JSON.stringify({ count: count + 1 }), now.toISOString());
}
export function stageReleaseLoops(db: Database.Database) {
  const rows = db.prepare(`SELECT j.id AS jobId,j.project_id AS projectId,p.profile_id AS profileId,s.value
    FROM app_settings s JOIN jobs j ON s.key=(? || j.id) JOIN projects p ON p.id=j.project_id
    WHERE j.status IN ('QUEUED','RUNNING')`).all(PREFIX) as Array<{ jobId: string; projectId: string; profileId: string | null; value: string }>;
  return rows.flatMap(({ value, ...row }) => {
    try { const count = Number(JSON.parse(value).count); return count > 3 ? [{ ...row, count }] : []; } catch { return []; }
  });
}
