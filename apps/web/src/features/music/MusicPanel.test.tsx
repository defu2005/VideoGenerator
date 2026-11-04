import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_ORDER, type MusicCandidate, type PipelineState, type Project, type ProjectMusic } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { MusicPanel } from "./MusicPanel";

const projectId = "44444444-4444-4444-8444-444444444444";
const project: Project = {
  id: projectId,
  title: "Music fixture",
  topic: "Ocean",
  description: "",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "ECO" }, language: "en", targetDurationSec: 30, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false,
  },
  status: "REVIEW", stage: "MUSIC_REVIEW", thumbnailPath: null, durationSec: null, version: 1,
  createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z", archivedAt: null,
};

function candidate(id: string, title: string, overrides: Partial<MusicCandidate> = {}): MusicCandidate {
  return {
    id, projectId, provider: "openverse", providerItemId: id, title, artist: "Ann",
    sourceUrl: "https://www.jamendo.com/track/1", audioUrl: `https://cdn.example.org/${id}.mp3`,
    durationSec: 185, genres: [], tags: ["calm", "piano"],
    license: {
      kind: "CC_BY", name: "CC BY 3.0", url: null, author: "Ann", authorUrl: null,
      attributionRequired: true, attributionText: "Quiet Piano by Ann (CC BY 3.0)", evidence: "api",
    },
    relevanceScore: 0.8, scoreBreakdown: {}, rank: 0, localPath: null, createdAt: project.createdAt,
    ...overrides,
  };
}

const first = candidate("11111111-1111-4111-8111-111111111111", "Quiet Piano");
const second = candidate("22222222-2222-4222-8222-222222222222", "Night Drums", {
  rank: 1, license: { ...first.license, kind: "UNKNOWN", name: "Unknown", attributionRequired: false },
});
const music: ProjectMusic = {
  enabled: true, mood: "calm", energy: "low", query: "calm piano", videoDurationSec: 60,
  candidates: [first, second],
  selection: {
    projectId, candidateId: first.id, status: "REVIEW_REQUIRED", selectedBy: "AGENT", queryOverride: null,
    volume: 0.15, fadeInSec: 2, fadeOutSec: 3, duckingDb: -12, startOffsetSec: 0, updatedAt: project.updatedAt,
  },
  selectedCandidate: first,
};
const pipeline: PipelineState = {
  projectId, mode: project.mode, runMode: null, currentStage: "MUSIC_REVIEW", status: "REVIEW",
  stages: STAGE_ORDER.map((stage) => ({
    stage, state: stage === "MUSIC_REVIEW" ? "WAITING_USER" : "PENDING", progress: 0,
    message: null, jobId: null, updatedAt: project.updatedAt, error: null,
  })),
  activeJob: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("MusicPanel", () => {
  it("lists candidates and sends select, search, none, settings and upload requests", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("EventSource", undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/pipeline")) return jsonResponse(pipeline);
      if (url.endsWith("/music/select")) {
        return jsonResponse({ ...music, selection: { ...music.selection!, status: "APPROVED", selectedBy: "USER", candidateId: second.id }, selectedCandidate: second });
      }
      return jsonResponse(music);
    }));
    const { container } = renderWithProviders(<MusicPanel project={project} />);

    expect(await screen.findByText("License chưa rõ")).toBeInTheDocument();
    expect(screen.getByText("Cần duyệt")).toBeInTheDocument();
    expect(screen.getByText(/Ghi nguồn: Quiet Piano by Ann/)).toBeInTheDocument();
    expect(container.querySelector(`audio[src="https://cdn.example.org/${second.id}.mp3"]`)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Duyệt nhạc → tiếp tục" })).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Dùng bản này" })[1]);
    await waitFor(() => expect(calls.find((call) => call.url.endsWith("/music/select"))?.init?.body).toBe(JSON.stringify({ candidateId: second.id })));
    expect(await screen.findByText("Bạn đã chọn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duyệt nhạc → tiếp tục" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Từ khóa tìm nhạc"), { target: { value: "epic drums" } });
    fireEvent.click(screen.getByRole("button", { name: "Tìm nhạc" }));
    await waitFor(() => expect(calls.find((call) => call.url.endsWith("/music/search"))?.init?.body).toBe(JSON.stringify({ query: "epic drums" })));

    fireEvent.click(screen.getByRole("button", { name: "Không dùng nhạc" }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/music/none"))).toBe(true));

    fireEvent.change(screen.getByLabelText("Fade out (giây)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));
    await waitFor(() => {
      const patch = calls.find((call) => call.url.endsWith("/music/settings"));
      expect(patch?.init?.method).toBe("PATCH");
      expect(JSON.parse(String(patch?.init?.body))).toMatchObject({ fadeOutSec: 5 });
    });

    const file = new File(["ID3"], "mine.mp3", { type: "audio/mpeg" });
    fireEvent.change(screen.getByLabelText("Tải nhạc của tôi"), { target: { files: [file] } });
    await waitFor(() => expect(calls.find((call) => call.url.endsWith("/music/upload"))?.init?.body).toBeInstanceOf(FormData));
  });
});
