import { z } from "zod";
import type { LlmQuotaUnit, LiveQuotaStatus } from "../schemas/llmQuota.js";

/** How long a snapshot overrides the local estimate. */
export const LIVE_QUOTA_FRESH_MS = 20 * 60 * 1000;
/** Refresh before a job when the last snapshot is older than this. */
export const LIVE_QUOTA_PREJOB_MS = 15 * 60 * 1000;
export const LIVE_QUOTA_REFRESH_GAP_MS = 60 * 1000;
export const LIVE_QUOTA_COOLDOWN_FALLBACK_MS = 60 * 60 * 1000;

const PROVIDER_WIDE_KEYS = new Set([
  "premium_interactions",
  "chat",
  "completions",
  "five_hour",
  "five-hour",
  "seven_day",
  "seven-day",
  "weekly",
  "weekly_all",
  "weekly-all",
  "session",
  "requests",
  "free_daily",
  "free_rpm",
  "spend",
]);

export const OMNIROUTE_TO_APP_PROVIDER: Record<string, string> = {
  antigravity: "antigravity-cli",
  agy: "antigravity-cli",
  github: "copilot-cli",
  claude: "claude-cli",
  gemini: "gemini",
  openrouter: "openrouter",
  groq: "groq",
  codex: "codex",
};

const APP_PROVIDERS = new Set([
  "antigravity-cli",
  "copilot-cli",
  "claude-cli",
  "gemini",
  "openrouter",
  "groq",
  "omniroute",
]);

export function appProviderForOmniroute(provider: string): string | null {
  return OMNIROUTE_TO_APP_PROVIDER[provider.toLowerCase()] ?? null;
}

export function omnirouteProvidersForApp(provider: string): string[] {
  return Object.entries(OMNIROUTE_TO_APP_PROVIDER)
    .filter(([, app]) => app === provider)
    .map(([omni]) => omni);
}

export function omnirouteCoversProvider(provider: string): boolean {
  return provider === "omniroute" || omnirouteProvidersForApp(provider).length > 0;
}

/** Prefill for a manual rule when OmniRoute does not report a quota. */
export function manualRuleTarget(omniProvider: string): { provider: string; model: string } {
  const app = appProviderForOmniroute(omniProvider);
  if (app && APP_PROVIDERS.has(app)) return { provider: app, model: "*" };
  return { provider: "omniroute", model: `${omniProvider}/*` };
}

export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "***";
  return `${trimmed.slice(0, 1)}***@${trimmed.slice(at + 1)}`;
}

export function maskEmailsInText(text: string): string {
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (match) => maskEmail(match));
}

export function normalizeQuotaToken(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-(low|high|medium|preview|latest|thinking)$/g, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/g, "")
    .replace(/-\d{8}$/g, "");
}

function isProviderWideKey(key: string): boolean {
  const norm = normalizeQuotaToken(key);
  return PROVIDER_WIDE_KEYS.has(key.toLowerCase()) || PROVIDER_WIDE_KEYS.has(norm);
}

/**
 * Match a model to OmniRoute quota keys.
 * Family (model id or a shared prefix such as `gemini-3` / `claude`) wins over a provider-wide bucket.
 */
export function matchLiveQuota(
  keys: readonly string[],
  modelId: string,
): { key: string; match: "family" | "provider" } | null {
  const model = normalizeQuotaToken(modelId);
  const family: { key: string; rank: number }[] = [];
  for (const key of keys) {
    if (!key || key.startsWith("__") || isProviderWideKey(key)) continue;
    const norm = normalizeQuotaToken(key);
    if (norm.length < 3 || model.length < 3) continue;
    const related = norm === model
      || model.startsWith(`${norm}-`)
      || norm.startsWith(`${model}-`)
      || (norm.length >= 5 && (model.includes(norm) || norm.includes(model)));
    if (!related) continue;
    family.push({ key, rank: norm === model ? 0 : Math.abs(norm.length - model.length) + 1 });
  }
  family.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  if (family[0]) return { key: family[0].key, match: "family" };
  const provider = keys.find((key) => key && !key.startsWith("__") && isProviderWideKey(key));
  return provider ? { key: provider, match: "provider" } : null;
}

export function shouldRefreshLiveQuota(input: {
  provider: string;
  model: string;
  fetchedAt: string | null;
  now: Date;
}): boolean {
  if (!omnirouteCoversProvider(input.provider)) return false;
  if (input.provider === "omniroute" && !input.model.includes("/")) return false;
  if (!input.fetchedAt) return true;
  const fetched = Date.parse(input.fetchedAt);
  if (!Number.isFinite(fetched)) return true;
  return input.now.getTime() - fetched > LIVE_QUOTA_PREJOB_MS;
}

const usageQuotaSchema = z.object({
  used: z.number().optional(),
  total: z.number().optional(),
  remaining: z.number().optional(),
  remainingPercentage: z.number().optional(),
  resetAt: z.string().nullable().optional(),
  unlimited: z.boolean().optional(),
  fractionReported: z.boolean().optional(),
  currency: z.string().optional(),
  displayName: z.string().optional(),
  plan: z.string().optional(),
  message: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
}).passthrough();

export type ParsedLiveQuota = {
  key: string;
  unit: LlmQuotaUnit;
  used: number | null;
  total: number | null;
  remaining: number | null;
  remainingPct: number | null;
  resetAt: string | null;
  expiresAt: string | null;
  unlimited: boolean;
  fractionReported: boolean | null;
};

export type ParsedUsagePayload =
  | { kind: "message"; message: string }
  | { kind: "quotas"; plan: string | null; quotas: ParsedLiveQuota[] };

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function inferUnit(key: string, quota: z.infer<typeof usageQuotaSchema>, plan: string | undefined): LlmQuotaUnit {
  const blob = `${key} ${quota.displayName ?? ""} ${quota.plan ?? ""} ${plan ?? ""} ${quota.currency ?? ""}`.toLowerCase();
  if (quota.currency?.toUpperCase() === "CNY" || blob.includes("cny")) return "credits";
  if (quota.currency?.toUpperCase() === "USD" || /credits?[_-]usd|\busd\b|\$/.test(blob)) return "credits_usd";
  if (/credit|balance/.test(blob)) return "credits_usd";
  if (/token/.test(blob)) return "tokens";
  return "requests";
}

function isCreditUnit(unit: LlmQuotaUnit): boolean {
  return unit === "credits_usd" || unit === "credits";
}

export function parseOmnirouteUsage(payload: unknown): ParsedUsagePayload {
  const root = z.object({
    plan: z.string().optional(),
    message: z.string().optional(),
    quotas: z.record(z.string(), z.unknown()).optional(),
  }).passthrough().safeParse(payload);
  if (!root.success) {
    return { kind: "message", message: "Nhà cung cấp không trả dữ liệu quota đọc được." };
  }
  const quotas: ParsedLiveQuota[] = [];
  for (const [key, value] of Object.entries(root.data.quotas ?? {})) {
    const parsed = usageQuotaSchema.safeParse(value);
    if (!parsed.success) continue;
    const unit = inferUnit(key, parsed.data, root.data.plan);
    const credit = isCreditUnit(unit);
    const used = finite(parsed.data.used) ?? null;
    const total = finite(parsed.data.total) ?? null;
    const remaining = finite(parsed.data.remaining) ?? null;
    const remainingPct = finite(parsed.data.remainingPercentage) ?? null;
    const onlyRemaining = credit && (total == null || total <= 0) && remaining != null;
    quotas.push({
      key,
      unit,
      used: onlyRemaining ? null : used,
      total: onlyRemaining ? null : total,
      remaining,
      remainingPct: onlyRemaining ? null : remainingPct,
      resetAt: parsed.data.resetAt ?? null,
      expiresAt: typeof parsed.data.expiresAt === "string" ? parsed.data.expiresAt : null,
      unlimited: credit ? false : parsed.data.unlimited === true,
      fractionReported: parsed.data.fractionReported ?? null,
    });
  }
  if (quotas.length === 0) {
    return { kind: "message", message: root.data.message?.slice(0, 240) || "Không có số liệu quota." };
  }
  return { kind: "quotas", plan: root.data.plan ?? null, quotas };
}

export function isLiveExhausted(quota: {
  used: number | null;
  total: number | null;
  remaining: number | null;
  remainingPct: number | null;
  unlimited: boolean;
  fractionReported: boolean | null;
  unit: LlmQuotaUnit;
}): boolean {
  if (quota.unlimited) return false;
  if (quota.fractionReported === false) return false;
  if (isCreditUnit(quota.unit)) {
    if (quota.remaining != null && quota.total != null && quota.total > 0) return quota.remaining <= 0 || (quota.used ?? 0) >= quota.total;
    if (quota.remaining != null && (quota.total == null || quota.total <= 0)) return quota.remaining <= 0;
  }
  if (quota.remainingPct != null && quota.remainingPct <= 0) return true;
  if ((quota.total ?? 0) > 0 && (quota.used ?? 0) >= (quota.total ?? 0)) return true;
  return false;
}

export function liveQuotaStatus(quota: ParsedLiveQuota, nearLimitRatio: number, now = new Date()): LiveQuotaStatus {
  if (quota.fractionReported === false) return "unknown";
  if (quota.unlimited) return "ok";
  if (isCreditUnit(quota.unit)) {
    const granted = quota.total != null && quota.total > 0 ? quota.total : (quota.remaining ?? 0) + (quota.used ?? 0);
    const spent = quota.used ?? (granted > 0 && quota.remaining != null ? Math.max(0, granted - quota.remaining) : 0);
    if (quota.expiresAt && Date.parse(quota.expiresAt) <= now.getTime()) return "exhausted";
    if (quota.remaining != null && quota.remaining <= 0) return "exhausted";
    if (granted > 0 && spent >= granted) return "exhausted";
    const remaining = quota.remaining ?? Math.max(0, granted - spent);
    const expiring = quota.expiresAt != null && Date.parse(quota.expiresAt) - now.getTime() <= 3 * 24 * 60 * 60 * 1000;
    if (expiring || (granted > 0 && remaining <= granted * 0.1) || (quota.unit === "credits_usd" && remaining < 0.5 && remaining > 0 && granted > 0)) {
      return "near";
    }
    return "ok";
  }
  if (isLiveExhausted(quota)) return "exhausted";
  const remainingFrac = quota.remainingPct != null
    ? quota.remainingPct / 100
    : quota.total && quota.total > 0 && quota.used != null
      ? Math.max(0, 1 - quota.used / quota.total)
      : 1;
  if (remainingFrac <= 1 - nearLimitRatio) return "near";
  return "ok";
}

export function formatLiveQuota(quota: ParsedLiveQuota): string {
  if (quota.unlimited) return "không giới hạn";
  if (isCreditUnit(quota.unit) && (quota.total == null || quota.total <= 0) && quota.remaining != null) {
    const amount = quota.remaining.toFixed(2);
    return quota.unit === "credits_usd" ? `còn $${amount}` : `còn ${amount} điểm`;
  }
  if (quota.used == null && quota.total == null) return "không giới hạn";
  const used = quota.used ?? 0;
  const total = quota.total ?? 0;
  if (quota.unit === "credits_usd") return `$${used.toFixed(2)} / $${total.toFixed(2)}`;
  if (quota.unit === "credits") return `${used.toFixed(2)} / ${total.toFixed(2)} điểm`;
  if (quota.unit === "tokens") return `${Math.round(used)} / ${Math.round(total)} tokens`;
  return `${Math.round(used)} / ${Math.round(total)} lượt`;
}

export function formatExpiryLabel(expiresAt: string | null, timeZone = "Asia/Ho_Chi_Minh"): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  const label = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", timeZone }).format(date);
  return `hết hạn ngày ${label}`;
}

export function relativeUntil(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "đã tới hạn";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `còn ${Math.max(1, minutes)} phút`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `còn ${hours} giờ`;
  return `còn ${Math.round(hours / 24)} ngày`;
}

export function callTargetsOmniProvider(provider: string, model: string, omniProvider: string): boolean {
  const wanted = omniProvider.toLowerCase();
  if (provider === "omniroute") {
    const slash = model.indexOf("/");
    if (slash <= 0) return false;
    const prefix = model.slice(0, slash).toLowerCase();
    return prefix === wanted || appProviderForOmniroute(prefix) === appProviderForOmniroute(wanted);
  }
  return omnirouteProvidersForApp(provider).includes(wanted);
}

export function modelIdForLiveMatch(provider: string, model: string): string {
  if (provider !== "omniroute") return model;
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(slash + 1) : model;
}

export function summarizeRateLimit(payload: unknown, connectionId: string): string | null {
  const found = findRateLimit(payload, connectionId, 0);
  if (!found) return null;
  const message = typeof found.message === "string" ? found.message : typeof found.status === "string" ? found.status : "";
  if (message && message.length <= 160 && !/bearer|token|authorization/i.test(message)) {
    return maskEmailsInText(message);
  }
  if (found.limited === true || found.isLimited === true || found.rateLimited === true) return "đang bị giới hạn tốc độ";
  if (typeof found.remaining === "number" && Number.isFinite(found.remaining)) {
    return `còn ${found.remaining} lượt trong cửa sổ giới hạn`;
  }
  return "có trạng thái giới hạn tốc độ";
}

function findRateLimit(payload: unknown, connectionId: string, depth: number): Record<string, unknown> | null {
  if (depth > 6 || payload == null || typeof payload !== "object") return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findRateLimit(item, connectionId, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = payload as Record<string, unknown>;
  const keyed = record[connectionId];
  if (keyed && typeof keyed === "object") return keyed as Record<string, unknown>;
  const id = record.connectionId ?? record.connection_id ?? record.id;
  if (id === connectionId) return record;
  for (const value of Object.values(record)) {
    const found = findRateLimit(value, connectionId, depth + 1);
    if (found) return found;
  }
  return null;
}
