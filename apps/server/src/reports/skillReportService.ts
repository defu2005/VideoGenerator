import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { textHasSecret } from "../operator/skills.js";
import type { AgentIdentity } from "./agentIdentity.js";
import { enqueueIndex } from "../retrieval/service.js";
import { catalogDirection, readCatalogMetric } from "./metricCatalog.js";

const CLAIM_MS = 2 * 60 * 60 * 1000;
const seenAgents = new Map<string, number>();

const textField = z.string().max(4000).optional();
const metricSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseline: z.number().nullable().optional(),
  target: z.number().nullable().optional(),
  actual: z.number().nullable().optional(),
  direction: z.enum(["up", "down"]),
}).strict();

export const SaveSkillReportSchema = z.object({
  skill: z.string().trim().min(1).max(80),
  skillHash: z.string().regex(/^[a-f0-9]{8}$/),
  profileId: z.string().uuid().nullable().optional(),
  profileName: z.string().trim().max(200).optional(),
  subjects: z.object({
    projectIds: z.array(z.string()).max(50).optional(),
    publicationIds: z.array(z.string()).max(50).optional(),
    topicIds: z.array(z.string()).max(50).optional(),
  }).strict().optional(),
  startedAt: z.string().min(1).max(40),
  status: z.enum(["done", "partial", "blocked", "failed", "proposal"]),
  inputs: textField,
  decision: textField,
  hypothesis: textField,
  notes: textField,
  lesson: textField,
  actions: z.array(z.object({
    tool: z.string().min(1).max(80),
    result: z.enum(["pending_action", "done", "blocked"]),
    ref: z.string().max(80).optional(),
  }).strict()).max(50).optional(),
  metrics: z.array(metricSchema).max(12).optional(),
  checkAt: z.string().max(40).optional(),
  claimId: z.string().uuid().optional(),
  runId: z.string().max(80).optional(),
}).strict();

export type SaveSkillReportInput = z.infer<typeof SaveSkillReportSchema>;

export function claimSkillRun(
  sqlite: Database.Database,
  input: { skill: string; profileId?: string | null; agent: AgentIdentity; now?: Date },
): { ok: true; claimId: string } | { ok: false; heldBy: { kind: string; name: string; environment: string; claimedAt: string; expiresAt: string } } {
  const now = input.now ?? new Date();
  const claimedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CLAIM_MS).toISOString();
  const run = sqlite.transaction(() => {
    const row = sqlite.prepare(
      `SELECT id, agent_kind, agent_name, agent_environment, claimed_at, expires_at
       FROM skill_claims
       WHERE skill = ? AND ifnull(profile_id, '') = ifnull(?, '') AND released_at IS NULL
       ORDER BY claimed_at DESC LIMIT 1`,
    ).get(input.skill, input.profileId ?? null) as {
      id: string; agent_kind: string; agent_name: string; agent_environment: string; claimed_at: string; expires_at: string;
    } | undefined;
    if (row && row.expires_at > claimedAt) {
      const same = row.agent_kind === input.agent.kind && row.agent_name === input.agent.name && row.agent_environment === input.agent.environment;
      if (!same) {
        return { ok: false as const, heldBy: { kind: row.agent_kind, name: row.agent_name, environment: row.agent_environment, claimedAt: row.claimed_at, expiresAt: row.expires_at } };
      }
      sqlite.prepare("UPDATE skill_claims SET expires_at = ? WHERE id = ?").run(expiresAt, row.id);
      return { ok: true as const, claimId: row.id };
    }
    const id = randomUUID();
    sqlite.prepare(
      `INSERT INTO skill_claims
        (id, skill, profile_id, agent_kind, agent_name, agent_environment, claimed_at, expires_at, released_at, report_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(id, input.skill, input.profileId ?? null, input.agent.kind, input.agent.name, input.agent.environment, claimedAt, expiresAt);
    return { ok: true as const, claimId: id };
  });
  return run.immediate();
}

export function saveSkillReport(
  sqlite: Database.Database,
  input: SaveSkillReportInput,
  agent: AgentIdentity,
  appEnvironment: string,
  source: "tool" | "import" = "tool",
): { id: string } {
  const parsed = SaveSkillReportSchema.parse(input);
  const relaxed = parsed.status === "blocked" || parsed.status === "failed" || parsed.status === "proposal";
  if (!relaxed && (!parsed.hypothesis || (parsed.metrics?.length ?? 0) === 0)) {
    throw new AppError(400, "REPORT_INCOMPLETE", "Báo cáo cần giả thuyết và ít nhất một chỉ số.");
  }
  if ((parsed.metrics?.length ?? 0) > 0 && !parsed.checkAt) {
    throw new AppError(400, "REPORT_CHECK_DATE", "Báo cáo có chỉ số thì cần ngày kiểm.");
  }
  for (const [field, value] of Object.entries({
    inputs: parsed.inputs, decision: parsed.decision, hypothesis: parsed.hypothesis, notes: parsed.notes, lesson: parsed.lesson, profileName: parsed.profileName,
  })) {
    if (value && textHasSecret(value)) throw new AppError(400, "REPORT_SECRET", `Trường ${field} có dữ liệu nhạy cảm.`);
  }
  let profileName = parsed.profileName ?? null;
  if (parsed.profileId) {
    const profile = sqlite.prepare("SELECT name FROM profiles WHERE id = ?").get(parsed.profileId) as { name: string } | undefined;
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Không thấy hồ sơ.");
    profileName = profile.name;
  } else if (!profileName) {
    throw new AppError(400, "REPORT_PROFILE", "Cần hồ sơ hoặc tên hồ sơ.");
  }
  const subjects = parsed.subjects ?? {};
  const metrics = (parsed.metrics ?? []).map((metric) => {
    const direction = catalogDirection(metric.name) ?? (metric.name.startsWith("custom:") ? metric.direction : null);
    if (!direction) throw new AppError(400, "REPORT_METRIC", `Chỉ số không có trong danh mục: ${metric.name}`);
    const baseline = metric.baseline ?? readCatalogMetric(sqlite, metric.name, subjects);
    return { ...metric, direction, baseline: baseline ?? null, actual: metric.actual ?? null, target: metric.target ?? null };
  });
  const now = new Date().toISOString();
  const id = randomUUID();
  const importKey = createHash("sha256")
    .update(`${parsed.skill}|${profileName ?? ""}|${agent.name}|${agent.environment}|${parsed.startedAt}`)
    .digest("hex");
  const write = sqlite.transaction(() => {
    sqlite.prepare(
      `INSERT INTO skill_reports
        (id, created_at, updated_at, skill, skill_hash, profile_id, profile_name, subjects,
         agent_kind, agent_name, agent_model, agent_environment, app_environment, started_at, status,
         inputs, decision, hypothesis, notes, lesson, actions, metrics, check_at, verdict, verdict_source,
         checked_at, checked_by_kind, checked_by_name, run_id, claim_id, source, import_key, imported_by_kind, imported_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, now, now, parsed.skill, parsed.skillHash, parsed.profileId ?? null, profileName, JSON.stringify(subjects),
      agent.kind, agent.name, agent.model, agent.environment, appEnvironment, parsed.startedAt, parsed.status,
      parsed.inputs ?? null, parsed.decision ?? null, parsed.hypothesis ?? null, parsed.notes ?? null, parsed.lesson ?? null,
      JSON.stringify(parsed.actions ?? []), JSON.stringify(metrics), parsed.checkAt ?? null, parsed.runId ?? null, parsed.claimId ?? null,
      source, importKey, source === "import" ? agent.kind : null, source === "import" ? agent.name : null,
    );
    if (parsed.claimId) {
      sqlite.prepare(
        `UPDATE skill_claims SET released_at = ?, report_id = ?
         WHERE id = ? AND released_at IS NULL AND agent_kind = ? AND agent_name = ? AND agent_environment = ?`,
      ).run(now, id, parsed.claimId, agent.kind, agent.name, agent.environment);
    }
  });
  write.immediate();
  return { id };
}

export function completeSkillReport(
  sqlite: Database.Database,
  input: { id: string; metrics: Array<{ name: string; actual: number | null }>; verdict: "dung" | "sai" | "chua_ro"; lesson?: string },
  agent: AgentIdentity,
): { id: string } {
  const row = sqlite.prepare("SELECT metrics, verdict_source FROM skill_reports WHERE id = ?").get(input.id) as { metrics: string; verdict_source: string | null } | undefined;
  if (!row) throw new AppError(404, "REPORT_NOT_FOUND", "Không thấy báo cáo.");
  if (row.verdict_source === "user") throw new AppError(409, "REPORT_USER_VERDICT", "Kết luận của người dùng không bị ghi đè.");
  if (input.lesson && textHasSecret(input.lesson)) throw new AppError(400, "REPORT_SECRET", "Trường lesson có dữ liệu nhạy cảm.");
  const current = JSON.parse(row.metrics) as Array<{ name: string; actual: number | null }>;
  const actuals = new Map(input.metrics.map((metric) => [metric.name, metric.actual]));
  const metrics = current.map((metric) => actuals.has(metric.name) ? { ...metric, actual: actuals.get(metric.name) ?? null } : metric);
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE skill_reports
     SET metrics = ?, verdict = ?, lesson = coalesce(?, lesson), verdict_source = 'agent',
         checked_at = ?, checked_by_kind = ?, checked_by_name = ?, updated_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(metrics), input.verdict, input.lesson ?? null, now, agent.kind, agent.name, now, input.id);
  if (input.lesson) enqueueIndex(sqlite, { scope: "source", kind: "skill_report", sourceId: input.id });
  return { id: input.id };
}

export function listSkillReports(
  sqlite: Database.Database,
  filter: { skill?: string; profileId?: string; agentKind?: string; environment?: string; status?: string; verdict?: string; due?: boolean; limit?: number },
): Array<Record<string, unknown>> {
  const clauses = ["1 = 1"];
  const args: unknown[] = [];
  if (filter.skill) { clauses.push("skill = ?"); args.push(filter.skill); }
  if (filter.profileId) { clauses.push("profile_id = ?"); args.push(filter.profileId); }
  if (filter.agentKind) { clauses.push("agent_kind = ?"); args.push(filter.agentKind); }
  if (filter.environment) { clauses.push("agent_environment = ?"); args.push(filter.environment); }
  if (filter.status) { clauses.push("status = ?"); args.push(filter.status); }
  if (filter.verdict) { clauses.push("verdict = ?"); args.push(filter.verdict); }
  if (filter.due) { clauses.push("check_at <= ? AND verdict IS NULL"); args.push(new Date().toISOString().slice(0, 10)); }
  args.push(Math.min(filter.limit ?? 50, 50));
  return sqlite.prepare(
    `SELECT id, skill, skill_hash, profile_id, profile_name, status, hypothesis, verdict, check_at, agent_kind, agent_name, agent_environment, created_at
     FROM skill_reports WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
  ).all(...args) as Array<Record<string, unknown>>;
}

export function setUserVerdict(
  sqlite: Database.Database,
  input: { id: string; metrics: Array<{ name: string; actual: number | null }>; verdict: "dung" | "sai" | "chua_ro"; lesson?: string },
): { id: string } {
  const row = sqlite.prepare("SELECT metrics FROM skill_reports WHERE id = ?").get(input.id) as { metrics: string } | undefined;
  if (!row) throw new AppError(404, "REPORT_NOT_FOUND", "Không thấy báo cáo.");
  if (input.lesson && textHasSecret(input.lesson)) throw new AppError(400, "REPORT_SECRET", "Trường lesson có dữ liệu nhạy cảm.");
  const current = JSON.parse(row.metrics) as Array<{ name: string; actual: number | null }>;
  const actuals = new Map(input.metrics.map((metric) => [metric.name, metric.actual]));
  const metrics = current.map((metric) => actuals.has(metric.name) ? { ...metric, actual: actuals.get(metric.name) ?? null } : metric);
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE skill_reports SET metrics = ?, verdict = ?, lesson = ?, verdict_source = 'user',
       checked_at = ?, checked_by_kind = 'user', checked_by_name = 'user', updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(metrics), input.verdict, input.lesson ?? null, now, now, input.id);
  if (input.lesson) enqueueIndex(sqlite, { scope: "source", kind: "skill_report", sourceId: input.id });
  return { id: input.id };
}

export function releaseSkillClaim(sqlite: Database.Database, id: string): { released: boolean } {
  const result = sqlite.prepare("UPDATE skill_claims SET released_at = ? WHERE id = ? AND released_at IS NULL").run(new Date().toISOString(), id);
  return { released: result.changes > 0 };
}

export function skillReportDetail(sqlite: Database.Database, id: string): Record<string, unknown> {
  const row = sqlite.prepare("SELECT * FROM skill_reports WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new AppError(404, "REPORT_NOT_FOUND", "Không thấy báo cáo.");
  return row;
}

export function listAgents(sqlite: Database.Database): Array<Record<string, unknown>> {
  return sqlite.prepare(
    `SELECT kind, name, environment, model, first_seen_at, last_seen_at, calls,
       (SELECT COUNT(*) FROM skill_reports r
        WHERE r.agent_kind = agents.kind AND r.agent_name = agents.name AND r.agent_environment = agents.environment) AS reports
     FROM agents ORDER BY last_seen_at DESC`,
  ).all() as Array<Record<string, unknown>>;
}

export function openSkillClaims(sqlite: Database.Database): Array<Record<string, unknown>> {
  return sqlite.prepare(
    `SELECT id, skill, profile_id, agent_kind, agent_name, agent_environment, claimed_at, expires_at
     FROM skill_claims WHERE released_at IS NULL AND expires_at > ? ORDER BY claimed_at`,
  ).all(new Date().toISOString()) as Array<Record<string, unknown>>;
}

export function exportSkillReports(sqlite: Database.Database, since?: string): string {
  const rows = sqlite.prepare(
    `SELECT * FROM skill_reports WHERE (? IS NULL OR created_at >= ?) ORDER BY created_at`,
  ).all(since ?? null, since ?? null) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const { claim_id: _claim, run_id: _run, ...rest } = row;
    return JSON.stringify(rest);
  }).join("\n");
}

export function skillReportSummary(sqlite: Database.Database): Array<Record<string, unknown>> {
  const rows = sqlite.prepare(
    `SELECT skill, skill_hash, verdict, agent_kind, agent_environment, lesson, created_at, id
     FROM skill_reports ORDER BY created_at DESC`,
  ).all() as Array<{ skill: string; skill_hash: string; verdict: string | null; agent_kind: string; agent_environment: string; lesson: string | null; created_at: string; id: string }>;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.skill}:${row.skill_hash}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  return [...groups.entries()].map(([key, items]) => {
    const [skill, skillHash] = key.split(":");
    const sai = items.filter((item) => item.verdict === "sai" && item.created_at >= cutoff);
    return {
      skill,
      skillHash,
      runs: items.length,
      dung: items.filter((item) => item.verdict === "dung").length,
      sai: items.filter((item) => item.verdict === "sai").length,
      chuaRo: items.filter((item) => item.verdict === "chua_ro").length,
      lessons: items.map((item) => item.lesson).filter(Boolean).slice(0, 5),
      review: sai.length >= 3,
      saiIds: sai.map((item) => item.id),
    };
  });
}

export function noteAgentSeen(sqlite: Database.Database, agent: AgentIdentity, at = new Date()): void {
  const key = `${agent.kind}|${agent.name}|${agent.environment}`;
  const last = seenAgents.get(key) ?? 0;
  if (at.getTime() - last < 60_000) return;
  seenAgents.set(key, at.getTime());
  const stamp = at.toISOString();
  sqlite.prepare(
    `INSERT INTO agents (id, kind, name, environment, model, first_seen_at, last_seen_at, calls)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(kind, name, environment) DO UPDATE SET
       model = excluded.model, last_seen_at = excluded.last_seen_at, calls = calls + 1`,
  ).run(randomUUID(), agent.kind, agent.name, agent.environment, agent.model, stamp, stamp);
}
