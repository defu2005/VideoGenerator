import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import type { LearningView, ProfileDetail } from "@vg/shared";
import { TITLE_AB_UNAVAILABLE_REASON } from "@vg/shared";
import { ProfileDetailPage } from "./ProfileDetailPage";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const insightId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const profile: ProfileDetail = {
  id: profileId,
  name: "Hồ sơ bài học",
  description: "",
  direction: "Lịch sử",
  language: "vi",
  market: null,
  defaultBrief: {
    budget: { mode: "BALANCED" },
    platform: "youtube",
    style: "documentary",
    tone: "neutral",
    audience: "general",
    targetDurationSec: 90,
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
    publishTimes: ["08:00"],
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
};

function learningView(overrides: Partial<LearningView> = {}): LearningView {
  return {
    learningMode: "suggest",
    learnedNotes: "",
    titleAbTest: false,
    titleAbAvailable: false,
    titleAbReason: TITLE_AB_UNAVAILABLE_REASON,
    scoredCount: 8,
    insufficient: false,
    message: null,
    canUndo: false,
    latest: {
      id: insightId,
      profileId,
      createdAt: "2026-11-02T01:00:00.000Z",
      period: "2026-10-01/2026-10-08",
      status: "new",
      summary: "- Đăng lúc 19:00 tốt hơn.",
      patterns: [{
        kind: "timing",
        finding: "19:00 vượt trung vị",
        evidence: "4 video",
        confidence: "high",
      }],
      recommendations: {
        directionAddendum: "Giữ hook ngắn.",
        preferredDurationSec: { min: 120, max: 120 },
      },
      appliedFields: [],
      dismissedFields: [],
    },
    history: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Insights tab", () => {
  it("renders the lesson, hides A/B without scope, and applies a recommendation", async () => {
    let applied: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init?.method || init.method === "GET")) {
        return jsonResponse(profile);
      }
      if (url.endsWith("/learning") && (!init?.method || init.method === "GET")) {
        return jsonResponse(learningView());
      }
      if (url.endsWith("/apply") && init?.method === "POST") {
        applied = JSON.parse(String(init.body));
        return jsonResponse({
          ...learningView().latest,
          status: "applied",
          appliedFields: ["directionAddendum"],
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(
      <Routes>
        <Route path="/profiles/:id/:tab" element={<ProfileDetailPage />} />
      </Routes>,
      [`/profiles/${profileId}/insights`],
    );

    expect(await screen.findByText("Giữ hook ngắn.")).toBeInTheDocument();
    expect(screen.getByText(/19:00 vượt trung vị/)).toBeInTheDocument();
    expect(screen.getByText(TITLE_AB_UNAVAILABLE_REASON)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Thử 2 tiêu đề" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Áp dụng" })[0]!);
    await waitFor(() => expect(applied).toEqual({ fields: ["directionAddendum"] }));
  });

  it("runs an analysis from the button", async () => {
    let ran = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init?.method || init.method === "GET")) {
        return jsonResponse(profile);
      }
      if (url.endsWith("/learning") && (!init?.method || init.method === "GET")) {
        return jsonResponse(learningView({ latest: null, history: [], message: "Chưa đủ dữ liệu", insufficient: true, scoredCount: 2 }));
      }
      if (url.endsWith("/learning/run") && init?.method === "POST") {
        ran = true;
        return jsonResponse({ status: "insufficient", message: "Chưa đủ dữ liệu", insight: null });
      }
      return jsonResponse({});
    }));

    renderWithProviders(
      <Routes>
        <Route path="/profiles/:id/:tab" element={<ProfileDetailPage />} />
      </Routes>,
      [`/profiles/${profileId}/insights`],
    );

    fireEvent.click(await screen.findByRole("button", { name: "Phân tích ngay" }));
    await waitFor(() => expect(ran).toBe(true));
    expect(await screen.findByText("Chưa đủ dữ liệu")).toBeInTheDocument();
  });
});
