import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type Job, type PipelineEvent, type PipelineState, type Project } from "@vg/shared";
import { renderWithProviders, jsonResponse } from "../../test/testUtils";
import { PipelinePanel } from "./PipelinePanel";

const projectId = "55555555-5555-4555-8555-555555555555";
const now = "2026-11-03T00:00:00.000Z";
const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makePipeline(): PipelineState {
  return {
    projectId,
    mode: "ASSISTED",
    runMode: null,
    currentStage: "TOPIC",
    status: "DRAFT",
    stages: STAGE_ORDER.map((stage) => ({
      stage,
      state: "PENDING",
      progress: 0,
      message: null,
      jobId: null,
      updatedAt: now,
      error: null,
    })),
    activeJob: null,
  };
}

function makeJob(status: Job["status"], stage: Job["stage"] = "RESEARCH", progress = 0): Job {
  return {
    id: jobId,
    projectId,
    stage,
    scope: null,
    status,
    progress,
    message: null,
    attempt: 1,
    maxAttempts: 3,
    error: null,
    usage: null,
    createdAt: now,
    startedAt: status === "RUNNING" ? now : null,
    finishedAt: status === "SUCCEEDED" ? now : null,
    runAfter: now,
  };
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, EventListener[]>();
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  MockEventSource.instances = [];
});

describe("PipelinePanel", () => {
  it("renders per-task provider, model, and call ranges in the budget estimate", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/llm-routes")) {
        return jsonResponse({
          routes: {
            research: { provider: "mock", model: "research-model", source: "app-task" },
            script: { provider: "mock", model: "script-model", source: "app-task" },
            scriptReview: { provider: "mock", model: "review-model", source: "app-task" },
            sceneQueries: { provider: "mock", model: "scene-model", source: "app-task" },
            visualAltQueries: { provider: "mock", model: "alt-model", source: "app-task" },
            visualRerank: { provider: "mock", model: "rerank-model", source: "app-task" },
          },
        });
      }
      return jsonResponse(makePipeline());
    });
    const project: Project = {
      id: projectId,
      title: "Test project",
      description: "",
      topic: "Test topic",
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
      status: "DRAFT",
      stage: "TOPIC",
      thumbnailPath: null,
      durationSec: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);

    renderWithProviders(<PipelinePanel projectId={projectId} project={project} />);

    expect(await screen.findByText(/Ước tính: ~8–13 lượt gọi AI/)).toBeInTheDocument();
    expect(screen.getByText("research: mock · research-model · 1–2 calls")).toBeInTheDocument();
    expect(screen.getByText("scriptReview: mock · review-model · 1–2 calls")).toBeInTheDocument();
    expect(screen.getByText("sceneQueries: mock · scene-model · 1 calls")).toBeInTheDocument();
  });

  it("explains when there are no AI calls left to estimate", async () => {
    const pipeline = makePipeline();
    pipeline.stages = pipeline.stages.map((stage) => ({ ...stage, state: "DONE" }));
    const project: Project = {
      id: projectId,
      title: "Test project",
      description: "",
      topic: "Test topic",
      mode: "ASSISTED",
      settings: {
        budget: { mode: "QUALITY" },
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
      status: "COMPLETED",
      stage: "DONE",
      thumbnailPath: null,
      durationSec: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(pipeline)));
    vi.stubGlobal("EventSource", MockEventSource);

    renderWithProviders(<PipelinePanel projectId={projectId} project={project} />);
    expect(await screen.findByText("Ước tính: 0 lượt gọi AI (đã có kết quả, dùng cache)", { exact: true })).toBeInTheDocument();
  });

  it("renders stage states and sends approval to the matching endpoint", async () => {
    const pipeline = makePipeline();
    pipeline.stages[0] = { ...pipeline.stages[0], state: "RUNNING", progress: 40, message: "Working" };
    pipeline.stages[1] = {
      ...pipeline.stages[1],
      state: "FAILED",
      error: { code: "FAKE", message: "The fake stage failed", retryable: true },
    };
    pipeline.stages.find((stage) => stage.stage === "VISUAL_REVIEW")!.state = "WAITING_USER";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/pipeline")) return jsonResponse(pipeline);
      return jsonResponse(pipeline);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);

    renderWithProviders(<PipelinePanel projectId={projectId} />);
    expect(await screen.findByText("The fake stage failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate All" })).toBeDisabled();
    expect(screen.getByText("Approve the review gate to continue")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "RESEARCH progress" })).toHaveAttribute("aria-valuenow", "40");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/pipeline/gates/VISUAL_REVIEW/approve`,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(screen.getAllByText("Review gate")).toHaveLength(3);
  });

  it("reduces a burst of job updates without leaving a stale active job", async () => {
    let serverPipeline = makePipeline();
    let pipelineGets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/pipeline")) {
        pipelineGets += 1;
        return jsonResponse(serverPipeline);
      }
      return jsonResponse(serverPipeline);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    renderWithProviders(<PipelinePanel projectId={projectId} />);
    await screen.findByRole("button", { name: "Generate All" });
    const source = MockEventSource.instances[0];

    const event = (type: PipelineEvent["type"], data: PipelineEvent["data"]) => ({
      type,
      projectId,
      data,
      at: now,
    }) as PipelineEvent;
    act(() => {
      source.emit("job.updated", event("job.updated", makeJob("QUEUED")));
      source.emit("job.updated", event("job.updated", makeJob("RUNNING")));
      for (let progress = 1; progress <= 50; progress += 1) {
        source.emit("job.updated", event("job.updated", makeJob("RUNNING", "RESEARCH", progress)));
      }
      source.emit("job.updated", event("job.updated", makeJob("SUCCEEDED", "RESEARCH", 100)));
    });
    expect(screen.getByRole("button", { name: "Generate All" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    act(() => {
      source.emit("job.updated", event("job.updated", { ...makeJob("QUEUED", "SCRIPT"), id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
      source.emit("job.updated", event("job.updated", { ...makeJob("SUCCEEDED", "SCRIPT", 100), id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
      const gate = {
        ...makePipeline().stages.find((stage) => stage.stage === "VISUAL_REVIEW")!,
        state: "WAITING_USER" as const,
        message: "Waiting for your approval",
      };
      source.emit("stage.updated", event("stage.updated", gate));
      const project: Project = {
        id: projectId,
        title: "Test project",
        description: "",
        topic: "Test topic",
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
        version: 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      source.emit("project.updated", event("project.updated", project));
    });
    serverPipeline = {
      ...makePipeline(),
      currentStage: "VISUAL_REVIEW",
      status: "REVIEW",
      stages: makePipeline().stages.map((stage) => stage.stage === "VISUAL_REVIEW"
        ? { ...stage, state: "WAITING_USER", message: "Waiting for your approval" }
        : stage),
    };

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(pipelineGets).toBeLessThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Generate All" })).toBeDisabled();
    expect(screen.getByText("Approve the review gate to continue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("labels the all-stages action as regeneration after completion", async () => {
    const pipeline = { ...makePipeline(), status: "COMPLETED" as const, currentStage: "DONE" as const };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(pipeline)));
    vi.stubGlobal("EventSource", MockEventSource);
    renderWithProviders(<PipelinePanel projectId={projectId} />);
    expect(await screen.findByRole("button", { name: "Regenerate All" })).toBeInTheDocument();
  });

  it("shows a server conflict inline and updates rows from SSE events with polling fallback", async () => {
    const pipeline = makePipeline();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({ error: { code: "INVALID_PIPELINE_STATE", message: "Complete RESEARCH first" } }, 409);
      }
      return jsonResponse(pipeline);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    renderWithProviders(<PipelinePanel projectId={projectId} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate All" })).toBeInTheDocument());
    const source = MockEventSource.instances[0];
    fireEvent.click(screen.getByRole("button", { name: "Generate All" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Complete RESEARCH first"));

    const updated = { ...pipeline.stages[0], state: "DONE" as const, progress: 100, message: "Finished" };
    pipeline.stages[0] = updated;
    const event: PipelineEvent = { type: "stage.updated", projectId, data: updated, at: now };
    source.emit("stage.updated", event);
    await waitFor(() => expect(screen.getByText("DONE")).toBeInTheDocument());

    vi.useFakeTimers();
    source.emit("error");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const afterSseRefetch = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(2_499); });
    expect(fetchMock.mock.calls.length).toBe(afterSseRefetch);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    const afterFirstPoll = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_999); });
    expect(fetchMock.mock.calls.length).toBe(afterFirstPoll);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirstPoll);
  });

  it("closes every EventSource on repeated unmounts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(makePipeline())));
    vi.stubGlobal("EventSource", MockEventSource);
    for (let index = 0; index < 20; index += 1) {
      const { unmount } = renderWithProviders(<PipelinePanel projectId={projectId} />);
      await screen.findByRole("button", { name: "Generate All" });
      const source = MockEventSource.instances.at(-1)!;
      unmount();
      expect(source.closed).toBe(true);
    }
  });
});
