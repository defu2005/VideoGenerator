import type Database from "better-sqlite3";
import { findEquivalentModel } from "@vg/shared";
import { effectiveAutonomy } from "./autonomy.js";

export const GATEWAY_BYPASS_KEY = "autonomy.gatewayBypass";

export type PlaybookFinding = {
  kind: string;
  key: string;
  profileId?: string | null;
  detail: Record<string, unknown>;
};

function grantsOf(db: Database.Database, profileId: string | null | undefined) {
  try {
    return effectiveAutonomy(db, { profileId: profileId ?? undefined }).grants;
  } catch {
    return null;
  }
}

function mark(db: Database.Database, key: string, status: string, resolution: string): void {
  db.prepare("UPDATE supervisor_findings SET status = ?, resolution = ? WHERE dedupe_key = ?").run(status, resolution, key);
}

export function gatewayBypassOn(db: Database.Database): boolean {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(GATEWAY_BYPASS_KEY) as { value: string } | undefined;
  return row?.value === "1";
}

export function setGatewayBypass(db: Database.Database, on: boolean, at: string): void {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(GATEWAY_BYPASS_KEY, on ? "1" : "0", at);
}

/** Code playbooks run before any model call. */
export function runPlaybooks(
  db: Database.Database,
  findings: PlaybookFinding[],
  options: { now: string; suggestTopics?: (profileId: string) => void },
): string[] {
  const actions: string[] = [];
  for (const finding of findings) {
    const dedupe = `${finding.kind}:${finding.key}`;
    const current = db.prepare("SELECT status FROM supervisor_findings WHERE dedupe_key = ?").get(dedupe) as { status: string } | undefined;
    if (!current || current.status === "healing" || current.status === "escalated") continue;
    const grants = grantsOf(db, finding.profileId);
    if (finding.kind === "topics_low" && finding.profileId && grants?.topics && options.suggestTopics) {
      options.suggestTopics(finding.profileId);
      mark(db, dedupe, "healing", "Đã xếp gợi ý chủ đề trước khi gọi model.");
      actions.push(dedupe);
    }
    if (finding.kind === "slot_at_risk" && finding.profileId && grants?.strategy && typeof finding.detail.publishAt === "string") {
      const next = new Date(Date.parse(finding.detail.publishAt) + 24 * 60 * 60 * 1000).toISOString();
      db.prepare("UPDATE profile_topics SET scheduled_for = ? WHERE profile_id = ? AND scheduled_for = ?")
        .run(next, finding.profileId, finding.detail.publishAt);
      try {
        db.prepare(`UPDATE publications SET scheduled_for = ?, updated_at = ?, guardrail_reason = ?
          WHERE scheduled_for = ? AND status = 'SCHEDULED' AND project_id IN (SELECT id FROM projects WHERE profile_id = ?)`)
          .run(next, options.now, "Dời slot vì chưa kịp video", finding.detail.publishAt, finding.profileId);
      } catch {
        // Publications are optional in unit fixtures.
      }
      mark(db, dedupe, "resolved", `Đã dời slot sang ${next}.`);
      actions.push(dedupe);
    }
    if (finding.kind === "gateway_unhealthy") {
      setGatewayBypass(db, true, options.now);
      mark(db, dedupe, "healing", "Đi vòng qua OmniRoute, dùng provider trực tiếp.");
      actions.push(dedupe);
    }
    if (finding.kind === "quota_wait") {
      const swap = findEquivalentModel({ provider: "omniroute", model: "blocked" }, []);
      mark(db, dedupe, "healing", swap
        ? `Đổi sang ${swap.provider}/${swap.model} cho lượt này.`
        : "Giữ job đến giờ reset. Chuỗi route ưu tiên model miễn phí còn quota.");
      actions.push(dedupe);
    }
  }
  return actions;
}
