import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  LLM_QUOTA_PRESETS,
  LlmQuotaRuleSchema,
  LlmQuotaSettingsSchema,
  chooseCooldown,
  currentWindowStart,
  formatHourMinute,
  kindForModel,
  limitRatio,
  listQuotaRulesForDisplay,
  localDateKey,
  modelMatchesRule,
  nextReset,
  resolveEffectiveRules,
  ruleForModel,
  type LlmQuotaCooldown,
  type LlmQuotaKind,
  type LlmQuotaLimit,
  type LlmQuotaRow,
  type LlmQuotaRule,
  type LlmQuotaSettings,
  type LlmQuotaStatus,
  type LlmQuotaWindow,
  type QuotaPolicy,
} from "@vg/shared";
import type { LlmProviderRegistry } from "./registry.js";
import type { LlmError } from "./types.js";

const SETTINGS_KEY = "llmQuota";
const PAID_SPEND_KEY = "llmPaidFallbackSpend";
const PRUNE_MS = 40 * 24 * 60 * 60 * 1000;
const WINDOWS: LlmQuotaWindow[] = ["minute", "day", "month", "rolling_5h"];

type UsageBucket = { requests: number; inputTokens: number; outputTokens: number };
type UsageRow = {
  provider: string;
  model: string;
  window: string;
  window_start: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
};
type CooldownRow = { provider: string; model: string; until: string; reason: string; set_at: string };

export type LlmQuotaController = {
  recordCall(input: { provider: string; model: string; inputTokens: number; outputTokens: number; now?: Date }): void;
  isUnavailable(provider: string, model: string, now?: Date): boolean;
  onQuotaFailure(input: { provider: string; model: string; error: LlmError; now?: Date }): { until: string };
  kindOf(provider: string, model: string): LlmQuotaKind | null;
  policyFor(profileId?: string | null): { policy: QuotaPolicy; paidFallbackDailyUsd: number; timeZone: string };
  todaySpendUsd(now?: Date): number;
  notePaidFallback(input: { task: string; provider: string; model: string; inputTokens: number; outputTokens: number; now?: Date }): void;
  earliestRetryAt(entries: { provider: string; model: string }[], now?: Date): string;
};

type QuotaDeps = {
  sqlite: Database.Database;
  spendToday?: (dateKey: string) => number;
  costOf?: (provider: string, model: string, inputTokens: number, outputTokens: number) => number;
  notifyPaid?: (message: string) => void;
  timeZone?: () => string;
  now?: () => Date;
};

function readSettings(sqlite: Database.Database): LlmQuotaSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return LlmQuotaSettingsSchema.parse({});
  try {
    const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
    return LlmQuotaSettingsSchema.parse(value);
  } catch {
    return LlmQuotaSettingsSchema.parse({});
  }
}

function writeSettings(sqlite: Database.Database, settings: LlmQuotaSettings): LlmQuotaSettings {
  const parsed = LlmQuotaSettingsSchema.parse(settings);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

function enabledRules(settings: LlmQuotaSettings): LlmQuotaRule[] {
  return resolveEffectiveRules({
    presets: LLM_QUOTA_PRESETS,
    userRules: settings.rules,
    disabled: settings.disabled,
  });
}

function loadUsage(sqlite: Database.Database, provider: string): UsageRow[] {
  return sqlite.prepare(
    "SELECT provider, model, window, window_start, requests, input_tokens, output_tokens FROM llm_quota_usage WHERE provider = ?",
  ).all(provider) as UsageRow[];
}

function loadCooldown(sqlite: Database.Database, provider: string, model: string): CooldownRow | undefined {
  return sqlite.prepare(
    "SELECT provider, model, until, reason, set_at FROM llm_cooldowns WHERE provider = ? AND model = ?",
  ).get(provider, model) as CooldownRow | undefined;
}

function usageForRule(rows: UsageRow[], rule: LlmQuotaRule, model: string, window: LlmQuotaWindow, now: Date): UsageBucket {
  const start = currentWindowStart(window, now, rule.resetTz).toISOString();
  const rollingCut = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
  const bucket: UsageBucket = { requests: 0, inputTokens: 0, outputTokens: 0 };
  for (const row of rows) {
    if (row.window !== window) continue;
    const counts = rule.model === "*" || rule.model.includes("*")
      ? modelMatchesRule(rule.model, row.model)
      : row.model === model;
    if (!counts) continue;
    if (window === "rolling_5h") {
      if (row.window_start < rollingCut) continue;
    } else if (row.window_start !== start) continue;
    bucket.requests += row.requests;
    bucket.inputTokens += row.input_tokens;
    bucket.outputTokens += row.output_tokens;
  }
  return bucket;
}

function worstRatio(rule: LlmQuotaRule, rows: UsageRow[], model: string, now: Date): number {
  let worst = 0;
  for (const limit of rule.limits) {
    const used = usageForRule(rows, rule, model, limit.window, now);
    worst = Math.max(worst, limitRatio(limit, used));
  }
  return worst;
}

function activeCooldown(row: CooldownRow | undefined, now: Date): boolean {
  return Boolean(row && Date.parse(row.until) > now.getTime());
}

function appTimeZone(sqlite: Database.Database, fallback = "Asia/Ho_Chi_Minh"): string {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get("notifications") as { value: string } | undefined;
  if (!row) return fallback;
  try {
    const value = typeof row.value === "string" ? JSON.parse(row.value) as { timezone?: string } : row.value as { timezone?: string };
    return typeof value?.timezone === "string" && value.timezone ? value.timezone : fallback;
  } catch {
    return fallback;
  }
}

function readPaidSpend(sqlite: Database.Database, dateKey: string): number {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(PAID_SPEND_KEY) as { value: string } | undefined;
  if (!row) return 0;
  try {
    const value = typeof row.value === "string" ? JSON.parse(row.value) as { date?: string; usd?: number } : row.value as { date?: string; usd?: number };
    return value?.date === dateKey && typeof value.usd === "number" ? value.usd : 0;
  } catch {
    return 0;
  }
}

function addPaidSpend(sqlite: Database.Database, dateKey: string, usd: number, now: Date): number {
  const next = Math.max(0, readPaidSpend(sqlite, dateKey) + Math.max(0, usd));
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(PAID_SPEND_KEY, JSON.stringify({ date: dateKey, usd: next }), now.toISOString());
  return next;
}

function paidNoticeSent(sqlite: Database.Database, dateKey: string): boolean {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get("llmPaidFallbackNotice") as { value: string } | undefined;
  if (!row) return false;
  const value = typeof row.value === "string" ? row.value.replace(/"/g, "") : "";
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return parsed === dateKey;
  } catch {
    return value === dateKey;
  }
}

function markPaidNotice(sqlite: Database.Database, dateKey: string, now: Date): void {
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run("llmPaidFallbackNotice", JSON.stringify(dateKey), now.toISOString());
}

function profilePolicy(sqlite: Database.Database, profileId: string | null | undefined, settings: LlmQuotaSettings): {
  policy: QuotaPolicy;
  paidFallbackDailyUsd: number;
} {
  if (!profileId) return { policy: settings.quotaPolicy, paidFallbackDailyUsd: settings.paidFallbackDailyUsd };
  const row = sqlite.prepare("SELECT llm FROM profiles WHERE id = ?").get(profileId) as { llm: string | null } | undefined;
  if (!row?.llm) return { policy: settings.quotaPolicy, paidFallbackDailyUsd: settings.paidFallbackDailyUsd };
  try {
    const llm = typeof row.llm === "string" ? JSON.parse(row.llm) as { quotaPolicy?: string; paidFallbackDailyUsd?: number } : row.llm;
    const policy = llm.quotaPolicy === "wait" || llm.quotaPolicy === "paid_fallback" ? llm.quotaPolicy : settings.quotaPolicy;
    const cap = typeof llm.paidFallbackDailyUsd === "number" ? llm.paidFallbackDailyUsd : settings.paidFallbackDailyUsd;
    return { policy, paidFallbackDailyUsd: cap };
  } catch {
    return { policy: settings.quotaPolicy, paidFallbackDailyUsd: settings.paidFallbackDailyUsd };
  }
}

function windowUsages(rule: LlmQuotaRule, rows: UsageRow[], model: string, now: Date): LlmQuotaRow["windows"] {
  return rule.limits.map((limit) => {
    const used = usageForRule(rows, rule, model, limit.window, now);
    return {
      window: limit.window,
      requestsUsed: used.requests,
      requestsLimit: limit.requests ?? null,
      inputTokensUsed: used.inputTokens,
      inputTokensLimit: limit.inputTokens ?? null,
      outputTokensUsed: used.outputTokens,
      outputTokensLimit: limit.outputTokens ?? null,
      ratio: limitRatio(limit, used),
    };
  });
}

function statusForRule(
  rule: LlmQuotaRule,
  rows: UsageRow[],
  model: string,
  cooldown: CooldownRow | undefined,
  nearLimitRatio: number,
  now: Date,
): { status: LlmQuotaRow["status"]; ratio: number } {
  if (activeCooldown(cooldown, now)) return { status: "cooldown", ratio: worstRatio(rule, rows, model, now) };
  const ratio = worstRatio(rule, rows, model, now);
  if (ratio >= 1) return { status: "exhausted", ratio };
  if (ratio >= nearLimitRatio) return { status: "near", ratio };
  return { status: "ok", ratio };
}

function nextResetFor(rule: LlmQuotaRule, now: Date): string | null {
  const windows = rule.limits.map((limit) => limit.window);
  if (windows.length === 0) return null;
  const resets = windows.map((window) => nextReset(window, now, rule.resetTz).getTime());
  return new Date(Math.min(...resets)).toISOString();
}

export function readQuotaStatus(sqlite: Database.Database, now = new Date(), spendToday = 0): LlmQuotaStatus {
  const settings = readSettings(sqlite);
  const zone = appTimeZone(sqlite);
  const dateKey = localDateKey(now, zone);
  const display = listQuotaRulesForDisplay({
    presets: LLM_QUOTA_PRESETS,
    userRules: settings.rules,
    disabled: settings.disabled,
  });
  const usageByProvider = new Map<string, UsageRow[]>();
  const rows: LlmQuotaRow[] = display.map((rule) => {
    const usage = usageByProvider.get(rule.provider) ?? loadUsage(sqlite, rule.provider);
    usageByProvider.set(rule.provider, usage);
    const sampleModel = rule.model.includes("*") ? (rule.model === "*:free" ? "example:free" : "example") : rule.model;
    const cooldown = rule.model.includes("*") ? undefined : loadCooldown(sqlite, rule.provider, rule.model);
    const judged = rule.enabled
      ? statusForRule(rule, usage, sampleModel, cooldown, settings.nearLimitRatio, now)
      : { status: "ok" as const, ratio: 0 };
    return {
      provider: rule.provider,
      model: rule.model,
      kind: rule.kind,
      source: rule.source,
      enabled: rule.enabled !== false,
      note: rule.note,
      resetTz: rule.resetTz,
      limits: rule.limits,
      windows: rule.enabled ? windowUsages(rule, usage, sampleModel, now) : [],
      nextReset: nextResetFor(rule, now),
      status: judged.status,
      cooldownUntil: cooldown && activeCooldown(cooldown, now) ? cooldown.until : null,
      cooldownReason: cooldown && activeCooldown(cooldown, now) ? cooldown.reason : null,
    };
  });
  const cooldowns = sqlite.prepare(
    "SELECT provider, model, until, reason, set_at FROM llm_cooldowns WHERE until > ?",
  ).all(now.toISOString()) as CooldownRow[];
  return {
    quotaPolicy: settings.quotaPolicy,
    paidFallbackDailyUsd: settings.paidFallbackDailyUsd,
    nearLimitRatio: settings.nearLimitRatio,
    todaySpendUsd: spendToday,
    paidFallbackSpendToday: readPaidSpend(sqlite, dateKey),
    rows,
    cooldowns: cooldowns.map((row): LlmQuotaCooldown => ({
      provider: row.provider,
      model: row.model,
      until: row.until,
      reason: row.reason,
      setAt: row.set_at,
    })),
  };
}

export function saveQuotaPolicy(sqlite: Database.Database, patch: {
  quotaPolicy: QuotaPolicy;
  paidFallbackDailyUsd: number;
  nearLimitRatio?: number;
}): LlmQuotaSettings {
  const current = readSettings(sqlite);
  return writeSettings(sqlite, {
    ...current,
    quotaPolicy: patch.quotaPolicy,
    paidFallbackDailyUsd: patch.paidFallbackDailyUsd,
    nearLimitRatio: patch.nearLimitRatio ?? current.nearLimitRatio,
  });
}

export function saveUserQuotaRule(sqlite: Database.Database, rule: LlmQuotaRule): LlmQuotaRule {
  const parsed = LlmQuotaRuleSchema.parse({ ...rule, source: "user", enabled: rule.enabled !== false });
  const current = readSettings(sqlite);
  const rules = current.rules.filter((item) => item.provider !== parsed.provider || item.model !== parsed.model);
  rules.push(parsed);
  const disabled = current.disabled.filter((item) => item.provider !== parsed.provider || item.model !== parsed.model);
  writeSettings(sqlite, { ...current, rules, disabled });
  return parsed;
}

export function setQuotaRuleEnabled(sqlite: Database.Database, provider: string, model: string, enabled: boolean): void {
  const current = readSettings(sqlite);
  const user = current.rules.find((rule) => rule.provider === provider && rule.model === model);
  if (user) {
    saveUserQuotaRule(sqlite, { ...user, enabled, source: "user" });
    return;
  }
  const disabled = current.disabled.filter((item) => item.provider !== provider || item.model !== model);
  if (!enabled) disabled.push({ provider, model });
  writeSettings(sqlite, { ...current, disabled });
}

export function clearLlmCooldown(sqlite: Database.Database, provider: string, model: string): void {
  sqlite.prepare("DELETE FROM llm_cooldowns WHERE provider = ? AND model = ?").run(provider, model);
}

export function quotaDailySummaryLine(sqlite: Database.Database, now = new Date()): string {
  try {
    const status = readQuotaStatus(sqlite, now);
    const hit = status.rows.filter((row) => row.enabled && (row.status === "exhausted" || row.status === "cooldown"));
    const names = hit.map((row) => escapeMini(`${row.provider}/${row.model}`)).join(", ");
    const hitText = names ? `hết hạn mức: ${names}` : "không model nào hết hạn mức";
    return `<b>Quota</b>: ${hitText}; dự phòng trả phí $${status.paidFallbackSpendToday.toFixed(2)}`;
  } catch {
    return "";
  }
}

export function advisorQuotaFor(sqlite: Database.Database, provider: string, model: string, now = new Date()): {
  kind: LlmQuotaKind | "unknown";
  remainingRequestsToday: number | null;
  quotaStatus: "available" | "near_limit" | "exhausted" | "cooldown";
} {
  const settings = readSettings(sqlite);
  const rules = enabledRules(settings);
  const rule = ruleForModel(rules, provider, model);
  const kind = kindForModel(rules, provider, model);
  const rows = loadUsage(sqlite, provider);
  const cooldown = loadCooldown(sqlite, provider, model);
  if (!rule) {
    return {
      kind: kind ?? "unknown",
      remainingRequestsToday: null,
      quotaStatus: activeCooldown(cooldown, now) ? "cooldown" : "available",
    };
  }
  const judged = statusForRule(rule, rows, model, cooldown, settings.nearLimitRatio, now);
  const dayLimit = rule.limits.find((limit) => limit.window === "day" && limit.requests);
  const used = dayLimit ? usageForRule(rows, rule, model, "day", now).requests : 0;
  const remaining = dayLimit?.requests === undefined ? null : Math.max(0, dayLimit.requests - used);
  const quotaStatus = judged.status === "ok" ? "available"
    : judged.status === "near" ? "near_limit"
      : judged.status === "cooldown" ? "cooldown"
        : "exhausted";
  return { kind: kind ?? "unknown", remainingRequestsToday: remaining, quotaStatus };
}

export function createLlmQuotaController(deps: QuotaDeps): LlmQuotaController {
  const nowFn = deps.now ?? (() => new Date());
  const zoneOf = deps.timeZone ?? (() => appTimeZone(deps.sqlite));

  function recordCall(input: { provider: string; model: string; inputTokens: number; outputTokens: number; now?: Date }): void {
    const now = input.now ?? nowFn();
    const pruneBefore = new Date(now.getTime() - PRUNE_MS).toISOString();
    deps.sqlite.prepare("DELETE FROM llm_quota_usage WHERE window_start < ?").run(pruneBefore);
    const insert = deps.sqlite.prepare(
      `INSERT INTO llm_quota_usage (id, provider, model, window_start, window, requests, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(provider, model, window, window_start) DO UPDATE SET
         requests = requests + 1,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens`,
    );
    const settings = readSettings(deps.sqlite);
    const rule = ruleForModel(enabledRules(settings), input.provider, input.model);
    const tz = rule?.resetTz ?? "UTC";
    for (const window of WINDOWS) {
      const start = window === "rolling_5h"
        ? now.toISOString()
        : currentWindowStart(window, now, tz).toISOString();
      insert.run(randomUUID(), input.provider, input.model, start, window, input.inputTokens, input.outputTokens);
    }
  }

  function isUnavailable(provider: string, model: string, now = nowFn()): boolean {
    const cooldown = loadCooldown(deps.sqlite, provider, model);
    if (activeCooldown(cooldown, now)) return true;
    const settings = readSettings(deps.sqlite);
    const rule = ruleForModel(enabledRules(settings), provider, model);
    if (!rule) return false;
    const rows = loadUsage(deps.sqlite, provider);
    return worstRatio(rule, rows, model, now) >= 1;
  }

  function onQuotaFailure(input: { provider: string; model: string; error: LlmError; now?: Date }): { until: string } {
    const now = input.now ?? nowFn();
    const settings = readSettings(deps.sqlite);
    const rule = ruleForModel(enabledRules(settings), input.provider, input.model);
    const tz = rule?.resetTz ?? zoneOf();
    const previous = loadCooldown(deps.sqlite, input.provider, input.model);
    const chosen = chooseCooldown({
      now,
      message: input.error.message,
      retryAfterMs: input.error.retryAfterMs,
      previous: previous ? { untilMs: Date.parse(previous.until), setAtMs: Date.parse(previous.set_at) } : null,
      nextDayReset: nextReset("day", now, tz),
    });
    const until = chosen.until.toISOString();
    deps.sqlite.prepare(
      `INSERT INTO llm_cooldowns (provider, model, until, reason, set_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider, model) DO UPDATE SET until = excluded.until, reason = excluded.reason, set_at = excluded.set_at`,
    ).run(input.provider, input.model, until, chosen.reason, now.toISOString());
    return { until };
  }

  return {
    recordCall,
    isUnavailable,
    onQuotaFailure,
    kindOf(provider, model) {
      return kindForModel(enabledRules(readSettings(deps.sqlite)), provider, model);
    },
    policyFor(profileId) {
      const settings = readSettings(deps.sqlite);
      const policy = profilePolicy(deps.sqlite, profileId, settings);
      return { ...policy, timeZone: zoneOf() };
    },
    todaySpendUsd(now = nowFn()) {
      if (!deps.spendToday) return 0;
      return deps.spendToday(localDateKey(now, zoneOf()));
    },
    notePaidFallback(input) {
      const now = input.now ?? nowFn();
      const zone = zoneOf();
      const dateKey = localDateKey(now, zone);
      const cost = deps.costOf?.(input.provider, input.model, input.inputTokens, input.outputTokens) ?? 0;
      const spend = addPaidSpend(deps.sqlite, dateKey, cost, now);
      if (paidNoticeSent(deps.sqlite, dateKey)) return;
      markPaidNotice(deps.sqlite, dateKey, now);
      const when = formatHourMinute(now, zone);
      deps.notifyPaid?.(`Hết quota miễn phí, chuyển sang model trả phí ${input.provider}/${input.model} cho tác vụ ${input.task} lúc ${when}. Chi phí dự phòng hôm nay: $${spend.toFixed(4)}.`);
    },
    earliestRetryAt(entries, now = nowFn()) {
      const settings = readSettings(deps.sqlite);
      const rules = enabledRules(settings);
      const times: number[] = [];
      for (const entry of entries) {
        const cooldown = loadCooldown(deps.sqlite, entry.provider, entry.model);
        if (activeCooldown(cooldown, now)) times.push(Date.parse(cooldown!.until));
        const rule = ruleForModel(rules, entry.provider, entry.model);
        if (!rule) continue;
        const rows = loadUsage(deps.sqlite, entry.provider);
        for (const limit of rule.limits) {
          const used = usageForRule(rows, rule, entry.model, limit.window, now);
          if (limitRatio(limit, used) >= 1) times.push(nextReset(limit.window, now, rule.resetTz).getTime());
        }
      }
      const soonest = times.filter((time) => Number.isFinite(time) && time > now.getTime());
      const at = soonest.length > 0 ? Math.min(...soonest) : now.getTime() + 60_000;
      return new Date(at).toISOString();
    },
  };
}

export function attachLlmQuota(registry: LlmProviderRegistry, deps: QuotaDeps): LlmQuotaController {
  const controller = createLlmQuotaController(deps);
  registry.quota = controller;
  return controller;
}

function escapeMini(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function modelsHittingLimitToday(rows: LlmQuotaRow[]): string[] {
  return rows.filter((row) => row.enabled && (row.status === "exhausted" || row.status === "cooldown")).map((row) => `${row.provider}/${row.model}`);
}

export type { LlmQuotaLimit };
