import type Database from "better-sqlite3";

export const METRIC_CATALOG = {
  retention_30s: "up",
  avg_view_pct: "up",
  views_7d: "up",
  views_28d: "up",
  subs_gained: "up",
  watch_hours: "up",
  shorts_viewed_pct: "up",
  rpm: "up",
  revenue: "up",
  policy_warnings: "down",
  published_count: "up",
  blocked_count: "down",
  quota_used: "down",
  topics_rejected_duplicate: "up",
} as const;

export type MetricName = keyof typeof METRIC_CATALOG;

export function catalogDirection(name: string): "up" | "down" | null {
  if (name.startsWith("custom:")) return null;
  return METRIC_CATALOG[name as MetricName] ?? null;
}

export function readCatalogMetric(
  sqlite: Database.Database,
  name: string,
  subjects: { publicationIds?: string[] },
): number | null {
  if (name !== "published_count") return null;
  const ids = subjects.publicationIds ?? [];
  if (ids.length === 0) return null;
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS n FROM publications WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).get(...ids) as { n: number };
  return row.n;
}
