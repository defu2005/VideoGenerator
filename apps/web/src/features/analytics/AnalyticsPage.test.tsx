import type { AnalyticsOverviewResponse } from "@vg/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AnalyticsPage } from "./AnalyticsPage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const publicationA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const publicationB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const emptyTotals = {
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  watchHours: 0,
  followersDelta: 0,
};

function overviewFixture(overrides: Partial<AnalyticsOverviewResponse> = {}): AnalyticsOverviewResponse {
  return {
    from: "2026-10-09",
    to: "2026-11-05",
    totals: { ...emptyTotals, views: 1500, likes: 40, previous: emptyTotals, delta: { ...emptyTotals, views: 200 } },
    series: [
      { date: "2026-11-01", platform: "youtube", views: 100, likes: 2, comments: 1, shares: 0, watchHours: 1 },
      { date: "2026-11-02", platform: "youtube", views: 200, likes: 4, comments: 1, shares: 0, watchHours: 2 },
    ],
    byPlatform: [
      { platform: "youtube", views: 300, likes: 6, comments: 2, shares: 0, watchHours: 3 },
    ],
    topByViews: [],
    bottomByViews: [],
    topByAvgViewPct: [],
    bottomByAvgViewPct: [],
    videos: [
      {
        publicationId: publicationA,
        projectId: null,
        title: "Video A ít view",
        platform: "youtube",
        publishedAt: "2026-11-01T10:00:00.000Z",
        externalUrl: "https://example.com/a",
        views: 10,
        avgViewPct: 40,
        score: 12,
        likes: 1,
        comments: 0,
        shares: 0,
      },
      {
        publicationId: publicationB,
        projectId: null,
        title: "Video B nhiều view",
        platform: "tiktok",
        publishedAt: "2026-11-02T10:00:00.000Z",
        externalUrl: "https://example.com/b",
        views: 999,
        avgViewPct: 55,
        score: 80,
        likes: 20,
        comments: 3,
        shares: 1,
      },
    ],
    ...overrides,
  };
}

describe("AnalyticsPage", () => {
  it("changing filters updates the overview query URL", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/analytics/accounts")) {
        return jsonResponse({ items: [] });
      }
      if (url.includes("/profiles")) {
        return jsonResponse({
          items: [{
            id: profileId,
            name: "Hồ sơ Demo",
            description: "",
            direction: "",
            language: "vi",
            color: "#3B82F6",
            avatarPath: null,
            archivedAt: null,
            createdAt: "2026-11-01T00:00:00.000Z",
            updatedAt: "2026-11-01T00:00:00.000Z",
            accountCount: 1,
            projectCount: 0,
          }],
        });
      }
      if (url.includes("/analytics/overview")) {
        return jsonResponse(overviewFixture());
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<AnalyticsPage />);
    expect(await screen.findByRole("heading", { name: "Thống kê" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Hồ sơ Demo" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Hồ sơ"), { target: { value: profileId } });
    fireEvent.change(screen.getByLabelText("Nền tảng"), { target: { value: "youtube" } });
    fireEvent.click(screen.getByRole("button", { name: "7 ngày" }));

    await waitFor(() => {
      const overviewCalls = fetchMock.mock.calls
        .map(([req]) => String(req))
        .filter((url) => url.includes("/analytics/overview"));
      const withFilters = overviewCalls.find((url) =>
        url.includes(`profileId=${profileId}`) && url.includes("platform=youtube"),
      );
      expect(withFilters).toBeTruthy();
      expect(withFilters).toMatch(/from=\d{4}-\d{2}-\d{2}/);
      expect(withFilters).toMatch(/to=\d{4}-\d{2}-\d{2}/);
    });
  });

  it("clicking a column header sorts the videos table", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/analytics/accounts")) return jsonResponse({ items: [] });
      if (url.includes("/profiles")) return jsonResponse({ items: [] });
      if (url.includes("/analytics/overview")) return jsonResponse(overviewFixture());
      return jsonResponse({});
    }));

    renderWithProviders(<AnalyticsPage />);
    expect(await screen.findByRole("button", { name: /Điểm/ })).toBeInTheDocument();
    expect(await screen.findByText("80")).toBeInTheDocument();
    const table = await screen.findByRole("table");
    const bodyRows = () => within(table).getAllByRole("row").slice(1);

    await waitFor(() => {
      expect(bodyRows()[0]).toHaveTextContent("Video B nhiều view");
    });

    fireEvent.click(screen.getByRole("button", { name: /Tiêu đề/ }));
    await waitFor(() => {
      expect(bodyRows()[0]).toHaveTextContent("Video A ít view");
      expect(bodyRows()[1]).toHaveTextContent("Video B nhiều view");
    });

    fireEvent.click(screen.getByRole("button", { name: /Lượt xem/ }));
    await waitFor(() => {
      expect(bodyRows()[0]).toHaveTextContent("Video B nhiều view");
    });
  });

  it("shows reconnect hint for needs_reconnect accounts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/analytics/accounts")) {
        return jsonResponse({
          items: [{
            accountId,
            profileId,
            platform: "youtube",
            displayName: "Kênh Demo",
            analyticsStatus: "needs_reconnect",
            lastSyncAt: null,
            lastError: "Thiếu quyền thống kê",
            missingScopes: ["https://www.googleapis.com/auth/yt-analytics.readonly"],
          }],
        });
      }
      if (url.includes("/profiles")) return jsonResponse({ items: [] });
      if (url.includes("/analytics/overview")) return jsonResponse(overviewFixture());
      return jsonResponse({});
    }));

    renderWithProviders(<AnalyticsPage />);
    expect(await screen.findByText(/Kết nối lại để bật thống kê/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kết nối lại" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đồng bộ ngay" })).not.toBeInTheDocument();
  });
});
