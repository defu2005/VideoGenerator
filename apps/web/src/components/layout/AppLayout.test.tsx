import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

function mockViewport(mobile: boolean) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: mobile ? 390 : 1280 });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: mobile && query.includes("max-width"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

describe("AppLayout", () => {
  it("renders the sidebar sections", async () => {
    mockViewport(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ count: 0, items: [] })));
    renderWithProviders(<AppLayout />);
    expect(await screen.findByRole("button", { name: "Tổng quan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nội dung" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kết quả" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cài đặt" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trợ lý AI" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dự án" })).toBeInTheDocument();
  });

  it("opens the drawer under 768px", async () => {
    mockViewport(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ count: 0, items: [] })));
    renderWithProviders(<AppLayout />);
    const sidebar = document.querySelector(".sidebar");
    expect(sidebar).toHaveClass("is-drawer");
    expect(sidebar).not.toHaveClass("is-open");
    fireEvent.click(await screen.findByRole("button", { name: "Mở điều hướng" }));
    expect(document.querySelector(".sidebar")).toHaveClass("is-open");
  });

  it("finds a page from the command palette", async () => {
    mockViewport(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, pageSize: 20, count: 0 })));
    renderWithProviders(<AppLayout />);
    fireEvent.click(screen.getByRole("button", { name: "Tìm nhanh" }));
    const input = await screen.findByLabelText("Tìm trang, hồ sơ hoặc dự án");
    fireEvent.change(input, { target: { value: "Dự án" } });
    const dialog = await screen.findByRole("dialog", { name: "Chuyển nhanh" });
    expect(within(dialog).getByRole("link", { name: "Dự án" })).toHaveAttribute("href", "/projects");
  });
});
