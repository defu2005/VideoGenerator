import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ContactSheetButton, SceneQuickPreview } from "./QuickPreview";

const projectId = "55555555-5555-4555-8555-555555555555";

function result(kind: string, name: string) {
  return {
    kind, basis: "selection", notes: ["Chưa có timeline."], file: { id: name, name, mime: "image/jpeg", bytes: 10, url: `/api/projects/${projectId}/preview/files/${name}` },
    cached: false, width: 480, height: 270, facts: [], warnings: ["Chữ gần mép khung."], elapsedMs: 1200,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("quick preview", () => {
  it("does nothing until clicked, then shows three frames", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const payload = result("frame", `f${fetchMock.mock.calls.length}.jpg`);
      return jsonResponse({ ...payload, warnings: [...payload.warnings, ...payload.notes] });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<SceneQuickPreview projectId={projectId} scene={{ sceneId: "s1", label: "Intro", durationSec: 4 }} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Xem trước nhanh" }));
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
    expect(screen.getByText("Chữ gần mép khung.")).toBeTruthy();
    expect(screen.getAllByText("Chưa có timeline.")).toHaveLength(1);
  });

  it("shows a friendly message when previews are busy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "PREVIEW_BUSY", message: "busy" } }, 429)));
    renderWithProviders(<ContactSheetButton projectId={projectId} />);
    fireEvent.click(screen.getByRole("button", { name: "Contact sheet" }));
    await screen.findByText(/đang bận/);
  });
});
