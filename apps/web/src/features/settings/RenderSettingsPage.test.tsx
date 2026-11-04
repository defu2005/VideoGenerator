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
});
