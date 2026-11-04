import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ImageSourcesSettingsPage } from "./ImageSourcesSettingsPage";

afterEach(() => vi.unstubAllGlobals());

describe("ImageSourcesSettingsPage", () => {
  it("renders Nguồn ảnh rows and saves toggles", async () => {
    const payload = {
      enabled: {
        wikimedia: true,
        openverse: true,
        pexels: true,
        pixabay: true,
        unsplash: true,
        nasa: true,
        met: true,
        loc: true,
        smithsonian: true,
        europeana: true,
        flickr: true,
      },
      sources: [
        {
          id: "nasa" as const,
          label: "NASA Image Library",
          enabled: true,
          keyRequired: false,
          keyConfigured: true,
          requestsPerMinute: 60,
          lastBlockedAt: null,
        },
        {
          id: "pixabay" as const,
          label: "Pixabay",
          enabled: true,
          keyRequired: true,
          keyConfigured: false,
          requestsPerMinute: 100,
          lastBlockedAt: null,
        },
        {
          id: "loc" as const,
          label: "Library of Congress",
          enabled: true,
          keyRequired: false,
          keyConfigured: true,
          requestsPerMinute: 20,
          lastBlockedAt: "2026-11-04T12:00:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/settings/image-sources") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { enabled: Record<string, boolean> };
        return jsonResponse({
          ...payload,
          enabled: body.enabled,
          sources: payload.sources.map((row) => ({
            ...row,
            enabled: body.enabled[row.id] !== false,
          })),
        });
      }
      if (url.endsWith("/settings/image-sources")) return jsonResponse(payload);
      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<ImageSourcesSettingsPage />);
    expect(await screen.findByRole("heading", { name: "Nguồn ảnh" })).toBeInTheDocument();
    expect(screen.getAllByText(/thiếu key/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/không cần key/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Bị chặn lần gần nhất:/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /Bật NASA Image Library/i }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toMatchObject({
      enabled: expect.objectContaining({ nasa: false }),
    });
    expect(await screen.findByText("Đã lưu.")).toBeInTheDocument();
  });
});
