import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import type { ProfileAutomationView, ProfileDetail, ProfileTopic } from "@vg/shared";
import { ProfileDetailPage } from "./ProfileDetailPage";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const profile: ProfileDetail = {
  id: profileId,
  name: "Hồ sơ auto",
  description: "",
  direction: "Lịch sử",
  language: "vi",
  defaultBrief: {
    budget: { mode: "ECO" },
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

const topic: ProfileTopic = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  profileId,
  topic: "Ai Cập cổ đại",
  notes: null,
  source: "USER",
  status: "PENDING",
  priority: 1,
  projectId: null,
  scheduledFor: null,
  error: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const automationView: ProfileAutomationView = {
  automation: profile.automation,
  slots: [{
    publishAt: "2026-11-04T12:00:00.000Z",
    localDate: "2026-11-04",
    topic: null,
    productionStatus: null,
    publicationStatus: null,
  }],
  todayCount: 0,
  approvedCount: 0,
  logs: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Profile automation + topics tabs", () => {
  it("saves the schedule form", async () => {
    let saved: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init || init.method === "GET" || !init.method)) {
        return jsonResponse(profile);
      }
      if (url.includes(`/profiles/${profileId}/automation`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse(automationView);
      }
      if (url.endsWith(`/profiles/${profileId}`) && init?.method === "PATCH") {
        saved = JSON.parse(String(init.body));
        return jsonResponse({
          ...profile,
          automation: { ...profile.automation, ...(saved as { automation: object }).automation, enabled: true },
        });
      }
      if (url.includes("/projects?")) return jsonResponse({ items: [], total: 0, page: 1, pageSize: 20 });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(
      <Routes>
        <Route path="/profiles/:id/:tab" element={<ProfileDetailPage />} />
      </Routes>,
      [`/profiles/${profileId}/automation`],
    );

    expect(await screen.findByRole("heading", { name: "Tự động sản xuất & đăng" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Bật tự động cho hồ sơ này/));
    fireEvent.click(screen.getByRole("button", { name: "Lưu lịch" }));

    await waitFor(() => expect(saved).toBeTruthy());
    expect(saved).toMatchObject({ automation: { enabled: true } });
  });

  it("approves a topic from the queue", async () => {
    let approved: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse(profile);
      }
      if (url.includes(`/profiles/${profileId}/topics`) && url.includes("approve") && init?.method === "POST") {
        approved = JSON.parse(String(init.body));
        return jsonResponse({ items: [{ ...topic, status: "APPROVED" }] });
      }
      if (url.includes(`/profiles/${profileId}/topics`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse({ items: [topic] });
      }
      if (url.includes("/projects?")) return jsonResponse({ items: [], total: 0, page: 1, pageSize: 20 });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(
      <Routes>
        <Route path="/profiles/:id/:tab" element={<ProfileDetailPage />} />
      </Routes>,
      [`/profiles/${profileId}/topics`],
    );

    expect(await screen.findByText("Ai Cập cổ đại")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(approved).toEqual({ ids: [topic.id], status: "APPROVED" }));
  });
});
