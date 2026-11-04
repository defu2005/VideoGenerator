import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutoReportResponse, Project } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AutoReportPanel } from "./AutoReportPanel";

const projectId = "77777777-7777-4777-8777-777777777777";
const sceneId = "88888888-8888-4888-8888-888888888888";

const project: Project = {
  id: projectId,
  title: "AUTO report fixture",
  topic: "Ocean",
  description: "",
  mode: "AUTO",
  settings: {
    budget: { mode: "BALANCED" }, language: "en", targetDurationSec: 120, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "COMPLETED", stage: "DONE", thumbnailPath: null, durationSec: 120, version: 1,
  createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z", archivedAt: null,
};

const payload: AutoReportResponse = {
  projectId,
  warnCount: 1,
  groups: [{
    stage: "VISUAL_REVIEW",
    entries: [{
      id: "99999999-9999-4999-8999-999999999999",
      projectId,
      stage: "VISUAL_REVIEW",
      sceneId,
      code: "VISUAL_LOW_FIT",
      severity: "WARN",
      message: "Scene đã duyệt ảnh fit 5/10 (dưới ngưỡng).",
      data: { fit: 5 },
      createdAt: "2026-11-04T00:00:00.000Z",
    }],
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe("AutoReportPanel", () => {
  it("renders AUTO report entries with scene fix links", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/auto-report")) return jsonResponse(payload);
      return jsonResponse({});
    }));
    renderWithProviders(<AutoReportPanel project={project} />);
    expect(await screen.findByLabelText("Báo cáo AUTO")).toBeInTheDocument();
    expect(screen.getByText(/1 cảnh báo/)).toBeInTheDocument();
    expect(screen.getByText(/fit 5\/10/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Sửa scene này" });
    expect(link).toHaveAttribute("href", expect.stringContaining(`scene=${sceneId}`));
    await waitFor(() => expect(link).toBeInTheDocument());
  });
});
