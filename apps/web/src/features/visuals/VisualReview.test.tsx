import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type PipelineState, type Project, type ProjectVisuals, type SceneVisuals, type VisualCandidate } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { VisualReview } from "./VisualReview";

const projectId = "44444444-4444-4444-8444-444444444444";
const sceneId = "11111111-1111-4111-8111-111111111111";
const candidateId = "33333333-3333-4333-8333-333333333333";
const project: Project = {
  id: projectId,
  title: "Visual review fixture",
  topic: "River",
  description: "",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "ECO" }, language: "en", targetDurationSec: 30, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "REVIEW", stage: "VISUAL_REVIEW", thumbnailPath: null, durationSec: null, version: 1,
  createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z", archivedAt: null,
};
const candidate: VisualCandidate = {
  id: candidateId, projectId, sceneId, origin: "SEARCH", provider: "mock", providerItemId: "river",
  query: "river sunrise", title: "River at sunrise", description: "", tags: [],
  previewUrl: "https://images.example.test/river.jpg", imageUrl: "https://images.example.test/river-full.jpg",
  sourceUrl: "https://source.example.test/river", sourceSite: "Mock", width: 1200, height: 800,
  aspectRatio: 1.5, fileType: "jpg", watermark: "NONE", relevanceScore: 0.9, scoreBreakdown: {},
  license: {
    kind: "UNKNOWN", name: "", url: null, author: null, authorUrl: null,
    attributionRequired: false, attributionText: "", evidence: "none",
  },
  rank: 0, discardedAt: null, createdAt: "2026-11-03T00:00:00.000Z",
};
const selection: NonNullable<SceneVisuals["selection"]> = {
  id: "22222222-2222-4222-8222-222222222222", projectId, sceneId, slot: 0,
  candidateId, status: "REVIEW_REQUIRED", selectedBy: "AGENT", motion: null, reviewedAt: null,
  createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z",
};
const visuals: ProjectVisuals = {
  scenes: [{
    sceneId, order: 0, selection, selectedCandidate: candidate, candidateCount: 1,
    needsUser: true, lowRelevance: true, status: "REVIEW_REQUIRED", noVisual: false,
    visualDescription: "A broad river beneath a sunrise.", visualQueries: { primary: "river sunrise", alternatives: [] },
    narration: "The sun rises over the river.", startSec: 0, durationSec: 6,
  }],
  summary: {
    withImage: 1, needsUser: 1, lowRelevance: 1, licenseCounts: { UNKNOWN: 1 },
    statusCounts: { NO_VISUAL: 0, SEARCHING: 0, REVIEW_REQUIRED: 1, NEEDS_ATTENTION: 0, APPROVED: 0, READY_FOR_RENDER: 0, SKIPPED: 0 },
  },
};
const sceneVisuals: SceneVisuals = { selection, candidates: [candidate], status: "REVIEW_REQUIRED", noVisual: false };
const pipeline: PipelineState = {
  projectId, mode: "ASSISTED", runMode: null, currentStage: "VISUAL_REVIEW", status: "REVIEW",
  stages: STAGE_ORDER.map((stage) => ({
    stage, state: stage === "VISUAL_REVIEW" ? "WAITING_USER" : "PENDING", progress: 0,
    message: null, jobId: null, updatedAt: project.updatedAt, error: null,
  })),
  activeJob: null,
};

const rateLimitReason = "Máy chủ ảnh đang giới hạn tốc độ (HTTP 429) — thử lại sau ít phút";

function setup(approveFails = false, approveAllResult?: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("EventSource", undefined);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
    if (approveAllResult && url.endsWith("/visuals/approve-all")) return jsonResponse(approveAllResult);
    if (approveFails && url.endsWith("/visuals/approve")) {
      return jsonResponse({ error: { code: "IMAGE_DOWNLOAD_FAILED", message: "Image download failed", details: {} } }, 422);
    }
    if (url.includes(`/scenes/${sceneId}/visuals`)) return jsonResponse(sceneVisuals);
    if (url.endsWith("/visuals")) return jsonResponse(visuals);
    if (url.endsWith("/gates/VISUAL_REVIEW/approve")) return jsonResponse(pipeline);
    return jsonResponse(sceneVisuals);
  }));
  renderWithProviders(<VisualReview project={project} />, [`/projects/${projectId}/visuals`]);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("VisualReview", () => {
  it("renders scene details, status and warnings and explains why the gate is disabled", async () => {
    setup();
    expect(await screen.findByText("A broad river beneath a sunrise.")).toBeInTheDocument();
    expect(screen.getByText("License chưa rõ")).toBeInTheDocument();
    expect(screen.getAllByText("Ít liên quan").length).toBeGreaterThan(0);
    expect(screen.getByText("1 scene cần xử lý trước khi duyệt cổng.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duyệt xong → tiếp tục" })).toBeDisabled();
  });

  it("opens the candidate sheet, displays metadata and sends keyboard approval", async () => {
    const calls = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Đổi ảnh" }));
    expect(await screen.findByRole("dialog", { name: "Chọn hình ảnh" })).toBeInTheDocument();
    expect(screen.getByText("River at sunrise", { selector: "strong" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/visuals/approve"))).toBe(true));
  });

  it("confirms approve-all before sending the request", async () => {
    const calls = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Duyệt tất cả" }));
    const dialog = await screen.findByRole("dialog", { name: "Duyệt tất cả ảnh?" });
    expect(dialog).toHaveTextContent("1 ảnh chưa duyệt");
    fireEvent.click(within(dialog).getByRole("button", { name: "Duyệt tất cả" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/visuals/approve-all"))).toBe(true));
  });

  it("groups rate-limited approve-all failures into one line", async () => {
    setup(false, {
      approved: 1,
      failed: [
        { sceneId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reason: rateLimitReason, retryable: true },
        { sceneId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", reason: rateLimitReason, retryable: true },
      ],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Duyệt tất cả" }));
    const dialog = await screen.findByRole("dialog", { name: "Duyệt tất cả ảnh?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Duyệt tất cả" }));
    expect(await screen.findByText(/2 cảnh bị máy chủ ảnh giới hạn tốc độ — bấm Duyệt tất cả lần nữa sau ít phút/)).toBeInTheDocument();
    expect(screen.queryAllByText(rateLimitReason)).toHaveLength(0);
  });

  it("rolls back an optimistic approval and displays the server error", async () => {
    setup(true);
    await screen.findByText("A broad river beneath a sunrise.");
    fireEvent.click(screen.getByRole("button", { name: /^Duyệt$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Image download failed");
    expect(screen.getAllByText("Cần xem").length).toBeGreaterThan(0);
  });
});
