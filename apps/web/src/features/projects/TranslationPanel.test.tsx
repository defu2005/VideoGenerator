import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@vg/shared";
import { TranslationPanel } from "./TranslationPanel";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";

const project: Project = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Đông Sơn",
  topic: "Lịch sử",
  description: "",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "BALANCED" },
    language: "vi",
    targetDurationSec: 60,
    aspectRatio: "16:9",
    platform: "youtube",
    style: "documentary",
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
    guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "COMPLETED",
  stage: "RENDER",
  thumbnailPath: null,
  durationSec: 60,
  version: 1,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  archivedAt: null,
};

describe("TranslationPanel", () => {
  it("starts a translation job for a configured language", async () => {
    let started: unknown;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/translations") && init?.method === "POST") {
        started = JSON.parse(String(init.body));
        return jsonResponse({ childId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", waitingReview: true, shortenCalls: 1 });
      }
      return jsonResponse({
        targets: [{ language: "en", accountIds: [], mode: "dub" }],
        children: [],
        review: null,
        youtubeHints: [],
      });
    }));
    renderWithProviders(<TranslationPanel project={project} />);
    expect(await screen.findByRole("button", { name: "Tạo bản dịch" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tạo bản dịch" }));
    await waitFor(() => expect(started).toEqual({ language: "en" }));
  });
});
