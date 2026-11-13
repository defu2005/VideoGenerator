import type { BudgetMode } from "../budget/modes.js";
import type { LlmTaskId } from "../schemas/llm.js";
import { LLM_TASKS } from "../schemas/llm.js";
import type { AbilityName, BenchmarkResult } from "../schemas/providerIntel.js";

export type TaskNeed = {
  abilities: AbilityName[];
  minContext: number;
  capabilities: string[];
};

const writing: AbilityName[] = ["vietnamese_writing", "creativity_storytelling", "instruction_following"];
const jsonTask: AbilityName[] = ["structured_output", "instruction_following"];
const vision: AbilityName[] = ["vision_detail", "vision_ocr"];

export const TASK_ABILITIES: Record<LlmTaskId, TaskNeed> = {
  retrievalEmbed: { abilities: ["vietnamese_understanding"], minContext: 0, capabilities: ["embeddings"] },
  research: { abilities: ["vietnamese_understanding", "fact_accuracy", "summarisation", "long_context"], minContext: 16000, capabilities: ["json"] },
  script: { abilities: writing, minContext: 16000, capabilities: ["json"] },
  scriptReview: { abilities: ["vietnamese_writing", "instruction_following", "fact_accuracy"], minContext: 16000, capabilities: ["json"] },
  guidelineCheck: { abilities: ["instruction_following", "classification"], minContext: 8000, capabilities: ["json"] },
  factCheck: { abilities: ["fact_accuracy", "vietnamese_understanding"], minContext: 16000, capabilities: ["json"] },
  sceneQueries: { abilities: jsonTask, minContext: 8000, capabilities: ["json"] },
  visualAltQueries: { abilities: jsonTask, minContext: 4000, capabilities: ["json"] },
  visualRerank: { abilities: ["classification"], minContext: 4000, capabilities: ["json"] },
  visionCheck: { abilities: vision, minContext: 4000, capabilities: ["vision", "json"] },
  visionResearch: { abilities: ["vision_detail", "instruction_following"], minContext: 4000, capabilities: ["json"] },
  visionConsistency: { abilities: vision, minContext: 8000, capabilities: ["vision", "json"] },
  webImageGrounding: { abilities: ["instruction_following"], minContext: 4000, capabilities: ["json"] },
  renderVision: { abilities: vision, minContext: 4000, capabilities: ["vision", "json"] },
  thumbnailPick: { abilities: ["vision_detail", "vietnamese_writing"], minContext: 4000, capabilities: ["vision", "json"] },
  musicAssist: { abilities: ["classification"], minContext: 2000, capabilities: ["json"] },
  metadata: { abilities: ["vietnamese_writing", "summarisation"], minContext: 8000, capabilities: ["json"] },
  reviewChat: { abilities: ["vietnamese_writing", "instruction_following", "long_context"], minContext: 16000, capabilities: ["json"] },
  modelAdvisor: { abilities: ["classification", "instruction_following"], minContext: 8000, capabilities: ["json"] },
  topicSuggest: { abilities: ["vietnamese_writing", "creativity_storytelling"], minContext: 4000, capabilities: ["json"] },
  stylePack: { abilities: ["creativity_storytelling", "instruction_following"], minContext: 4000, capabilities: ["json"] },
  assistantChat: { abilities: ["tool_calling", "instruction_following", "coding"], minContext: 8000, capabilities: ["tools", "json"] },
  financeInsight: { abilities: ["summarisation", "vietnamese_writing"], minContext: 4000, capabilities: ["json"] },
  performanceInsight: { abilities: ["summarisation", "reasoning"], minContext: 8000, capabilities: ["json"] },
  clipPick: { abilities: ["summarisation", "vietnamese_understanding"], minContext: 8000, capabilities: ["json"] },
  commentAssist: { abilities: ["classification", "vietnamese_writing"], minContext: 4000, capabilities: ["json"] },
  trendMatch: { abilities: ["classification", "vietnamese_understanding"], minContext: 4000, capabilities: ["json"] },
  translateScript: { abilities: ["translation", "vietnamese_writing"], minContext: 16000, capabilities: ["json"] },
  providerIntelExtract: { abilities: ["instruction_following", "fact_accuracy"], minContext: 8000, capabilities: ["json"] },
  knowledgeWatch: { abilities: ["instruction_following", "fact_accuracy"], minContext: 8000, capabilities: ["json"] },
  editPlan: { abilities: ["instruction_following", "creativity_storytelling"], minContext: 8000, capabilities: ["json"] },
  formatPick: { abilities: ["classification", "instruction_following"], minContext: 4000, capabilities: ["json"] },
  stageTimeouts: { abilities: ["instruction_following", "reasoning"], minContext: 4000, capabilities: ["json"] },
  operatorPlan: { abilities: ["instruction_following", "classification"], minContext: 4000, capabilities: ["json"] },
  operatorClassify: { abilities: ["classification", "instruction_following"], minContext: 4000, capabilities: ["json"] },
  overdueCheck: { abilities: ["instruction_following", "reasoning"], minContext: 4000, capabilities: ["json"] },
  operatorRepair: { abilities: ["instruction_following", "reasoning"], minContext: 4000, capabilities: ["json"] },
};

export function everyTaskHasAbilities(): boolean {
  return LLM_TASKS.every((task) => TASK_ABILITIES[task.id]?.abilities.length);
}

export type RoutingProfile = {
  id: "coding" | "video" | "agent" | "embeddings";
  titleVi: string;
  requiredCapabilities: string[];
  minContext: number;
  tasks: LlmTaskId[];
};

export const ROUTING_PROFILES: RoutingProfile[] = [
  {
    id: "coding",
    titleVi: "Lập trình",
    requiredCapabilities: ["tools", "json"],
    minContext: 32000,
    tasks: ["assistantChat"],
  },
  {
    id: "video",
    titleVi: "Ứng dụng video",
    requiredCapabilities: ["json"],
    minContext: 8000,
    tasks: ["research", "script", "scriptReview", "sceneQueries", "visionCheck", "metadata", "factCheck"],
  },
  {
    id: "agent",
    titleVi: "Agent tổng quát",
    requiredCapabilities: ["tools", "json"],
    minContext: 16000,
    tasks: ["assistantChat", "reviewChat", "topicSuggest", "stylePack"],
  },
  {
    id: "embeddings",
    titleVi: "Embedding và rerank",
    requiredCapabilities: ["embedding"],
    minContext: 512,
    tasks: ["visualRerank"],
  },
];

export const BENCHMARK_SOURCES = [
  { id: "lmarena", url: "https://lmarena.ai", benchmark: "lmarena" },
  { id: "artificial-analysis", url: "https://artificialanalysis.ai", benchmark: "artificial-analysis" },
  { id: "openrouter", url: "https://openrouter.ai/rankings", benchmark: "openrouter" },
  { id: "swe-bench", url: "https://www.swebench.com", benchmark: "swe-bench" },
  { id: "mmlu-pro", url: "https://huggingface.co/spaces/TIGER-Lab/MMLU-Pro", benchmark: "mmlu-pro" },
  { id: "gpqa", url: "https://github.com/idavidrein/gpqa", benchmark: "gpqa" },
  { id: "livebench", url: "https://livebench.ai", benchmark: "livebench" },
  { id: "aider", url: "https://aider.chat", benchmark: "aider" },
];

export const BENCHMARK_ABILITY: Record<string, AbilityName[]> = {
  lmarena: ["vietnamese_writing", "english_writing", "reasoning"],
  "artificial-analysis": ["reasoning"],
  openrouter: ["coding"],
  "swe-bench": ["coding"],
  "mmlu-pro": ["reasoning", "fact_accuracy"],
  gpqa: ["reasoning"],
  livebench: ["instruction_following"],
  aider: ["coding"],
};

export const BENCHMARK_STALE_DAYS = 180;

export function benchmarkApplies(taskId: LlmTaskId, benchmark: string): boolean {
  const needed = TASK_ABILITIES[taskId]?.abilities ?? [];
  const mapped = BENCHMARK_ABILITY[benchmark] ?? [];
  return mapped.some((ability) => needed.includes(ability));
}

export function benchmarkComponent(
  results: BenchmarkResult[],
  taskId: LlmTaskId,
  now: Date,
): { score: number; stale: boolean } | null {
  const applicable = results.filter((result) => benchmarkApplies(taskId, result.benchmark));
  if (!applicable.length) return null;
  const newestVersion = new Map<string, BenchmarkResult>();
  for (const result of applicable) {
    const current = newestVersion.get(result.benchmark);
    if (!current || Date.parse(result.measuredAt) > Date.parse(current.measuredAt)) newestVersion.set(result.benchmark, result);
  }
  let weighted = 0;
  let weight = 0;
  let stale = false;
  for (const result of newestVersion.values()) {
    const ageDays = (now.getTime() - Date.parse(result.measuredAt)) / 86_400_000;
    const itemWeight = ageDays > BENCHMARK_STALE_DAYS ? 0.5 : 1;
    if (itemWeight < 1) stale = true;
    weighted += result.value * itemWeight;
    weight += itemWeight;
  }
  if (weight === 0) return null;
  return { score: weighted / weight, stale };
}

export type CapabilityInput = { state: "tested" | "documented" | "UNKNOWN"; value: boolean };

export type ScorecardModel = {
  providerId: string;
  modelId: string;
  autoConfigAllowed: boolean;
  paid: boolean;
  cooldown: boolean;
  context: number | "UNKNOWN";
  capabilities: Record<string, CapabilityInput>;
  quotaLeft: number | "UNKNOWN";
  successRate: number | null;
  schemaRate: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  quality: {
    appEval: number | null;
    appEvalN?: number;
    realRun: number | null;
    benchmarks: number | null;
    documented: number | null;
  };
};

const QUALITY_WEIGHTS = { appEval: 50, realRun: 25, benchmarks: 15, documented: 10 } as const;

export function qualityFromSources(input: ScorecardModel["quality"]): {
  score: number | null;
  confidence: "low" | "medium" | "high";
  coverage: number;
} {
  const parts = (Object.keys(QUALITY_WEIGHTS) as Array<keyof typeof QUALITY_WEIGHTS>)
    .map((key) => ({ key, value: input[key], weight: QUALITY_WEIGHTS[key] }))
    .filter((part) => typeof part.value === "number");
  if (!parts.length) return { score: null, confidence: "low", coverage: 0 };
  const weight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = parts.reduce((sum, part) => sum + (part.value as number) * part.weight, 0) / weight;
  const coverage = weight / 100;
  const confidence = coverage >= 0.75 ? "high" : coverage >= 0.35 ? "medium" : "low";
  return { score, confidence, coverage };
}

function latencyScore(ms: number | null): number | null {
  if (ms == null) return null;
  return Math.max(0, Math.min(100, 100 - ms / 40));
}

function costScore(usd: number | null): number | null {
  if (usd == null) return null;
  return Math.max(0, Math.min(100, 100 - usd * 100));
}

const MODE_WEIGHTS: Record<string, Record<string, number>> = {
  ECO: { quality: 0.15, quota: 0.4, success: 0.15, schema: 0.1, latency: 0.1, cost: 0.1 },
  QUALITY: { quality: 0.55, quota: 0.05, success: 0.15, schema: 0.1, latency: 0.1, cost: 0.05 },
  MAX: { quality: 0.55, quota: 0.05, success: 0.15, schema: 0.1, latency: 0.1, cost: 0.05 },
  BALANCED: { quality: 0.35, quota: 0.2, success: 0.15, schema: 0.1, latency: 0.1, cost: 0.1 },
  CUSTOM: { quality: 0.35, quota: 0.2, success: 0.15, schema: 0.1, latency: 0.1, cost: 0.1 },
};

function combine(mode: BudgetMode, parts: Record<string, number | null>): number {
  const weights = MODE_WEIGHTS[mode] ?? MODE_WEIGHTS.BALANCED!;
  let weight = 0;
  let score = 0;
  for (const [key, value] of Object.entries(parts)) {
    if (value == null) continue;
    weight += weights[key] ?? 0;
    score += value * (weights[key] ?? 0);
  }
  return weight === 0 ? 0 : score / weight;
}

export type ScorecardRow = {
  providerId: string;
  modelId: string;
  rank: number;
  score: number;
  confidence: "low" | "medium" | "high";
  reasonVi: string;
  quotaKnown: boolean;
};

function reasonVi(model: ScorecardModel, quality: ReturnType<typeof qualityFromSources>): string {
  const bits: string[] = [];
  if (model.quality.appEval != null) bits.push(`điểm eval ${Math.round(model.quality.appEval)} (n=${model.quality.appEvalN ?? 0})`);
  if (model.successRate != null) bits.push(`dùng thật ${Math.round(model.successRate * 100)}% thành công`);
  if (typeof model.quotaLeft === "number") bits.push(`còn ${Math.round(model.quotaLeft * 100)}% quota`);
  else bits.push("quota chưa rõ");
  if (!bits.length) bits.push("chưa đủ nguồn để chấm");
  return bits.join(", ");
}

export function modelScorecard(input: {
  taskId: LlmTaskId;
  budgetMode: BudgetMode;
  paidFallback: boolean;
  models: ScorecardModel[];
}): { ranked: ScorecardRow[]; excluded: Array<{ modelId: string; reasonVi: string }> } {
  const need = TASK_ABILITIES[input.taskId];
  const excluded: Array<{ modelId: string; reasonVi: string }> = [];
  const ranked: Array<ScorecardRow & { sort: number }> = [];
  for (const model of input.models) {
    const missingCap = need.capabilities.some((name) => {
      const cap = model.capabilities[name];
      return !cap || cap.state === "UNKNOWN" || cap.value !== true;
    });
    if (missingCap) {
      excluded.push({ modelId: model.modelId, reasonVi: "Thiếu năng lực đã kiểm tra hoặc đã ghi trong tài liệu." });
      continue;
    }
    if (typeof model.context !== "number" || model.context < need.minContext) {
      excluded.push({ modelId: model.modelId, reasonVi: "Ngữ cảnh chưa đủ cho tác vụ." });
      continue;
    }
    if (!model.autoConfigAllowed) {
      excluded.push({ modelId: model.modelId, reasonVi: "Nhà cung cấp không được tự cấu hình." });
      continue;
    }
    if (model.cooldown) {
      excluded.push({ modelId: model.modelId, reasonVi: "Model đang chờ hạ nhiệt." });
      continue;
    }
    if (model.paid && !input.paidFallback) {
      excluded.push({ modelId: model.modelId, reasonVi: "Model trả phí khi chưa bật fallback trả phí." });
      continue;
    }
    if (model.quotaLeft === "UNKNOWN") {
      excluded.push({ modelId: model.modelId, reasonVi: "Quota còn lại chưa rõ, không tính là còn lượt." });
      continue;
    }
    const quality = qualityFromSources(model.quality);
    const score = combine(input.budgetMode, {
      quality: quality.score,
      quota: model.quotaLeft * 100,
      success: model.successRate == null ? null : model.successRate * 100,
      schema: model.schemaRate == null ? null : model.schemaRate * 100,
      latency: latencyScore(model.latencyMs),
      cost: costScore(model.costUsd),
    });
    ranked.push({
      providerId: model.providerId,
      modelId: model.modelId,
      rank: 0,
      score: Math.round(score * 10) / 10,
      confidence: quality.confidence,
      reasonVi: reasonVi(model, quality),
      quotaKnown: true,
      sort: score,
    });
  }
  ranked.sort((a, b) => b.sort - a.sort || a.modelId.localeCompare(b.modelId));
  return {
    ranked: ranked.map((row, index) => ({ ...row, rank: index + 1 })),
    excluded,
  };
}

export type RecommendModel = {
  providerId: string;
  modelId: string;
  autoConfigAllowed: boolean;
  paid: boolean;
  cooldown: boolean;
  context: number | "UNKNOWN";
  capabilities: Record<string, CapabilityInput>;
  quotaLeft: number | "UNKNOWN";
  reliability: number;
  quality: number;
  latencyMs: number | "UNKNOWN";
  cost: number;
  score?: number;
};

export function recommendProfile(
  profile: RoutingProfile,
  models: RecommendModel[],
  options: { paidFallback: boolean },
): { chain: RecommendModel[]; withheld: Array<{ modelId: string; reasonVi: string }> } {
  const withheld: Array<{ modelId: string; reasonVi: string }> = [];
  const chain: RecommendModel[] = [];
  for (const model of models) {
    const missing = profile.requiredCapabilities.some((name) => {
      const cap = model.capabilities[name];
      return !cap || (cap.state !== "tested" && cap.state !== "documented") || cap.value !== true;
    });
    if (missing) {
      withheld.push({ modelId: model.modelId, reasonVi: "Năng lực bắt buộc chưa được kiểm tra hoặc ghi trong tài liệu." });
      continue;
    }
    if (typeof model.context !== "number" || model.context < profile.minContext) {
      withheld.push({ modelId: model.modelId, reasonVi: "Ngữ cảnh chưa đủ." });
      continue;
    }
    if (!model.autoConfigAllowed) {
      withheld.push({ modelId: model.modelId, reasonVi: "Không được tự cấu hình." });
      continue;
    }
    if (model.cooldown) {
      withheld.push({ modelId: model.modelId, reasonVi: "Đang chờ hạ nhiệt." });
      continue;
    }
    if (model.paid && !options.paidFallback) {
      withheld.push({ modelId: model.modelId, reasonVi: "Model trả phí khi chưa bật fallback." });
      continue;
    }
    if (model.quotaLeft === "UNKNOWN") {
      withheld.push({ modelId: model.modelId, reasonVi: "Quota chưa rõ, không tính là còn." });
      continue;
    }
    chain.push(model);
  }
  chain.sort((a, b) => {
    const score = (b.score ?? 0) - (a.score ?? 0);
    if (score !== 0) return score;
    const quota = (b.quotaLeft as number) - (a.quotaLeft as number);
    if (quota !== 0) return quota;
    if (b.reliability !== a.reliability) return b.reliability - a.reliability;
    if (b.quality !== a.quality) return b.quality - a.quality;
    const latencyA = a.latencyMs === "UNKNOWN" ? Number.POSITIVE_INFINITY : a.latencyMs;
    const latencyB = b.latencyMs === "UNKNOWN" ? Number.POSITIVE_INFINITY : b.latencyMs;
    if (latencyA !== latencyB) return latencyA - latencyB;
    if (a.context !== b.context && typeof a.context === "number" && typeof b.context === "number") return b.context - a.context;
    return a.cost - b.cost;
  });
  return { chain, withheld };
}

export function capabilityFromEvidence(input: { state?: string; value?: boolean } | undefined): CapabilityInput {
  if (!input || (input.state !== "tested" && input.state !== "documented") || typeof input.value !== "boolean") {
    return { state: "UNKNOWN", value: false };
  }
  return { state: input.state, value: input.value };
}
