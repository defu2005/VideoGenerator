import type { LlmQuotaKind, LlmQuotaLimit, LlmQuotaRule, LlmQuotaWindow } from "../schemas/llmQuota.js";

const PAID_WITHOUT_RULE = new Set(["anthropic", "openai", "deepseek", "opencode"]);

export function modelMatchesRule(ruleModel: string, model: string): boolean {
  if (ruleModel === "*") return true;
  if (ruleModel === "*:free") return model.endsWith(":free");
  return ruleModel === model;
}

function specificity(ruleModel: string): number {
  if (ruleModel === "*") return 0;
  if (ruleModel.includes("*")) return 1;
  return 2;
}

export function resolveEffectiveRules(input: {
  presets: readonly LlmQuotaRule[];
  userRules: readonly LlmQuotaRule[];
  disabled: readonly { provider: string; model: string }[];
}): LlmQuotaRule[] {
  const disabled = new Set(input.disabled.map((item) => `${item.provider}\0${item.model}`));
  const map = new Map<string, LlmQuotaRule>();
  for (const preset of input.presets) {
    const key = `${preset.provider}\0${preset.model}`;
    if (disabled.has(key)) continue;
    map.set(key, { ...preset, source: "preset", enabled: preset.enabled !== false });
  }
  for (const rule of input.userRules) {
    const key = `${rule.provider}\0${rule.model}`;
    if (rule.enabled === false || disabled.has(key)) {
      map.delete(key);
      continue;
    }
    map.set(key, { ...rule, source: "user", enabled: true });
  }
  return [...map.values()];
}

/** Presets and user rules for the settings table, including ones the user turned off. */
export function listQuotaRulesForDisplay(input: {
  presets: readonly LlmQuotaRule[];
  userRules: readonly LlmQuotaRule[];
  disabled: readonly { provider: string; model: string }[];
}): LlmQuotaRule[] {
  const disabled = new Set(input.disabled.map((item) => `${item.provider}\0${item.model}`));
  const userByKey = new Map(input.userRules.map((rule) => [`${rule.provider}\0${rule.model}`, rule]));
  const rows: LlmQuotaRule[] = [];
  const seen = new Set<string>();
  for (const preset of input.presets) {
    const key = `${preset.provider}\0${preset.model}`;
    seen.add(key);
    const user = userByKey.get(key);
    if (user) {
      rows.push({ ...user, source: "user", enabled: user.enabled !== false && !disabled.has(key) });
      continue;
    }
    rows.push({ ...preset, source: "preset", enabled: preset.enabled !== false && !disabled.has(key) });
  }
  for (const rule of input.userRules) {
    const key = `${rule.provider}\0${rule.model}`;
    if (seen.has(key)) continue;
    rows.push({ ...rule, source: "user", enabled: rule.enabled !== false && !disabled.has(key) });
  }
  return rows;
}

export function ruleForModel(rules: readonly LlmQuotaRule[], provider: string, model: string): LlmQuotaRule | undefined {
  const matches = rules.filter((rule) => rule.enabled !== false && rule.provider === provider && modelMatchesRule(rule.model, model));
  matches.sort((a, b) => specificity(b.model) - specificity(a.model));
  return matches[0];
}

export function kindForModel(rules: readonly LlmQuotaRule[], provider: string, model: string): LlmQuotaKind | null {
  const rule = ruleForModel(rules, provider, model);
  if (rule) return rule.kind;
  if (PAID_WITHOUT_RULE.has(provider)) return "paid";
  if (provider === "openrouter" && model && !model.endsWith(":free")) return "paid";
  return null;
}

export function limitRatio(
  limit: LlmQuotaLimit,
  used: { requests: number; inputTokens: number; outputTokens: number },
): number {
  const ratios: number[] = [];
  if (limit.requests) ratios.push(used.requests / limit.requests);
  if (limit.inputTokens) ratios.push(used.inputTokens / limit.inputTokens);
  if (limit.outputTokens) ratios.push(used.outputTokens / limit.outputTokens);
  return ratios.length === 0 ? 0 : Math.max(...ratios);
}

export function orderChainForBudget<T extends { kind: LlmQuotaKind | null }>(entries: readonly T[], budgetMode: string | undefined): T[] {
  if (budgetMode !== "ECO") return [...entries];
  const rank = (kind: LlmQuotaKind | null) => (kind === "free_tier" || kind === "subscription" ? 0 : kind === "paid" ? 2 : 1);
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const delta = rank(a.entry.kind) - rank(b.entry.kind);
      return delta !== 0 ? delta : a.index - b.index;
    })
    .map((item) => item.entry);
}

export function tightestWindow(limits: readonly LlmQuotaLimit[]): LlmQuotaWindow | undefined {
  return limits[0]?.window;
}
