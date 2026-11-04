import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { NotificationsPage } from "./NotificationsPage";

afterEach(() => vi.unstubAllGlobals());

const baseSettings = {
  telegram: { enabled: false, chatId: null, botUsername: "vg_bot" },
  events: {
    attention: true,
    published: true,
    waitingApproval: true,
    dailySummary: true,
  },
  dailySummaryTime: "21:00",
  timezone: "Asia/Ho_Chi_Minh",
  quietHours: null,
  tokenConfigured: true,
};

describe("NotificationsPage", () => {
  it("never renders the token back, shows pairing code, and saves toggles", async () => {
    let savedBody: unknown;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/notifications/settings") && init?.method === "PUT") {
        savedBody = JSON.parse(String(init.body));
        return jsonResponse({ ...baseSettings, ...(savedBody as object), tokenConfigured: true });
      }
      if (url.endsWith("/notifications/settings")) return jsonResponse(baseSettings);
      if (url.endsWith("/notifications/log")) return jsonResponse({ items: [] });
      if (url.endsWith("/notifications/telegram/pair") && init?.method === "POST") {
        return jsonResponse({
          code: "654321",
          expiresAt: "2026-11-05T12:10:00.000Z",
          botUsername: "vg_bot",
          startCommand: "/start 654321",
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<NotificationsPage />);
    expect(await screen.findByLabelText("Bật thông báo Telegram")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/123456:/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Token bot Telegram")).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Ghép nối" }));
    expect(await screen.findByLabelText("Lệnh ghép nối")).toHaveTextContent("/start 654321");

    fireEvent.click(screen.getByLabelText("Đăng thành công"));
    fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));
    await waitFor(() => {
      expect(savedBody).toMatchObject({
        events: expect.objectContaining({ published: false }),
      });
    });
    expect(await screen.findByText("Đã lưu.")).toBeInTheDocument();
  });
});
