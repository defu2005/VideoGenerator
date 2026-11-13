import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LLM_TASKS } from "../src/index.js";
import {
  aggregateModelTaskStats,
  averageSwapped,
  decideEvalRun,
  gradeBanned,
  gradeDiacritics,
  gradeExact,
  gradeLength,
  gradePlanted,
  gradeRequiredKeys,
  gradeSchema,
  gradeTool,
  planJudge,
  shouldStopForQuota,
} from "../src/modelEval/engine.js";
import { EvalSuiteSchema, buildEvalSuites } from "../src/modelEval/suites.js";
import { TASK_ABILITIES } from "../src/providerIntel/routing.js";

const suiteDir = join(dirname(fileURLToPath(import.meta.url)), "../src/modelEval/suites");

describe("model eval", () => {
  it("grades one deterministic case of each kind", () => {
    expect(gradeSchema({ ok: true }).pass).toBe(true);
    expect(gradeSchema("no").pass).toBe(false);
    expect(gradeRequiredKeys({ title: "A" }, ["title"]).pass).toBe(true);
    expect(gradeLength("xin chào bạn", 4, 20).pass).toBe(true);
    expect(gradeDiacritics("Xin chào Việt Nam", 0.05).pass).toBe(true);
    expect(gradeBanned("một câu bình thường", ["bạn sẽ sốc"]).pass).toBe(true);
    expect(gradeBanned("bạn sẽ sốc khi xem", ["bạn sẽ sốc"]).pass).toBe(false);
    expect(gradeExact({ label: "câu hỏi" }, { label: "câu hỏi" }).pass).toBe(true);
    expect(gradePlanted(["năm sai"], ["năm sai"]).pass).toBe(true);
    expect(gradeTool({ name: "list_projects", args: { page: 1 } }, { name: "list_projects", args: { page: 1 } }).pass).toBe(true);
  });

  it("never lets a model judge itself and swaps order", () => {
    const plan = planJudge({ candidateModel: "candidate", incumbentModel: "current", judges: ["candidate", "judge-b"] });
    expect(plan?.judge).toBe("judge-b");
    expect(plan?.orders).toEqual([["candidate", "current"], ["current", "candidate"]]);
    expect(averageSwapped([80, 60])).toBe(70);
    expect(planJudge({ candidateModel: "only", incumbentModel: "other", judges: ["only"] })).toBeNull();
  });

  it("runs free quota directly and holds paid, over-cap, and cookie runs", () => {
    expect(decideEvalRun({
      models: [{ id: "free", paid: false, cookie: false, quotaLeft: 0.4 }],
      estimatedCalls: 10,
      maxCalls: 80,
    }).action).toBe("run");
    expect(decideEvalRun({
      models: [{ id: "paid", paid: true, cookie: false, quotaLeft: 1 }],
      estimatedCalls: 4,
      maxCalls: 80,
    }).action).toBe("pending");
    expect(decideEvalRun({
      models: [{ id: "free", paid: false, cookie: false, quotaLeft: 1 }],
      estimatedCalls: 90,
      maxCalls: 80,
    }).action).toBe("pending");
    expect(decideEvalRun({
      models: [{ id: "cookie", paid: false, cookie: true, quotaLeft: 1 }],
      estimatedCalls: 2,
      maxCalls: 80,
    }).action).toBe("refused");
    expect(shouldStopForQuota(0.05)).toBe(true);
    expect(shouldStopForQuota(0.4)).toBe(false);
  });

  it("attributes quality to the producing model and sets confidence from n", () => {
    const rows = aggregateModelTaskStats([
      { task: "script", provider: "p", model: "writer", ok: true, schemaValid: true, fallback: false, latencyMs: 100, tokens: 20, costUsd: 0, day: "2026-11-05", retries: 0 },
      { task: "script", provider: "p", model: "writer", ok: false, schemaValid: false, fallback: true, fallbackReason: "quota", latencyMs: 300, tokens: 40, costUsd: 0, day: "2026-11-05", retries: 1 },
      { task: "scriptReview", provider: "p", model: "reviewer", ok: true, schemaValid: true, fallback: false, day: "2026-11-05" },
    ], [
      { task: "script", provider: "p", model: "writer", kind: "scriptReview", value: 8 },
    ]);
    const writer = rows.find((row) => row.model === "writer");
    const reviewer = rows.find((row) => row.model === "reviewer");
    expect(writer?.quality.scriptReview).toBe(8);
    expect(writer?.successRate).toBe(0.5);
    expect(writer?.confidence).toBe("low");
    expect(reviewer?.quality.scriptReview).toBeUndefined();
  });

  it("parses every suite file and maps every model task", () => {
    const suites = buildEvalSuites();
    expect(suites.length).toBeGreaterThanOrEqual(12);
    const files = readdirSync(suiteDir).filter((name) => name.endsWith(".json")).sort();
    expect(files).toEqual(suites.map((suite) => `${suite.id}.json`).sort());
    for (const suite of suites) {
      const disk = EvalSuiteSchema.parse(JSON.parse(readFileSync(join(suiteDir, `${suite.id}.json`), "utf8")));
      expect(disk).toEqual(suite);
    }
    for (const task of LLM_TASKS) expect(TASK_ABILITIES[task.id]?.abilities.length).toBeGreaterThan(0);
  });
});
