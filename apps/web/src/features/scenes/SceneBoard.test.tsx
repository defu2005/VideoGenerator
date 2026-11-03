import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type PipelineState, type Project, type Scene, type ScenePlanSummary } from "@vg/shared";
import { renderWithProviders, jsonResponse } from "../../test/testUtils";
import { SceneBoard } from "./SceneBoard";

const projectId = "44444444-4444-4444-8444-444444444444";
const project: Project = {
  id: projectId,
  title: "Storyboard test",
  topic: "A test topic",
  description: "",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "BALANCED" },
    language: "en",
    targetDurationSec: 120,
    aspectRatio: "16:9",
    platform: "youtube",
    style: "storytelling",
    tone: "neutral",
    audience: "general",
    wordsPerMinute: 150,
    sceneDurationSec: 7,
    visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 },
    music: { enabled: true, volume: 0.15 },
    userSet: [],
    stageExecutors: {},
    autoRender: false,
  },
  status: "DRAFT",
  stage: "SCRIPT",
  thumbnailPath: null,
  durationSec: null,
  version: 1,
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z",
  archivedAt: null,
};

const scenes: Scene[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    projectId,
    order: 0,
    kind: "section",
    sectionId: "intro",
    label: "Introduction",
    narration: "First sentence. Second sentence.",
    visualNotes: "A sunrise",
    visualQueries: { primary: "sunrise city", alternatives: ["city lights"] },
    queryVariant: false,
    musicMood: "Curious",
    energy: "medium",
    estDurationSec: 4,
    durationOverrideSec: null,
    startSec: 0,
    transitionNote: "",
    origin: "AGENT",
    edited: true,
    inputHash: "input",
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    projectId,
    order: 1,
    kind: "section",
    sectionId: "next",
    label: "Next",
    narration: "A second scene.",
    visualNotes: "",
    visualQueries: { primary: "street", alternatives: [] },
    queryVariant: false,
    musicMood: "",
    energy: "low",
    estDurationSec: 4,
    durationOverrideSec: null,
    startSec: 4,
    transitionNote: "",
    origin: "AGENT",
    edited: false,
    inputHash: "input",
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
  },
];

const summary: ScenePlanSummary = { scenes, totalSec: 8, targetSec: 120, stale: true };
const pipeline: PipelineState = {
  projectId,
  mode: "ASSISTED",
  runMode: null,
  currentStage: "SCENE_PLAN",
  status: "DRAFT",
  stages: STAGE_ORDER.map((stage) => ({
    stage,
    state: stage === "SCRIPT" ? "DONE" : "PENDING",
    progress: 0,
    message: null,
    jobId: null,
    updatedAt: "2026-11-03T00:00:00.000Z",
    error: null,
  })),
  activeJob: null,
};

function setup() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("EventSource", undefined);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
    if (url.endsWith("/scenes")) return jsonResponse(summary);
    if (url.includes("/pipeline/run")) return jsonResponse(pipeline);
    return jsonResponse(summary);
  }));
  renderWithProviders(<SceneBoard project={project} />);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("SceneBoard", () => {
  it("renders the storyboard, timecodes, duration status, and stale banner", async () => {
    setup();
    expect(await screen.findByText("The script changed after this scene plan was created. Regenerate to sync the storyboard.")).toBeInTheDocument();
    expect(screen.getByText("00:00–00:04")).toBeInTheDocument();
    expect(screen.getAllByText("Ảnh sẽ có ở bước Visual")).toHaveLength(2);
    expect(screen.getByText("sunrise city")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move scene 1 right" })).toBeEnabled();
  });

  it("uses accessible move controls and saves scene editor payloads", async () => {
    const calls = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Move scene 1 right" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/scenes/reorder"))).toBe(true));
    const reorder = calls.find((call) => call.url.endsWith("/scenes/reorder"));
    expect(JSON.parse(String(reorder?.init?.body))).toEqual({ sceneIds: [scenes[1].id, scenes[0].id] });

    fireEvent.click(screen.getByRole("button", { name: "Edit scene 1: Introduction" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Narration/ }), { target: { value: "Edited narration." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith(`/scenes/${scenes[0].id}`))).toBe(true));
    const save = calls.find((call) => call.url.endsWith(`/scenes/${scenes[0].id}`));
    expect(save?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(save?.init?.body))).toMatchObject({ narration: "Edited narration." });
  });

  it("prompts before overwriting edited scenes and confirms the stage run", async () => {
    const calls = setup();
    fireEvent.click(await screen.findByRole("button", { name: /Regenerate scene plan/ }));
    expect(await screen.findByRole("heading", { name: "Overwrite edited scenes?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/pipeline/run"))).toBe(true));
    const run = calls.find((call) => call.url.endsWith("/pipeline/run"));
    expect(JSON.parse(String(run?.init?.body))).toEqual({ stage: "SCENE_PLAN", confirmOverwrite: true });
  });

  it("exposes split-after-sentence and merge-with-next actions", async () => {
    const calls = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Edit scene 1: Introduction" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Split after" })[0]);
    await waitFor(() => expect(calls.some((call) => call.url.endsWith(`/scenes/${scenes[0].id}/split`))).toBe(true));
    const split = calls.find((call) => call.url.endsWith(`/scenes/${scenes[0].id}/split`));
    expect(JSON.parse(String(split?.init?.body))).toEqual({ sentenceIndex: 0 });

    fireEvent.click(screen.getByRole("button", { name: "Merge with next" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/scenes/merge"))).toBe(true));
    const merge = calls.find((call) => call.url.endsWith("/scenes/merge"));
    expect(JSON.parse(String(merge?.init?.body))).toEqual({ sceneIds: [scenes[0].id, scenes[1].id] });
  });
});
