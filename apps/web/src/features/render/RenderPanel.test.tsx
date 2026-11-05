import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type PipelineState, type Project, type ProjectRender, type ProjectTimeline, type RenderVersion } from "@vg/shared";
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

const report = {
  ok: true, expectedDurationSec: 64, durationSec: 64.02, width: 1920, height: 1080, hasAudio: true,
  issues: [{ code: "BLACK_FRAMES" as const, severity: "WARN" as const, sceneId, message: "Khung đen 1.0s ở cảnh 1." }],
  thumbnails: [sceneId], clipsReused: 0, clipsRendered: 1, elapsedSec: 12.3,
};

const render: ProjectRender = {
  render: {
    id: "r1", projectId, status: "DONE", inputHash: "h", durationSec: 64, sizeBytes: 3 * 1024 * 1024,
    width: 1920, height: 1080, hasCredits: true, hasSubtitles: false, createdAt: project.updatedAt,
    report,
  },
};

const version = (overrides: Partial<RenderVersion> = {}): RenderVersion => ({
  id: "r1",
  projectId,
  status: "DONE",
  inputHash: "h",
  durationSec: 64,
  sizeBytes: 3 * 1024 * 1024,
  width: 1920,
  height: 1080,
  hasCredits: true,
  hasSubtitles: false,
  createdAt: project.updatedAt,
  report,
  version: 2,
  note: "Bản tốt",
  pinned: false,
  deleted: false,
  reviewThreadId: null,
  hasMetadata: true,
  ...overrides,
});

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
      if (url.includes("/clips")) return jsonResponse({ eligible: true, reason: null, renderId: "r1", options: { count: 3, minSec: 20, maxSec: 45, reframe: "center" }, proposals: [], children: [], jobs: [] });
      if (url.includes("/thumbnail")) return jsonResponse({ hasLandscape: false, hasCover: false, meta: null, candidates: [] });
      if (url.endsWith("/pipeline") || url.includes("/run")) return jsonResponse(pipelineWith("DONE"));
      if (url.endsWith("/renders")) return jsonResponse({ renders: [version()] });
      if (url.endsWith("/render") && init?.method === "POST") return jsonResponse(pipelineWith("DONE"));
      if (url.endsWith("/render")) return jsonResponse(render);
      if (url.endsWith("/metadata")) {
        return jsonResponse({
          metadata: {
            projectId, inputHash: "hash", source: "CODE",
            draft: { titles: ["Ocean story"], description: "A calm sea", tags: ["ocean"], hashtags: ["#ocean"], thumbnailText: ["Sea"] },
            edited: null, createdAt: project.updatedAt, updatedAt: project.updatedAt,
          },
          stale: false,
          extras: { chaptersText: "", creditsText: "Credits", disclosure: "AI disclosure" },
        });
      }
      return jsonResponse(timeline);
    }));
    const { container } = renderWithProviders(<RenderPanel project={project} />);

    expect(await screen.findByText("1:04 · 1920×1080 · 3.0 MB")).toBeInTheDocument();
    expect(container.querySelector("video")?.getAttribute("src")).toBe(`/api/projects/${projectId}/renders/r1/video?v=r1`);
    expect(screen.getByRole("link", { name: "Tải video" })).toHaveAttribute("href", `/api/projects/${projectId}/renders/r1/video?v=r1&download=1`);
    expect(screen.getByRole("link", { name: "Tải credits" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tải phụ đề" })).toBeNull();
    expect(screen.getByText("Kiểm tra: đạt · 1 vấn đề")).toBeInTheDocument();
    expect(screen.getByText("Khung đen")).toBeInTheDocument();
    expect(screen.getByAltText("1. Intro")).toHaveAttribute("src", `/api/projects/${projectId}/renders/r1/thumbs/${sceneId}?v=r1`);
    expect(screen.getByText("Lịch sử bản render")).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();

    expect(screen.getByLabelText("Định dạng")).toHaveValue("16:9");
    expect(screen.getAllByText(/Ngang 16:9/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Render lại" }));
    await waitFor(() => expect(calls.some((call) =>
      call.init?.method === "POST"
      && call.url.endsWith("/render")
      && String(call.init.body).includes('"16:9"')
    )).toBe(true));
  });

  it("shows a vertical player frame and the profile multi-format button", async () => {
    const verticalProject = {
      ...project,
      profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      settings: { ...project.settings, aspectRatio: "16:9" as const },
    };
    const verticalVersion = version({
      id: "r-vert",
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      report: { ...report, width: 1080, height: 1920 },
    });
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/clips")) return jsonResponse({ eligible: true, reason: null, renderId: "r1", options: { count: 3, minSec: 20, maxSec: 45, reframe: "center" }, proposals: [], children: [], jobs: [] });
      if (url.includes("/thumbnail")) return jsonResponse({ hasLandscape: false, hasCover: false, meta: null, candidates: [] });
      if (url.endsWith("/pipeline")) return jsonResponse(pipelineWith("DONE"));
      if (url.endsWith("/renders")) return jsonResponse({ renders: [verticalVersion] });
      if (url.endsWith("/render") && init?.method === "POST") return jsonResponse(pipelineWith("DONE"));
      if (url.endsWith("/render")) return jsonResponse({ render: verticalVersion });
      if (url.endsWith("/render-variants")) return jsonResponse({ queued: [], skipped: ["16:9", "9:16"], renders: [] });
      if (url.endsWith("/metadata")) {
        return jsonResponse({
          metadata: null, stale: true,
          extras: { chaptersText: "", creditsText: "", disclosure: "AI" },
        });
      }
      return jsonResponse(timeline);
    }));
    const { container } = renderWithProviders(<RenderPanel project={verticalProject} />);
    expect(await screen.findByText(/1080×1920/)).toBeInTheDocument();
    expect(container.querySelector(".render-player.is-vertical")).toBeTruthy();
    expect(screen.getAllByText("Dọc 9:16").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Render cho mọi tài khoản của hồ sơ" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Định dạng"), { target: { value: "9:16" } });
    fireEvent.click(screen.getByRole("button", { name: "Render lại" }));
    await waitFor(() => expect(
      (vi.mocked(fetch).mock.calls as Array<[RequestInfo | URL, RequestInit?]>)
        .some(([url, init]) => String(url).endsWith("/render") && init?.method === "POST" && String(init.body).includes('"9:16"')),
    ).toBe(true));
  });

  it("switches the player source, patches a note, and confirms delete", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let note = "Bản tốt";
    let deleted = false;
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/clips")) return jsonResponse({ eligible: true, reason: null, renderId: "r1", options: { count: 3, minSec: 20, maxSec: 45, reframe: "center" }, proposals: [], children: [], jobs: [] });
      if (url.includes("/thumbnail")) return jsonResponse({ hasLandscape: false, hasCover: false, meta: null, candidates: [] });
      if (url.endsWith("/pipeline")) return jsonResponse(pipelineWith("DONE"));
      if (url.endsWith("/renders")) {
        return jsonResponse({
          renders: [
            version({ id: "r2", version: 2, note, deleted }),
            version({ id: "r1", version: 1, note: null, hasMetadata: false, report: { ...report, issues: [], clipsReused: 1 } }),
          ],
        });
      }
      if (url.includes("/renders/r2") && init?.method === "PATCH") {
        note = JSON.parse(String(init.body)).note;
        return jsonResponse(version({ id: "r2", version: 2, note }));
      }
      if (url.includes("/renders/r2") && init?.method === "DELETE") {
        deleted = true;
        return jsonResponse(version({ id: "r2", version: 2, deleted: true }));
      }
      if (url.endsWith("/render")) return jsonResponse({ render: { ...render.render!, id: deleted ? "r1" : "r2" } });
      if (url.endsWith("/metadata")) {
        return jsonResponse({ metadata: null, stale: true, extras: { chaptersText: "", creditsText: "", disclosure: "AI" } });
      }
      return jsonResponse(timeline);
    }));
    const { container } = renderWithProviders(<RenderPanel project={project} />);
    expect(await screen.findByText("Lịch sử bản render")).toBeInTheDocument();
    const viewButtons = screen.getAllByRole("button", { name: "Xem" });
    fireEvent.click(viewButtons[1]!);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBe(`/api/projects/${projectId}/renders/r1/video?v=r1`));

    const noteInput = screen.getAllByPlaceholderText("Ghi chú ngắn…")[0]!;
    fireEvent.change(noteInput, { target: { value: "Ghi chú mới" } });
    fireEvent.blur(noteInput);
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH" && String(call.init.body).includes("Ghi chú mới"))).toBe(true));

    fireEvent.click(screen.getAllByRole("button", { name: "Xoá" })[0]!);
    await waitFor(() => expect(calls.some((call) => call.init?.method === "DELETE")).toBe(true));
    expect(window.confirm).toHaveBeenCalled();
  });

  it("asks for a timeline before rendering", async () => {
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/clips")) return jsonResponse({ eligible: true, reason: null, renderId: "r1", options: { count: 3, minSec: 20, maxSec: 45, reframe: "center" }, proposals: [], children: [], jobs: [] });
      if (url.includes("/thumbnail")) return jsonResponse({ hasLandscape: false, hasCover: false, meta: null, candidates: [] });
      if (url.endsWith("/pipeline")) return jsonResponse(pipelineWith("PENDING"));
      if (url.endsWith("/renders")) return jsonResponse({ renders: [] });
      if (url.endsWith("/render")) return jsonResponse({ render: null });
      if (url.endsWith("/metadata")) {
        return jsonResponse({ metadata: null, stale: true, extras: { chaptersText: "", creditsText: "", disclosure: "AI" } });
      }
      return jsonResponse({ timeline: null, inputHash: null, updatedAt: null });
    }));
    renderWithProviders(<RenderPanel project={project} />);
    expect(await screen.findByText("Chưa có video")).toBeInTheDocument();
    expect(screen.getByText(/hoàn tất tab Timeline trước/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Render" })).toBeDisabled();
  });
});
