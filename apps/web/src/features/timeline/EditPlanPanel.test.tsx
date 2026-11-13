import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Timeline } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { EditPlanPanel } from "./EditPlanPanel";

const timeline = {
  formatVersion: 1,
  target: { width: 1920, height: 1080, fps: 30 },
  totalDurationSec: 8,
  scenes: [
    {
      sceneId: "s1", order: 0, label: "Mở", startSec: 0, endSec: 4, durationSec: 4, durationFrames: 120,
      voice: null,
      visuals: [{ kind: "IMAGE" as const, candidateId: null, path: null, startSec: 0, endSec: 4, motion: { type: "kenburns" as const, from: { zoom: 1 }, to: { zoom: 1.1 } }, licenseKind: null }],
      fadeInSec: 0.5, fadeOutSec: 0,
      transitionOut: { type: "cut" as const, durationSec: 0 },
    },
    {
      sceneId: "s2", order: 1, label: "Sau", startSec: 4, endSec: 8, durationSec: 4, durationFrames: 120,
      voice: null,
      visuals: [{ kind: "PLACEHOLDER" as const, candidateId: null, path: null, startSec: 4, endSec: 8, motion: { type: "kenburns" as const, from: { zoom: 1 }, to: { zoom: 1 } }, licenseKind: null }],
      fadeInSec: 0, fadeOutSec: 0.8,
    },
  ],
  music: null,
  subtitles: null,
  warnings: [],
  licenseSummary: {},
  editPlan: {
    preset: "story" as const,
    transitions: [{ afterSceneId: "s1", type: "cut" as const, durationSec: 0 }],
    motions: [{ sceneId: "s1", preset: "push_in" as const }],
    emphasis: [{ sceneId: "s1", wordIndexStart: 0, wordIndexEnd: 0, effects: ["callout" as const], calloutText: "hố" }],
    subtitleStyle: "karaoke" as const,
    source: "fallback" as const,
  },
  graphics: [{
    id: "g1",
    templateId: "title_card" as const,
    sceneId: "s1",
    startSec: 2,
    durationSec: 2,
    variables: { title: "Hố" },
    layer: "overlay" as const,
    source: "user" as const,
  }],
} satisfies Timeline;

describe("EditPlanPanel", () => {
  it("changes a transition, toggles the style preview, and requests a 10 second preview", async () => {
    const calls: { url: string; method?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.endsWith("/preview")) return jsonResponse({ startSec: 0, endSec: 8, sceneId: "s1", graphics: [{ templateId: "title_card", startSec: 0, durationSec: 3 }] });
      if (url.endsWith("/scenes")) return jsonResponse({ scenes: [{ id: "s1", label: "Mở", narration: "hố đen sâu" }, { id: "s2", label: "Sau", narration: "sau đó" }], totalSec: 8 });
      return jsonResponse({ timeline: { ...timeline, editPlan: { ...timeline.editPlan, subtitleStyle: "pop" } } });
    }));
    renderWithProviders(<EditPlanPanel projectId="55555555-5555-4555-8555-555555555555" timeline={timeline} onSaved={() => undefined} />);
    expect(screen.getByLabelText("Xem thử kiểu phụ đề").className).toContain("karaoke");
    expect(screen.getByTitle("Xem trước đồ họa")).toHaveAttribute("sandbox", "allow-scripts");
    expect(screen.getByRole("button", { name: "title_card" })).toHaveStyle({ left: "25%" });
    fireEvent.click(screen.getByRole("button", { name: "title_card" }));
    expect(screen.getByTitle("Xem trước đồ họa").getAttribute("src")).toContain(encodeURIComponent("Hố"));
    fireEvent.change(screen.getByLabelText("Kiểu phụ đề"), { target: { value: "pop" } });
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    fireEvent.change(screen.getByLabelText("Chuyển cảnh sau Mở"), { target: { value: "dissolve" } });
    expect(screen.getByRole("button", { name: "hố" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "đen" }));
    fireEvent.change(screen.getByLabelText("Chuyển động Mở"), { target: { value: "pan_left" } });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ nhấn mạnh" }));
    await waitFor(() => expect(screen.getByText("Đã lưu kế hoạch dựng.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Xem nhanh 10 giây" }));
    await waitFor(() => expect(screen.getByText(/Xem nhanh 10 giây từ 0.0s đến 8.0s. Đồ họa: title_card/)).toBeInTheDocument());
  });
});
