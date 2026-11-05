import type Database from "better-sqlite3";
import {
  LLM_TASKS,
  LIVE_QUOTA_FRESH_MS,
  ProfileLlmSettingsSchema,
  appProviderForOmniroute,
  callTargetsOmniProvider,
  fallbackChainOf,
  formatExpiryLabel,
  formatLiveQuota,
  liveQuotaStatus,
  manualRuleTarget,
  matchLiveQuota,
  modelIdForLiveMatch,
  ruleForModel,
  type LlmQuotaRule,
  type LlmRoute,
  type MissingQuotaModel,
  type OmniRouteConnectionCard,
  type OmniRouteLiveView,
  type ParsedLiveQuota,
} from "@vg/shared";
import { getAppLlmSettings } from "./settings.js";
import {
  NONE_QUOTA_KEY,
  loadQuotaSnapshots,
  managementTokenSaved,
  readSyncState,
  type QuotaSnapshot,
} from "./omnirouteQuotaStore.js";

type RoutedModel = { provider: string; model: string; task: string; label: string };

export function buildOmnirouteQuotaView(
  sqlite: Database.Database,
  now: Date,
  input: {
    rules: readonly LlmQuotaRule[];
    nearLimitRatio: number;
    tokenLast4?: string | null;
  },
): OmniRouteLiveView {
  const sync = readSyncState(sqlite);
  const snapshots = loadQuotaSnapshots(sqlite);
  const routed = collectRoutedModels(sqlite);
  const connections = groupConnections(snapshots).map((group) => toCard(group, routed, input.nearLimitRatio, now));
  return {
    status: sync.status,
    fetchedAt: sync.fetchedAt,
    tokenSaved: managementTokenSaved(sqlite),
    tokenLast4: input.tokenLast4 ?? null,
    dashboardUrl: sync.dashboardUrl,
    message: sync.message,
    connections,
    missingModels: missingModels(routed, snapshots, input.rules, now),
  };
}

export function freshSnapshots(snapshots: readonly QuotaSnapshot[], now: Date): QuotaSnapshot[] {
  return snapshots.filter((row) => {
    if (row.quotaKey === NONE_QUOTA_KEY || row.error) return false;
    const fetched = Date.parse(row.fetchedAt);
    return Number.isFinite(fetched) && now.getTime() - fetched <= LIVE_QUOTA_FRESH_MS;
  });
}

export function liveMatchFor(
  snapshots: readonly QuotaSnapshot[],
  provider: string,
  model: string,
  now: Date,
): QuotaSnapshot | null {
  const fresh = freshSnapshots(snapshots, now).filter((row) => callTargetsOmniProvider(provider, model, row.omnirouteProvider));
  if (fresh.length === 0) return null;
  const matched = matchLiveQuota(fresh.map((row) => row.quotaKey), modelIdForLiveMatch(provider, model));
  if (!matched) return null;
  return fresh.find((row) => row.quotaKey === matched.key) ?? null;
}

function collectRoutedModels(sqlite: Database.Database): RoutedModel[] {
  const out: RoutedModel[] = [];
  const add = (route: LlmRoute | null | undefined, task: string, label: string) => {
    if (!route?.provider || !route.model) return;
    out.push({ provider: route.provider, model: route.model, task, label });
    for (const entry of fallbackChainOf(route)) {
      if (!entry.provider || !entry.model) continue;
      out.push({ provider: entry.provider, model: entry.model, task, label });
    }
  };
  const settings = getAppLlmSettings(sqlite);
  add(settings?.default, "default", "Mặc định");
  for (const task of LLM_TASKS) add(settings?.tasks?.[task.id], task.id, task.label);
  const profiles = sqlite.prepare("SELECT llm FROM profiles WHERE llm IS NOT NULL").all() as { llm: string | null }[];
  for (const row of profiles) {
    if (!row.llm) continue;
    try {
      const raw = typeof row.llm === "string" ? JSON.parse(row.llm) as unknown : row.llm;
      const parsed = ProfileLlmSettingsSchema.safeParse(raw);
      if (!parsed.success) continue;
      add(parsed.data.default, "default", "Mặc định");
      for (const task of LLM_TASKS) add(parsed.data.tasks?.[task.id], task.id, task.label);
    } catch {
      // Ignore a profile whose LLM JSON cannot be read.
    }
  }
  return out;
}

function groupConnections(snapshots: readonly QuotaSnapshot[]): QuotaSnapshot[][] {
  const groups = new Map<string, QuotaSnapshot[]>();
  for (const row of snapshots) {
    const list = groups.get(row.connectionId) ?? [];
    list.push(row);
    groups.set(row.connectionId, list);
  }
  return [...groups.values()];
}

function toCard(rows: QuotaSnapshot[], routed: RoutedModel[], nearLimitRatio: number, now: Date): OmniRouteConnectionCard {
  const first = rows[0]!;
  const real = rows.filter((row) => row.quotaKey !== NONE_QUOTA_KEY);
  const quotas = real.map((row) => {
    const parsed = toParsed(row);
    return {
      key: row.quotaKey,
      unit: row.unit,
      used: row.used,
      total: row.total,
      remaining: row.remaining,
      remainingPct: row.remainingPct,
      resetAt: row.resetAt,
      expiresAt: row.expiresAt,
      unlimited: row.unlimited,
      fractionReported: row.fractionReported,
      status: liveQuotaStatus(parsed, nearLimitRatio, now),
      display: formatLiveQuota(parsed),
      expiryLabel: formatExpiryLabel(row.expiresAt),
    };
  });
  const tasks = [...new Set(routed.filter((item) => callTargetsOmniProvider(item.provider, item.model, first.omnirouteProvider)).map((item) => item.label))];
  return {
    connectionId: first.connectionId,
    provider: first.omnirouteProvider,
    appProvider: appProviderForOmniroute(first.omnirouteProvider),
    label: first.label,
    maskedAccount: first.maskedAccount,
    active: first.active,
    fetchedAt: first.fetchedAt,
    error: rows.find((row) => row.error)?.error ?? null,
    quotas,
    noQuotaData: real.length === 0 && !rows.some((row) => row.error),
    tasks,
    rateLimitNote: rows.find((row) => row.rateLimitNote)?.rateLimitNote ?? null,
    manualRule: manualRuleTarget(first.omnirouteProvider),
  };
}

function toParsed(row: QuotaSnapshot): ParsedLiveQuota {
  return {
    key: row.quotaKey,
    unit: row.unit,
    used: row.used,
    total: row.total,
    remaining: row.remaining,
    remainingPct: row.remainingPct,
    resetAt: row.resetAt,
    expiresAt: row.expiresAt,
    unlimited: row.unlimited,
    fractionReported: row.fractionReported,
  };
}

function missingModels(
  routed: readonly RoutedModel[],
  snapshots: readonly QuotaSnapshot[],
  rules: readonly LlmQuotaRule[],
  now: Date,
): MissingQuotaModel[] {
  const grouped = new Map<string, MissingQuotaModel>();
  for (const item of routed) {
    if (ruleForModel(rules, item.provider, item.model)) continue;
    if (liveMatchFor(snapshots, item.provider, item.model, now)) continue;
    const key = `${item.provider}\0${item.model}`;
    const current = grouped.get(key) ?? { provider: item.provider, model: item.model, tasks: [] };
    if (!current.tasks.includes(item.label)) current.tasks.push(item.label);
    grouped.set(key, current);
  }
  return [...grouped.values()];
}
