import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type PipelineState, type Project, type ProjectRender, type ProjectTimeline } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { RenderPanel } from "./RenderPanel";

const projectId = "66666666-6666-4666-8666-666666666666";
const sceneId = "77777777-7777-4777-8777-777777777777";
const project: Project = {
  id: projectId,
  title: "Render fixture",
  topic: "Ocean",
  description: "",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "ECO" }, language: "en", targetDurationSec: 30, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "REVIEW", stage: "RENDER", thumbnailPath: null, durationSec: 4, version: 1,
  createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z", archivedAt: null,
};

const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.5 } };
const timeline: ProjectTimeline = {
  inputHash: "hash",
  updatedAt: project.updatedAt,
  timeline: {
    formatVersion: 1,
    target: { width: 1920, height: 1080, fps: 30 },
    totalDurationSec: 4,
    scenes: [{
      sceneId, order: 0, label: "Intro", startSec: 0, endSec: 4, durationSec: 4, durationFrames: 120,
      voice: null,
      visuals: [{ kind: "IMAGE", candidateId: "c1", path: "visuals/c1.jpg", startSec: 0, endSec: 4, motion, licenseKind: "CC0" }],
      fadeInSec: 0.5, fadeOutSec: 0.25,
    }],
    music: null,
    subtitles: null,
    warnings: [],
    licenseSummary: { CC0: 1 },
  },
};

const render: ProjectRender = {
  render: {
    id: "r1", projectId, status: "DONE", inputHash: "h", durationSec: 64, sizeBytes: 3 * 1024 * 1024,
    width: 1920, height: 1080, hasCredits: true, hasSubtitles: false, createdAt: project.updatedAt,
    report: {
      ok: true, expectedDurationSec: 64, durationSec: 64.02, width: 1920, height: 1080, hasAudio: true,
      issues: [{ code: "BLACK_FRAMES", severity: "WARN", sceneId, message: "Khung đen 1.0s ở cảnh 1." }],
      thumbnails: [sceneId], clipsReused: 0, clipsRendered: 1, elapsedSec: 12.3,
    },
  },
};

function pipelineWith(state: "DONE" | "PENDING"): PipelineState {
  return {
    projectId, mode: project.mode, runMode: null, currentStage: "RENDER", status: "REVIEW",
    stages: STAGE_ORDER.map((stage) => ({
      stage, state: stage === "RENDER" ? state : "DONE", progress: 0,
      message: null, jobId: null, updatedAt: project.updatedAt, error: null,
    })),
    activeJob: null,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("RenderPanel", () => {
  it("shows the player, report, thumbnails and downloads, and starts a re-render", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/pipeline") || url.includes("/run")) return jsonResponse(pipelineWith("DONE"));
      if (url.endsWith("/render")) return jsonResponse(render);
      return jsonResponse(timeline);
    }));
    const { container } = renderWithProviders(<RenderPanel project={project} />);

    expect(await screen.findByText("1:04 · 1920×1080 · 3.0 MB")).toBeInTheDocument();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(`/api/projects/${projectId}/render/video?v=r1`);
    expect(screen.getByRole("link", { name: "Tải video" })).toHaveAttribute("href", `/api/projects/${projectId}/render/video?v=r1&download=1`);
    expect(screen.getByRole("link", { name: "Tải credits" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tải phụ đề" })).toBeNull();
    expect(screen.getByText("Kiểm tra: đạt · 1 vấn đề")).toBeInTheDocument();
    expect(screen.getByText("Khung đen")).toBeInTheDocument();
    expect(screen.getByAltText("1. Intro")).toHaveAttribute("src", `/api/projects/${projectId}/render/thumbs/${sceneId}?v=r1`);

    fireEvent.click(screen.getByRole("button", { name: "Render lại" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "POST" && call.url.endsWith("/pipeline/run") && String(call.init.body).includes('"RENDER"'))).toBe(true));
  });

  it("asks for a timeline before rendering", async () => {
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pipeline")) return jsonResponse(pipelineWith("PENDING"));
      if (url.endsWith("/render")) return jsonResponse({ render: null });
      return jsonResponse({ timeline: null, inputHash: null, updatedAt: null });
    }));
    renderWithProviders(<RenderPanel project={project} />);
    expect(await screen.findByText("Chưa có video")).toBeInTheDocument();
    expect(screen.getByText(/hoàn tất tab Timeline trước/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Render" })).toBeDisabled();
  });
});
