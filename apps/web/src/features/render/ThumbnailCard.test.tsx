import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ThumbnailCard } from "./ThumbnailCard";

const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const project = {
  id: projectId,
  title: "Đại dương",
  topic: "Ocean",
  description: "",
  mode: "ASSISTED",
  profileId: null,
  settings: {
    budget: { mode: "ECO" }, language: "vi", targetDurationSec: 60, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "COMPLETED",
  stage: "DONE",
  thumbnailPath: null,
  durationSec: 60,
  version: 1,
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt: "2026-11-04T00:00:00.000Z",
  archivedAt: null,
} as Project;

const state = {
  hasLandscape: true,
  hasCover: true,
  meta: { frameTimeSec: 4, text: "Bí ẩn", position: "bottom" as const, source: "auto" as const, frameId: "c0" },
  candidates: [{ id: "c0", sceneId: "s", timeSec: 4, score: 10 }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ThumbnailCard", () => {
  it("calls the API when a frame is selected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/thumbnail/recompose") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { frameId: string; text: string; position: string };
        expect(body.frameId).toBe("c0");
        return jsonResponse({ ...state, meta: { ...state.meta, source: "manual", text: body.text } });
      }
      if (url.includes("/thumbnail")) return jsonResponse(state);
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ThumbnailCard project={project} />);
    fireEvent.click(await screen.findByRole("button", { name: "Chọn khung 4 giây" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/thumbnail/recompose"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("rejects an upload that is too large or the wrong type before calling the API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/thumbnail")) return jsonResponse(state);
      return jsonResponse({ error: { code: "NOT_FOUND", message: url } }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ThumbnailCard project={project} />);
    const input = await screen.findByLabelText("Tải ảnh lên");
    const gif = new File([new Uint8Array([1, 2, 3])], "a.gif", { type: "image/gif" });
    fireEvent.change(input, { target: { files: [gif] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/PNG hoặc JPG/);
    const huge = new File([new Uint8Array([1])], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [huge] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/5 MB/);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/upload"))).toBe(false);
  });
});
