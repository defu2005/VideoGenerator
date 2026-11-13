import type Database from "better-sqlite3";
import { zonedParts } from "./cron.js";
import { applyGoalToAutomation, buildDigest } from "./autopilot.js";
import { effectiveAutonomy } from "./autonomy.js";

const ZONE = "Asia/Ho_Chi_Minh";

function firedKey(kind: string, day: string): string {
  return `autonomy.fired.${kind}.${day}`;
}

function already(db: Database.Database, key: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get(key));
}

function remember(db: Database.Database, key: string, at: string): void {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', ?)
    ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`).run(key, at);
}

function localDay(now: Date): string {
  const parts = zonedParts(now, ZONE);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function shiftTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const total = ((hour ?? 20) * 60 + (minute ?? 0) + 30) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function runStandingPlans(db: Database.Database, now: Date): { planner: boolean; review: boolean; digest: boolean } {
  const parts = zonedParts(now, ZONE);
  const day = localDay(now);
  const at = now.toISOString();
  const result = { planner: false, review: false, digest: false };
  if (parts.hour === 5 && !already(db, firedKey("planner", day))) {
    const goals = db.prepare("SELECT profile_id FROM operator_goals WHERE status = 'active' AND profile_id IS NOT NULL")
      .all() as Array<{ profile_id: string }>;
    for (const goal of goals) applyGoalToAutomation(db, goal.profile_id, () => now);
    remember(db, firedKey("planner", day), at);
    result.planner = true;
  }
  if (parts.weekday === 1 && parts.hour === 6 && !already(db, firedKey("review", day))) {
    const goals = db.prepare("SELECT id, profile_id, spec FROM operator_goals WHERE status = 'active' AND profile_id IS NOT NULL")
      .all() as Array<{ id: string; profile_id: string; spec: string }>;
    for (const goal of goals) {
      const spec = JSON.parse(goal.spec) as { videosPerDay?: number; publishTime?: string; plan?: Record<string, unknown> };
      const planned = (spec.videosPerDay ?? 1) * 7;
      let published = 0;
      try {
        published = (db.prepare(`SELECT COUNT(*) AS n FROM publications p JOIN projects j ON j.id = p.project_id
          WHERE j.profile_id = ? AND p.status = 'PUBLISHED'`).get(goal.profile_id) as { n: number }).n;
      } catch {
        published = 0;
      }
      const changes: string[] = [];
      let grantsStrategy = false;
      try {
        grantsStrategy = effectiveAutonomy(db, { profileId: goal.profile_id }).grants.strategy;
      } catch {
        grantsStrategy = false;
      }
      if (published < planned - 1 && grantsStrategy) {
        const publishTime = shiftTime(spec.publishTime ?? "20:00");
        spec.publishTime = publishTime;
        const row = db.prepare("SELECT automation FROM profiles WHERE id = ?").get(goal.profile_id) as { automation: string | null } | undefined;
        const current = row?.automation ? JSON.parse(row.automation) as Record<string, unknown> : {};
        db.prepare("UPDATE profiles SET automation = ? WHERE id = ?").run(JSON.stringify({ ...current, publishTimes: [publishTime] }), goal.profile_id);
        changes.push(`Dời giờ đăng thành ${publishTime}.`);
      }
      db.prepare("UPDATE operator_goals SET spec = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify({ ...spec, plan: { ...spec.plan, weekly: { at, published, planned, changes } } }), at, goal.id);
    }
    remember(db, firedKey("review", day), at);
    result.review = true;
  }
  if (parts.hour === 21 && !already(db, firedKey("digest", day))) {
    buildDigest(db, () => now);
    remember(db, firedKey("digest", day), at);
    result.digest = true;
  }
  return result;
}
