import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ComputerUsePanel } from "./ComputerUsePanel";

afterEach(() => vi.unstubAllGlobals());

const off = {
  settings: { enabled: false, adapter: "none", allowedApps: [], allowedActions: ["observe", "navigate"], maxSteps: 15, timeoutSec: 120 },
  available: false, reason: "Computer Use đang tắt. Bật trong mục Computer Use của Agent operator.", stoppedAt: null, adapter: null,
};

describe("ComputerUsePanel", () => {
  it("starts off, explains why, and saves the granted scope", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        return jsonResponse({ ...off, settings: body, available: true, reason: null, adapter: { label: "Ứng dụng thử (giả lập)", apps: ["ung-dung-thu"] } });
      }
      return jsonResponse(off);
    }));
    renderWithProviders(<ComputerUsePanel />);
    expect(await screen.findByText(/đang tắt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dừng Computer Use" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Bật Computer Use"));
    fireEvent.change(screen.getByLabelText("Môi trường"), { target: { value: "simulator" } });
    fireEvent.change(screen.getByLabelText(/Ứng dụng hoặc tên miền/), { target: { value: "ung-dung-thu" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));
    expect(await screen.findByText(/Sẵn sàng/)).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({ enabled: true, adapter: "simulator", allowedApps: ["ung-dung-thu"], allowedActions: ["observe", "navigate"] });
  });
});
