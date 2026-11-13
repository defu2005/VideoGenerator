import { containsProtectedProject, redactExportText } from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { evaluateSkill, SKILL_EVAL_MIN_SCORE, type SkillEvalResult } from "./skillEval.js";
import { parseSkillMarkdown, validateSkillMarkdown } from "./skills.js";

export type SkillEvidence = {
  source: "repeated_failure" | "user_review" | "user_edit" | "agent_proposal"; runIds: string[];
  /** agent_proposal only: who proposed it and why (shown in the skills view). */
  caller?: string; reason?: string;
};
export type SkillVersion = {
  name: string; version: number; markdown: string; evidence: SkillEvidence;
  score: number; status: "draft" | "active" | "archived";
};
export type SkillVersionView = SkillVersion & { evaluation: SkillEvalResult; activeScore: number | null };
export type SkillRegistry = ReadonlyMap<string, "read" | "safe" | "confirm">;
const riskRank = { read: 0, safe: 1, confirm: 2 } as const;

function checkSkill(markdown: string, registry: SkillRegistry): string {
  const errors = validateSkillMarkdown(markdown, new Set(registry.keys()));
  const parsed = parseSkillMarkdown(markdown);
  if (!parsed || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(parsed.name)) errors.push("Tên skill không hợp lệ.");
  if (parsed && parsed.tools.some((tool) => (riskRank[registry.get(tool) ?? "confirm"]) >
      (riskRank[parsed.risk as keyof typeof riskRank] ?? -1))) errors.push("Quyền khai báo thấp hơn quyền của công cụ.");
  if (markdown.length > 12_000 || containsProtectedProject(markdown) || redactExportText(markdown) !== markdown) {
    errors.push("Skill chứa dữ liệu nhạy cảm hoặc vượt giới hạn.");
  }
  if (errors.length || !parsed) throw new AppError(400, "INVALID_OPERATOR_SKILL", errors.join(" "));
  return parsed.name;
}

export function saveSkillDraft(db: Database.Database, markdown: string, evidence: SkillEvidence, registry: SkillRegistry) {
  const name = checkSkill(markdown, registry);
  return db.transaction(() => {
    const latest = db.prepare(
      "SELECT version, markdown, status FROM operator_skill_versions WHERE name = ? ORDER BY version DESC LIMIT 1",
    ).get(name) as { version: number; markdown: string; status: SkillVersion["status"] } | undefined;
    if (latest?.markdown === markdown || (evidence.source === "repeated_failure" && latest?.status === "draft")) {
      return { name, version: latest!.version };
    }
    if (evidence.source === "repeated_failure" || evidence.source === "agent_proposal") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const row = db.prepare("SELECT count(*) AS total FROM operator_skill_versions WHERE created_at >= ?")
        .get(since) as { total: number };
      if (row.total >= 10) return null;
    }
    const version = (latest?.version ?? 0) + 1;
    const { score } = evaluateSkill(markdown);
    db.prepare(
      "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?)",
    ).run(name, version, markdown, JSON.stringify(evidence), score, new Date().toISOString());
    return { name, version };
  }).immediate();
}

export function listSkillVersions(db: Database.Database, activeOnly = false): SkillVersion[] {
  const rows = db.prepare(
    `SELECT name, version, markdown, evidence, score, status FROM operator_skill_versions
     ${activeOnly ? "WHERE status = 'active'" : ""} ORDER BY created_at DESC, version DESC LIMIT 100`,
  ).all() as Array<Omit<SkillVersion, "evidence"> & { evidence: string }>;
  return rows.map((row) => ({ ...row, evidence: JSON.parse(row.evidence) as SkillEvidence }));
}

/** Adds the scenario results and the active version's score so a draft can be compared before approval. */
export function listSkillVersionViews(db: Database.Database): SkillVersionView[] {
  const versions = listSkillVersions(db);
  const active = new Map(versions.filter((item) => item.status === "active").map((item) => [item.name, item.score]));
  return versions.map((item) => ({ ...item, evaluation: evaluateSkill(item.markdown), activeScore: active.get(item.name) ?? null }));
}

export function activateSkillVersion(db: Database.Database, name: string, version: number, registry: SkillRegistry): string {
  return db.transaction(() => {
    const row = db.prepare("SELECT markdown, status FROM operator_skill_versions WHERE name = ? AND version = ?")
      .get(name, version) as { markdown: string; status: string } | undefined;
    if (!row) throw new AppError(404, "SKILL_VERSION_NOT_FOUND", "Không tìm thấy phiên bản skill.");
    if (checkSkill(row.markdown, registry) !== name) throw new AppError(409, "SKILL_NAME_MISMATCH", "Tên skill không khớp.");
    const { score } = evaluateSkill(row.markdown);
    if (score < SKILL_EVAL_MIN_SCORE) {
      throw new AppError(409, "SKILL_EVAL_FAILED",
        `Skill chỉ đạt ${score}/100 trong bộ tình huống, cần ít nhất ${SKILL_EVAL_MIN_SCORE}. Sửa điều kiện kích hoạt rồi thử lại.`);
    }
    db.prepare("UPDATE operator_skill_versions SET score = ? WHERE name = ? AND version = ?").run(score, name, version);
    db.prepare("UPDATE operator_skill_versions SET status = 'archived' WHERE name = ? AND status = 'active'").run(name);
    db.prepare("UPDATE operator_skill_versions SET status = 'active' WHERE name = ? AND version = ?").run(name, version);
    return row.markdown;
  }).immediate();
}
