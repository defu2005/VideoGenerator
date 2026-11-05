import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { OperatorPage } from "./OperatorPage";

afterEach(() => vi.unstubAllGlobals());

const overview = {
  killed: false,
  cli: { found: true, version: "2026.11.05-test", loggedIn: null, model: null },
  queue: [{ id: "run-2", prompt: "việc chờ", position: 1, status: "queued" }],
  activeRunId: null,
  pending: [{ id: "act-1", summary: "Đăng video", status: "pending" }],
  orders: [{ id: "ord-1", title: "Kênh A", prompt: "3 video", cron: "0 8 * * *", enabled: true }],
  runs: [{ id: "run-1", status: "done", prompt: "Kiểm tra", result: "Xong", toolChips: ["list_projects"], outcome: "success", createdAt: "2026-11-05T01:00:00.000Z" }],
  audit: [{ id: "aud-1", source: "operator", tool: "list_projects", decision: "executed", summary: "Liệt kê dự án", created_at: "2026-11-05T01:00:00.000Z" }],
  notes: [{ name: "journal.md", text: "Ghi chú" }],
  settings: { killed: false, cursorPath: "", tickCron: null, maxRunsPerDay: 30 },
  resumeCommand: "cursor-agent --resume chat-1",
  workspacePath: "C:/data/operator",
  usage: { today: 1, month: 4, cap: 30 },
  conversationId: "11111111-1111-4111-8111-111111111111",
};

describe("OperatorPage", () => {
  it("shows status, a pending card and the resume command", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/operator/overview")) return jsonResponse(overview);
      if (url.includes("/operator/conversations/")) return jsonResponse({ messages: [{ id: "m1", role: "assistant", text: "Xong việc", createdAt: "2026-11-05T01:00:00.000Z" }] });
      if (url.includes("/assistant/actions/") && init?.method === "POST") return jsonResponse({ id: "act-1", status: "confirmed" });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<OperatorPage />);
    expect(await screen.findByText(/2026.11.05-test/)).toBeInTheDocument();
    expect(screen.getByText("Đăng video")).toBeInTheDocument();
    expect(screen.getByText(/cursor-agent --resume chat-1/)).toBeInTheDocument();
    expect(screen.getByText(/Đang chờ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    expect(await screen.findByRole("button", { name: "Duyệt" })).toBeInTheDocument();
  });
});
