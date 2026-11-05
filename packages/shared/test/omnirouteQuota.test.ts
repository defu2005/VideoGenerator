import { describe, expect, it } from "vitest";
import {
  creditAllowanceStatus,
  formatLiveQuota,
  isLiveExhausted,
  liveQuotaStatus,
  maskEmail,
  matchLiveQuota,
  parseOmnirouteUsage,
  shouldRefreshLiveQuota,
} from "../src/index.js";

const now = new Date("2026-06-15T18:00:00.000Z");

describe("OmniRoute quota parsing", () => {
  it("reads a GitHub-style provider-wide quota", () => {
    const parsed = parseOmnirouteUsage({
      plan: "Copilot Pro",
      quotas: {
        premium_interactions: {
          used: 10,
          total: 300,
          remaining: 290,
          remainingPercentage: 96.7,
          resetAt: "2026-07-01T00:00:00.000Z",
          unlimited: false,
        },
      },
    });
    expect(parsed.kind).toBe("quotas");
    if (parsed.kind !== "quotas") return;
    expect(parsed.quotas[0]).toMatchObject({ key: "premium_interactions", unit: "requests", used: 10, total: 300 });
    expect(formatLiveQuota(parsed.quotas[0]!)).toBe("10 / 300 lượt");
    expect(isLiveExhausted(parsed.quotas[0]!)).toBe(false);
  });

  it("reads Antigravity-style per-family quotas", () => {
    const parsed = parseOmnirouteUsage({
      plan: "Antigravity",
      quotas: {
        "gemini-3-pro-low": { used: 200, total: 1000, remainingPercentage: 80, resetAt: "2026-06-15T20:00:00.000Z", unlimited: false, fractionReported: true },
        "claude-sonnet": { used: 1000, total: 1000, remainingPercentage: 0, resetAt: "2026-06-16T00:00:00.000Z", unlimited: false, fractionReported: true },
      },
    });
    expect(parsed.kind).toBe("quotas");
    if (parsed.kind !== "quotas") return;
    expect(parsed.quotas.map((quota) => quota.key)).toEqual(["gemini-3-pro-low", "claude-sonnet"]);
    expect(isLiveExhausted(parsed.quotas[1]!)).toBe(true);
  });

  it("reads Claude 5 hour and weekly quotas", () => {
    const parsed = parseOmnirouteUsage({
      plan: "Claude Pro",
      quotas: {
        five_hour: { used: 10, total: 45, remainingPercentage: 77, resetAt: "2026-06-15T20:00:00.000Z", unlimited: false },
        weekly: { used: 20, total: 200, remainingPercentage: 90, resetAt: "2026-06-20T00:00:00.000Z", unlimited: false },
      },
    });
    expect(parsed.kind).toBe("quotas");
    if (parsed.kind !== "quotas") return;
    expect(parsed.quotas).toHaveLength(2);
    expect(liveQuotaStatus(parsed.quotas[0]!, 0.9, now)).toBe("ok");
  });

  it("treats a message-only payload as no quota data", () => {
    expect(parseOmnirouteUsage({ message: "GitHub Copilot connected. Unable to parse quota data." })).toEqual({
      kind: "message",
      message: "GitHub Copilot connected. Unable to parse quota data.",
    });
  });

  it("keeps unlimited quotas available", () => {
    const parsed = parseOmnirouteUsage({
      quotas: { chat: { used: 0, total: 0, remainingPercentage: 100, resetAt: null, unlimited: true } },
    });
    expect(parsed.kind).toBe("quotas");
    if (parsed.kind !== "quotas") return;
    expect(parsed.quotas[0]!.unlimited).toBe(true);
    expect(isLiveExhausted(parsed.quotas[0]!)).toBe(false);
    expect(formatLiveQuota(parsed.quotas[0]!)).toBe("không giới hạn");
  });

  it("does not treat fractionReported false with 0 as exhausted", () => {
    const parsed = parseOmnirouteUsage({
      quotas: {
        "gemini-3-pro": { used: 0, total: 0, remainingPercentage: 0, resetAt: "2026-06-16T00:00:00.000Z", unlimited: false, fractionReported: false },
      },
    });
    expect(parsed.kind).toBe("quotas");
    if (parsed.kind !== "quotas") return;
    expect(isLiveExhausted(parsed.quotas[0]!)).toBe(false);
    expect(liveQuotaStatus(parsed.quotas[0]!, 0.9, now)).toBe("unknown");
  });

  it("reads an OpenRouter-style credit balance that only has remaining", () => {
    const parsed = parseOmnirouteUsage({
      plan: "OpenRouter",
      quotas: {
        credits: { used: 0, total: 0, remaining: 12.5, resetAt: null, unlimited: false, currency: "USD" },
      },
    });
    expect(parsed.kind).toBe("quotas");
    if (parsed.kind !== "quotas") return;
    expect(parsed.quotas[0]).toMatchObject({ unit: "credits_usd", remaining: 12.5, total: null, unlimited: false });
    expect(formatLiveQuota(parsed.quotas[0]!)).toBe("còn $12.50");
    expect(isLiveExhausted(parsed.quotas[0]!)).toBe(false);
  });

  it("reads a DeepSeek-style USD balance", () => {
    const parsed = parseOmnirouteUsage({
      plan: "DeepSeek",
      quotas: {
        credits_usd: {
          used: 0,
          total: 0,
          remaining: 50,
          remainingPercentage: 100,
          resetAt: null,
          unlimited: true,
          currency: "USD",
        },
      },
    });
    expect(parsed.kind).toBe("quotas");
    if (parsed.kind !== "quotas") return;
    expect(parsed.quotas[0]).toMatchObject({ unit: "credits_usd", remaining: 50, unlimited: false });
    expect(formatLiveQuota(parsed.quotas[0]!)).toBe("còn $50.00");
  });
});

describe("quota matcher", () => {
  it("prefers a family match over a provider-wide bucket", () => {
    expect(matchLiveQuota(["premium_interactions", "gemini-3-pro-low"], "gemini-3-pro-high")).toEqual({
      key: "gemini-3-pro-low",
      match: "family",
    });
  });

  it("falls back to a provider-wide quota", () => {
    expect(matchLiveQuota(["premium_interactions", "chat"], "gpt-4.1")).toEqual({
      key: "premium_interactions",
      match: "provider",
    });
  });

  it("returns none when nothing applies", () => {
    expect(matchLiveQuota(["claude-sonnet"], "gpt-4.1")).toBeNull();
  });
});

describe("credit allowance status", () => {
  it("is near inside three days and exhausted after expiry or a zero balance", () => {
    expect(creditAllowanceStatus({
      grantedUsd: 5,
      spentUsd: 1,
      expiresAt: "2026-06-17T18:00:00.000Z",
      now,
    })).toBe("near");
    expect(creditAllowanceStatus({
      grantedUsd: 5,
      spentUsd: 0,
      expiresAt: "2026-06-14T18:00:00.000Z",
      now,
    })).toBe("exhausted");
    expect(creditAllowanceStatus({ grantedUsd: 1, spentUsd: 1, now })).toBe("exhausted");
    expect(creditAllowanceStatus({ grantedUsd: 10, spentUsd: 9.6, now })).toBe("near");
  });
});

describe("live refresh gate", () => {
  it("refreshes a covered provider when the snapshot is older than 15 minutes", () => {
    expect(shouldRefreshLiveQuota({
      provider: "gemini",
      model: "gemini-2.5-flash",
      fetchedAt: new Date(now.getTime() - 16 * 60_000).toISOString(),
      now,
    })).toBe(true);
    expect(shouldRefreshLiveQuota({
      provider: "gemini",
      model: "gemini-2.5-flash",
      fetchedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
      now,
    })).toBe(false);
    expect(shouldRefreshLiveQuota({ provider: "mock", model: "mock-v1", fetchedAt: null, now })).toBe(false);
  });

  it("masks an email before it can be stored", () => {
    expect(maskEmail("alice@gmail.com")).toBe("a***@gmail.com");
  });
});
