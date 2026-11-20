import { containsProtectedProject, redactExportText } from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { evaluateSkill, SKILL_EVAL_MIN_SCORE, type SkillEvalResult } from "./skillEval.js";
import { OPERATOR_SKILLS, parseSkillMarkdown, validateSkillMarkdown } from "./skills.js";
import { consumeSelfImprovementBudget } from "./autonomyBudget.js";
import { findBannedPhrase, findLongQuote, MAX_QUOTED_WORDS } from "./skillDraftChecks.js";
import { behaviourReason } from "./behaviourGate.js";

export type SkillEvidence = {
  source: "repeated_failure" | "user_review" | "user_edit" | "agent_proposal" | "pattern" | "research" | "change_event" | "outcome" | "improvement"; runIds: string[];
  /** agent_proposal only: who proposed it and why (shown in the skills view). */
  caller?: string; reason?: string;
  sourceKind?: string; sourceInstance?: string; parentVersion?: number;
  files?: Record<string, string>;
};
export type SkillVersion = {
  name: string; version: number; markdown: string; evidence: SkillEvidence;
  score: number; status: "draft" | "active" | "archived" | "needs_merge" | "shadow";
};
export type SkillVersionView = SkillVersion & { evaluation: SkillEvalResult; activeScore: number | null };
export type SkillRegistry = ReadonlyMap<string, "read" | "safe" | "confirm">;
const riskRank = { read: 0, safe: 1, confirm: 2 } as const;

function checkSkill(markdown: string, registry: SkillRegistry): string {
  const errors = validateSkillMarkdown(markdown, new Set(registry.keys()));
  const parsed = parseSkillMarkdown(markdown);
  if (parsed && OPERATOR_SKILLS.some((skill) => skill.name === parsed.name && skill.research) && !parsed.research) errors.push("Skill nghiên cứu phải giữ metadata kind/question/outputKinds.");
  if (!parsed || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(parsed.name)) errors.push("Tên skill không hợp lệ.");
  if (parsed && parsed.tools.some((tool) => (riskRank[registry.get(tool) ?? "confirm"]) >
      (riskRank[parsed.risk as keyof typeof riskRank] ?? -1))) errors.push("Quyền khai báo thấp hơn quyền của công cụ.");
  if (markdown.length > 12_000 || containsProtectedProject(markdown) || redactExportText(markdown) !== markdown) {
    errors.push("Skill chứa dữ liệu nhạy cảm hoặc vượt giới hạn.");
  }
  if (errors.length || !parsed) throw new AppError(400, "INVALID_OPERATOR_SKILL", errors.join(" "));
  return parsed.name;
}

/** Draft-only static checks (TASK-074b-1). Run in saveSkillDraft, not in checkSkill, so activation rules stay unchanged. */
function checkDraftText(markdown: string) {
  const errors: string[] = [];
  const banned = findBannedPhrase(markdown);
  if (banned) errors.push(`Skill chứa nội dung bị cấm (${banned.rule}): "${banned.phrase}".`);
  const longQuote = findLongQuote(markdown);
  if (longQuote) errors.push(`Trích dẫn dài ${longQuote.words} từ, quá ${MAX_QUOTED_WORDS} từ: "${longQuote.span.slice(0, 80)}".`);
  if (errors.length) throw new AppError(400, "INVALID_OPERATOR_SKILL", errors.join(" "));
}

export const SKILL_EVIDENCE_SOURCES: ReadonlyArray<SkillEvidence["source"]> = [
  "repeated_failure", "user_review", "user_edit", "agent_proposal", "pattern", "research", "change_event", "outcome", "improvement",
];

export function saveSkillDraft(db: Database.Database, markdown: string, evidence: SkillEvidence, registry: SkillRegistry) {
  if (!SKILL_EVIDENCE_SOURCES.includes(evidence.source)) throw new AppError(400, "INVALID_SKILL_EVIDENCE", `Nguồn bằng chứng không hợp lệ: ${String(evidence.source)}.`);
  const name = checkSkill(markdown, registry);
  checkDraftText(markdown);
  return db.transaction(() => {
    const latest = db.prepare(
      "SELECT version, markdown, status, evidence FROM operator_skill_versions WHERE name = ? ORDER BY version DESC LIMIT 1",
    ).get(name) as { version: number; markdown: string; status: SkillVersion["status"]; evidence: string } | undefined;
    const previousEvidence = latest ? JSON.parse(latest.evidence) as SkillEvidence : undefined;
    if ((latest?.markdown === markdown && previousEvidence?.sourceInstance === evidence.sourceInstance
      && previousEvidence?.parentVersion === evidence.parentVersion && JSON.stringify(previousEvidence?.files ?? {}) === JSON.stringify(evidence.files ?? {}))
      || (evidence.source === "repeated_failure" && latest?.status === "draft")) {
      return { name, version: latest!.version };
    }
    if (evidence.source === "repeated_failure" || evidence.source === "agent_proposal") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const row = db.prepare("SELECT count(*) AS total FROM operator_skill_versions WHERE created_at >= ?")
        .get(since) as { total: number };
      if (row.total >= 10) return null;
    }
    const version = (latest?.version ?? 0) + 1;
    if (parseSkillMarkdown(markdown)?.research) consumeSelfImprovementBudget(db, "skillDrafts", { manual: evidence.source === "user_edit" || evidence.source === "user_review" });
    const { score } = evaluateSkill(markdown);
    const active = db.prepare("SELECT version FROM operator_skill_versions WHERE name=? AND status='active'").get(name) as { version: number } | undefined;
    const status = evidence.sourceInstance && (active?.version ?? null) !== (evidence.parentVersion ?? null) ? "needs_merge" : "draft";
    db.prepare(
      "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(name, version, markdown, JSON.stringify(evidence), score, status, new Date().toISOString());
    return { name, version, status };
  }).immediate();
}

export function listSkillVersions(db: Database.Database, activeOnly = false): SkillVersion[] {
  const rows = db.prepare(
    `SELECT name, version, markdown, evidence, score, status FROM operator_skill_versions
     ${activeOnly ? "WHERE status = 'active'" : ""} ORDER BY created_at DESC, version DESC ${activeOnly ? "" : "LIMIT 100"}`,
  ).all() as Array<Omit<SkillVersion, "evidence"> & { evidence: string }>;
  return rows.map((row) => ({ ...row, evidence: JSON.parse(row.evidence) as SkillEvidence }));
}

/** Adds the scenario results and the active version's score so a draft can be compared before approval. */
export function listSkillVersionViews(db: Database.Database): SkillVersionView[] {
  const versions = listSkillVersions(db);
  const active = new Map(versions.filter((item) => item.status === "active").map((item) => [item.name, item.score]));
  return versions.map((item) => ({ ...item, evaluation: evaluateSkill(item.markdown), activeScore: active.get(item.name) ?? null }));
}

/**
 * TASK-074b-3a: marks a draft as the one shadow version of its skill. The shadow status is the marker
 * (no migration). TASK-074b-3b: a displaced shadow goes back to draft (it is not archived: it was never
 * active). A shadow is never active and never runs.
 */
export function markShadowVersion(db: Database.Database, name: string, version: number): void {
  db.transaction(() => {
    const row = db.prepare("SELECT status FROM operator_skill_versions WHERE name = ? AND version = ?")
      .get(name, version) as { status: string } | undefined;
    if (!row) throw new AppError(404, "SKILL_VERSION_NOT_FOUND", "Không tìm thấy phiên bản skill.");
    if (row.status !== "draft") throw new AppError(409, "SKILL_NOT_DRAFT", "Chỉ bản nháp mới có thể đặt làm shadow.");
    db.prepare("UPDATE operator_skill_versions SET status = 'draft' WHERE name = ? AND status = 'shadow'").run(name);
    db.prepare("UPDATE operator_skill_versions SET status = 'shadow' WHERE name = ? AND version = ?").run(name, version);
  }).immediate();
}

/** The skill's shadow version and its active version number (null when none is active). */
export function shadowVersionFor(db: Database.Database, name: string): { version: number; markdown: string; activeVersion: number | null } | null {
  const shadow = db.prepare("SELECT version, markdown FROM operator_skill_versions WHERE name = ? AND status = 'shadow'")
    .get(name) as { version: number; markdown: string } | undefined;
  if (!shadow) return null;
  const active = db.prepare("SELECT version FROM operator_skill_versions WHERE name = ? AND status = 'active'")
    .get(name) as { version: number } | undefined;
  return { version: shadow.version, markdown: shadow.markdown, activeVersion: active?.version ?? null };
}

/** Turns the shadow version back into a draft. */
export function clearShadowVersion(db: Database.Database, name: string): number {
  return db.prepare("UPDATE operator_skill_versions SET status = 'draft' WHERE name = ? AND status = 'shadow'").run(name).changes;
}

/** TASK-074b-4: a draft the user wrote themselves (user_edit) skips the behaviour gate on the user path. */
export function isBehaviourExempt(evidence: SkillEvidence): boolean {
  return evidence.source === "user_edit";
}

/**
 * Activation core with no transaction of its own, so the auto path (autoActivation.ts) can run it inside its
 * own immediate transaction. Gates in order: needs_merge, shadow, name, routing score, then the behaviour
 * eval (drafts only, unless exempt). Archived versions (rollback) skip the behaviour gate.
 */
export function activateSkillVersionInTx(db: Database.Database, name: string, version: number, registry: SkillRegistry): string {
  const row = db.prepare("SELECT markdown, status, evidence FROM operator_skill_versions WHERE name = ? AND version = ?")
    .get(name, version) as { markdown: string; status: string; evidence: string } | undefined;
  if (!row) throw new AppError(404, "SKILL_VERSION_NOT_FOUND", "Không tìm thấy phiên bản skill.");
  if (row.status === "needs_merge") throw new AppError(409, "SKILL_NEEDS_MERGE", "Bản nháp dựa trên phiên bản cũ. Gộp thay đổi thành bản nháp mới trước khi kích hoạt.");
  if (row.status === "shadow") throw new AppError(409, "SKILL_IS_SHADOW", "Bản shadow chỉ ghi nhận lượt định tuyến, không thể kích hoạt.");
  if (checkSkill(row.markdown, registry) !== name) throw new AppError(409, "SKILL_NAME_MISMATCH", "Tên skill không khớp.");
  const { score, reason: evalReason } = evaluateSkill(row.markdown);
  if (score < SKILL_EVAL_MIN_SCORE) {
    throw new AppError(409, "SKILL_EVAL_FAILED",
      `Skill chỉ đạt ${score}/100 trong bộ tình huống, cần ít nhất ${SKILL_EVAL_MIN_SCORE}${evalReason ? ` (${evalReason})` : ""}. Sửa điều kiện kích hoạt rồi thử lại.`);
  }
  if (row.status === "draft" && !isBehaviourExempt(JSON.parse(row.evidence) as SkillEvidence)) {
    const reason = behaviourReason(db, name, version);
    if (reason) throw new AppError(409, "SKILL_BEHAVIOUR_NOT_PASSED", `Chưa kích hoạt được bản nháp này: ${reason}. Chạy eval hành vi và đạt trước khi kích hoạt.`);
  }
  db.prepare("UPDATE operator_skill_versions SET score = ? WHERE name = ? AND version = ?").run(score, name, version);
  db.prepare("UPDATE operator_skill_versions SET status = 'archived' WHERE name = ? AND status = 'active'").run(name);
  db.prepare("UPDATE operator_skill_versions SET status = 'active' WHERE name = ? AND version = ?").run(name, version);
  return row.markdown;
}

export function activateSkillVersion(db: Database.Database, name: string, version: number, registry: SkillRegistry): string {
  return db.transaction(() => activateSkillVersionInTx(db, name, version, registry)).immediate();
}
