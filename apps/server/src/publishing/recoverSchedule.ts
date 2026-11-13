import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { PROTECTED_PROJECT_ID, ProfileAutomationSchema, enumerateSlots } from "@vg/shared";
import { effectiveAutonomy } from "../operator/autonomy.js";
import { getAutomationPaused } from "../services/automationSettings.js";

const GRACE_MS = 2 * 60 * 60_000;

/** Recover automatic slots only. Manual schedules and platform quota retries retain their own policy. */
export function recoverMissedPublications(db: Database.Database, lastHeartbeat: string, now: Date) {
  const summary = { rescheduled: 0, needsReview: 0 };
  const at = now.toISOString();
  const staleBefore = new Date(now.getTime() - GRACE_MS).toISOString();
  return db.transaction(() => {
    const rows = db.prepare(`SELECT p.id, p.project_id, p.account_id, p.scheduled_for, profile.id AS profile_id, profile.automation
      FROM publications p JOIN projects project ON project.id = p.project_id
      JOIN profiles profile ON profile.id = project.profile_id
      WHERE p.status = 'SCHEDULED' AND p.external_id IS NULL AND p.published_at IS NULL AND p.last_error IS NULL
        AND p.scheduled_for > ? AND p.scheduled_for <= ? AND p.project_id <> ?
        AND project.archived_at IS NULL AND profile.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM profile_topics t WHERE t.project_id = p.project_id AND t.profile_id = profile.id
          AND t.scheduled_for = p.scheduled_for)
      ORDER BY p.scheduled_for, p.id`).all(lastHeartbeat, staleBefore, PROTECTED_PROJECT_ID) as {
        id: string; project_id: string; account_id: string; scheduled_for: string; profile_id: string; automation: string | null;
      }[];
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.project_id}:${row.scheduled_for}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const first = group[0]!;
      const { level, grants } = effectiveAutonomy(db, {
        projectId: first.project_id, body: { accountIds: group.map(({ account_id }) => account_id) },
      });
      if (level !== "autonomous" && level !== "supervised") continue;
      let next: string | undefined;
      if (grants.strategy && !getAutomationPaused(db) && first.automation) {
        const automation = ProfileAutomationSchema.safeParse(JSON.parse(first.automation));
        if (automation.success && automation.data.enabled) {
          const occupied = db.prepare(`SELECT scheduled_for FROM profile_topics WHERE profile_id = ? AND scheduled_for >= ?
            UNION SELECT p.scheduled_for FROM publications p JOIN platform_accounts a ON a.id = p.account_id
            WHERE a.profile_id = ? AND p.scheduled_for >= ? AND p.status IN ('SCHEDULED','QUEUED','UPLOADING','PUBLISHED')`)
            .all(first.profile_id, at, first.profile_id, at) as { scheduled_for: string }[];
          const taken = new Set(occupied.map(({ scheduled_for }) => scheduled_for));
          try {
            next = enumerateSlots(now, automation.data, 7).map(({ at: slot }) => slot.toISOString())
              .find((slot) => slot > at && !taken.has(slot));
          } catch (error) {
            if (!(error instanceof RangeError)) throw error;
          }
        }
      }
      if (next) {
        db.prepare("UPDATE profile_topics SET scheduled_for = ?, updated_at = ? WHERE project_id = ? AND scheduled_for = ?")
          .run(next, at, first.project_id, first.scheduled_for);
      }
      for (const row of group) {
        const message = next ? "Đã chuyển lịch đăng bị lỡ sang khung giờ trống."
          : "Lịch đăng bị lỡ hơn hai giờ. Kiểm tra nội dung trước khi đăng lại.";
        if (next) {
          db.prepare("UPDATE publications SET scheduled_for = ?, updated_at = ? WHERE id = ?").run(next, at, row.id);
          summary.rescheduled++;
        } else {
          db.prepare("UPDATE publications SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?")
            .run(message, at, row.id);
          summary.needsReview++;
        }
        db.prepare(`UPDATE jobs SET status = 'CANCELLED', finished_at = ?, message = ?
          WHERE project_id = ? AND stage = 'PUBLISH' AND scope = ? AND status = 'QUEUED'`)
          .run(at, message, row.project_id, row.id);
        db.prepare(`INSERT OR IGNORE INTO supervisor_findings
          (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status, resolution)
          VALUES (?, ?, 'missed_publish', ?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), row.profile_id, next ? "info" : "warn", `missed_publish:${row.id}:${row.scheduled_for}`,
            JSON.stringify({ publicationId: row.id, scheduledFor: row.scheduled_for, rescheduledTo: next ?? null }),
            at, at, next ? "resolved" : "open", next ? message : null);
      }
    }
    return summary;
  }).immediate();
}
