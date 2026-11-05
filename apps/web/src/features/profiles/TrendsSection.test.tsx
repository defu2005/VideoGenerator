import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProfileDetail } from "@vg/shared";
import { TrendsSection } from "./TrendsSection";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const profile = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Hồ sơ",
  description: "",
  direction: "Lịch sử",
  language: "vi",
  defaultBrief: {
    budget: { mode: "BALANCED" },
    platform: "youtube",
    style: "documentary",
    tone: "neutral",
    audience: "general",
    targetDurationSec: 60,
    aspectRatio: "16:9",
    language: "vi",
    wordsPerMinute: 150,
    sceneDurationSec: 7,
    visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 },
    music: { enabled: true, volume: 0.15 },
    userSet: [],
    mode: "ASSISTED",
    autoRender: false,
  },
  voice: null,
  guidelines: { platformPack: "auto", customRules: [] },
  llm: null,
  automation: {
    enabled: false,
    timezone: "Asia/Ho_Chi_Minh",
    videosPerDay: 1,
    publishTimes: ["19:00"],
    leadTimeHours: 6,
    autoSuggest: false,
    autoApproveTopics: false,
    autoShorts: false,
    shortsPerVideo: 3,
    accountIds: null,
  },
  avatarPath: null,
  color: "#3B82F6",
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  accounts: [],
  projectCount: 0,
} as ProfileDetail;

describe("TrendsSection", () => {
  it("adds a matched idea to the topic queue", async () => {
    const idea = {
      title: "Đông Sơn",
      angle: "Một hiện vật",
      whyNow: "Nguồn: Đông Sơn",
      sourceTitles: ["Đông Sơn"],
      urgency: "today",
      fitScore: 90,
      sensitive: false,
    };
    let added: unknown;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/trends/refresh")) {
        return jsonResponse({ items: [{ title: "Đông Sơn", source: "wikimedia_top", score: 10 }], ideas: [idea], skipped: [] });
      }
      if (url.includes("/trends/topics") && init?.method === "POST") {
        added = JSON.parse(String(init.body));
        return jsonResponse({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "PENDING" });
      }
      return jsonResponse({});
    }));
    renderWithProviders(<TrendsSection profile={profile} />);
    fireEvent.click(screen.getByRole("button", { name: "Xem xu hướng ngay" }));
    expect(await screen.findAllByText("Đông Sơn")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Thêm vào hàng chờ" }));
    await waitFor(() => expect(added).toEqual({ idea }));
  });
});
