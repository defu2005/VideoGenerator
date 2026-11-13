import { knowledgeConsumers } from "./consumers.js";

export const EVENT_SEVERITIES = ["info", "warn", "high", "critical"] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];
export const REACTION_IDS = ["R0", "R1", "R2", "R3", "R4", "R5"] as const;
export type ReactionId = (typeof REACTION_IDS)[number];
export const CHANGE_STATUSES = ["open", "acknowledged", "resolved", "ignored"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** Categories that already have a configured fallback, so a warning may adapt instead of only proposing. */
const ADAPT_CATEGORIES = new Set(["B2", "D1", "D2", "D3", "F1"]);

const HIGH_RISK_KINDS = new Set([
  "law", "account_policy", "platform_capability", "api_contract", "monetization_program",
]);

export const INVESTIGATION_CHECKS = [
  "So kênh khác",
  "So nền tảng khác",
  "So cùng tuần năm trước",
  "So phiên bản tri thức trước và sau",
  "Đọc lỗi đồng bộ",
] as const;

export const INVESTIGATION_HYPOTHESES = [
  "Nền tảng đổi",
  "Nội dung của mình đổi",
  "Yếu tố mùa",
  "Lỗi dữ liệu hoặc đồng bộ",
] as const;

export function defaultReactions(category: string, severity: EventSeverity): ReactionId[] {
  if (severity === "critical") return ["R4", "R1"];
  if (severity === "high") return ["R2", "R1"];
  if (severity === "warn") return [ADAPT_CATEGORIES.has(category) ? "R3" : "R2"];
  return ["R0"];
}

/** A critical account event always keeps R4. The caller cannot store a lower policy. */
export function resolveReactions(input: {
  category: string;
  severity: EventSeverity;
  subjectType: string;
  override?: ReactionId[];
}): ReactionId[] {
  const chosen = input.override ?? defaultReactions(input.category, input.severity);
  const accountCritical = input.severity === "critical" && (input.subjectType === "account" || input.category === "E1");
  if (accountCritical && !chosen.includes("R4")) return ["R4", ...chosen];
  return chosen;
}

export function adaptAllowed(option: {
  configured: boolean;
  allowed: boolean;
  changesMust: boolean;
  overBudget: boolean;
  paidFallback: boolean;
}): boolean {
  return option.configured && option.allowed && !option.changesMust && !option.overBudget && !option.paidFallback;
}

export function consumersForSubject(subject: { type: string; id: string }, explicit?: string[]): string[] {
  if (explicit) return explicit;
  if (subject.type === "knowledge") return knowledgeConsumers(subject.id);
  return [];
}

const PUBLISHER: Record<string, string> = {
  youtube: "YouTubePublisher.publish",
  tiktok: "TikTokPublisher.publish",
};

export type HoldView = { active: boolean; consumer: string; subjectType: string; subjectId: string };

/** A hold stops the consumer that reads the fact, or that one account. It does not stop every platform. */
export function publishBlocked(holds: HoldView[], account: { id: string; platform: string }): boolean {
  const publisher = PUBLISHER[account.platform];
  return holds.some((hold) => hold.active && (
    (hold.subjectType === "account" && hold.subjectId === account.id)
    || (hold.subjectType !== "account" && publisher !== undefined && hold.consumer === publisher)
  ));
}

export function highRiskKind(kind: string): boolean {
  return HIGH_RISK_KINDS.has(kind);
}

export function watchEveryDays(volatility: "stable" | "yearly" | "quarterly" | "monthly" | "weekly"): number {
  if (volatility === "weekly") return 1;
  if (volatility === "monthly") return 3;
  return 7;
}

export function watchDue(lastChecked: string | null, volatility: "stable" | "yearly" | "quarterly" | "monthly" | "weekly", now: Date): boolean {
  if (!lastChecked) return true;
  const elapsed = now.getTime() - Date.parse(lastChecked);
  return elapsed >= watchEveryDays(volatility) * 86_400_000;
}

/** Drop dates and counters before hashing, the same idea as changedetection.io noise filtering. */
export function stripWatchNoise(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?\b/g, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function watchHash(text: string): string {
  const clean = stripWatchNoise(text);
  let hash = 5381;
  for (let i = 0; i < clean.length; i += 1) hash = Math.imul(hash, 33) ^ clean.charCodeAt(i);
  return (hash >>> 0).toString(16);
}

export function classifyDocument(input: {
  status: number;
  requestedUrl: string;
  finalUrl: string;
  text: string;
  previousHash: string | null;
  canonical?: string | null;
  previousCanonical?: string | null;
  robotsBlocked?: boolean;
}): "manual" | "g1" | "g2" | "unchanged" | "changed" {
  if (input.robotsBlocked || input.status === 403) return "manual";
  let requested: URL | null = null;
  let finalUrl: URL | null = null;
  try {
    requested = new URL(input.requestedUrl);
    finalUrl = new URL(input.finalUrl);
  } catch {
    requested = null;
  }
  if (input.status === 404 || (requested && finalUrl && requested.pathname !== finalUrl.pathname)) return "g1";
  if (stripWatchNoise(input.text).length < 40) return "g2";
  if (input.canonical && input.previousCanonical && input.canonical !== input.previousCanonical) return "g2";
  if (input.previousHash && watchHash(input.text) === input.previousHash) return "unchanged";
  return "changed";
}

export function newFeedItems(text: string, seen: string[]): string[] {
  const ids = [...text.matchAll(/<(?:guid|id|link)[^>]*>([^<]+)</gi)].map((match) => match[1]!.trim());
  const unique = [...new Set(ids)];
  if (seen.length === 0) return [];
  return unique.filter((id) => !seen.includes(id));
}

export function llmBudgetDecision(input: { eco: boolean; used: number; limit: number }): "hash" | "read" {
  if (input.eco || input.used >= input.limit) return "hash";
  return "read";
}

export const DEFAULT_CHANGE_LLM_BUDGET = 20;

export type RuntimeSignal = {
  fingerprint: string;
  kind: string;
  immediate: boolean;
  severity: EventSeverity;
  category: string;
  summary: string;
};

export function signalOf(input: {
  provider: string;
  endpoint: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
  schemaOk?: boolean;
  category?: string;
}): RuntimeSignal | null {
  const headers = Object.fromEntries(Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const category = input.category ?? "D2";
  const base = `${input.provider}|${input.endpoint}`;
  if (headers.sunset || headers.deprecation) {
    return {
      fingerprint: `${base}|sunset`, kind: "sunset", immediate: true, severity: "high", category,
      summary: `${input.provider} báo hiệu ngừng ${input.endpoint}`,
    };
  }
  if (input.error === "invalid_grant") {
    return {
      fingerprint: `${base}|invalid_grant`, kind: "auth", immediate: true, severity: "critical", category: "E1",
      summary: `${input.provider} từ chối token (invalid_grant). Chưa kết luận đây là khoá kênh.`,
    };
  }
  if (input.status === 401 || input.status === 403) {
    return {
      fingerprint: `${base}|auth-${input.status}`, kind: "auth", immediate: true, severity: "high", category: "E1",
      summary: `${input.provider} trả ${input.status} tại ${input.endpoint}. Chưa đủ để kết luận khoá tài khoản.`,
    };
  }
  if (input.error?.startsWith("rejection:")) {
    return {
      fingerprint: `${base}|${input.error}`, kind: "rejection", immediate: true, severity: "high", category,
      summary: `${input.provider} từ chối nội dung (${input.error.slice("rejection:".length)})`,
    };
  }
  if (input.status === 429 || /quota|rate/i.test(input.error ?? "")) {
    return {
      fingerprint: `${base}|quota`, kind: "quota", immediate: false, severity: "warn", category,
      summary: `${input.provider} chạm hạn mức tại ${input.endpoint}`,
    };
  }
  if (input.schemaOk === false) {
    return {
      fingerprint: `${base}|schema`, kind: "schema", immediate: true, severity: "high", category,
      summary: `${input.provider} trả dữ liệu không khớp khuôn tại ${input.endpoint}`,
    };
  }
  if (input.status !== undefined && input.status >= 500) return null;
  if (input.status !== undefined && input.status >= 400) {
    return {
      fingerprint: `${base}|status-${input.status}`, kind: "status", immediate: false, severity: "warn", category,
      summary: `${input.provider} trả mã mới ${input.status} tại ${input.endpoint}`,
    };
  }
  return null;
}

export function cliSignal(input: {
  provider: string;
  version?: string;
  seenVersions: string[];
  message?: string;
  seenMessages: string[];
}): RuntimeSignal | null {
  if (input.version && input.seenVersions.length > 0 && !input.seenVersions.includes(input.version)) {
    return {
      fingerprint: `cli|${input.provider}|version`, kind: "version", immediate: true, severity: "warn", category: "D3",
      summary: `${input.provider} đổi phiên bản ${input.seenVersions[0]} sang ${input.version}`,
    };
  }
  if (input.message && input.seenMessages.length > 0 && !input.seenMessages.includes(input.message)) {
    return {
      fingerprint: `cli|${input.provider}|exit`, kind: "exit", immediate: true, severity: "warn", category: "D3",
      summary: `${input.provider} có thông báo thoát mới`,
    };
  }
  return null;
}

export function signalThreshold(signal: RuntimeSignal, configured = 3): number {
  return signal.immediate ? 1 : configured;
}

export function npmFindings(outdated: unknown, audit: unknown): Array<{ name: string; summary: string; severity: EventSeverity }> {
  const found: Array<{ name: string; summary: string; severity: EventSeverity }> = [];
  if (outdated && typeof outdated === "object") {
    for (const [name, row] of Object.entries(outdated as Record<string, { deprecated?: unknown }>)) {
      if (row && typeof row.deprecated === "string" && row.deprecated) {
        found.push({ name, summary: `${name} bị đánh dấu cũ: ${row.deprecated}`, severity: "warn" });
      }
    }
  }
  const vulnerabilities = (audit as { vulnerabilities?: Record<string, { severity?: string }> } | null)?.vulnerabilities ?? {};
  for (const [name, row] of Object.entries(vulnerabilities)) {
    if (row.severity === "high" || row.severity === "critical") {
      found.push({ name, summary: `${name} có lỗ hổng mức ${row.severity}`, severity: row.severity === "critical" ? "critical" : "high" });
    }
  }
  return found;
}
