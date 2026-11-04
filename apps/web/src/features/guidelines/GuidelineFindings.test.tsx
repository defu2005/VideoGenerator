import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { GuidelineFindings } from "./GuidelineFindings";

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Test",
  topic: "Topic",
  description: "",
  mode: "AUTO",
  settings: {
    language: "vi",
    targetDurationSec: 120,
    aspectRatio: "16:9",
    platform: "youtube",
    style: "storytelling",
    tone: "dramatic",
    audience: "general",
    budget: { mode: "BALANCED" },
    wordsPerMinute: 150,
    sceneDurationSec: 7,
    visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 },
    music: { enabled: true, volume: 0.15 },
    userSet: [],
    stageExecutors: {},
    autoRender: false,
    guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "REVIEW",
  stage: "SCRIPT",
  thumbnailPath: null,
  durationSec: null,
  version: 1,
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt: "2026-11-04T00:00:00.000Z",
  archivedAt: null,
} as Project;

const response = {
  strictness: "FILTER",
  activePacks: [],
  needsAttentionSceneIds: ["opening"],
  findings: [{
    id: "22222222-2222-4222-8222-222222222222",
    projectId: project.id,
    stage: "SCRIPT",
    source: "LLM",
    ruleId: "youtube.no_misleading",
    severity: "MUST",
    sceneId: "opening",
    text: "Thiếu nguồn.",
    quote: "một câu",
    suggestion: "Nói rõ chưa chắc.",
    status: "OPEN",
    dismissedBy: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }],
};

describe("GuidelineFindings", () => {
  it("dismisses a finding through the API", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
      if (init?.method === "POST") return jsonResponse({ ...response, findings: [{ ...response.findings[0], status: "DISMISSED", dismissedBy: "user" }] });
      return jsonResponse(response);
    }));
    renderWithProviders(<GuidelineFindings project={project} stage="SCRIPT" />);
    expect(await screen.findByText("Thiếu nguồn.")).toBeInTheDocument();
    expect(screen.getByText(/AUTO đang tạm dừng/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.includes("/dismiss"))).toBe(true));
    expect(await screen.findByText("Không có phát hiện đang mở.")).toBeInTheDocument();
  });
});
