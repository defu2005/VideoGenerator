import { describe, expect, it } from "vitest";
import {
  allocateRevenue,
  buildRateTable,
  computeVideoProfits,
  convertToAppCurrency,
  profitMargin,
  sumCostsInApp,
  sumRevenueInApp,
} from "../src/finance/profit.js";

const rates = buildRateTable([{ currency: "USD", rateToAppCurrency: 25_000 }], "VND");

describe("profit math", () => {
  it("converts currency with the rate table", () => {
    expect(convertToAppCurrency(2, "USD", "VND", rates)).toBe(50_000);
    expect(convertToAppCurrency(1000, "VND", "VND", rates)).toBe(1000);
  });

  it("keeps direct publication revenue and marks channel allocation as estimated", () => {
    const videos = [
      {
        publicationId: "p1",
        accountId: "a1",
        projectId: "proj1",
        profileId: "pr1",
        title: "A",
        platform: "youtube",
        views: 100,
      },
      {
        publicationId: "p2",
        accountId: "a1",
        projectId: "proj2",
        profileId: "pr1",
        title: "B",
        platform: "youtube",
        views: 300,
      },
    ];
    const allocated = allocateRevenue(
      [
        {
          id: "r1",
          accountId: "a1",
          publicationId: "p1",
          profileId: "pr1",
          kind: "ads",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-01",
          amount: 10,
          currency: "USD",
        },
        {
          id: "r2",
          accountId: "a1",
          publicationId: null,
          profileId: "pr1",
          kind: "ads",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          amount: 40,
          currency: "USD",
        },
      ],
      videos,
      { from: "2026-10-01", to: "2026-10-31" },
      "VND",
      rates,
    );

    const direct = allocated.filter((a) => a.publicationId === "p1" && !a.estimated);
    expect(direct).toHaveLength(1);
    expect(direct[0]!.amountApp).toBe(250_000);

    const estimated = allocated.filter((a) => a.estimated);
    expect(estimated).toHaveLength(2);
    const p1 = estimated.find((a) => a.publicationId === "p1")!;
    const p2 = estimated.find((a) => a.publicationId === "p2")!;
    // 40 USD * 25000 = 1_000_000; views 100:300 → 250k : 750k
    expect(p1.amountApp).toBe(250_000);
    expect(p2.amountApp).toBe(750_000);
  });

  it("falls back to equal allocation when there are no views", () => {
    const videos = [
      {
        publicationId: "p1",
        accountId: "a1",
        projectId: null,
        profileId: "pr1",
        title: "A",
        platform: "tiktok",
        views: null,
      },
      {
        publicationId: "p2",
        accountId: "a1",
        projectId: null,
        profileId: "pr1",
        title: "B",
        platform: "tiktok",
        views: 0,
      },
    ];
    const allocated = allocateRevenue(
      [{
        id: "r1",
        accountId: "a1",
        publicationId: null,
        profileId: "pr1",
        kind: "creator_fund",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        amount: 100_000,
        currency: "VND",
      }],
      videos,
      { from: "2026-10-01", to: "2026-10-31" },
      "VND",
      rates,
    );
    expect(allocated.every((a) => a.estimated)).toBe(true);
    expect(allocated.map((a) => a.amountApp)).toEqual([50_000, 50_000]);
  });

  it("subtracts project costs from video profit", () => {
    const videos = [{
      publicationId: "p1",
      accountId: "a1",
      projectId: "proj1",
      profileId: "pr1",
      title: "A",
      platform: "youtube",
      views: 10,
    }];
    const allocated = allocateRevenue(
      [{
        id: "r1",
        accountId: "a1",
        publicationId: "p1",
        profileId: "pr1",
        kind: "ads",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-01",
        amount: 100_000,
        currency: "VND",
      }],
      videos,
      { from: "2026-10-01", to: "2026-10-31" },
      "VND",
      rates,
    );
    const profits = computeVideoProfits(
      allocated,
      [{
        profileId: "pr1",
        projectId: "proj1",
        kind: "llm",
        date: "2026-10-05",
        amount: 1,
        currency: "USD",
        source: "usage_auto",
      }, {
        profileId: "pr1",
        projectId: null,
        kind: "tool_subscription",
        date: "2026-10-01",
        amount: 50_000,
        currency: "VND",
        source: "manual",
      }],
      videos,
      "VND",
      rates,
    );
    expect(profits[0]!.revenue).toBe(100_000);
    expect(profits[0]!.cost).toBe(25_000);
    expect(profits[0]!.profit).toBe(75_000);
    expect(sumRevenueInApp(allocated)).toBe(100_000);
    expect(sumCostsInApp(
      [{
        profileId: "pr1",
        projectId: null,
        kind: "tool_subscription",
        date: "2026-10-01",
        amount: 50_000,
        currency: "VND",
        source: "manual",
      }],
      "VND",
      rates,
    )).toBe(50_000);
    expect(profitMargin(100, 40)).toBeCloseTo(0.6);
  });
});
