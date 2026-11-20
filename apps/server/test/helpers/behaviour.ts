import type Database from "better-sqlite3";
import { storeBehaviourEval, type BehaviourEvalResult } from "../../src/operator/behaviourGate.js";

/**
 * Stores a behaviour eval result for one version, in the same shape runBehaviourEval writes. Tests that are not
 * about the eval itself use this instead of a fake LLM. Pass `passed: false` to store a failed result.
 * The wiring test runs the real runBehaviourEval against a fake model, so this shape is checked there too.
 */
export function storePassingBehaviourEval(
  db: Database.Database,
  name: string,
  version: number,
  opts: { baseline: BehaviourEvalResult["baseline"]; activeVersion: number | null; passed?: boolean },
): void {
  const passed = opts.passed ?? true;
  const result: BehaviourEvalResult = {
    ranAt: new Date().toISOString(),
    baseline: opts.baseline,
    activeVersion: opts.activeVersion,
    scenarios: [],
    hardFailures: [],
    rubric: { criteria: [], passScore: 0.7 },
    score: passed ? 0.9 : 0.2,
    activeScore: opts.baseline === "none" ? null : 0.5,
    passed,
    judgeStatus: "ok",
    judgeModel: "fixture",
  };
  storeBehaviourEval(db, name, version, result, new Date());
}
