import type Database from "better-sqlite3";
import { localDateString, type Job } from "@vg/shared";
import { effectiveAutonomy } from "./autonomy.js";
import { readAutonomyBudget } from "./autonomyBudget.js";

type Claim = { day: string; stage: "RENDER" | "PUBLISH"; profileId: string | null; accountId: string | null };

/** A returned null means the job does not count, false means it must wait. */
function evaluate(db: Database.Database, job: Job, now: Date): Claim | null | false {
  const stage = job.stage;
  if (stage !== "RENDER" && stage !== "PUBLISH") return null;
  const day = localDateString(now, "Asia/Ho_Chi_Minh");
  const app = readAutonomyBudget(db);
  if (stage === "RENDER") {
    const row = db.prepare("SELECT profile_id FROM projects WHERE id = ?").get(job.projectId) as { profile_id: string | null } | undefined;
    const profileId = row?.profile_id ?? null;
    const appCap = app.maxRendersPerDay;
    const profileCap = profileId ? readAutonomyBudget(db, profileId).maxRendersPerDay : null;
    const count = (profile?: string) => {
      const sql = "SELECT COUNT(*) AS count FROM autonomy_job_claims WHERE day = ? AND stage = 'RENDER'";
      return (profile ? db.prepare(sql + " AND profile_id = ?").get(day, profile) : db.prepare(sql).get(day)) as { count: number };
    };
    if ((appCap != null && count().count >= appCap)
        || (profileId && profileCap != null && count(profileId).count >= profileCap)) return false;
    return { day, stage, profileId, accountId: null };
  }
  const account = db.prepare(`SELECT a.id, a.profile_id, a.platform FROM publications p
    JOIN platform_accounts a ON a.id = p.account_id WHERE p.id = ? AND p.project_id = ?`)
    .get(job.scope, job.projectId) as { id: string; profile_id: string; platform: string } | undefined;
  if (!account) return null;
  const profileCap = readAutonomyBudget(db, account.profile_id).maxPublishesPerDayPerAccount;
  const { level } = effectiveAutonomy(db, { profileId: account.profile_id });
  // TASK-059's conservative planning allowance, independent of live provider quota.
  const fallback = account.platform === "youtube" && (level === "supervised" || level === "autonomous") ? 6 : Infinity;
  const cap = Math.min(app.maxPublishesPerDayPerAccount ?? Infinity, profileCap ?? Infinity);
  const limit = Number.isFinite(cap) ? cap : fallback;
  if (Number.isFinite(limit)) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM autonomy_job_claims WHERE day = ? AND account_id = ?")
      .get(day, account.id) as { count: number };
    if (row.count >= limit) return false;
  }
  return { day, stage, profileId: account.profile_id, accountId: account.id };
}

export function jobWithinAutonomyLimit(db: Database.Database, job: Job, now: Date): boolean {
  return evaluate(db, job, now) !== false;
}

export function autonomyJobCounts(db: Database.Database, day: string, profileId?: string) {
  const rows = db.prepare(`SELECT stage, account_id AS accountId, COUNT(*) AS count FROM autonomy_job_claims
    WHERE day = ? AND (? IS NULL OR profile_id = ?) GROUP BY stage, account_id ORDER BY account_id`)
    .all(day, profileId ?? null, profileId ?? null) as { stage: Claim["stage"]; accountId: string | null; count: number }[];
  return {
    render: rows.find((row) => row.stage === "RENDER")?.count ?? 0,
    publishes: rows.flatMap(({ accountId, count }) => accountId ? [{ accountId, count }] : []),
  };
}

/** Called only in the transaction that changes the job to RUNNING. */
export function reserveAutonomyJob(db: Database.Database, job: Job, now: Date): boolean {
  const claim = evaluate(db, job, now);
  if (claim === false) return false;
  if (claim) {
    db.prepare("INSERT INTO autonomy_job_claims (day, stage, profile_id, account_id) VALUES (?, ?, ?, ?)")
      .run(claim.day, claim.stage, claim.profileId, claim.accountId);
  }
  return true;
}
