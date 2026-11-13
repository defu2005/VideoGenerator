import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountHealthPanel } from "./AccountHealthPanel";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

describe("weekly health checklist", () => {
  it("submits dashboard metrics with an explicit source, units and sample count", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? jsonResponse({ recorded: true })
      : jsonResponse({ settings: { offline: false, eco: false }, webhook: "polling", accounts: [{ accountId: "a", name: "Kênh thử", platform: "youtube", checks: [] }] }));
    vi.stubGlobal("fetch", fetchMock); renderWithProviders(<AccountHealthPanel />);
    await screen.findByText("Ghi số liệu ngày từ dashboard");
    const form = within(screen.getByRole("form", { name: "Ghi số liệu ngày", hidden: true }));
    fireEvent.change(form.getByLabelText("Ngày số liệu"), { target: { value: "2026-11-10" } });
    fireEvent.change(form.getByLabelText("Giá trị"), { target: { value: "0.05" } });
    fireEvent.change(form.getByLabelText("Số mẫu"), { target: { value: "500" } });
    fireEvent.change(form.getByLabelText("Link dashboard / báo cáo nguồn"), { target: { value: "https://studio.youtube.com/fixture" } });
    fireEvent.submit(screen.getByRole("form", { name: "Ghi số liệu ngày", hidden: true }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === "POST" && JSON.parse(String(call[1]?.body)).value === 0.05)).toBe(true));
  });
  it("shows the knowledge verification path and submits a manual check with its account and policy", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? jsonResponse({ ok: true }) : jsonResponse({ settings: { offline: false, eco: true }, webhook: "Đang polling, chưa có webhook HTTPS", accounts: [{
        accountId: "account", platform: "youtube", name: "Kênh của tôi", checks: [{ entryId: "account.youtube.strikes", name: "Strike", coverage: "manual", verification: "Studio → Channel violations", due: true, observations: [] }],
      }] }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AccountHealthPanel />);
    expect(await screen.findByText("Studio → Channel violations")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Strike · Kiểm tra thủ công/));
    fireEvent.change(screen.getByLabelText("Kết quả"), { target: { value: "issue" } });
    fireEvent.change(screen.getByLabelText("Tên chính sách / thông báo"), { target: { value: "Community Guidelines" } });
    fireEvent.click(screen.getByRole("button", { name: "Ghi lần kiểm tra" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === "POST" && JSON.parse(String(call[1]?.body)).entryId === "account.youtube.strikes")).toBe(true));
    expect(await screen.findByText("Đã ghi báo cáo thủ công cùng thời điểm kiểm tra.")).toBeInTheDocument();
  });
  it("shows connection errors instead of an empty or healthy checklist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "HEALTH_ERROR", message: "Không đọc được checklist" } }, 500)));
    renderWithProviders(<AccountHealthPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không đọc được checklist");
  });
});
