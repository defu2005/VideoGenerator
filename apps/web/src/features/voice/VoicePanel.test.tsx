import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type PipelineState, type Project, type ProjectVoiceSummary, type ScenePlanSummary, type VoiceTrack } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { VoicePanel } from "./VoicePanel";

const projectId = "44444444-4444-4444-8444-444444444444";
const sceneId = "11111111-1111-4111-8111-111111111111";
const trackId = "33333333-3333-4333-8333-333333333333";
const project: Project = {
  id: projectId,
  title: "Voice fixture",
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
  status: "REVIEW", stage: "VOICE", thumbnailPath: null, durationSec: null, version: 1,
  createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z", archivedAt: null,
};
const sceneSummary: ScenePlanSummary = {
  scenes: [{
    id: sceneId, projectId, order: 0, kind: "section", sectionId: null, label: "Ocean scene",
    narration: "The waves reach the shore.", visualNotes: "", visualDescription: "", noVisual: false,
    visualQueries: { primary: "", alternatives: [] }, queryVariant: false, musicMood: "", energy: "medium",
    estDurationSec: 5, durationOverrideSec: null, startSec: 0, transitionNote: "", origin: "AGENT",
    edited: false, inputHash: "input", createdAt: project.createdAt, updatedAt: project.updatedAt,
  }],
  totalSec: 5, targetSec: 30, stale: false,
};
const track: VoiceTrack = {
  id: trackId, projectId, sceneId, provider: "mock", voice: "en-US-AriaNeural", rate: "+0%", origin: "AGENT",
  audioPath: "voice.wav", durationSec: 7, cues: [], inputHash: "input",
  createdAt: project.createdAt, updatedAt: project.updatedAt,
};
const voiceSummary: ProjectVoiceSummary = {
  voice: "en-US-AriaNeural", rate: "+0%", provider: "mock", tracks: [track],
  totalDurationSec: 7, missingSceneIds: [],
};
const pipeline: PipelineState = {
  projectId, mode: project.mode, runMode: null, currentStage: "VOICE", status: "REVIEW",
  stages: STAGE_ORDER.map((stage) => ({
    stage, state: stage === "VOICE" ? "DONE" : "PENDING", progress: 0,
    message: null, jobId: null, updatedAt: project.updatedAt, error: null,
  })),
  activeJob: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("VoicePanel", () => {
  it("renders a track and sends regenerate and multipart upload requests", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
      if (url.endsWith("/scenes")) return jsonResponse(sceneSummary);
      if (url.endsWith("/voice")) return jsonResponse(voiceSummary);
      if (url.endsWith("/regenerate") || url.endsWith("/upload")) return jsonResponse(track);
      return jsonResponse({});
    }));
    const { container } = renderWithProviders(<VoicePanel project={project} />);

    expect(await screen.findAllByText(/en-US-AriaNeural/)).toHaveLength(2);
    expect(container.querySelector("audio")).toHaveAttribute("src", `/api/projects/${projectId}/voice/${trackId}/audio`);
    fireEvent.click(screen.getByRole("button", { name: "Tạo lại" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/regenerate"))).toBe(true));

    const file = new File(["wav"], "my-voice.wav", { type: "audio/wav" });
    fireEvent.change(screen.getByLabelText("Tải lên giọng của tôi"), { target: { files: [file] } });
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/upload"))).toBe(true));
    const uploadCall = calls.find((call) => call.url.endsWith("/upload"));
    expect(uploadCall?.init?.body).toBeInstanceOf(FormData);
  });
});
