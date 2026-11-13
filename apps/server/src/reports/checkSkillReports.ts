import type Database from "better-sqlite3";
import { enqueueIndex } from "../retrieval/service.js";

type Metric = { name: string; baseline: number | null; target: number | null; actual: number | null; direction: "up" | "down" };

export function metricReached(metric: Metric): boolean {
  if (metric.target == null || metric.actual == null) return false;
  return metric.direction === "down" ? metric.actual <= metric.target : metric.actual >= metric.target;
}

export function verdictFor(metrics: Metric[], publishedCount: number): "dung" | "sai" | "chua_ro" | null {
  if (metrics.length === 0 || metrics.some((metric) => metric.target == null || metric.actual == null)) return null;
  const enough = publishedCount >= 3 || publishedCount === 1;
  if (!enough) return "chua_ro";
  const reached = metrics.filter(metricReached).length;
  if (reached === metrics.length) return "dung";
  if (reached === 0) return "sai";
  return "chua_ro";
}

export function checkDueSkillReports(sqlite: Database.Database, now = new Date()): { due: number; newSai: number } {
  const today = now.toISOString().slice(0, 10);
  const rows = sqlite.prepare(
    `SELECT id, profile_id, skill, hypothesis, lesson, subjects, metrics, check_at
     FROM skill_reports WHERE verdict IS NULL AND check_at IS NOT NULL AND check_at <= ?`,
  ).all(today) as Array<{ id: string; profile_id: string | null; skill: string; hypothesis: string | null; lesson: string | null; subjects: string; metrics: string; check_at: string }>;
  let due = 0;
  let newSai = 0;
  for (const row of rows) {
    const subjects = JSON.parse(row.subjects) as { publicationIds?: string[] };
    const ids = subjects.publicationIds ?? [];
    const publications = ids.length
      ? sqlite.prepare(
        `SELECT status, published_at FROM publications WHERE id IN (${ids.map(() => "?").join(",")})`,
      ).all(...ids) as Array<{ status: string; published_at: string | null }>
      : [];
    const published = publications.filter((item) => item.status === "PUBLISHED");
    const youngest = published.map((item) => item.published_at).filter((value): value is string => Boolean(value))
      .sort().at(-1);
    if (youngest && now.getTime() - Date.parse(youngest) < 48 * 60 * 60 * 1000) {
      const next = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      sqlite.prepare("UPDATE skill_reports SET check_at = ?, updated_at = ? WHERE id = ?").run(next, now.toISOString(), row.id);
      due += 1;
      continue;
    }
    const metrics = (JSON.parse(row.metrics) as Metric[]).map((metric) => (
      metric.actual == null && metric.name === "published_count" ? { ...metric, actual: published.length } : metric
    ));
    const verdict = verdictFor(metrics, published.length);
    if (!verdict) {
      due += 1;
      continue;
    }
    sqlite.prepare(
      `UPDATE skill_reports SET metrics = ?, verdict = ?, verdict_source = 'auto', checked_at = ?, checked_by_kind = 'operator', checked_by_name = 'auto', updated_at = ? WHERE id = ?`,
    ).run(JSON.stringify(metrics), verdict, now.toISOString(), now.toISOString(), row.id);
    if (verdict === "sai") newSai += 1;
    if (row.lesson) enqueueIndex(sqlite, { scope: "source", kind: "skill_report", sourceId: row.id });
  }
  return { due, newSai };
}
