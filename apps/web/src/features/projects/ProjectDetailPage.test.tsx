import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { STAGE_ORDER, type PipelineState, type Project } from "@vg/shared";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { EditProjectDialog } from "./EditProjectDialog";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const project: Project = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Ocean documentary",
  topic: "Life under the sea",
  description: "A short video",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "BALANCED" },
    language: "en",
    targetDurationSec: 120,
    aspectRatio: "16:9",
    platform: "youtube",
    style: "storytelling",
    tone: "dramatic",
    audience: "general",
    wordsPerMinute: 150,
    sceneDurationSec: 7,
    visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 },
    music: { enabled: true, volume: 0.15 },
    userSet: [],
    stageExecutors: {},
    autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "REVIEW",
  stage: "VISUAL_REVIEW",
  thumbnailPath: null,
  durationSec: null,
  version: 2,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  archivedAt: null,
};

function renderDetail(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/:tab" element={<ProjectDetailPage />} />
    </Routes>,
    [path],
  );
}

function stubProjectFetch(value: Project) {
  const pipeline: PipelineState = {
    projectId: value.id,
    mode: value.mode,
    runMode: null,
    currentStage: value.stage,
    status: value.status,
    stages: STAGE_ORDER.map((stage) => ({
      stage,
      state: stage === "VISUAL_REVIEW" ? "WAITING_USER" : "PENDING",
      progress: 0,
      message: null,
      jobId: null,
      updatedAt: value.updatedAt,
      error: null,
    })),
    activeJob: null,
  };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
    if (url.includes("/auto-report")) return jsonResponse({ projectId: value.id, warnCount: 0, groups: [] });
    return jsonResponse(value);
  }));
}

describe("ProjectDetailPage", () => {
  it("shows project header and redirects unknown tabs to overview", async () => {
    stubProjectFetch(project);
    renderDetail(`/projects/${project.id}/unknown`);
    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent(`/projects/${project.id}/overview`));
  });

  describe("EditProjectDialog", () => {
    it("saves selected voice and speed settings", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/llm/providers") return jsonResponse([]);
        if (url === "/api/tts/voices") return jsonResponse({ voices: [
          { language: "en-US", gender: "female", name: "en-US-AriaNeural" },
        ] });
        if (url.endsWith("/llm-routes")) return jsonResponse({ routes: {} });
        if (init?.method === "PATCH") return jsonResponse(project);
        return jsonResponse(project);
      });
      vi.stubGlobal("fetch", fetchMock);
      renderWithProviders(<EditProjectDialog project={project} open onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: /Advanced settings/ }));
      await screen.findByRole("option", { name: "en-US-AriaNeural" });
      fireEvent.change(screen.getByLabelText("Giọng đọc"), { target: { value: "en-US-AriaNeural" } });
      fireEvent.change(screen.getByLabelText("Tốc độ"), { target: { value: "+10%" } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        `/api/projects/${project.id}`,
        expect.objectContaining({ method: "PATCH" }),
      ));
      const request = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1] as RequestInit;
      expect(JSON.parse(String(request.body))).toMatchObject({
        settings: { voice: { voice: "en-US-AriaNeural", rate: "+10%" } },
      });
    });

    it("submits edited brief values so the server marks them user-set", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
        String(input) === "/api/llm/providers" ? jsonResponse([]) : jsonResponse(project));
      vi.stubGlobal("fetch", fetchMock);
      renderWithProviders(<EditProjectDialog project={project} open onClose={vi.fn()} />);
      fireEvent.change(await screen.findByLabelText("Platform"), { target: { value: "tiktok" } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        `/api/projects/${project.id}`,
        expect.objectContaining({ method: "PATCH" }),
      ));
      const request = fetchMock.mock.calls.find(([input]) => String(input).endsWith(project.id))?.[1] as RequestInit;
      expect(JSON.parse(String(request.body))).toMatchObject({ settings: { platform: "tiktok" } });
    });
  });

  it("renders project data for the overview tab", async () => {
    stubProjectFetch(project);
    renderDetail(`/projects/${project.id}/overview`);
    expect(await screen.findByRole("heading", { name: "Ocean documentary" })).toBeInTheDocument();
    expect(await screen.findByText("WAITING USER")).toBeInTheDocument();
    expect(screen.getAllByText("VISUAL REVIEW")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Production stages" })).toBeInTheDocument();
    expect(await screen.findByText("Ước tính: ~11–17 lượt gọi AI (BALANCED)")).toBeInTheDocument();
    expect(screen.getByText("Giải thích. Mặc định là mẫu giải thích.")).toBeInTheDocument();
  });

  it("renders token totals, stage-specific tasks, runs, and the budget comparison", async () => {
    const emptyTotals = {
      llmCalls: 1,
      inputTokens: 12345,
      outputTokens: 321,
      cachedCalls: 1,
      fallbackCalls: 1,
      failedCalls: 0,
      premiumRequests: 0,
      tokensUnknown: false,
      costUsd: 0.01,
    };
    const usage = {
      projectId: project.id,
      usdVndRate: 26000,
      totals: emptyTotals,
      byStage: [{ key: "VISUAL_SEARCH", label: "VISUAL SEARCH", ...emptyTotals }],
      byTask: [{ key: "visualRerank", label: "visualRerank", ...emptyTotals }],
      byModel: [{ key: "claude-cli/sonnet", label: "claude-cli · sonnet", ...emptyTotals }],
      runs: [{
        jobId: "66666666-6666-4666-8666-666666666666",
        stage: "VISUAL_SEARCH",
        scope: "scene-1",
        attempt: 2,
        status: "FAILED",
        startedAt: "2026-11-02T10:00:00.000Z",
        finishedAt: "2026-11-02T10:00:02.500Z",
        durationMs: 2500,
        tokens: { input: 12345, output: 321, unknown: false },
        totals: emptyTotals,
        calls: [{
          task: "visualRerank",
          provider: "claude-cli",
          model: "sonnet",
          inputTokens: 12345,
          outputTokens: 321,
          premiumRequests: 0,
          callCount: 1,
          cached: false,
          fallback: true,
          ok: false,
          tokensUnknown: false,
          costUsd: 0.01,
          characters: 80,
        }],
      }],
    };
    const pipeline: PipelineState = {
      projectId: project.id,
      mode: project.mode,
      runMode: null,
      currentStage: project.stage,
      status: project.status,
      stages: STAGE_ORDER.map((stage) => ({
        stage,
        state: "PENDING",
        progress: 0,
        message: null,
        jobId: null,
        updatedAt: project.updatedAt,
        error: null,
      })),
      activeJob: null,
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
      if (url.endsWith("/usage")) return jsonResponse(usage);
      if (url.includes("/auto-report")) return jsonResponse({ projectId: project.id, warnCount: 0, groups: [] });
      if (url.endsWith("/budget-estimate")) return jsonResponse({
        mode: "BALANCED",
        features: {
          knowledgeContext: 1500, knowledgeEmbeddings: true,
          storyMode: "separate",
          repairAttempts: 1,
          scriptReview: true,
          scriptReviewPasses: 1,
          researchDepth: "standard",
          altQueryAssist: true,
          sceneQueryAssist: true,
          semanticImageRerank: true,
          visionCheck: false,
          visionRetryRounds: 0,
          visionThreshold: 7,
          visualSearchBreadth: 8,
          renderVerify: false,
          thumbnailPick: false,
          factCheck: false,
          musicAssist: true,
          metadata: true,
          guidelineCheck: "check",
          webImageSearch: 3,
          modelAdvisor: true,
          topicSuggest: true,
          assistantChat: true,
          financeInsight: true,
          performanceInsight: true,
          clipPick: true,
          commentAssist: true,
          trendMatch: true,
          translateScript: true,
          providerIntelExtract: true,
          editPlan: true,
          formatPick: true,
          stageTimeouts: true,
          operatorPlan: true,
          operatorClassify: true,
          outputHeadroom: 1.5,
          composeGraphics: "static",
          graphicGrain: false,
        },
        perStage: [],
        total: { min: 2, max: 5 },
      });
      return jsonResponse({
        ...project,
        settings: {
          ...project.settings,
          treatment: {
            title: "Ocean",
            formatId: "explainer",
            formatNameVi: "Giải thích",
            angle: "Hook",
            sections: [],
            estimatedSceneCount: 4,
            estimatedDurationSec: 60,
            cost: { inputTokens: 1000, outputTokens: 200, ttsCharacters: 400, usd: null },
            estimatedRenderSec: null,
            renderNoteVi: "chưa có dữ liệu",
          },
        },
      });
    }));
    renderDetail(`/projects/${project.id}/usage`);
    expect(await screen.findByRole("link", { name: "Token" })).toHaveAttribute("href", `/projects/${project.id}/usage`);
    expect((await screen.findAllByText("12.3K")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Đã dùng 1 lượt; các bước chưa chạy ước tính thêm ~2–5 lượt.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Ước tính vs thực tế" })).toBeInTheDocument();
    expect(screen.getByText(/1\.000 token vào, 200 token ra, 400 ký tự đọc/)).toBeInTheDocument();
    expect(screen.getByText(/80 ký tự đọc/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /VISUAL SEARCH/ }));
    expect(await screen.findByText(/visualRerank: 1 lượt/)).toBeInTheDocument();
    expect(screen.getByText(/claude-cli\/sonnet/)).toBeInTheDocument();
    expect(screen.getByText(/FAILED/)).toBeInTheDocument();
  });

  it("shows a back link when the API returns 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
    }, 404)));
    renderDetail(`/projects/${project.id}/overview`);
    expect(await screen.findByRole("heading", { name: "Project not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to project library" })).toHaveAttribute("href", "/projects");
  });
});
