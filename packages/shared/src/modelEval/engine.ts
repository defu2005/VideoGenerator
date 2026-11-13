import type { EvalCase, EvalSuite } from "./suites.js";

export type GradeResult = { id: string; pass: boolean; detail: string };

const DIACRITICS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/iu;

export function diacriticsRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return 0;
  const marked = letters.filter((char) => DIACRITICS.test(char)).length;
  return marked / letters.length;
}

export function gradeSchema(output: unknown): GradeResult {
  const pass = output !== null && typeof output === "object";
  return { id: "schema", pass, detail: pass ? "JSON object" : "Không phải object" };
}

export function gradeRequiredKeys(output: unknown, keys: string[]): GradeResult {
  const record = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const missing = keys.filter((key) => record[key] === undefined);
  return { id: "requiredKeys", pass: missing.length === 0, detail: missing.length ? `Thiếu ${missing.join(", ")}` : "Đủ khóa" };
}

export function gradeLength(text: string, min: number, max: number): GradeResult {
  const length = text.trim().length;
  return { id: "length", pass: length >= min && length <= max, detail: `${length} ký tự` };
}

export function gradeDiacritics(text: string, minRatio: number): GradeResult {
  const ratio = diacriticsRatio(text);
  return { id: "vietnameseDiacritics", pass: ratio >= minRatio, detail: ratio.toFixed(2) };
}

export function gradeBanned(text: string, phrases: string[]): GradeResult {
  const hay = text.toLowerCase();
  const found = phrases.filter((phrase) => hay.includes(phrase.toLowerCase()));
  return { id: "bannedPhrases", pass: found.length === 0, detail: found.join(", ") || "không có cụm cấm" };
}

export function gradeExact(output: unknown, expected: unknown): GradeResult {
  const pass = JSON.stringify(output) === JSON.stringify(expected);
  return { id: "exact", pass, detail: pass ? "khớp" : "không khớp" };
}

export function gradePlanted(found: string[], planted: string[]): GradeResult {
  const missing = planted.filter((item) => !found.includes(item));
  return { id: "plantedErrors", pass: missing.length === 0, detail: missing.length ? `chưa thấy ${missing.join(", ")}` : "thấy đủ lỗi gài" };
}

export function gradeTool(output: { name?: string; args?: unknown }, expected: { name: string; args: Record<string, unknown> }): GradeResult {
  const pass = output.name === expected.name && JSON.stringify(output.args) === JSON.stringify(expected.args);
  return { id: "toolCall", pass, detail: pass ? "đúng công cụ" : "sai công cụ hoặc tham số" };
}

export function gradeCase(testCase: EvalCase, output: unknown): GradeResult[] {
  return testCase.graders.map((grader) => {
    if (grader.kind === "schema") return gradeSchema(output);
    if (grader.kind === "requiredKeys") return gradeRequiredKeys(output, grader.keys);
    const text = typeof output === "string" ? output : JSON.stringify(output ?? "");
    if (grader.kind === "length") return gradeLength(text, grader.min, grader.max);
    if (grader.kind === "vietnameseDiacritics") return gradeDiacritics(text, grader.minRatio);
    if (grader.kind === "bannedPhrases") return gradeBanned(text, grader.phrases);
    if (grader.kind === "exact") return gradeExact(output, grader.expected);
    if (grader.kind === "plantedErrors") {
      const found = output && typeof output === "object" && Array.isArray((output as { found?: unknown }).found)
        ? (output as { found: string[] }).found
        : [];
      return gradePlanted(found, grader.errors);
    }
    const call = output && typeof output === "object" ? output as { name?: string; args?: unknown } : {};
    return gradeTool(call, { name: grader.name, args: grader.args });
  });
}

export function planJudge(input: {
  candidateModel: string;
  incumbentModel: string;
  judges: string[];
}): { judge: string; orders: Array<[string, string]> } | null {
  const judge = input.judges.find((item) => item !== input.candidateModel && item !== input.incumbentModel)
    ?? input.judges.find((item) => item !== input.candidateModel);
  if (!judge || judge === input.candidateModel) return null;
  return {
    judge,
    orders: [
      [input.candidateModel, input.incumbentModel],
      [input.incumbentModel, input.candidateModel],
    ],
  };
}

export function averageSwapped(scores: [number, number]): number {
  return (scores[0] + scores[1]) / 2;
}

export type EvalModelGuard = {
  id: string;
  paid: boolean;
  cookie: boolean;
  quotaLeft: number | "UNKNOWN" | "exhausted";
};

export function decideEvalRun(input: {
  models: EvalModelGuard[];
  estimatedCalls: number;
  maxCalls: number;
}): { action: "run" | "pending" | "refused"; reasonVi: string } {
  if (input.models.some((model) => model.cookie)) {
    return { action: "refused", reasonVi: "Không đánh giá kết nối cookie hoặc phiên trình duyệt." };
  }
  if (input.models.some((model) => model.paid)) {
    return { action: "pending", reasonVi: `Model trả phí cần duyệt. Ước tính ${input.estimatedCalls} lượt.` };
  }
  if (input.estimatedCalls > input.maxCalls) {
    return { action: "pending", reasonVi: `Vượt trần ${input.maxCalls} lượt. Ước tính ${input.estimatedCalls} lượt.` };
  }
  if (input.models.some((model) => model.quotaLeft === "UNKNOWN" || model.quotaLeft === "exhausted" || model.quotaLeft <= 0)) {
    return { action: "pending", reasonVi: "Quota còn lại chưa rõ hoặc đã hết. Cần duyệt trước khi chạy." };
  }
  return { action: "run", reasonVi: "Model miễn phí còn quota, chạy trực tiếp." };
}

export function shouldStopForQuota(remainingRatio: number, near = 0.1): boolean {
  return remainingRatio <= near;
}

export function estimateEvalCalls(suites: EvalSuite[], modelCount: number, judgeCount: number): number {
  const cases = suites.reduce((sum, suite) => sum + suite.cases.length, 0);
  return cases * modelCount * (1 + Math.max(0, judgeCount));
}

export type TaskStatCall = {
  task: string;
  provider: string;
  model: string;
  ok: boolean;
  schemaValid?: boolean;
  retries?: number;
  fallback: boolean;
  fallbackReason?: string;
  latencyMs?: number;
  tokens?: number;
  costUsd?: number;
  day: string;
};

export type TaskStatSignal = {
  task: string;
  provider: string;
  model: string;
  kind: "scriptReview" | "guidelineCheck" | "factCheck" | "visionCheck" | "gate" | "reviewChat" | "commentAssist";
  value: number;
};

export type TaskStatRow = {
  provider: string;
  model: string;
  taskId: string;
  day: string;
  calls: number;
  successRate: number;
  schemaValidRate: number;
  retries: number;
  fallbackRate: number;
  fallbackReasons: string[];
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p50Tokens: number | null;
  p95Tokens: number | null;
  p50CostUsd: number | null;
  p95CostUsd: number | null;
  quality: Record<string, number>;
  confidence: "low" | "medium" | "high";
};

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function confidenceForN(n: number): "low" | "medium" | "high" {
  if (n < 10) return "low";
  if (n < 50) return "medium";
  return "high";
}

/** Signals must already name the model that produced the judged input. */
export function aggregateModelTaskStats(calls: TaskStatCall[], signals: TaskStatSignal[] = []): TaskStatRow[] {
  const groups = new Map<string, TaskStatCall[]>();
  for (const call of calls) {
    const key = `${call.provider}\u0000${call.model}\u0000${call.task}\u0000${call.day}`;
    const list = groups.get(key) ?? [];
    list.push(call);
    groups.set(key, list);
  }
  const rows: TaskStatRow[] = [];
  for (const [key, list] of groups) {
    const [provider, model, taskId, day] = key.split("\u0000");
    const ok = list.filter((item) => item.ok).length;
    const schemaKnown = list.filter((item) => item.schemaValid !== undefined);
    const schemaOk = schemaKnown.filter((item) => item.schemaValid).length;
    const reasons = [...new Set(list.map((item) => item.fallbackReason).filter((item): item is string => Boolean(item)))];
    const quality: Record<string, number> = {};
    const matched = signals.filter((signal) => signal.provider === provider && signal.model === model && signal.task === taskId);
    for (const signal of matched) quality[signal.kind] = signal.value;
    rows.push({
      provider: provider!,
      model: model!,
      taskId: taskId!,
      day: day!,
      calls: list.length,
      successRate: list.length ? ok / list.length : 0,
      schemaValidRate: schemaKnown.length ? schemaOk / schemaKnown.length : 0,
      retries: list.reduce((sum, item) => sum + (item.retries ?? 0), 0),
      fallbackRate: list.length ? list.filter((item) => item.fallback).length / list.length : 0,
      fallbackReasons: reasons,
      p50LatencyMs: percentile(list.map((item) => item.latencyMs).filter((item): item is number => item !== undefined), 50),
      p95LatencyMs: percentile(list.map((item) => item.latencyMs).filter((item): item is number => item !== undefined), 95),
      p50Tokens: percentile(list.map((item) => item.tokens).filter((item): item is number => item !== undefined), 50),
      p95Tokens: percentile(list.map((item) => item.tokens).filter((item): item is number => item !== undefined), 95),
      p50CostUsd: percentile(list.map((item) => item.costUsd).filter((item): item is number => item !== undefined), 50),
      p95CostUsd: percentile(list.map((item) => item.costUsd).filter((item): item is number => item !== undefined), 95),
      quality,
      confidence: confidenceForN(list.length),
    });
  }
  return rows.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.model.localeCompare(b.model));
}
