import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { WebImageSettingsPage } from "./WebImageSettingsPage";

afterEach(() => vi.unstubAllGlobals());

describe("WebImageSettingsPage", () => {
  it("shows key status without revealing secrets and saves denylist", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/settings/web-image") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          ...body,
          keyConfigured: { brave: false, gemini: true },
          braveRequestsThisMonth: 2,
        });
      }
      return jsonResponse({
        braveEnabled: true,
        geminiGroundingEnabled: true,
        geminiModel: "gemini-2.5-flash",
        domainDenylist: ["pinterest.com", "pinimg.com"],
        keyConfigured: { brave: false, gemini: true },
        braveRequestsThisMonth: 2,
      });
    }));

    renderWithProviders(<WebImageSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Nguồn ảnh web" })).toBeInTheDocument();
    expect(screen.getByText(/thiếu key \(BRAVE_SEARCH_API_KEY\)/)).toBeInTheDocument();
    expect(screen.getByText(/đã cấu hình/)).toBeInTheDocument();
    expect(screen.getByText(/Lượt tháng này: 2/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Domain denylist"), {
      target: { value: "pinterest.com, example-spoiler.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.init?.method === "PUT");
    expect(JSON.parse(String(put?.init?.body))).toMatchObject({
      domainDenylist: ["pinterest.com", "example-spoiler.test"],
    });
    expect(await screen.findByText("Đã lưu.")).toBeInTheDocument();
  });
});
