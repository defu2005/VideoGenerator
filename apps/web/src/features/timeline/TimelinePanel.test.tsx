import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type PipelineState, type Project, type ProjectTimeline } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { TimelinePanel } from "./TimelinePanel";

const projectId = "55555555-5555-4555-8555-555555555555";
const project: Project = {
  id: projectId,
  title: "Timeline fixture",
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
  status: "REVIEW", stage: "FINAL_APPROVAL", thumbnailPath: null, durationSec: 9, version: 1,
  createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z", archivedAt: null,
};

const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.5 } };
const timeline: ProjectTimeline = {
  inputHash: "hash",
  updatedAt: project.updatedAt,
  timeline: {
    formatVersion: 1,
    target: { width: 1920, height: 1080, fps: 30 },
    totalDurationSec: 7.4,
    scenes: [
      {
        sceneId: "s1", order: 0, label: "Intro", startSec: 0, endSec: 4.4, durationSec: 4.4, durationFrames: 132,
        voice: { trackId: "v1", path: "/a.mp3", startSec: 0.1, durationSec: 4 },
        visuals: [{ kind: "IMAGE", candidateId: "c1", path: "visuals/c1.jpg", startSec: 0, endSec: 4.4, motion, licenseKind: "CC0" }],
        fadeInSec: 0.5, fadeOutSec: 0.25,
      },
      {
        sceneId: "s2", order: 1, label: "Pause", startSec: 4.4, endSec: 7.4, durationSec: 3, durationFrames: 90,
        voice: null,
        visuals: [{ kind: "PLACEHOLDER", candidateId: null, path: null, startSec: 4.4, endSec: 7.4, motion, licenseKind: null }],
        fadeInSec: 0.25, fadeOutSec: 0.8,
      },
    ],
    music: {
      candidateId: "m1", title: "Calm Piano", path: "music/a.mp3", sourceDurationSec: 5, loop: true, startOffsetSec: 0,
      volume: 0.2, fadeInSec: 2, fadeOutSec: 3, duckingDb: -12, licenseKind: "CC_BY_NC",
    },
    subtitles: { srtPath: "/t/subtitles.srt", assPath: "/t/subtitles.ass", cueCount: 3 },
    warnings: [
      { code: "VISUAL_MISSING", sceneId: "s2", message: "Cảnh 2 chưa có hình." },
      { code: "LICENSE_NON_COMMERCIAL", sceneId: null, message: "Nhạc dùng license phi thương mại." },
    ],
    licenseSummary: { CC0: 1, CC_BY_NC: 1 },
  },
};

const pipeline: PipelineState = {
  projectId, mode: project.mode, runMode: null, currentStage: "FINAL_APPROVAL", status: "REVIEW",
  stages: STAGE_ORDER.map((stage) => ({
    stage, state: stage === "FINAL_APPROVAL" ? "WAITING_USER" : stage === "TIMELINE" ? "DONE" : "PENDING", progress: 0,
    message: null, jobId: null, updatedAt: project.updatedAt, error: null,
  })),
  activeJob: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("TimelinePanel", () => {
  it("shows tracks, warnings and scenes, and approves the final gate", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
      if (url.includes("/gates/") || url.includes("/approve")) return jsonResponse(pipeline);
      return jsonResponse(timeline);
    }));
    const { container } = renderWithProviders(<TimelinePanel project={project} />);

    expect(await screen.findByText("0:07.4 · 2 cảnh")).toBeInTheDocument();
    expect(screen.getByText(/1920×1080 · 30 fps/)).toBeInTheDocument();
    expect(screen.getByText("Thiếu hình")).toBeInTheDocument();
    expect(screen.getByText("License phi thương mại")).toBeInTheDocument();
    expect(screen.getByText("License: CC0 ×1 · CC_BY_NC ×1")).toBeInTheDocument();
    expect(screen.getByText("Calm Piano · lặp")).toBeInTheDocument();
    expect(screen.getByText("3 dòng")).toBeInTheDocument();
    expect(screen.getByText("Im lặng")).toBeInTheDocument();
    expect(container.querySelectorAll(".timeline-block.voice")).toHaveLength(1);
    expect(container.querySelector(".timeline-block.visual.placeholder")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Duyệt & render" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "POST" && call.url.includes("FINAL_APPROVAL"))).toBe(true));
  });

  it("explains the empty state before the stage has run", async () => {
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pipeline")) return jsonResponse({ ...pipeline, stages: pipeline.stages.map((record) => ({ ...record, state: "PENDING" })) });
      return jsonResponse({ timeline: null, inputHash: null, updatedAt: null });
    }));
    renderWithProviders(<TimelinePanel project={project} />);
    expect(await screen.findByText("Chưa có timeline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duyệt & render" })).toBeNull();
    expect(screen.getByRole("button", { name: "Chạy bước Timeline" })).toBeEnabled();
  });
});
