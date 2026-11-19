import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AccountPage } from "./AccountPage";

afterEach(() => vi.unstubAllGlobals());
it("shows a bound workspace and lets the user bind a legacy key", async () => {
  let bound = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/me")) return jsonResponse({ user: { id: "u", name: "User", email: "test@example.test" }, workspace: { id: "A", name: "A", flags: {} }, workspaces: [], role: "owner", channelIds: "all", allowed: [] });
    if (url.endsWith("/api-key/bind")) { expect(JSON.parse(String(init?.body))).toEqual({ keyId: "old" }); bound = true; return jsonResponse({ ok: true }); }
    if (url.endsWith("/api-key/list")) return jsonResponse([
      { id: "new", name: "New", createdAt: "2026-11-14", metadata: { workspaceId: "A" } },
      { id: "old", name: "Old", createdAt: "2026-11-14", metadata: bound ? { workspaceId: "A" } : null },
    ]);
    if (url.endsWith("/list-sessions")) return jsonResponse([]);
    return jsonResponse({ profiles: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  renderWithProviders(<AccountPage />);
  expect(await screen.findByText("Không gian: A")).toBeInTheDocument();
  expect(await screen.findByText("Chưa gắn workspace")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Gắn vào không gian hiện tại" }));
  await waitFor(() => expect(screen.queryByText("Chưa gắn workspace")).not.toBeInTheDocument());
});
