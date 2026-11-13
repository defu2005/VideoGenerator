import type { LlmError } from "./types.js";

/**
 * In-memory failover bookkeeping (TASK-127). Design borrowed from LiteLLM Router
 * (cooldown_time / allowed_fails ideas, MIT); no code and no dependency.
 * A restart clears everything, which is acceptable.
 */

export const RATE_LIMIT_COOLDOWN_MS = 60_000;
export const RATE_LIMIT_COOLDOWN_MAX_MS = 15 * 60_000;
export const QUOTA_COOLDOWN_MS = 30 * 60_000;
export const FAILOVER_STORM_WINDOW_MS = 10 * 60_000;
export const FAILOVER_STORM_THRESHOLD = 10;
const EVENT_LIMIT = 200;

export type CooldownReason = "rate_limit" | "quota" | "unavailable";

export type CooldownEntry = {
  key: string;
  provider: string;
  model: string | null;
  until: number;
  reason: CooldownReason;
  streak: number;
  code: string;
};

export type FailoverEvent = {
  at: number;
  task: string;
  from: string;
  to: string;
  reason: string;
};

/** Errors that may move the call to the next provider and put the failing one to rest. */
export function isFailoverError(error: LlmError): boolean {
  if (error.code === "LLM_INVALID_OUTPUT") return false;
  if (error.code === "LLM_QUOTA_EXHAUSTED" || error.code === "LLM_QUOTA_WAIT" || error.code === "LLM_RATE_LIMIT") return true;
  if (error.status === 402 || error.status === 429 || error.status === 503) return true;
  return error.code === "LLM_UNAVAILABLE";
}

function reasonOf(error: LlmError): CooldownReason | null {
  if (error.code === "LLM_QUOTA_EXHAUSTED" || error.code === "LLM_QUOTA_WAIT" || error.status === 402) return "quota";
  if (error.code === "LLM_RATE_LIMIT" || error.status === 429) return "rate_limit";
  if (error.status === 503) return "unavailable";
  return null;
}

export class FailoverTracker {
  private readonly cooldowns = new Map<string, CooldownEntry>();
  private readonly streaks = new Map<string, number>();
  private events: FailoverEvent[] = [];

  private keyOf(provider: string, model: string | null | undefined, error?: LlmError): string {
    // A model-specific problem only rests that model, not the whole provider.
    const modelSpecific = error ? /\bmodel\b/i.test(error.message) : false;
    return modelSpecific && model ? `${provider}:${model}` : provider;
  }

  /** The active cooldown for this provider/model, or null. Expired entries are dropped. */
  cooldownFor(provider: string, model: string | null | undefined): CooldownEntry | null {
    const now = Date.now();
    for (const key of model ? [`${provider}:${model}`, provider] : [provider]) {
      const entry = this.cooldowns.get(key);
      if (!entry) continue;
      if (entry.until <= now) {
        this.cooldowns.delete(key);
        continue;
      }
      return entry;
    }
    return null;
  }

  /** Puts the provider to rest when the error is a quota / rate limit / 402 / 429 / 503. */
  recordFailure(provider: string, model: string | null, error: LlmError): CooldownEntry | null {
    const reason = reasonOf(error);
    if (!reason) return null;
    const key = this.keyOf(provider, model, error);
    const now = Date.now();
    const streak = (this.streaks.get(key) ?? 0) + 1;
    this.streaks.set(key, streak);
    let ms: number;
    if (reason === "quota") {
      const resetAt = error.retryAt ? Date.parse(error.retryAt) : Number.NaN;
      if (Number.isFinite(resetAt) && resetAt > now) ms = resetAt - now;
      else if (error.retryAfterMs && error.retryAfterMs > 0) ms = error.retryAfterMs;
      else ms = QUOTA_COOLDOWN_MS;
    } else {
      ms = Math.min(RATE_LIMIT_COOLDOWN_MS * 2 ** (streak - 1), RATE_LIMIT_COOLDOWN_MAX_MS);
      if (error.retryAfterMs && error.retryAfterMs > ms) ms = Math.min(error.retryAfterMs, RATE_LIMIT_COOLDOWN_MAX_MS);
    }
    const entry: CooldownEntry = {
      key, provider, model: key === provider ? null : model, until: now + ms, reason, streak, code: error.code,
    };
    this.cooldowns.set(key, entry);
    return entry;
  }

  /** A success clears the cooldown and the doubling streak. */
  recordSuccess(provider: string, model: string | null): void {
    for (const key of [provider, model ? `${provider}:${model}` : provider]) {
      this.cooldowns.delete(key);
      this.streaks.delete(key);
    }
  }

  recordFailover(event: Omit<FailoverEvent, "at">): void {
    this.events.push({ at: Date.now(), ...event });
    if (this.events.length > EVENT_LIMIT) this.events = this.events.slice(-EVENT_LIMIT);
  }

  recentFailovers(windowMs = FAILOVER_STORM_WINDOW_MS): FailoverEvent[] {
    const since = Date.now() - windowMs;
    return this.events.filter((event) => event.at >= since);
  }

  snapshot(): {
    cooldowns: Array<{ provider: string; model: string | null; until: string; reason: CooldownReason; streak: number; code: string }>;
    recentFailovers: Array<{ at: string; task: string; from: string; to: string; reason: string }>;
    failoversLast10Min: number;
  } {
    const now = Date.now();
    const cooldowns = [...this.cooldowns.values()]
      .filter((entry) => entry.until > now)
      .map((entry) => ({
        provider: entry.provider, model: entry.model, until: new Date(entry.until).toISOString(),
        reason: entry.reason, streak: entry.streak, code: entry.code,
      }));
    const recent = this.recentFailovers();
    return {
      cooldowns,
      recentFailovers: recent.slice(-20).map((event) => ({ ...event, at: new Date(event.at).toISOString() })),
      failoversLast10Min: recent.length,
    };
  }
}
