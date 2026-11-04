import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount, ProfileDetail, Project, Publication } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { PublishPanel } from "./PublishPanel";
import { oauthStartUrl } from "../../services/publishApi";

const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const project: Project = {
  id: projectId,
  title: "Publish fixture",
  topic: "Ocean",
  description: "",
  mode: "ASSISTED",
  profileId,
  settings: {
    budget: { mode: "ECO" }, language: "vi", targetDurationSec: 60, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "COMPLETED", stage: "DONE", thumbnailPath: null, durationSec: 60, version: 1,
  createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z", archivedAt: null,
};

const account: PlatformAccount = {
  id: accountId,
  profileId,
  platform: "mock",
  displayName: "Mock Channel",
  handle: "@mock",
  externalId: "mock-ext-1",
  format: "landscape",
  enabled: true,
  connection: "CONNECTED",
  connectionError: null,
  lastCheckedAt: null,
  publishSettings: { visibility: "public", autoPublish: false },
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

const profile: ProfileDetail = {
  id: profileId,
  name: "Test profile",
  description: "",
  direction: "",
  language: "vi",
  defaultBrief: {
    budget: { mode: "ECO" },
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    targetDurationSec: 60, aspectRatio: "16:9", language: "vi",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [],
    mode: "ASSISTED", autoRender: false,
  },
  voice: null,
  guidelines: { platformPack: "auto", customRules: [] },
  llm: null,
  avatarPath: null,
  color: "#3B82F6",
  archivedAt: null,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  accounts: [account],
  projectCount: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PublishPanel", () => {
  it("renders accounts and posts publications", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(`/profiles/${profileId}`) && !url.includes("publications")) {
        return jsonResponse(profile);
      }
      if (url.includes(`/projects/${projectId}/publications`) && (!init || init.method === "GET" || !init.method)) {
        return jsonResponse({ items: [] satisfies Publication[] });
      }
      if (url.includes(`/projects/${projectId}/publications`) && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { accountIds: string[] };
        expect(body.accountIds).toEqual([accountId]);
        return jsonResponse({
          items: [{
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            projectId,
            renderId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            accountId,
            status: "QUEUED",
            visibilityRequested: "public",
            visibilityUsed: "public",
            guardrailReason: null,
            scheduledFor: null,
            externalId: null,
            externalUrl: null,
            attempts: 0,
            lastError: null,
            progress: 0,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            publishedAt: null,
          }],
        }, 201);
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<PublishPanel project={project} />);
    expect(await screen.findByRole("heading", { name: "Đăng" })).toBeInTheDocument();
    expect(await screen.findByText(/Mock Channel/)).toBeInTheDocument();

    const checkbox = await screen.findByRole("checkbox");
    await waitFor(() => expect(checkbox).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "Đăng" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => {
        const init = call[1] as RequestInit | undefined;
        return String(call[0]).includes("/publications") && init?.method === "POST";
      })).toBe(true);
    });
  });
});

describe("oauthStartUrl", () => {
  it("points at the API oauth start endpoint", () => {
    expect(oauthStartUrl("mock", accountId)).toContain(`/api/oauth/mock/start?accountId=${accountId}`);
  });
});
