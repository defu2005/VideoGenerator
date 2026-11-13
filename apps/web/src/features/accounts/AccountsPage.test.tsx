import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AccountListRow } from "@vg/shared";
import { AccountsPage, filterAccounts, needsAttention, summarizeAccountChecks } from "./AccountsPage";
import { AddAccountWizard } from "./AddAccountWizard";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function account(patch: Partial<AccountListRow>): AccountListRow {
  return {
    id: A1,
    profileId: P1,
    platform: "youtube",
    displayName: "Kênh A",
    handle: null,
    externalId: null,
    format: "landscape",
    enabled: true,
    connection: "CONNECTED",
    connectionError: null,
    lastCheckedAt: null,
    publishSettings: {} as AccountListRow["publishSettings"],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    profileName: "Hồ sơ 1",
    tokenExpiresAt: null,
    ...patch,
  };
}

const ACCOUNTS = [
  account({}),
  account({ id: A2, profileId: P2, platform: "tiktok", displayName: "Kênh B", connection: "EXPIRED", profileName: "Hồ sơ 2" }),
];
const PROFILES = { items: [{ id: P1, name: "Hồ sơ 1" }, { id: P2, name: "Hồ sơ 2" }] };

function apiPath(url: unknown): string {
  return String(url).replace(/^.*\/api/, "");
}

describe("filterAccounts", () => {
  it("does not count unconnected accounts as checked or healthy", () => {
    expect(summarizeAccountChecks(0, 0, 5)).toMatchObject({ success: false, message: expect.stringContaining("5 tài khoản chưa kết nối") });
    expect(summarizeAccountChecks(2, 1, 5)).toEqual({
      success: false, message: "Đã kiểm tra 3 tài khoản: 2 hoạt động, 1 cần kết nối lại. 5 tài khoản chưa kết nối.",
    });
    expect(summarizeAccountChecks(2, 0, 0).success).toBe(true);
    expect(summarizeAccountChecks(2, 0, 1).success).toBe(false);
  });
  it("filters by platform, profile and attention", () => {
    expect(filterAccounts(ACCOUNTS, { platform: "tiktok", profileId: "", status: "" }).map((row) => row.displayName)).toEqual(["Kênh B"]);
    expect(filterAccounts(ACCOUNTS, { platform: "", profileId: P1, status: "" }).map((row) => row.displayName)).toEqual(["Kênh A"]);
    expect(filterAccounts(ACCOUNTS, { platform: "", profileId: "", status: "attention" }).map((row) => row.displayName)).toEqual(["Kênh B"]);
    expect(needsAttention(account({ enabled: false, connection: "ERROR" }))).toBe(false);
  });
});

describe("AccountsPage", () => {
  it("opens the developer app step from an OAuth repair link", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = apiPath(url);
      if (path === "/accounts") return jsonResponse({ accounts: ACCOUNTS });
      if (path.startsWith("/profiles")) return jsonResponse(PROFILES);
      return jsonResponse({ configured: true, source: "app", problems: [], redirectUri: "https://example.test/callback", howToVi: [] });
    }));
    renderWithProviders(<AccountsPage />, [`/accounts?editApp=${A1}`]);
    expect(await screen.findByLabelText("Client ID")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.getByTestId("current-location")).toHaveTextContent(/^\/accounts$/);
  });

  it("opens reconnect on the row and confirms deletion before sending it", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = apiPath(url);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (path === "/accounts") return jsonResponse({ accounts: ACCOUNTS });
      if (path.startsWith("/profiles")) return jsonResponse(PROFILES);
      return jsonResponse({ configured: true, source: "app", problems: [], redirectUri: "https://example.test/callback", howToVi: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AccountsPage />);
    const row = (await screen.findAllByTestId("account-row")).find((item) => within(item).queryByText("Kênh B"))!;
    expect(within(row).getByRole("button", { name: "Chuyển hồ sơ" })).toBeEnabled();
    fireEvent.click(within(row).getByRole("button", { name: "Kết nối lại" }));
    await screen.findByRole("button", { name: "Đăng nhập" });
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(row).getByRole("button", { name: "Xoá" }));
    const confirm = screen.getByRole("dialog");
    expect(confirm).toHaveTextContent("Kênh B");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(within(confirm).getByRole("button", { name: "Xoá" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/profiles/${P2}/accounts/${A2}`), expect.objectContaining({ method: "DELETE" })));
  });

  it("shows every account, a banner for broken ones and narrows the list from the banner", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const path = apiPath(url);
      if (path.startsWith("/accounts")) return Promise.resolve(jsonResponse({ accounts: ACCOUNTS }));
      if (path.startsWith("/profiles")) return Promise.resolve(jsonResponse(PROFILES));
      return Promise.resolve(jsonResponse({ message: "not found" }, 404));
    }));
    renderWithProviders(<AccountsPage />);
    expect(await screen.findAllByTestId("account-row")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("1 tài khoản cần kết nối lại");
    fireEvent.click(screen.getByRole("button", { name: "Chỉ xem các tài khoản này" }));
    await waitFor(() => expect(screen.getAllByTestId("account-row")).toHaveLength(1));
    expect(screen.getByText("Kênh B")).toBeInTheDocument();
  });
});

describe("AddAccountWizard", () => {
  it("shows help after 20 seconds and stops waiting when the callback reports an error", async () => {
    let failed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = apiPath(url);
      if (path === "/accounts") return jsonResponse({ accounts: [account({ connection: "NOT_CONNECTED" })] });
      if (path.endsWith("/connection")) return jsonResponse(account({
        connection: failed ? "ERROR" : "NOT_CONNECTED",
        connectionError: failed ? "Không xác thực được ứng dụng." : null,
      }));
      if (path.startsWith("/profiles")) return jsonResponse(PROFILES);
      return jsonResponse({ configured: true, source: "app", problems: [], redirectUri: "https://example.test/callback", howToVi: [] });
    }));
    renderWithProviders(<AddAccountWizard open onClose={vi.fn()} accountId={A1} />);
    const login = await screen.findByRole("button", { name: "Đăng nhập" });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.useFakeTimers();
    try {
      fireEvent.click(login);
      expect(screen.getByText("Đang chờ bạn đăng nhập…")).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(19_999));
      expect(screen.queryByText("Trang đăng nhập báo lỗi?")).not.toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(screen.getByText("Trang đăng nhập báo lỗi?")).toBeInTheDocument();
      failed = true;
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(screen.getByRole("alert")).toHaveTextContent("Không xác thực được ứng dụng.");
      expect(screen.queryByText("Đang chờ bạn đăng nhập…")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      open.mockRestore();
    }
  });

  it.each([false, true])("cleans up only the account created by this wizard (resume=%s)", async (resume) => {
    const existing = account({ connection: "ERROR" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = apiPath(url);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (path === "/accounts") return jsonResponse({ accounts: [existing] });
      if (path.startsWith("/profiles") && init?.method === "POST") return jsonResponse({ ...existing, connection: "NOT_CONNECTED" }, 201);
      if (path.startsWith("/profiles")) return jsonResponse(PROFILES);
      return jsonResponse({ configured: true, source: "app", problems: [], redirectUri: "https://example.test/callback", howToVi: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const close = vi.fn();
    renderWithProviders(<AddAccountWizard open onClose={close} accountId={resume ? A1 : undefined} />);
    if (resume) await screen.findByRole("button", { name: "Đăng nhập" });
    else {
      await screen.findByRole("option", { name: "Hồ sơ 1" });
      fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
      await screen.findByTestId("redirect-uri");
    }
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes).toHaveLength(resume ? 0 : 1);
    if (!resume) expect(deletes[0]?.[0]).toContain(`/accounts/${A1}?unfinished=true`);
  });

  it("creates the account, shows the redirect URI and saves the developer app", async () => {
    const created = account({ connection: "NOT_CONNECTED" });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const path = apiPath(url);
      if (path.startsWith("/profiles") && init?.method === "POST") return Promise.resolve(jsonResponse(created, 201));
      if (path.startsWith("/profiles")) return Promise.resolve(jsonResponse(PROFILES));
      if (path.startsWith("/connections/platform-apps/youtube")) {
        const saved = init?.method === "PUT";
        return Promise.resolve(jsonResponse({
          platform: "youtube",
          secretId: "platform.youtube.app",
          configured: saved,
          source: saved ? "app" : "none",
          hint: null,
          redirectUri: "http://127.0.0.1:3001/api/oauth/youtube/callback",
          consoleUrl: "https://console.cloud.google.com/apis/credentials",
          howToVi: ["Tạo OAuth client."],
        }));
      }
      return Promise.resolve(jsonResponse({ message: "not found" }, 404));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AddAccountWizard open onClose={vi.fn()} />);
    await screen.findByRole("option", { name: "Hồ sơ 1" });
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    expect(await screen.findByTestId("redirect-uri")).toHaveTextContent("/api/oauth/youtube/callback");
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "fixture@example.test" } });
    fireEvent.change(screen.getByLabelText("Client Secret"), { target: { value: "secret-1" } });
    expect(screen.getByRole("button", { name: "Lưu và tiếp" })).toBeDisabled();
    expect(screen.getByText(/Đây là email/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "1234-fixture.apps.googleusercontent.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu và tiếp" }));
    expect(await screen.findByRole("button", { name: "Đăng nhập" })).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/platform-apps/youtube") && init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ clientId: "1234-fixture.apps.googleusercontent.com", clientSecret: "secret-1", scope: "app" });
  });
});
