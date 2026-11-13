import { describe, expect, it } from "vitest";
import {
  adaptAllowed, classifyDocument, cliSignal, defaultReactions, llmBudgetDecision, newFeedItems,
  npmFindings, publishBlocked, resolveReactions, signalOf, signalThreshold, watchEveryDays, watchHash,
} from "../src/knowledge/reactions.js";

const page = "Chính sách độ dài video ngắn giữ nguyên câu này để đủ dài cho bộ kiểm.";

describe("change reaction policy", () => {
  it("maps each severity to a reaction level", () => {
    expect(defaultReactions("A1", "info")).toEqual(["R0"]);
    expect(defaultReactions("B1", "warn")).toEqual(["R2"]);
    expect(defaultReactions("D2", "warn")).toEqual(["R3"]);
    expect(defaultReactions("D1", "high")).toEqual(["R2", "R1"]);
    expect(defaultReactions("E1", "critical")).toEqual(["R4", "R1"]);
  });

  it("refuses to lower a critical account event below a hold", () => {
    expect(resolveReactions({ category: "E1", severity: "critical", subjectType: "account", override: ["R1"] })).toEqual(["R4", "R1"]);
  });

  it("adapts only a configured option that stays inside the current rules", () => {
    expect(adaptAllowed({ configured: true, allowed: true, changesMust: false, overBudget: false, paidFallback: false })).toBe(true);
    expect(adaptAllowed({ configured: false, allowed: true, changesMust: false, overBudget: false, paidFallback: false })).toBe(false);
    expect(adaptAllowed({ configured: true, allowed: true, changesMust: true, overBudget: false, paidFallback: false })).toBe(false);
    expect(adaptAllowed({ configured: true, allowed: true, changesMust: false, overBudget: true, paidFallback: false })).toBe(false);
    expect(adaptAllowed({ configured: true, allowed: true, changesMust: false, overBudget: false, paidFallback: true })).toBe(false);
  });

  it("holds only the consumer that reads the fact", () => {
    const holds = [{ active: true, consumer: "YouTubePublisher.publish", subjectType: "knowledge", subjectId: "limit.youtube.shorts_max_sec" }];
    expect(publishBlocked(holds, { id: "yt", platform: "youtube" })).toBe(true);
    expect(publishBlocked(holds, { id: "tt", platform: "tiktok" })).toBe(false);
    const account = [{ active: true, consumer: "YouTubePublisher.publish", subjectType: "account", subjectId: "acc-yt" }];
    expect(publishBlocked(account, { id: "acc-yt", platform: "youtube" })).toBe(true);
    expect(publishBlocked(account, { id: "acc-yt-2", platform: "youtube" })).toBe(false);
  });
});

describe("document and runtime signals", () => {
  it("ignores a date-only page change and a single server error", () => {
    const baseline = `${page} Cập nhật 2026-01-01. Lượt xem 1,000.`;
    const dated = `${page} Cập nhật 2026-01-02. Lượt xem 1,234.`;
    expect(watchHash(baseline)).toBe(watchHash(dated));
    expect(classifyDocument({
      status: 200, requestedUrl: "https://example.com/a", finalUrl: "https://example.com/a",
      text: dated, previousHash: watchHash(baseline),
    })).toBe("unchanged");
    expect(signalOf({ provider: "pexels", endpoint: "/search", status: 500 })).toBeNull();
  });

  it("flags a missing page, a shell, a sunset header and a new feed item", () => {
    expect(classifyDocument({
      status: 404, requestedUrl: "https://example.com/a", finalUrl: "https://example.com/a", text: page, previousHash: null,
    })).toBe("g1");
    expect(classifyDocument({
      status: 200, requestedUrl: "https://example.com/a", finalUrl: "https://example.com/gone", text: page, previousHash: null,
    })).toBe("g1");
    expect(classifyDocument({
      status: 200, requestedUrl: "https://example.com/a", finalUrl: "https://example.com/a", text: "<div id=app>", previousHash: null,
    })).toBe("g2");
    const sunset = signalOf({ provider: "openai", endpoint: "/v1/models", status: 200, headers: { Sunset: "Wed, 11 Nov 2026 00:00:00 GMT" } });
    expect(sunset?.immediate).toBe(true);
    expect(signalThreshold(sunset!, 3)).toBe(1);
    expect(newFeedItems("<guid>one</guid>", [])).toEqual([]);
    expect(newFeedItems("<guid>one</guid><guid>two</guid>", ["one"])).toEqual(["two"]);
  });

  it("keeps the read budget and the weekly watch pace", () => {
    expect(llmBudgetDecision({ eco: true, used: 0, limit: 20 })).toBe("hash");
    expect(llmBudgetDecision({ eco: false, used: 20, limit: 20 })).toBe("hash");
    expect(llmBudgetDecision({ eco: false, used: 19, limit: 20 })).toBe("read");
    expect(watchEveryDays("weekly")).toBe(1);
    expect(watchEveryDays("monthly")).toBe(3);
    expect(watchEveryDays("yearly")).toBe(7);
    expect(cliSignal({ provider: "edge", version: "1", seenVersions: [], seenMessages: [] })).toBeNull();
    expect(cliSignal({ provider: "edge", version: "2", seenVersions: ["1"], seenMessages: [] })?.kind).toBe("version");
  });

  it("turns dependency output into findings without treating a low advisory as one", () => {
    const found = npmFindings(
      { leftpad: { deprecated: "use pad" } },
      { vulnerabilities: { lodash: { severity: "high" }, tiny: { severity: "low" } } },
    );
    expect(found.map((item) => item.name)).toEqual(["leftpad", "lodash"]);
  });
});
