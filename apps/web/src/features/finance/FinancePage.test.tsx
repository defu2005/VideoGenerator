import type { FinanceSummaryResponse } from "@vg/shared";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { FinancePage } from "./FinancePage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const emptySummary = (): FinanceSummaryResponse => ({
  from: "2026-10-07",
  to: "2026-11-05",
  currency: "VND",
  kpi: { revenue: 1_000_000, cost: 200_000, profit: 800_000, margin: 0.8, currency: "VND" },
  byMonth: [
    { month: "2026-10", revenue: 600_000, cost: 100_000 },
    { month: "2026-11", revenue: 400_000, cost: 100_000 },
  ],
  byProfile: [{ profileId: null, profileName: "(không hồ sơ)", revenue: 1_000_000, cost: 200_000, profit: 800_000 }],
  byPlatform: [{ platform: "youtube", revenue: 1_000_000, cost: 100_000, profit: 900_000 }],
  byVideo: [{
    publicationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    projectId: null,
    title: "Video lãi",
    platform: "youtube",
    views: 1000,
    revenue: 500_000,
    revenueEstimated: false,
    cost: 50_000,
    profit: 450_000,
  }],
  revenueByKind: [{ kind: "ads", amount: 1_000_000 }],
  costByKind: [{ kind: "llm", amount: 200_000, source: "usage_auto" }],
});

describe("FinancePage", () => {
  it("renders summary KPIs and validates the revenue form", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/finance/summary")) return jsonResponse(emptySummary());
      if (url.includes("/finance/currency")) return jsonResponse({ appCurrency: "VND", rates: [] });
      if (url.includes("/profiles")) return jsonResponse({ items: [], total: 0, page: 1, pageSize: 50 });
      if (url.includes("/finance/reports")) return jsonResponse({ items: [] });
      if (url.includes("/finance/youtube-accounts")) return jsonResponse({ items: [] });
      if (url.includes("/finance/payout-thresholds")) return jsonResponse({ items: [] });
      if (url.includes("/finance/revenue") && init?.method === "POST") {
        return jsonResponse({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          accountId: null,
          publicationId: null,
          profileId: null,
          source: "manual",
          kind: "ads",
          periodStart: "2026-11-05",
          periodEnd: "2026-11-05",
          amount: 1000,
          currency: "VND",
          note: null,
          externalKey: null,
          createdAt: "2026-11-05T00:00:00.000Z",
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<FinancePage />);

    expect(await screen.findByRole("heading", { name: "Doanh thu" })).toBeInTheDocument();
    expect(await screen.findByText("Doanh thu")).toBeInTheDocument();
    expect(screen.getByLabelText("Biểu đồ doanh thu và chi phí theo tháng")).toBeInTheDocument();
    expect(await screen.findByText("Video lãi")).toBeInTheDocument();

    const amount = screen.getByLabelText("Số tiền doanh thu");
    fireEvent.change(amount, { target: { value: "abc" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/không hợp lệ/i);

    fireEvent.change(amount, { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu doanh thu" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/finance/revenue") && c[1]?.method === "POST")).toBe(true);
    });
  });
});
