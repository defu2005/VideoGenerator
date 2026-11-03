import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type PipelineState, type Project, type ProjectVoiceSummary, type ScenePlanSummary } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { SubtitlePanel } from "./SubtitlePanel";

const projectId = "44444444-4444-4444-8444-444444444444";
const firstSceneId = "11111111-1111-4111-8111-111111111111";
const secondSceneId = "22222222-2222-4222-8222-222222222222";
const project: Project = {
  id: projectId,
  title: "Subtitle fixture",
  topic: "Ocean",
  description: "",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "ECO" }, language: "en", targetDurationSec: 30, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 24 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false,
  },
  status: "REVIEW", stage: "SUBTITLE", thumbnailPath: null, durationSec: null, version: 1,
  createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z", archivedAt: null,
};
const scenes: ScenePlanSummary = {
  scenes: [
    {
      id: firstSceneId, projectId, order: 0, kind: "section", sectionId: null, label: "Opening scene",
      narration: "First cue.", visualNotes: "", visualDescription: "", noVisual: false,
      visualQueries: { primary: "", alternatives: [] }, queryVariant: false, musicMood: "", energy: "medium",
      estDurationSec: 5, durationOverrideSec: null, startSec: 0, transitionNote: "", origin: "AGENT",
      edited: false, inputHash: "input-a", createdAt: project.createdAt, updatedAt: project.updatedAt,
    },
    {
      id: secondSceneId, projectId, order: 1, kind: "section", sectionId: null, label: "Closing scene",
      narration: "Second cue.", visualNotes: "", visualDescription: "", noVisual: false,
      visualQueries: { primary: "", alternatives: [] }, queryVariant: false, musicMood: "", energy: "medium",
      estDurationSec: 5, durationOverrideSec: null, startSec: 5, transitionNote: "", origin: "AGENT",
      edited: false, inputHash: "input-b", createdAt: project.createdAt, updatedAt: project.updatedAt,
    },
  ],
  totalSec: 10, targetSec: 30, stale: false,
};
const pipeline: PipelineState = {
  projectId, mode: project.mode, runMode: null, currentStage: "SUBTITLE", status: "REVIEW",
  stages: STAGE_ORDER.map((stage) => ({
    stage, state: stage === "SUBTITLE" ? "DONE" : "PENDING", progress: 0,
    message: null, jobId: null, updatedAt: project.updatedAt, error: null,
  })),
  activeJob: null,
};
const voice: ProjectVoiceSummary = {
  voice: "en-US-AriaNeural", rate: "+0%", provider: "mock", tracks: [], totalDurationSec: 10, missingSceneIds: [],
};
const cueItems = [
  { index: 0, sceneId: firstSceneId, startSec: 0, endSec: 2, text: "First subtitle cue." },
  { index: 1, sceneId: firstSceneId, startSec: 2, endSec: 5, text: "Another first-scene cue." },
  { index: 2, sceneId: secondSceneId, startSec: 5, endSec: 10, text: "Second subtitle cue." },
];
const subtitles = { cues: cueItems, totalDurationSec: 10, updatedAt: project.updatedAt };

function installFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("EventSource", undefined);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/scenes")) return jsonResponse(scenes);
    if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
    if (url.endsWith("/voice")) return jsonResponse(voice);
    if (url.endsWith("/subtitles")) return jsonResponse(subtitles);
    if (url.includes("/subtitles/cues/")) return jsonResponse(subtitles);
    return jsonResponse({});
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("SubtitlePanel", () => {
  it("renders cues grouped by scene", async () => {
    installFetch();
    const { container } = renderWithProviders(<SubtitlePanel project={project} />);

    expect(await screen.findByText("Opening scene")).toBeInTheDocument();
    expect(screen.getByText("Closing scene")).toBeInTheDocument();
    expect(within(container.querySelectorAll<HTMLElement>(".subtitle-scene")[0]).getAllByRole("textbox")).toHaveLength(2);
    expect(container.querySelectorAll(".subtitle-scene")).toHaveLength(2);
  });

  it("PATCHes an edited cue on blur", async () => {
    const calls = installFetch();
    renderWithProviders(<SubtitlePanel project={project} />);
    const editor = await screen.findByRole("textbox", { name: "Edit subtitle text 0" });

    fireEvent.change(editor, { target: { value: "Changed subtitle." } });
    fireEvent.blur(editor);

    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/subtitles/cues/0") && call.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.url.endsWith("/subtitles/cues/0"));
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ text: "Changed subtitle." });
  });

  it("links to the SRT and ASS download routes", async () => {
    installFetch();
    renderWithProviders(<SubtitlePanel project={project} />);

    expect(await screen.findByRole("link", { name: "Tải .srt" })).toHaveAttribute("href", `/api/projects/${projectId}/subtitles/file.srt`);
    expect(screen.getByRole("link", { name: "Tải .ass" })).toHaveAttribute("href", `/api/projects/${projectId}/subtitles/file.ass`);
  });

  it("shows a warning for over-length subtitle text", async () => {
    installFetch();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/scenes")) return jsonResponse(scenes);
      if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
      if (url.endsWith("/voice")) return jsonResponse(voice);
      if (url.endsWith("/subtitles")) return jsonResponse({
        ...subtitles,
        cues: [{ ...cueItems[0], text: "This subtitle text clearly exceeds the allowed line length for two lines." }],
      });
      return jsonResponse({});
    }));
    renderWithProviders(<SubtitlePanel project={project} />);

    expect(await screen.findByText("Dòng dài hơn 24 ký tự")).toBeInTheDocument();
  });
});
