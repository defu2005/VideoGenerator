import { z } from "zod";
import type Database from "better-sqlite3";
import { ChangeInbox } from "./changeInbox.js";
import { KnowledgeService } from "./service.js";

export const EligibilityMetricsSchema = z.object({
  followers: z.number().int().nonnegative().optional(), age: z.number().int().min(0).max(120).optional(),
  windows: z.array(z.object({ days: z.number().int().min(1).max(730), qualified: z.boolean(),
    views: z.number().nonnegative().optional(), watchHours: z.number().nonnegative().optional(), uploads: z.number().int().nonnegative().optional(),
  }).strict()).max(10).default([]),
}).strict();
export type EligibilityMetrics = z.infer<typeof EligibilityMetricsSchema>;
type Rule = { text?: string; followers?: number | null; minAge?: number | null; uploads?: number; uploadsWindowDays?: number;
  views?: number; watchHours?: number; windowDays?: number; anyOf?: Array<{ views?: number; watchHours?: number; windowDays?: number }> };

/** Numeric milestones only. Qualified windows must be explicitly verified in the platform dashboard. */
export function eligibilityNumbers(rule: Rule, metrics: EligibilityMetrics): "met" | "not_met" | "unknown" {
  const numericKeys = new Set(["followers", "minAge", "uploads", "uploadsWindowDays", "views", "watchHours", "windowDays"]);
  if ("minAgeByMarket" in rule || "conditional" in rule) return "unknown";
  if (Object.entries(rule).some(([key, value]) => typeof value === "number" && !numericKeys.has(key))) return "unknown";
  let tested = false;
  for (const [required, observed] of [[rule.followers, metrics.followers], [rule.minAge, metrics.age]]) {
    if (typeof required !== "number") continue;
    tested = true; if (typeof observed !== "number") return "unknown"; if (observed < required) return "not_met";
  }
  if (typeof rule.uploads === "number") {
    tested = true;
    const observed = metrics.windows.find(w => w.days === rule.uploadsWindowDays && w.qualified)?.uploads;
    if (observed === undefined) return "unknown";
    if (observed < rule.uploads) return "not_met";
  }
  if (typeof rule.views === "number" || typeof rule.watchHours === "number") {
    tested = true;
    const window = metrics.windows.find(w => w.days === rule.windowDays && w.qualified);
    if (!window) return "unknown";
    for (const field of ["views", "watchHours"] as const) {
      if (typeof rule[field] !== "number") continue;
      if (window[field] === undefined) return "unknown";
      if (window[field]! < rule[field]!) return "not_met";
    }
  }
  if (rule.anyOf?.length) {
    tested = true;
    const outcomes = rule.anyOf.map(branch => {
      if (Object.keys(branch).some(key => !["views", "watchHours", "windowDays"].includes(key))) return "unknown";
      const window = metrics.windows.find(w => w.days === branch.windowDays && w.qualified);
      if (!window) return "unknown";
      let checked = false;
      for (const field of ["views", "watchHours"] as const) {
        const minimum = branch[field]; if (typeof minimum !== "number") continue;
        checked = true; if (window[field] === undefined) return "unknown"; if (window[field]! < minimum) return "not_met";
      }
      return checked ? "met" : "unknown";
    });
    if (!outcomes.includes("met")) return outcomes.includes("unknown") ? "unknown" : "not_met";
  }
  return tested ? "met" : "unknown";
}

export class Milestones {
  constructor(private readonly db: Database.Database, private readonly now = () => new Date()) {}
  saveManual(accountId: string, metrics: EligibilityMetrics) {
    new ChangeInbox(this.db, this.now).putSetting(`change.eligibility:${accountId}`, JSON.stringify({ metrics, checkedAt: this.now().toISOString(), source: "manual_dashboard" }));
    return this.check(accountId);
  }
  check(accountId: string): number {
    const account = this.db.prepare(`SELECT a.platform, a.display_name, p.market FROM platform_accounts a JOIN profiles p ON p.id = a.profile_id WHERE a.id = ?`)
      .get(accountId) as { platform: string; display_name: string; market: string | null } | undefined;
    if (!account) return 0;
    const inbox = new ChangeInbox(this.db, this.now), raw = inbox.setting(`change.eligibility:${accountId}`);
    if (!raw) return 0;
    const saved = JSON.parse(raw) as { metrics: EligibilityMetrics; checkedAt: string; source: string };
    if (!Number.isFinite(Date.parse(saved.checkedAt)) || this.now().getTime() - Date.parse(saved.checkedAt) > 7 * 86_400_000) return 0;
    const metrics = EligibilityMetricsSchema.parse(saved.metrics);
    const channel = this.db.prepare("SELECT followers FROM channel_metrics_daily WHERE account_id = ? AND followers IS NOT NULL AND date >= ? ORDER BY date DESC LIMIT 1")
      .get(accountId, new Date(this.now().getTime() - 7 * 86_400_000).toISOString().slice(0, 10)) as { followers: number } | undefined;
    if (metrics.followers === undefined && channel) metrics.followers = channel.followers;
    let count = 0;
    for (const { entry } of new KnowledgeService(this.db, this.now).list({ kind: "monetization_program", platform: account.platform.replace(/_reels$/, "") })) {
      if (!entry.scope.markets.some(x => x === "*" || x === account.market)) continue;
      const value = entry.value as { name: string; eligibility: Rule };
      if (eligibilityNumbers(value.eligibility, metrics) !== "met") continue;
      inbox.record({ category: "E3", detector: "D3", subject: { type: "account", id: accountId },
        summary: `${account.display_name}: kênh đã đủ điều kiện số liệu để kiểm tra ${value.name}; cần nền tảng xác nhận duyệt`,
        evidence: { program: entry.id, metrics, checkedAt: saved.checkedAt, source: saved.source, sources: entry.evidence }, severity: "info",
        fingerprint: `milestone:${accountId}:${entry.id}` }); count++;
    }
    return count;
  }
}
