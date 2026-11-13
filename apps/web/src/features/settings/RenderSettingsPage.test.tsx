import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { RenderSettingsPage } from "./RenderSettingsPage";

afterEach(() => vi.unstubAllGlobals());

describe("RenderSettingsPage", () => {
  it("loads and saves keepVersions", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/settings/render") && init?.method === "PUT") {
        return jsonResponse(JSON.parse(String(init.body)));
      }
      return jsonResponse({ keepVersions: 5 });
    }));
    renderWithProviders(<RenderSettingsPage />);
    expect(await screen.findByLabelText("Số bản render giữ lại")).toHaveValue(5);
    fireEvent.change(screen.getByLabelText("Số bản render giữ lại"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PUT" && String(call.init.body).includes('"keepVersions":8'))).toBe(true));
    expect(await screen.findByText("Đã lưu.")).toBeInTheDocument();
  });

  it("asks for a short title-card trial", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/motion/trial")) return jsonResponse({ ok: true, seconds: 1.2, cached: false, warning: null });
      if (url.endsWith("/motion/status")) return jsonResponse({ version: "0.9.14", ok: true, doctor: "" });
      return jsonResponse({ keepVersions: 5 });
    }));
    renderWithProviders(<RenderSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Render thử" }));
    await waitFor(() => expect(calls.some((call) => call.startsWith("POST") && call.includes("/motion/trial"))).toBe(true));
    expect(await screen.findByText(/1\.2 giây/)).toBeInTheDocument();
  });
});
