import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import type { AccountConnectionDetail, PlatformAccount, ProfileDetail } from "@vg/shared";
import { ProfileDetailPage } from "./ProfileDetailPage";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const account: PlatformAccount = {
  id: accountId,
  profileId,
  platform: "youtube",
  displayName: "Kênh lịch sử",
  handle: "@lichsu",
  externalId: "yt-ext-1",
  format: "landscape",
  enabled: true,
  connection: "CONNECTED",
  connectionError: null,
  lastCheckedAt: "2026-11-01T10:00:00.000Z",
  publishSettings: { visibility: "public", autoPublish: false },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const profile: ProfileDetail = {
  id: profileId,
  name: "Hồ sơ test",
  description: "",
  direction: "",
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
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
  accounts: [account],
  projectCount: 0,
};

function connectionDetail(overrides: Partial<AccountConnectionDetail> = {}): AccountConnectionDetail {
  return {
    connection: "CONNECTED",
    connectionError: null,
    displayName: account.displayName,
    handle: account.handle ?? null,
    externalId: account.externalId ?? null,
    tokenExpiresAt: "2026-12-01T00:00:00.000Z",
    scopes: ["youtube.upload"],
    lastCheckedAt: "2026-11-01T10:00:00.000Z",
    appCredentials: { configured: false, idHint: null },
    redirectUri: "http://127.0.0.1:3001/api/oauth/youtube/callback",
    canConnect: true,
    connectBlockedReason: null,
    ...overrides,
  };
}

function renderAccountsTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/profiles/:id/:tab" element={<ProfileDetailPage />} />
    </Routes>,
    [`/profiles/${profileId}/accounts`],
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProfileDetailPage accounts tab", () => {
  it("submits app credentials, clears inputs, and never shows the secret back", async () => {
    let detail = connectionDetail();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse(profile);
      }
      if (url.includes(`/accounts/${accountId}/connection`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse(detail);
      }
      if (url.includes(`/accounts/${accountId}/app-credentials`) && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { clientId: string; clientSecret: string };
        expect(body.clientId).toBe("my-client-id-xyz9");
        expect(body.clientSecret).toBe("top-secret-never-echo");
        detail = connectionDetail({
          appCredentials: { configured: true, idHint: "xyz9" },
        });
        return jsonResponse({ configured: true, idHint: "xyz9" });
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAccountsTab();
    expect(await screen.findByText("Thông tin ứng dụng")).toBeInTheDocument();
    expect(screen.getByText(/Chưa cấu hình/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "my-client-id-xyz9" } });
    fireEvent.change(screen.getByLabelText("Client Secret"), { target: { value: "top-secret-never-echo" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thông tin ứng dụng" }));

    await waitFor(() => {
      expect(screen.getByText(/Đã cấu hình \(…xyz9\)/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Client ID")).toHaveValue("");
    expect(screen.getByLabelText("Client Secret")).toHaveValue("");
    expect(screen.queryByDisplayValue("top-secret-never-echo")).not.toBeInTheDocument();
    expect(screen.queryByText("top-secret-never-echo")).not.toBeInTheDocument();
  });

  it("disables Kết nối with the blocked reason", async () => {
    const disconnected: PlatformAccount = {
      ...account,
      connection: "NOT_CONNECTED",
      externalId: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse({ ...profile, accounts: [disconnected] });
      }
      if (url.includes(`/accounts/${accountId}/connection`)) {
        return jsonResponse(connectionDetail({
          connection: "NOT_CONNECTED",
          externalId: null,
          canConnect: false,
          connectBlockedReason: "Nền tảng này chưa được hỗ trợ đăng tự động",
        }));
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAccountsTab();
    const button = await screen.findByRole("button", { name: "Kết nối" });
    expect(button).toBeDisabled();
    expect(await screen.findByText("Nền tảng này chưa được hỗ trợ đăng tự động")).toBeInTheDocument();
  });

  it("calls connection check API and shows pending state", async () => {
    let resolveCheck: ((value: Response) => void) | undefined;
    const checkPromise = new Promise<Response>((resolve) => {
      resolveCheck = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse(profile);
      }
      if (url.includes(`/accounts/${accountId}/connection/check`) && init?.method === "POST") {
        return checkPromise;
      }
      if (url.includes(`/accounts/${accountId}/connection`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse(connectionDetail());
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAccountsTab();
    const checkButton = await screen.findByRole("button", { name: "Kiểm tra kết nối" });
    fireEvent.click(checkButton);
    expect(await screen.findByRole("button", { name: "Đang kiểm tra…" })).toBeDisabled();

    resolveCheck?.(jsonResponse(connectionDetail({ lastCheckedAt: "2026-11-04T12:00:00.000Z" })));
    await waitFor(() => {
      expect(screen.getByText("Kết nối ổn.")).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes("/connection/check") && (init as RequestInit | undefined)?.method === "POST",
    )).toBe(true);
  });

  it("shows Sắp hết hạn when token expires within 7 days", async () => {
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse(profile);
      }
      if (url.includes(`/accounts/${accountId}/connection`)) {
        return jsonResponse(connectionDetail({ tokenExpiresAt: soon }));
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAccountsTab();
    expect(await screen.findByText("Sắp hết hạn")).toBeInTheDocument();
  });

  it("shows YouTube setup help and playlist scope note", async () => {
    const withPlaylist: PlatformAccount = {
      ...account,
      publishSettings: { visibility: "public", autoPublish: false, playlistId: "PLabc" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse({ ...profile, accounts: [withPlaylist] });
      }
      if (url.includes(`/accounts/${accountId}/connection`)) {
        return jsonResponse(connectionDetail());
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAccountsTab();
    expect(await screen.findByText("Hướng dẫn kết nối YouTube")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Hướng dẫn kết nối YouTube"));
    expect(await screen.findByText(/YouTube Data API v3/)).toBeInTheDocument();
    expect(screen.getByText(/xin quyền đầy đủ youtube/i)).toBeInTheDocument();
  });

  it("shows TikTok setup help and inbox mode hint", async () => {
    const tiktokAccount: PlatformAccount = {
      ...account,
      platform: "tiktok",
      format: "vertical",
      publishSettings: { visibility: "public", autoPublish: false, tiktokUploadMode: "inbox" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/profiles/${profileId}`) && (!init || !init.method || init.method === "GET")) {
        return jsonResponse({ ...profile, accounts: [tiktokAccount] });
      }
      if (url.includes(`/accounts/${accountId}/connection`)) {
        return jsonResponse(connectionDetail({
          redirectUri: "http://127.0.0.1:3001/api/oauth/tiktok/callback",
        }));
      }
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderAccountsTab();
    expect(await screen.findByText("Hướng dẫn kết nối TikTok")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Hướng dẫn kết nối TikTok"));
    expect(await screen.findByText(/Content Posting API/)).toBeInTheDocument();
    expect(screen.getByText(/Chế độ: Gửi vào hộp thư nháp/i)).toBeInTheDocument();
  });
});
