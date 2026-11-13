import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineState, Project, Script, ScriptData, StageRecord } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ScriptTab } from "./ScriptTab";

const projectId = "11111111-1111-4111-8111-111111111111";
const project = {
  id: projectId,
  title: "Test project",
  description: "",
  topic: "A topic",
  mode: "ASSISTED",
  settings: {
    language: "vi",
    targetDurationSec: 120,
    aspectRatio: "16:9",
    stageExecutors: {},
    autoRender: false,
  },
  status: "DRAFT",
  stage: "TOPIC",
  thumbnailPath: null,
  durationSec: null,
  version: 1,
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z",
  archivedAt: null,
} as Project;

const stages: StageRecord[] = [
  "RESEARCH", "SCRIPT", "SCENE_PLAN", "VISUAL_SEARCH", "VISUAL_REVIEW", "VOICE", "SUBTITLE",
  "MUSIC_SEARCH", "MUSIC_REVIEW", "TIMELINE", "FINAL_APPROVAL", "RENDER",
].map((stage) => ({
  stage: stage as StageRecord["stage"],
  state: "PENDING",
  progress: 0,
  message: null,
  jobId: null,
  updatedAt: "2026-11-03T00:00:00.000Z",
  error: null,
}));

const pipeline = {
  projectId,
  mode: "ASSISTED",
  runMode: null,
  currentStage: "TOPIC",
  status: "DRAFT",
  stages,
  activeJob: null,
} as PipelineState;

const research: NonNullable<ScriptData["research"]> = {
  data: {
    summary: "Research summary.",
    keyFacts: [
      { fact: "One", confidence: "high", sourceHint: null },
      { fact: "Two", confidence: "medium", sourceHint: "A source" },
      { fact: "Three", confidence: "low", sourceHint: null },
      { fact: "Four", confidence: "medium", sourceHint: null },
      { fact: "Five", confidence: "high", sourceHint: null },
    ],
    timeline: [{ date: "Today", event: "An event" }],
    angles: ["A hook"],
    outline: [
      { section: "One", purpose: "Start", points: [] },
      { section: "Two", purpose: "Explain", points: [] },
      { section: "Three", purpose: "End", points: [] },
    ],
    cautions: ["Check this claim."],
  },
  provider: "mock",
  model: "mock-v1",
  cached: true,
  createdAt: "2026-11-03T00:00:00.000Z",
};

function installFetch(data: ScriptData, state: PipelineState = pipeline, jobs: unknown[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/script")) return jsonResponse(data);
    if (url.endsWith("/pipeline")) return jsonResponse(state);
    if (url.includes("/jobs")) return jsonResponse(jobs);
    return jsonResponse({});
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("ScriptTab", () => {
  it("shows both empty-state choices and renders research confidence badges", async () => {
    installFetch({ script: null, research, origin: null, version: 0, stale: false });
    renderWithProviders(<ScriptTab project={project} />);
    expect(await screen.findByRole("button", { name: "Let the AI write it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write my own script" })).toBeTruthy();
    expect(screen.getByText("Research summary.")).toBeTruthy();
    expect(screen.getAllByText("high", { selector: ".confidence-badge" })).toHaveLength(2);
    expect(screen.getByText(/Cached/)).toBeTruthy();
  });

  it("disables script regeneration and explains the incomplete earlier stage", async () => {
    const script: Script = {
      title: "Existing",
      hook: "",
      sections: [{
        id: "one",
        heading: "One",
        narration: "",
        visualQueries: { primary: "", alternatives: [] },
        visualNotes: "",
        musicMood: "",
        energy: "medium",
        estDurationSec: 0,
      }],
      outro: "",
      music: { mood: "", energy: "medium", keywords: [] },
    };
    installFetch({ script: { data: script, origin: "AGENT", edited: false, version: 1, provider: "mock", model: "mock-v1", reviewNotes: null, updatedAt: "2026-11-03T00:00:00.000Z" }, research: null, origin: "AGENT", version: 1, stale: false });
    renderWithProviders(<ScriptTab project={project} />);
    const regenerate = await screen.findByRole("button", { name: "Regenerate script" });
    await waitFor(() => expect(regenerate).toBeDisabled());
    expect(screen.getByText("Complete RESEARCH before generating the script.")).toBeTruthy();
  });

  it("shows QUALITY review notes and the revised-by-review badge", async () => {
    const script: Script = {
      title: "Reviewed",
      hook: "",
      sections: [{
        id: "one",
        heading: "One",
        narration: "",
        visualQueries: { primary: "", alternatives: [] },
        visualNotes: "",
        musicMood: "",
        energy: "medium",
        estDurationSec: 0,
      }],
      outro: "",
      music: { mood: "", energy: "medium", keywords: [] },
    };
    const qualityProject = {
      ...project,
      settings: { ...project.settings, budget: { mode: "QUALITY" as const } },
    } as Project;
    installFetch({
      script: {
        data: script,
        origin: "AGENT",
        edited: false,
        version: 2,
        provider: "mock",
        model: "mock-v1",
        reviewNotes: ["Clarified the opening."],
        updatedAt: "2026-11-03T00:00:00.000Z",
      },
      research: null,
      origin: "AGENT",
      version: 2,
      stale: false,
    });
    renderWithProviders(<ScriptTab project={qualityProject} />);
    expect(await screen.findByText("Revised by AI review")).toBeInTheDocument();
    fireEvent.click(screen.getByText("AI review notes (1)"));
    expect(screen.getByText("Clarified the opening.")).toBeInTheDocument();
  });

  it("shows calls and token totals, including cached zero-token stages", async () => {
    installFetch({ script: null, research, origin: null, version: 0, stale: false }, pipeline, [
      {
        id: "research-job",
        projectId,
        stage: "RESEARCH",
        scope: null,
        status: "SUCCEEDED",
        progress: 100,
        message: "Research and script loaded from cache",
        attempt: 1,
        maxAttempts: 3,
        error: null,
        usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        createdAt: "2026-11-03T00:00:00.000Z",
        startedAt: "2026-11-03T00:00:00.000Z",
        finishedAt: "2026-11-03T00:00:01.000Z",
        runAfter: "2026-11-03T00:00:00.000Z",
      },
      {
        id: "script-job",
        projectId,
        stage: "SCRIPT",
        scope: null,
        status: "SUCCEEDED",
        progress: 100,
        message: "Script from merged call (0 tokens)",
        attempt: 1,
        maxAttempts: 3,
        error: null,
        usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        createdAt: "2026-11-03T00:00:02.000Z",
        startedAt: "2026-11-03T00:00:02.000Z",
        finishedAt: "2026-11-03T00:00:03.000Z",
        runAfter: "2026-11-03T00:00:02.000Z",
      },
    ]);
    renderWithProviders(<ScriptTab project={project} />);
    expect(await screen.findByText("LLM calls this run: 0 · 0 tokens (cached)")).toBeTruthy();
    expect(screen.getByText("Research: 0 tokens (cached)")).toBeTruthy();
    expect(screen.getByText("Script: 0 tokens (merged call)")).toBeTruthy();
  });

  it("labels Copilot usage when the CLI cannot report token counts", async () => {
    installFetch({ script: null, research, origin: null, version: 0, stale: false }, pipeline, [
      {
        id: "research-job",
        projectId,
        stage: "RESEARCH",
        scope: null,
        status: "SUCCEEDED",
        progress: 100,
        message: "Research notes saved",
        attempt: 1,
        maxAttempts: 3,
        error: null,
        usage: {
          llmCalls: 1,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          provider: "copilot-cli",
          model: "auto",
          tokensUnknown: true,
        },
        createdAt: "2026-11-03T00:00:00.000Z",
        startedAt: "2026-11-03T00:00:00.000Z",
        finishedAt: "2026-11-03T00:00:01.000Z",
        runAfter: "2026-11-03T00:00:00.000Z",
      },
    ]);
    renderWithProviders(<ScriptTab project={project} />);
    expect(await screen.findByText("LLM calls this run: 1 · token count unknown")).toBeTruthy();
    expect(screen.getByText("Research: 1 call · token count unknown")).toBeTruthy();
  });

  it("shows Claude Desktop guidance for a USER executor and copies the ready-to-paste prompt", async () => {
    const userProject = {
      ...project,
      settings: { ...project.settings, stageExecutors: { script: "USER" } },
    } as Project;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    installFetch({ script: null, research: null, origin: null, version: 0, stale: false });
    renderWithProviders(<ScriptTab project={userProject} />);
    expect(await screen.findByText("WRITE WITH CLAUDE DESKTOP")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Setup instructions" }).getAttribute("href")).toBe("/docs/CLAUDE_DESKTOP.md");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `Viết script cho project "Test project" (id ${projectId}) bằng Video Agent`,
    ));
  });

  it("shows the treatment card stored on the project", async () => {
    const withTreatment = {
      ...project,
      settings: {
        ...project.settings,
        treatment: {
          title: "Hố đen",
          formatId: "explainer",
          formatNameVi: "Giải thích",
          angle: "Vì sao ánh sáng không thoát?",
          sections: [{ key: "hook", nameVi: "Mở đầu", estSec: 12 }],
          estimatedSceneCount: 6,
          estimatedDurationSec: 90,
          cost: { inputTokens: 100, outputTokens: 200, ttsCharacters: 300, usd: null },
          estimatedRenderSec: null,
          renderNoteVi: "chưa có dữ liệu",
        },
      },
    } as Project;
    installFetch({ script: null, research: null, origin: null, version: 0, stale: false });
    renderWithProviders(<ScriptTab project={withTreatment} />);
    expect(await screen.findByRole("region", { name: "Bản đề xuất" })).toBeTruthy();
    expect(screen.getByText("Hố đen")).toBeTruthy();
    expect(screen.getByText(/Giải thích/)).toBeTruthy();
    expect(screen.getByText(/100 token vào/)).toBeTruthy();
    expect(screen.getByText(/Mở đầu · 12 giây/)).toBeTruthy();
  });
});
