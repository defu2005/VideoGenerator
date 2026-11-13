import { describe, expect, it } from "vitest";
import {
  LLM_QUOTA_PRESETS,
  LLM_QUOTA_PRESET_NOTE,
  LlmQuotaRuleSchema,
  chooseCooldown,
  currentWindowStart,
  isDailyQuotaMessage,
  nextBackoffMs,
  nextReset,
  callTargetsOmniProvider,
  preferCheapestQualified,
  resolveEffectiveRules,
} from "../src/index.js";

const LA = "America/Los_Angeles";

describe("quota window math", () => {
  it("keeps the Los Angeles day across the spring-forward DST change", () => {
    const before = new Date("2026-03-08T09:30:00.000Z");
    const after = new Date("2026-03-08T10:30:00.000Z");
    expect(currentWindowStart("day", before, LA).toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(currentWindowStart("day", after, LA).toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(nextReset("day", before, LA).toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect(nextReset("day", after, LA).toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });

  it("keeps the Los Angeles day across the fall-back DST change", () => {
    const before = new Date("2026-11-01T08:30:00.000Z");
    const after = new Date("2026-11-01T10:30:00.000Z");
    expect(currentWindowStart("day", before, LA).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(currentWindowStart("day", after, LA).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(nextReset("day", after, LA).toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("resets a month on the first instant of the next month, including February", () => {
    const january = new Date("2026-01-31T20:00:00.000Z");
    const february = new Date("2026-02-28T20:00:00.000Z");
    expect(currentWindowStart("month", january, LA).toISOString()).toBe("2026-01-01T08:00:00.000Z");
    expect(nextReset("month", january, LA).toISOString()).toBe("2026-02-01T08:00:00.000Z");
    expect(nextReset("month", february, LA).toISOString()).toBe("2026-03-01T08:00:00.000Z");
  });

  it("uses a rolling 5 hour window", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    expect(currentWindowStart("rolling_5h", now, "UTC").toISOString()).toBe("2026-06-01T07:00:00.000Z");
    expect(nextReset("rolling_5h", now, "UTC").toISOString()).toBe("2026-06-01T17:00:00.000Z");
    expect(now.getTime() - currentWindowStart("rolling_5h", now, LA).getTime()).toBe(5 * 60 * 60 * 1000);
  });
});

describe("quota cooldown choice", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");
  const nextDay = new Date("2026-06-02T07:00:00.000Z");

  it("honours Retry-After", () => {
    const chosen = chooseCooldown({ now, message: "slow down", retryAfterMs: 15_000, previous: null, nextDayReset: nextDay });
    expect(chosen.reason).toBe("retry-after");
    expect(chosen.until.toISOString()).toBe("2026-06-01T12:00:15.000Z");
  });

  it("waits until the next day reset for a daily quota message", () => {
    expect(isDailyQuotaMessage("Quota exceeded for metric generate_content_free_tier_requests per day")).toBe(true);
    expect(isDailyQuotaMessage("RPD limit")).toBe(true);
    const chosen = chooseCooldown({
      now,
      message: "You exceeded your daily quota",
      previous: null,
      nextDayReset: nextDay,
    });
    expect(chosen.reason).toBe("daily-reset");
    expect(chosen.until.toISOString()).toBe(nextDay.toISOString());
  });

  it("grows backoff and caps it at 6 hours", () => {
    expect(nextBackoffMs(null)).toBe(60_000);
    expect(nextBackoffMs(60_000)).toBe(5 * 60_000);
    expect(nextBackoffMs(5 * 60_000)).toBe(30 * 60_000);
    expect(nextBackoffMs(30 * 60_000)).toBe(6 * 60 * 60_000);
    expect(nextBackoffMs(6 * 60 * 60_000)).toBe(6 * 60 * 60_000);
  });
});

describe("quota presets", () => {
  it("match the schema and stay estimates", () => {
    expect(LLM_QUOTA_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of LLM_QUOTA_PRESETS) {
      expect(LlmQuotaRuleSchema.parse(preset).note).toBe(LLM_QUOTA_PRESET_NOTE);
      expect(preset.source).toBe("preset");
    }
  });

  it("lets a user rule replace the preset for the same provider and model", () => {
    const preset = LLM_QUOTA_PRESETS[0]!;
    const user = LlmQuotaRuleSchema.parse({
      ...preset,
      source: "user",
      limits: [{ window: "day", requests: 3 }],
      note: "riêng",
    });
    const effective = resolveEffectiveRules({ presets: LLM_QUOTA_PRESETS, userRules: [user], disabled: [] });
    const found = effective.find((rule) => rule.provider === preset.provider && rule.model === preset.model);
    expect(found?.source).toBe("user");
    expect(found?.limits).toEqual([{ window: "day", requests: 3 }]);
    expect(effective.some((rule) => rule.source === "preset")).toBe(true);
  });
});

describe("omniroute provider match", () => {
  it("does not treat two unknown prefixes as the same provider", () => {
    expect(callTargetsOmniProvider("omniroute", "sopen/gemini-3.8-flash-high", "grok-cli")).toBe(false);
    expect(callTargetsOmniProvider("omniroute", "sopen/gemini-3.8-flash-high", "other-unknown")).toBe(false);
    expect(callTargetsOmniProvider("omniroute", "gemini-3.8-flash-high", "gemini")).toBe(false);
    expect(callTargetsOmniProvider("omniroute", "agy/model", "antigravity")).toBe(true);
  });
});

describe("eco model order", () => {
  it("keeps models at the quality floor and sorts by cost", () => {
    const ordered = preferCheapestQualified([
      { kind: "paid" as const, quality: 9, costUsd: 0.2 },
      { kind: "paid" as const, quality: 4, costUsd: 0.01 },
      { kind: "free_tier" as const, quality: 7.2, costUsd: 0 },
    ], 7);
    expect(ordered.map((item) => item.costUsd)).toEqual([0, 0.2]);
  });
});
