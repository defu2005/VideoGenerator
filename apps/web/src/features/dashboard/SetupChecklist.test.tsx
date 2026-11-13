import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetupChecklist } from "./SetupChecklist";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const overview = (hidden: boolean) => ({
  sections: [],
  importable: [],
  setup: {
    items: [
      { id: "ai", label: "Ít nhất một nhà cung cấp AI sẵn sàng", done: true, href: "/settings/connections#ai" },
      { id: "accounts", label: "Kết nối ít nhất một tài khoản nền tảng", done: false, href: "/accounts" },
    ],
    complete: false,
    hidden,
  },
});

describe("SetupChecklist", () => {
  it("lists the steps with links and hides on request", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(jsonResponse(init?.method === "PUT" ? overview(true) : overview(false))));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SetupChecklist />);
    expect(await screen.findByText(/Xong 1\/2 bước/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kết nối ít nhất một tài khoản nền tảng" })).toHaveAttribute("href", "/accounts");
    fireEvent.click(screen.getByRole("button", { name: "Ẩn" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith("/api/connections/setup") && init?.method === "PUT")).toBe(true));
  });

  it("renders nothing when hidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(overview(true)));
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SetupChecklist />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText("Thiết lập ban đầu")).toBeNull();
  });
});
