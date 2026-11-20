import type Database from "better-sqlite3";
import type { BehaviourVerdict } from "./skillBehaviourEval.js";
import type { SkillScenario } from "./skillEval.js";
import { OPERATOR_SKILLS, renderSkillMarkdown } from "./skills.js";

/**
 * TASK-074b-4 leaf module: the behaviour-eval storage and the gates that read it. It imports no tool
 * registry, executor, runner or child process, so the activation code can import it without a cycle.
 * skillBehaviourEval.ts re-exports these names, so existing imports keep working.
 */

export type HardLaw = "a" | "b" | "c" | "d";
export type HardFailure = { law: HardLaw; tool: string };

export type ScenarioOutcome = {
  id: string;
  request: string;
  expect: SkillScenario["expect"];
  hardFailures: HardFailure[];
  verdict: BehaviourVerdict | null;
  score: number;
};

export type BehaviourEvalResult = {
  ranAt: string;
  /** Which baseline was used: the active DB row, the built-in skill, or none. Null activeScore alone does not tell these apart. */
  baseline: "active" | "builtin" | "none";
  activeVersion: number | null;
  scenarios: ScenarioOutcome[];
  hardFailures: HardFailure[];
  rubric: { criteria: readonly string[]; passScore: number };
  /** Candidate score 0..1, or null when the candidate failed a hard rule or the judge was unavailable. */
  score: number | null;
  /** Baseline score 0..1, or null when there is no baseline. */
  activeScore: number | null;
  passed: boolean;
  /** "ok": judge ran or was not needed; "unavailable": judge failed; "insufficient": fewer than 3 scenarios, or no trigger (no pick scenario). */
  judgeStatus: "ok" | "unavailable" | "insufficient";
  judgeModel: string | null;
};

export function behaviourEvalKey(name: string, version: number): string {
  return `operator.behaviourEval.${name}.v${version}`;
}

export type ShadowGateCode = "SKILL_NO_BASELINE" | "SKILL_BEHAVIOUR_NOT_RUN" | "SKILL_BEHAVIOUR_NOT_PASSED";

/**
 * TASK-074b-3b gate for setting a version as shadow. Returns the refusal, or null when it may proceed.
 * Order: no baseline, then no stored result, then a result that did not pass or is stale.
 * Stale means the baseline kind or active version now differs from what the stored result compared against.
 */
export function shadowGateRefusal(input: {
  baseline: { version: number | null } | null;
  result: BehaviourEvalResult | null;
}): { code: ShadowGateCode; message: string } | null {
  const kind = input.baseline === null ? "none" : input.baseline.version === null ? "builtin" : "active";
  if (kind === "none") {
    return { code: "SKILL_NO_BASELINE", message: "Skill chưa có bản nền để so sánh, không thể đặt làm shadow." };
  }
  if (!input.result) {
    return { code: "SKILL_BEHAVIOUR_NOT_RUN", message: "Chưa chạy eval hành vi cho bản này. Chạy eval trước khi đặt làm shadow." };
  }
  const result = input.result;
  if (result.judgeStatus !== "ok" || !result.passed) {
    return { code: "SKILL_BEHAVIOUR_NOT_PASSED", message: "Bản này chưa đạt eval hành vi, không thể đặt làm shadow." };
  }
  if (result.baseline !== kind || result.activeVersion !== (input.baseline?.version ?? null)) {
    return { code: "SKILL_BEHAVIOUR_NOT_PASSED", message: "Kết quả eval cũ so với bản đang dùng khác. Chạy eval lại trước khi đặt làm shadow." };
  }
  return null;
}

export type BehaviourEvalState =
  | { state: "missing" }
  | { state: "corrupt" }
  | { state: "ok"; result: BehaviourEvalResult };

/**
 * TASK-152 Việc 2: tells a missing row from a corrupt one. A corrupt row must not throw into the activation
 * path, and is never read as a result (fail closed).
 */
export function readBehaviourEvalState(db: Database.Database, name: string, version: number): BehaviourEvalState {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(behaviourEvalKey(name, version)) as
    | { value: string }
    | undefined;
  if (!row) return { state: "missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    parsed = undefined;
  }
  // A value that parses but is not an object (the literal null, an array, a number) is corrupt too.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(`[behaviourGate] corrupt eval row ${behaviourEvalKey(name, version)}; treating as no result`);
    return { state: "corrupt" };
  }
  return { state: "ok", result: parsed as BehaviourEvalResult };
}

/** Reads the stored result written by runBehaviourEval. Returns null when the row is missing or corrupt. */
export function readBehaviourEval(db: Database.Database, name: string, version: number): BehaviourEvalResult | null {
  const state = readBehaviourEvalState(db, name, version);
  return state.state === "ok" ? state.result : null;
}

export function storeBehaviourEval(db: Database.Database, name: string, version: number, result: BehaviourEvalResult, now: Date): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(behaviourEvalKey(name, version), JSON.stringify(result), now.toISOString());
}

/**
 * The baseline: the active DB row, else the built-in skill. Repo skills are not covered yet (see report).
 * Exported for the TASK-074b-3b gate, which must see the same baseline the eval used.
 */
export function baselineFor(db: Database.Database, name: string): { version: number | null; markdown: string } | null {
  const active = db.prepare("SELECT version, markdown FROM operator_skill_versions WHERE name = ? AND status = 'active'").get(name) as
    | { version: number; markdown: string }
    | undefined;
  if (active) return { version: active.version, markdown: active.markdown };
  const builtin = OPERATOR_SKILLS.find((skill) => skill.name === name);
  return builtin ? { version: null, markdown: renderSkillMarkdown(builtin) } : null;
}

/**
 * TASK-074b-4: why a stored eval does not allow a version to be activated, or null when it does. The result
 * must have passed, been judged, and be for the active version that is current now (null matches no active row).
 */
export function behaviourReason(db: Database.Database, name: string, version: number): string | null {
  const stored = readBehaviourEvalState(db, name, version);
  if (stored.state === "missing") return "chưa chạy eval hành vi";
  if (stored.state === "corrupt") return "eval hành vi không đọc được: chạy lại eval hành vi";
  const result = stored.result;
  if (result.judgeStatus === "unavailable") return "judge chưa sẵn sàng: chạy lại eval hành vi";
  if (result.judgeStatus === "insufficient") return "eval hành vi chưa đủ tình huống (cần ít nhất 3, trong đó có tình huống kích hoạt skill; skill chưa có trigger thì chưa eval được)";
  if (!result.passed) return "chưa qua eval hành vi";
  const baseline = baselineFor(db, name);
  const kind = baseline === null ? "none" : baseline.version === null ? "builtin" : "active";
  if (result.baseline !== kind || result.activeVersion !== (baseline?.version ?? null)) return "kết quả eval cũ (bản đang dùng đã đổi)";
  return null;
}
