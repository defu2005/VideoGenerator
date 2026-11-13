import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  LLM_QUOTA_PRESETS,
  LIVE_QUOTA_COOLDOWN_FALLBACK_MS,
  LlmQuotaRuleSchema,
  LlmQuotaSettingsSchema,
  appProviderForOmniroute,
  chooseCooldown,
  creditAllowanceStatus,
  currentWindowStart,
  formatHourMinute,
  isLiveExhausted,
  kindForModel,
  limitRatio,
  limitUnit,
  listQuotaRulesForDisplay,
  liveQuotaStatus,
  localDateKey,
  matchLiveQuota,
  modelMatchesRule,
  nextReset,
  resolveEffectiveRules,
  ruleForModel,
  shouldRefreshLiveQuota,
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
import { latestSnapshotFetchedAt, loadQuotaSnapshots, type QuotaSnapshot } from "./omnirouteQuotaStore.js";
import { buildOmnirouteQuotaView, freshSnapshots, liveMatchFor } from "./omnirouteQuotaView.js";

const SETTINGS_KEY = "llmQuota";
const PAID_SPEND_KEY = "llmPaidFallbackSpend";
const BACKFILL_KEY = "llmQuotaUsageBackfillV1";
const PRUNE_MS = 40 * 24 * 60 * 60 * 1000;
const WINDOWS: LlmQuotaWindow[] = ["minute", "day", "month", "rolling_5h"];

type UsageBucket = { requests: number; inputTokens: number; outputTokens: number; creditsUsd: number };
type UsageRow = {
  provider: string;
  model: string;
  window: string;
  window_start: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  credits_usd: number;
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
  earliestRetryAt(entries: { provider: string; model: string }[], now?: Date): string | null;
  refreshIfStale(provider: string, model: string): Promise<void>;
};

type QuotaDeps = {
  sqlite: Database.Database;
  spendToday?: (dateKey: string) => number;
  costOf?: (provider: string, model: string, inputTokens: number, outputTokens: number) => number;
  notifyPaid?: (message: string) => void;
  timeZone?: () => string;
  now?: () => Date;
  refreshLive?: () => Promise<void>;
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
    "SELECT provider, model, window, window_start, requests, input_tokens, output_tokens, credits_usd FROM llm_quota_usage WHERE provider = ?",
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
  const bucket: UsageBucket = { requests: 0, inputTokens: 0, outputTokens: 0, creditsUsd: 0 };
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
    bucket.creditsUsd += row.credits_usd ?? 0;
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
      ...(limit.creditsUsd !== undefined ? {
        creditsUsdUsed: used.creditsUsd,
        creditsUsdLimit: limit.creditsUsd,
        unit: limitUnit(limit),
      } : {}),
      ratio: limitRatio(limit, used),
    };
  });
}

function creditState(rule: LlmQuotaRule, rows: UsageRow[], model: string, now: Date): "ok" | "near" | "exhausted" | null {
  let saw = false;
  let near = false;
  for (const limit of rule.limits) {
    if (limit.creditsUsd === undefined && limitUnit(limit) !== "credits_usd" && limitUnit(limit) !== "credits") continue;
    saw = true;
    const spent = usageForRule(rows, rule, model, limit.window, now).creditsUsd;
    const status = creditAllowanceStatus({
      grantedUsd: limit.creditsUsd ?? 0,
      spentUsd: spent,
      expiresAt: limit.expiresAt,
      now,
    });
    if (status === "exhausted") return "exhausted";
    if (status === "near") near = true;
  }
  if (!saw) return null;
  return near ? "near" : "ok";
}

function statusForRule(
  rule: LlmQuotaRule,
  rows: UsageRow[],
  model: string,
  cooldown: CooldownRow | undefined,
  nearLimitRatio: number,
  now: Date,
): { status: LlmQuotaRow["status"]; ratio: number } {
  const credit = creditState(rule, rows, model, now);
  if (credit === "exhausted") return { status: "exhausted", ratio: 1 };
  if (activeCooldown(cooldown, now)) return { status: "cooldown", ratio: worstRatio(rule, rows, model, now) };
  const ratio = worstRatio(rule, rows, model, now);
  if (ratio >= 1) return { status: "exhausted", ratio };
  if (credit === "near" || ratio >= nearLimitRatio) return { status: "near", ratio };
  return { status: "ok", ratio };
}

function limitingReset(rule: LlmQuotaRule, rows: UsageRow[], model: string, now: Date): string | null {
  let bestRatio = -1;
  let best: LlmQuotaLimit | null = null;
  for (const limit of rule.limits) {
    const ratio = limitRatio(limit, usageForRule(rows, rule, model, limit.window, now));
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = limit;
    }
  }
  if (!best || bestRatio <= 0) best = rule.limits.find((limit) => limit.window === "day") ?? rule.limits[0] ?? null;
  if (!best) return null;
  if (best.window === "lifetime") return best.expiresAt ?? null;
  return nextReset(best.window, now, rule.resetTz).toISOString();
}

function ruleCoveredByLive(rule: LlmQuotaRule, snapshots: readonly QuotaSnapshot[], now: Date): boolean {
  const fresh = freshSnapshots(snapshots, now).filter((row) => {
    const mapped = appProviderForOmniroute(row.omnirouteProvider);
    return mapped !== null && mapped === rule.provider;
  });
  if (fresh.length === 0) return false;
  if (rule.model === "*" || rule.model.includes("*")) return true;
  return matchLiveQuota(fresh.map((row) => row.quotaKey), rule.model) != null;
}

export function readQuotaStatus(sqlite: Database.Database, now = new Date(), spendToday = 0): LlmQuotaStatus {
  backfillLlmQuotaUsage(sqlite, now);
  const settings = readSettings(sqlite);
  const zone = appTimeZone(sqlite);
  const dateKey = localDateKey(now, zone);
  const display = listQuotaRulesForDisplay({
    presets: LLM_QUOTA_PRESETS,
    userRules: settings.rules,
    disabled: settings.disabled,
  });
  const usageByProvider = new Map<string, UsageRow[]>();
  const snapshots = loadQuotaSnapshots(sqlite);
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
      nextReset: limitingReset(rule, usage, sampleModel, now),
      status: judged.status,
      cooldownUntil: cooldown && activeCooldown(cooldown, now) ? cooldown.until : null,
      cooldownReason: cooldown && activeCooldown(cooldown, now) ? cooldown.reason : null,
      coveredByLive: rule.enabled && ruleCoveredByLive(rule, snapshots, now),
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
    freeCreditSpendUsd: readFreeCreditSpend(sqlite),
    rows,
    cooldowns: cooldowns.map((row): LlmQuotaCooldown => ({
      provider: row.provider,
      model: row.model,
      until: row.until,
      reason: row.reason,
      setAt: row.set_at,
    })),
    omniroute: buildOmnirouteQuotaView(sqlite, now, {
      rules: enabledRules(settings),
      nearLimitRatio: settings.nearLimitRatio,
    }),
  };
}

function readFreeCreditSpend(sqlite: Database.Database): number {
  const row = sqlite.prepare(
    "SELECT COALESCE(SUM(credits_usd), 0) AS usd FROM llm_quota_usage WHERE window = 'lifetime'",
  ).get() as { usd: number } | undefined;
  return row?.usd ?? 0;
}

export function backfillLlmQuotaUsage(sqlite: Database.Database, now = new Date()): { applied: boolean } {
  const existing = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(BACKFILL_KEY) as { value: string } | undefined;
  if (existing) return { applied: false };
  const jobs = sqlite.prepare(
    "SELECT usage, finished_at, started_at FROM jobs WHERE usage IS NOT NULL",
  ).all() as { usage: string | null; finished_at: string | null; started_at: string | null }[];
  type Bucket = { provider: string; model: string; window: string; start: string; requests: number; input: number; output: number };
  const buckets = new Map<string, Bucket>();
  const rules = enabledRules(readSettings(sqlite));
  const add = (provider: string, model: string, window: string, start: string, inputTokens: number, outputTokens: number) => {
    const key = `${provider}\0${model}\0${window}\0${start}`;
    const current = buckets.get(key) ?? { provider, model, window, start, requests: 0, input: 0, output: 0 };
    current.requests += 1;
    current.input += inputTokens;
    current.output += outputTokens;
    buckets.set(key, current);
  };
  for (const job of jobs) {
    const whenRaw = job.finished_at || job.started_at;
    if (!whenRaw || !job.usage) continue;
    const when = new Date(whenRaw);
    if (Number.isNaN(when.getTime())) continue;
    let usage: { calls?: { provider?: string; model?: string; inputTokens?: number; outputTokens?: number; cached?: boolean }[] };
    try {
      usage = typeof job.usage === "string" ? JSON.parse(job.usage) as typeof usage : job.usage;
    } catch {
      continue;
    }
    for (const call of usage.calls ?? []) {
      if (!call.provider || call.cached) continue;
      const model = call.model ?? "";
      const tz = ruleForModel(rules, call.provider, model)?.resetTz ?? "UTC";
      const dayStart = currentWindowStart("day", now, tz);
      const monthStart = currentWindowStart("month", now, tz);
      const rollingCut = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      const inputTokens = call.inputTokens ?? 0;
      const outputTokens = call.outputTokens ?? 0;
      if (when >= dayStart) add(call.provider, model, "day", dayStart.toISOString(), inputTokens, outputTokens);
      if (when >= monthStart) add(call.provider, model, "month", monthStart.toISOString(), inputTokens, outputTokens);
      if (when >= rollingCut) add(call.provider, model, "rolling_5h", when.toISOString(), inputTokens, outputTokens);
    }
  }
  const insert = sqlite.prepare(
    `INSERT INTO llm_quota_usage (id, provider, model, window_start, window, requests, input_tokens, output_tokens, credits_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(provider, model, window, window_start) DO UPDATE SET
       requests = excluded.requests,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens`,
  );
  const tx = sqlite.transaction(() => {
    const remove = sqlite.prepare(
      "DELETE FROM llm_quota_usage WHERE provider = ? AND model = ? AND window = ? AND window_start = ?",
    );
    const rollingSeen = new Set<string>();
    const rollingCut = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
    for (const bucket of buckets.values()) {
      if (bucket.window === "rolling_5h") {
        const key = `${bucket.provider}\0${bucket.model}`;
        if (!rollingSeen.has(key)) {
          rollingSeen.add(key);
          sqlite.prepare(
            "DELETE FROM llm_quota_usage WHERE provider = ? AND model = ? AND window = 'rolling_5h' AND window_start >= ?",
          ).run(bucket.provider, bucket.model, rollingCut);
        }
      } else {
        remove.run(bucket.provider, bucket.model, bucket.window, bucket.start);
      }
    }
    for (const bucket of buckets.values()) {
      insert.run(randomUUID(), bucket.provider, bucket.model, bucket.start, bucket.window, bucket.requests, bucket.input, bucket.output);
    }
    sqlite.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run(BACKFILL_KEY, JSON.stringify("done"), now.toISOString());
  });
  tx();
  return { applied: true };
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
  const live = liveMatchFor(loadQuotaSnapshots(sqlite), provider, model, now);
  if (live) {
    const status = liveQuotaStatus({
      key: live.quotaKey,
      unit: live.unit,
      used: live.used,
      total: live.total,
      remaining: live.remaining,
      remainingPct: live.remainingPct,
      resetAt: live.resetAt,
      expiresAt: live.expiresAt,
      unlimited: live.unlimited,
      fractionReported: live.fractionReported,
    }, settings.nearLimitRatio, now);
    const remaining = live.unit === "requests" && live.remaining != null ? Math.max(0, Math.round(live.remaining)) : null;
    const quotaStatus = status === "near" ? "near_limit"
      : status === "exhausted" ? "exhausted"
        : "available";
    return { kind: kind ?? "unknown", remainingRequestsToday: remaining, quotaStatus };
  }
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
    deps.sqlite.prepare("DELETE FROM llm_quota_usage WHERE window_start < ? AND window != 'lifetime'").run(pruneBefore);
    const insert = deps.sqlite.prepare(
      `INSERT INTO llm_quota_usage (id, provider, model, window_start, window, requests, input_tokens, output_tokens, credits_usd)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(provider, model, window, window_start) DO UPDATE SET
         requests = requests + 1,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         credits_usd = credits_usd + excluded.credits_usd`,
    );
    const settings = readSettings(deps.sqlite);
    const rule = ruleForModel(enabledRules(settings), input.provider, input.model);
    const tz = rule?.resetTz ?? "UTC";
    const creditLimit = rule?.limits.find((limit) => (limit.creditsUsd ?? 0) > 0);
    const creditUsd = creditLimit
      ? Math.max(0, deps.costOf?.(input.provider, input.model, input.inputTokens, input.outputTokens) ?? 0)
      : 0;
    for (const window of WINDOWS) {
      const start = window === "rolling_5h"
        ? now.toISOString()
        : currentWindowStart(window, now, tz).toISOString();
      insert.run(randomUUID(), input.provider, input.model, start, window, input.inputTokens, input.outputTokens, 0);
    }
    if (creditLimit) {
      insert.run(
        randomUUID(),
        input.provider,
        input.model,
        currentWindowStart("lifetime", now, tz).toISOString(),
        "lifetime",
        input.inputTokens,
        input.outputTokens,
        creditUsd,
      );
    }
  }

  function syncLive(provider: string, model: string, now: Date): "ok" | "exhausted" | "credit" | "miss" {
    const match = liveMatchFor(loadQuotaSnapshots(deps.sqlite), provider, model, now);
    if (!match) return "miss";
    const parsed = {
      key: match.quotaKey,
      unit: match.unit,
      used: match.used,
      total: match.total,
      remaining: match.remaining,
      remainingPct: match.remainingPct,
      resetAt: match.resetAt,
      expiresAt: match.expiresAt,
      unlimited: match.unlimited,
      fractionReported: match.fractionReported,
    };
    if (!isLiveExhausted(parsed)) {
      const cooldown = loadCooldown(deps.sqlite, provider, model);
      if (cooldown?.reason.startsWith("OmniRoute:")) clearLlmCooldown(deps.sqlite, provider, model);
      return "ok";
    }
    if ((match.unit === "credits_usd" || match.unit === "credits") && !match.resetAt) return "credit";
    const resetMs = match.resetAt ? Date.parse(match.resetAt) : Number.NaN;
    const untilMs = Number.isFinite(resetMs) && resetMs > now.getTime()
      ? resetMs
      : now.getTime() + LIVE_QUOTA_COOLDOWN_FALLBACK_MS;
    upsertCooldown(deps.sqlite, provider, model, new Date(untilMs).toISOString(), `OmniRoute: hết quota ${match.quotaKey}`, now);
    return "exhausted";
  }

  function isUnavailable(provider: string, model: string, now = nowFn()): boolean {
    const live = syncLive(provider, model, now);
    const cooldown = loadCooldown(deps.sqlite, provider, model);
    if (live === "ok") return Boolean(activeCooldown(cooldown, now) && !cooldown?.reason.startsWith("OmniRoute:"));
    if (live === "exhausted" || live === "credit") return true;
    if (activeCooldown(cooldown, now)) return true;
    const settings = readSettings(deps.sqlite);
    const rule = ruleForModel(enabledRules(settings), provider, model);
    if (!rule) return false;
    const rows = loadUsage(deps.sqlite, provider);
    if (creditState(rule, rows, model, now) === "exhausted") return true;
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
    upsertCooldown(deps.sqlite, input.provider, input.model, until, chosen.reason, now);
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
      let blockedWithoutReset = false;
      for (const entry of entries) {
        const live = syncLive(entry.provider, entry.model, now);
        if (live === "credit") {
          blockedWithoutReset = true;
          continue;
        }
        if (live === "ok") {
          const cooldown = loadCooldown(deps.sqlite, entry.provider, entry.model);
          if (activeCooldown(cooldown, now) && !cooldown?.reason.startsWith("OmniRoute:")) times.push(Date.parse(cooldown!.until));
          continue;
        }
        if (live === "exhausted") {
          const cooldown = loadCooldown(deps.sqlite, entry.provider, entry.model);
          if (cooldown) times.push(Date.parse(cooldown.until));
          continue;
        }
        const cooldown = loadCooldown(deps.sqlite, entry.provider, entry.model);
        if (activeCooldown(cooldown, now)) times.push(Date.parse(cooldown!.until));
        const rule = ruleForModel(rules, entry.provider, entry.model);
        if (!rule) continue;
        const rows = loadUsage(deps.sqlite, entry.provider);
        let timed = false;
        for (const limit of rule.limits) {
          const used = usageForRule(rows, rule, entry.model, limit.window, now);
          const creditLimit = (limit.creditsUsd ?? 0) > 0 || limit.window === "lifetime";
          if (creditLimit && creditAllowanceStatus({
            grantedUsd: limit.creditsUsd ?? 0,
            spentUsd: used.creditsUsd,
            expiresAt: limit.expiresAt,
            now,
          }) === "exhausted") {
            blockedWithoutReset = true;
            continue;
          }
          if (limitRatio(limit, used) >= 1 && limit.window !== "lifetime") {
            timed = true;
            times.push(nextReset(limit.window, now, rule.resetTz).getTime());
          }
        }
        if (!timed && creditState(rule, rows, entry.model, now) === "exhausted") blockedWithoutReset = true;
      }
      const soonest = times.filter((time) => Number.isFinite(time) && time > now.getTime());
      if (soonest.length === 0) return blockedWithoutReset ? null : new Date(now.getTime() + 60_000).toISOString();
      return new Date(Math.min(...soonest)).toISOString();
    },
    async refreshIfStale(provider, model) {
      if (process.env.VITEST) return;
      if (!deps.refreshLive) return;
      const fetchedAt = latestSnapshotFetchedAt(deps.sqlite, provider, model);
      if (!shouldRefreshLiveQuota({ provider, model, fetchedAt, now: nowFn() })) return;
      await deps.refreshLive();
    },
  };
}

function upsertCooldown(sqlite: Database.Database, provider: string, model: string, until: string, reason: string, now: Date): void {
  sqlite.prepare(
    `INSERT INTO llm_cooldowns (provider, model, until, reason, set_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider, model) DO UPDATE SET until = excluded.until, reason = excluded.reason, set_at = excluded.set_at`,
  ).run(provider, model, until, reason, now.toISOString());
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
