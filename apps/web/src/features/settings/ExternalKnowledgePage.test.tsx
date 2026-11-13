import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalKnowledgePage } from "./ExternalKnowledgePage";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  summary: "Token YouTube bị thu hồi",
  severity: "critical",
  status: "open",
  detector: "D2",
  seenCount: 2,
  reaction: { proposalId: "22222222-2222-4222-8222-222222222222" },
};

describe("ExternalKnowledgePage changes", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/settings/knowledge?tab=changes");
  });

  it("filters the inbox and offers continue and close", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/knowledge/changes")) return jsonResponse({ events: [event] });
      if (url.includes("/knowledge/proposals")) return jsonResponse({ proposals: [] });
      return jsonResponse({ entries: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ExternalKnowledgePage />);
    expect(await screen.findByRole("heading", { name: "Token YouTube bị thu hồi" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở đề xuất" })).toHaveAttribute("href", "/settings/knowledge?tab=pending");
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Đóng" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Mức"), { target: { value: "info" } });
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("severity=info"))).toBe(true));
  });
});
