import { randomUUID } from "node:crypto";
import { containsProtectedProject, gradeCase, listEvalSuites, redactExportText } from "@vg/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { AppConfig } from "../lib/config.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";

const ModelRef = z.object({ provider: z.string().min(1).max(80), model: z.string().min(1).max(160) }).strict();
export const CompareModelsInput = z.object({ suiteId: z.string(), baseline: ModelRef, candidate: ModelRef }).strict();
const EvalOutput = z.object({ output: z.json() }).strict();

type CaseResult = {
  caseId: string;
  quality: number;
  schemaValid: boolean;
  tokens: number | null;
  costUsd: number | null;
  latencyMs: number;
};

function summarize(cases: CaseResult[]) {
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    cases: cases.length,
    quality: mean(cases.map((item) => item.quality)),
    schemaErrorRate: mean(cases.map((item) => item.schemaValid ? 0 : 1)),
    averageLatencyMs: mean(cases.map((item) => item.latencyMs)),
    totalTokens: cases.some((item) => item.tokens === null) ? null : cases.reduce((sum, item) => sum + (item.tokens ?? 0), 0),
    estimatedCostUsd: cases.some((item) => item.costUsd === null) ? null : cases.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
  };
}

export async function compareModels(
  sqlite: Database.Database, registry: LlmProviderRegistry, config: AppConfig,
  input: z.output<typeof CompareModelsInput>,
) {
  if (containsProtectedProject(input)) throw new AppError(403, "TOOL_BLOCKED", "Dự án này bị từ chối.");
  const suite = listEvalSuites().find((item) => item.id === input.suiteId);
  if (!suite || suite.taskId === "visionCheck") {
    throw new AppError(400, "EVAL_SUITE_UNSUPPORTED", "Hãy chọn bộ mẫu văn bản có sẵn.");
  }
  if (input.baseline.provider === input.candidate.provider && input.baseline.model === input.candidate.model) {
    throw new AppError(400, "EVAL_IDENTICAL_MODELS", "Chọn hai model khác nhau để so sánh.");
  }
  const limitRow = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'providerIntel.maxCallsPerRun'")
    .get() as { value: string } | undefined;
  const maxCalls = limitRow ? Number(limitRow.value) : 80;
  if (!Number.isFinite(maxCalls) || suite.cases.length * 2 > maxCalls) {
    throw new AppError(409, "EVAL_BUDGET_EXCEEDED", "Số lượt của bộ mẫu vượt giới hạn đánh giá.");
  }
  const models = [input.baseline, input.candidate];
  const routes = models.map((ref) => {
    const resolved = registry.resolveFallback(ref);
    const kind = registry.quota?.kindOf(ref.provider, ref.model);
    if (ref.provider !== "mock" && kind !== "free_tier" && kind !== "subscription") {
      throw new AppError(409, "EVAL_QUOTA_REQUIRED", "So sánh yêu cầu model có gói miễn phí hoặc thuê bao đã xác định.");
    }
    return { ...resolved, source: "app-default" as const };
  });
  const runId = randomUUID();
  const modelIds = models.map((model) => `${model.provider}/${model.model}`);
  const startedAt = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO model_eval_runs (id, suite_ids, model_ids, status, calls_used, max_calls, summary_vi, started_at)
     VALUES (?, ?, ?, 'running', 0, ?, 'Đang so sánh model', ?)`,
  ).run(runId, JSON.stringify([suite.id]), JSON.stringify(modelIds), maxCalls, startedAt);
  const results: [CaseResult[], CaseResult[]] = [[], []];
  let callsUsed = 0;
  let stopped = false;
  for (const [caseIndex, testCase] of suite.cases.entries()) {
    for (const index of caseIndex % 2 === 0 ? [0, 1] as const : [1, 0] as const) {
      const route = routes[index]!;
      const before = performance.now();
      let output: unknown;
      let schemaValid = false;
      let usage: { inputTokens: number; outputTokens: number; tokensUnknown?: boolean } | undefined;
      try {
        const generated = await generateRoutedStructured({
          registry, route, task: suite.taskId, gatewaySettings: { mode: "off", mappings: [] },
          system: `Đánh giá trên dữ liệu giả lập. ${suite.rubricVi} Trả JSON có khóa output chứa câu trả lời.`,
          prompt: JSON.stringify(testCase.input), schema: EvalOutput, schemaName: "RouteComparison",
          schemaVersion: "1", maxOutputTokens: 2048, repairAttempts: 0,
          signal: AbortSignal.timeout(30_000),
        });
        output = generated.value.output;
        usage = generated.usage;
        callsUsed += generated.usage.llmCalls;
        schemaValid = true;
      } catch (error) {
        if (error instanceof LlmError) {
          usage = error.usage;
          callsUsed += error.usage?.llmCalls ?? 0;
          if (error.code !== "LLM_INVALID_OUTPUT" && error.code !== "LLM_OUTPUT_TRUNCATED") stopped = true;
        } else stopped = true;
      }
      const grades = schemaValid ? gradeCase(testCase, output) : [];
      schemaValid &&= grades.filter((grade) => grade.id === "schema" || grade.id === "requiredKeys").every((grade) => grade.pass);
      const metrics = {
        caseId: testCase.id, schemaValid,
        quality: grades.length ? grades.filter((grade) => grade.pass).length / grades.length : 0,
        tokens: usage && !usage.tokensUnknown ? usage.inputTokens + usage.outputTokens : null,
        costUsd: usage && !usage.tokensUnknown ? estimateLlmCost(config, route.provider.id, route.model, usage) : null,
        latencyMs: Math.round(performance.now() - before),
      };
      results[index].push(metrics);
      sqlite.prepare(
        `INSERT INTO model_eval_results (id, run_id, suite_id, case_id, model_id, output_json, grades_json, cached, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(randomUUID(), runId, suite.id, testCase.id, modelIds[index], JSON.stringify(metrics),
        redactExportText(JSON.stringify(grades)), new Date().toISOString());
      if (stopped) break;
    }
    if (stopped) break;
  }
  const [baseline, candidate] = results.map(summarize) as [ReturnType<typeof summarize>, ReturnType<typeof summarize>];
  const qualifies = !stopped && candidate.cases === suite.cases.length && baseline.cases === suite.cases.length
    && candidate.quality >= Math.max(0.8, baseline.quality) && candidate.schemaErrorRate <= baseline.schemaErrorRate;
  const report = { runId, suiteId: suite.id, taskId: suite.taskId, callsUsed, stopped,
    recommendation: qualifies ? "candidate_eligible" : "keep_baseline",
    baseline: { ...input.baseline, ...baseline }, candidate: { ...input.candidate, ...candidate } };
  sqlite.prepare(
    "UPDATE model_eval_runs SET status = ?, calls_used = ?, summary_vi = ?, finished_at = ? WHERE id = ?",
  ).run(stopped ? "stopped" : "done", callsUsed, JSON.stringify(report), new Date().toISOString(), runId);
  return report;
}
