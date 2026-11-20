import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { baselineFor, behaviourReason } from "./behaviourGate.js";
import { SHADOW_MIN_RUNS, shadowProgress } from "./shadow.js";
import { evaluateSkill, SKILL_EVAL_MIN_SCORE } from "./skillEval.js";
import { OPERATOR_SKILLS, parseSkillMarkdown } from "./skills.js";
import { activateSkillVersionInTx, isBehaviourExempt, shadowVersionFor, type SkillEvidence, type SkillRegistry } from "./skillVersions.js";

/**
 * TASK-074b-4: automatic activation of a shadow version, and automatic shadowing after a passed eval. Only
 * read-only skills with a baseline, that have passed a shadow run (du_mau) and the behaviour eval, and that
 * declare no more tools than the baseline. Imports only direct dependencies: no executor, runner, fleet or
 * operator service (checked by a test). Read-only checks run first; a change happens only when they all pass.
 */

export type AutoActivationResult = { activated: boolean; reasons: string[]; markdown: string | null; version: number | null };

type VersionRow = { markdown: string; evidence: string; status: string };

function loadRow(db: Database.Database, name: string, version: number): VersionRow | undefined {
  return db.prepare("SELECT markdown, evidence, status FROM operator_skill_versions WHERE name = ? AND version = ?")
    .get(name, version) as VersionRow | undefined;
}

function evidenceFiles(evidence: string): Record<string, string> {
  return (JSON.parse(evidence) as { files?: Record<string, string> }).files ?? {};
}

/** Read-only check, moved from fleet/service.ts: every declared tool is read-only and no mutating tool is named in the text. */
export function readOnlyReasons(markdown: string, files: Record<string, string>, registry: SkillRegistry): string[] {
  const parsed = parseSkillMarkdown(markdown);
  if (!parsed) return ["markdown không hợp lệ"];
  const reasons: string[] = [];
  if (!parsed.tools.every((tool) => registry.get(tool) === "read")) reasons.push("skill khai báo công cụ không chỉ đọc");
  const allText = [markdown, ...Object.values(files)].join("\n");
  const mutating = [...registry].some(([name, risk]) => risk !== "read" && new RegExp(`\\b${name}\\b`).test(allText));
  if (mutating) reasons.push("skill nhắc tới công cụ có quyền ghi");
  return reasons;
}

/**
 * Checks that do not depend on the version's status: not a built-in, read-only, a baseline no weaker in declared
 * tools, the routing score, and the behaviour eval. The eval check has no user_edit exemption: this is never the user path.
 */
function fitReasons(db: Database.Database, name: string, version: number, row: VersionRow, registry: SkillRegistry): string[] {
  const reasons: string[] = [];
  if (OPERATOR_SKILLS.some((skill) => skill.name === name && !skill.research)) reasons.push("skill có sẵn không tự kích hoạt");
  reasons.push(...readOnlyReasons(row.markdown, evidenceFiles(row.evidence), registry));
  const base = baselineFor(db, name);
  if (!base) {
    reasons.push("chưa có bản nền để so sánh");
  } else {
    const baseTools = parseSkillMarkdown(base.markdown)?.tools;
    const candTools = parseSkillMarkdown(row.markdown)?.tools ?? [];
    if (!baseTools) reasons.push("bản nền không đọc được");
    else if (!candTools.every((tool) => baseTools.includes(tool))) reasons.push("khai báo nhiều công cụ hơn bản nền");
  }
  if (evaluateSkill(row.markdown).score < SKILL_EVAL_MIN_SCORE) reasons.push(`điểm dưới ${SKILL_EVAL_MIN_SCORE}`);
  const behaviour = behaviourReason(db, name, version);
  if (behaviour) reasons.push(`eval hành vi: ${behaviour}`);
  return reasons;
}

/** Every reason the shadow version cannot be activated automatically now (empty when eligible). Reads only. */
export function autoEligibility(db: Database.Database, name: string, version: number, registry: SkillRegistry, now: Date): string[] {
  const row = loadRow(db, name, version);
  if (!row) return ["không tìm thấy phiên bản"];
  if (row.status !== "shadow") return ["bản này không còn là shadow"];
  const reasons: string[] = [];
  const progress = shadowProgress(db, name, version, now);
  if (progress.status !== "du_mau") reasons.push(`chưa đủ ${SHADOW_MIN_RUNS} lượt shadow trong 7 ngày (${progress.runs} lượt)`);
  return [...reasons, ...fitReasons(db, name, version, row, registry)];
}

/** For a draft that has just passed its behaviour eval: the reasons it must not become the shadow version (empty when it may). Reads only. */
export function autoShadowReasons(db: Database.Database, name: string, version: number, registry: SkillRegistry): string[] {
  const row = loadRow(db, name, version);
  if (!row) return ["không tìm thấy phiên bản"];
  if (row.status !== "draft") return ["chỉ bản nháp mới được đặt làm shadow tự động"];
  if (isBehaviourExempt(JSON.parse(row.evidence) as SkillEvidence)) return ["bản do người dùng tự sửa không tự đặt làm shadow"];
  return fitReasons(db, name, version, row, registry);
}

/**
 * Activates the skill's shadow version when eligible. Silent no-op (no reasons, no change) when the feature is
 * off or there is no shadow, so a second call after activation does nothing. The flip and the activation run in
 * one immediate transaction; a refusal inside it rolls the flip back and is returned as a reason.
 */
export function checkAutoActivation(
  db: Database.Database,
  name: string,
  opts: { now: Date; registry: SkillRegistry; autoEnabled: boolean },
): AutoActivationResult {
  const none: AutoActivationResult = { activated: false, reasons: [], markdown: null, version: null };
  if (!opts.autoEnabled) return none;
  try {
    return db.transaction((): AutoActivationResult => {
      const shadow = shadowVersionFor(db, name);
      if (!shadow) return none;
      const reasons = autoEligibility(db, name, shadow.version, opts.registry, opts.now);
      if (reasons.length) return { activated: false, reasons, markdown: null, version: null };
      db.prepare("UPDATE operator_skill_versions SET status = 'draft' WHERE name = ? AND version = ? AND status = 'shadow'")
        .run(name, shadow.version);
      const markdown = activateSkillVersionInTx(db, name, shadow.version, opts.registry);
      return { activated: true, reasons: [], markdown, version: shadow.version };
    }).immediate();
  } catch (err) {
    if (err instanceof AppError) return { activated: false, reasons: [err.message], markdown: null, version: null };
    throw err;
  }
}
