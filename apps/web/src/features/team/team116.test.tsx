import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { TeamPage } from "./TeamPage";
import { ServiceKeysCard } from "./ServiceKeysCard";
import { AuditPage } from "../audit/AuditPage";
import { AccountPage } from "../account/AccountPage";
import { InvitePage } from "../auth/InvitePage";
import { assignableRoles, effectiveRole } from "../../services/teamApi";

type Handler = (url: string, init?: RequestInit) => Response | undefined;
function mockFetch(handlers: Handler[]) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    for (const handler of handlers) {
      const out = handler(url, init);
      if (out) return out;
    }
    return jsonResponse({ error: { code: "NOT_FOUND", message: "x" } }, 404);
  }));
  return calls;
}

const me = (role = "owner") => ({
  user: { id: "u1", name: "Chủ", email: "o@x.test" },
  workspace: { id: "w1", name: "Nhóm", flags: {} },
  workspaces: [], role, channelIds: "all", isInstanceOwner: true, twoFactorEnabled: false,
  allowed: ["members.manage", "audit.read"],
});
const members = {
  members: [
    { userId: "u1", name: "Chủ", email: "o@x.test", role: "owner", twoFactorEnabled: false, lastActiveAt: null, joinedAt: "2026-01-01T00:00:00Z", grants: [], isSelf: true },
    { userId: "u2", name: "Lan", email: "lan@x.test", role: "viewer", twoFactorEnabled: true, lastActiveAt: null, joinedAt: "2026-01-02T00:00:00Z", grants: [], isSelf: false },
  ],
  channels: [{ id: "p1", name: "Kênh A" }],
};
const teamHandlers: Handler[] = [
  (u) => (u.endsWith("/api/me") ? jsonResponse(me()) : undefined),
  (u) => (u.endsWith("/workspace/members") ? jsonResponse(members) : undefined),
  (u) => (u.endsWith("/workspace/invitations") ? jsonResponse({ invitations: [] }) : undefined),
  (u) => (u.endsWith("/workspace/settings") ? jsonResponse({ name: "Nhóm", flags: {}, canEdit: true }) : undefined),
  (u) => (u.endsWith("/workspace/service-keys") ? jsonResponse({ keys: [] }) : undefined),
];

afterEach(() => vi.unstubAllGlobals());

describe("team helpers", () => {
  it("never offers owner to admins and takes the lower effective role", () => {
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(effectiveRole("editor", "viewer")).toBe("viewer");
    expect(effectiveRole("viewer", "editor")).toBe("viewer");
  });
});

describe("TeamPage", () => {
  it("lists members and asks before removing one", async () => {
    const calls = mockFetch(teamHandlers);
    renderWithProviders(<TeamPage />);
    expect(await screen.findByText("Lan")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Xóa" })[0]);
    expect(await screen.findByText("Xóa thành viên?")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("shows the invite link after creating an invitation", async () => {
    mockFetch([
      (u, init) => (u.endsWith("/workspace/invitations") && init?.method === "POST"
        ? jsonResponse({ id: "i1", email: "new@x.test", role: "viewer", grants: [], expiresAt: "2026-12-01T00:00:00Z", link: "/invite/i1" }, 201) : undefined),
      ...teamHandlers,
    ]);
    renderWithProviders(<TeamPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Mời thành viên" }));
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: "new@x.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Tạo (lời mời|liên kết)/ }));
    expect(await screen.findByDisplayValue(/\/invite\/i1/)).toBeInTheDocument();
  });
});

describe("ServiceKeysCard", () => {
  it("hides Thu hồi when the server says canRevoke is false", async () => {
    const key = (id: string, name: string, canRevoke: boolean) => ({
      id, name, preview: "vg_abcd…", ownerName: "Chủ", enabled: true, isLocalService: false, canRevoke,
      createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, expiresAt: null,
    });
    mockFetch([(u) => (u.endsWith("/workspace/service-keys") ? jsonResponse({ keys: [key("k1", "của-chủ", false), key("k2", "của-tôi", true)] }) : undefined)]);
    renderWithProviders(<ServiceKeysCard />);
    expect(await screen.findByText("của-chủ")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Thu hồi" })).toHaveLength(1);
  });
});

describe("AuditPage", () => {
  it("pages with Tải thêm", async () => {
    const item = (id: string) => ({ id, at: Date.now(), actorKind: "user", actorName: "Chủ", actorKeyName: null, action: `a.${id}`, summary: `Việc ${id}`, source: "api", outcome: "ok", targetType: null, targetId: null, statusCode: 200, requestId: null, payload: null });
    mockFetch([
      (u) => (u.includes("/api/audit") ? jsonResponse(u.includes("cursor=") ? { items: [item("2")], nextCursor: null } : { items: [item("1")], nextCursor: "c1" }) : undefined),
      (u) => (u.endsWith("/workspace/members") ? jsonResponse(members) : undefined),
    ]);
    renderWithProviders(<AuditPage />);
    expect(await screen.findByText("Việc 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    expect(await screen.findByText("Việc 2")).toBeInTheDocument();
  });
});

describe("AccountPage", () => {
  it("shows a created API key once", async () => {
    mockFetch([
      (u) => (u.endsWith("/api/me") ? jsonResponse(me()) : undefined),
      (u, init) => (u.endsWith("/api-key/create") && init?.method === "POST" ? jsonResponse({ id: "k1", key: "vg_secret_full_key_123" }) : undefined),
      (u) => (u.endsWith("/api-key/list") ? jsonResponse([]) : undefined),
      (u) => (u.endsWith("/list-sessions") ? jsonResponse([]) : undefined),
    ]);
    renderWithProviders(<AccountPage />);
    fireEvent.change(await screen.findByLabelText("Tên khóa"), { target: { value: "mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo khóa" }));
    expect(await screen.findByDisplayValue("vg_secret_full_key_123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tôi đã lưu" }));
    expect(screen.queryByDisplayValue("vg_secret_full_key_123")).toBeNull();
  });
});

describe("InvitePage", () => {
  const at = () => renderWithProviders(<Routes><Route path="/invite/:id" element={<InvitePage />} /></Routes>, ["/invite/i1"]);
  it("shows a signup form with a fixed email", async () => {
    mockFetch([
      (u) => (u.includes("/api/setup/invite/i1") ? jsonResponse({ email: "new@x.test", role: "viewer", workspaceName: "Nhóm", accountExists: false }) : undefined),
      (u) => (u.includes("get-session") ? jsonResponse(null) : undefined),
    ]);
    at();
    expect(await screen.findByDisplayValue("new@x.test")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /Tạo tài khoản/ })).toBeInTheDocument();
  });
  it("shows one message for an invalid link", async () => {
    mockFetch([(u) => (u.includes("get-session") ? jsonResponse(null) : jsonResponse({ error: { code: "NOT_FOUND", message: "x" } }, 404))]);
    at();
    await waitFor(() => expect(screen.getByText(/không hợp lệ hoặc đã hết hạn/)).toBeInTheDocument());
  });
});
