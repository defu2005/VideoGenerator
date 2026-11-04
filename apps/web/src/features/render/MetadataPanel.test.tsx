import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, VideoMetadataResponse } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { MetadataPanel } from "./MetadataPanel";

const projectId = "66666666-6666-4666-8666-666666666666";
const project: Project = {
  id: projectId,
  title: "Metadata fixture",
  topic: "Ocean",
  description: "",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "BALANCED" }, language: "en", targetDurationSec: 120, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "REVIEW", stage: "RENDER", thumbnailPath: null, durationSec: 120, version: 1,
  createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z", archivedAt: null,
};

const payload: VideoMetadataResponse = {
  metadata: {
    projectId,
    inputHash: "hash",
    source: "LLM",
    draft: {
      titles: ["Ocean story", "Deep blue", "Waves"],
      description: "A calm sea",
      tags: ["ocean", "nature"],
      hashtags: ["#ocean"],
      thumbnailText: ["Sea", "Calm"],
    },
    edited: null,
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
  },
  stale: false,
  extras: {
    chaptersText: "00:00 Intro\n00:40 Middle\n01:20 End",
    creditsText: "Image credits…",
    disclosure: "Video có sử dụng giọng đọc tổng hợp và nội dung do AI hỗ trợ.",
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("MetadataPanel", () => {
  it("renders titles, saves edits, and copies blocks", async () => {
    const writes: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: { writeText: async (text: string) => { writes.push(text); } },
    });
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/timeline")) {
        return jsonResponse({
          timeline: { formatVersion: 1, target: { width: 1920, height: 1080, fps: 30 }, totalDurationSec: 120, scenes: [], music: null, subtitles: null, warnings: [], licenseSummary: {} },
          inputHash: "hash",
          updatedAt: project.updatedAt,
        });
      }
      if (url.endsWith("/metadata") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as VideoMetadataResponse["metadata"] extends infer M ? M extends { draft: infer D } ? D : never : never;
        return jsonResponse({
          ...payload,
          metadata: { ...payload.metadata!, edited: body, draft: payload.metadata!.draft },
        });
      }
      if (url.endsWith("/metadata")) return jsonResponse(payload);
      return jsonResponse({});
    }));

    renderWithProviders(<MetadataPanel project={project} />);
    expect(await screen.findByLabelText("Thông tin đăng tải")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ocean story")).toBeInTheDocument();
    expect(screen.getByText("#ocean")).toBeInTheDocument();
    expect(screen.getByLabelText("Phần mô tả bổ sung (chỉ đọc)")).toHaveTextContent("00:00 Intro");

    fireEvent.change(screen.getByLabelText("Mô tả"), { target: { value: "Edited description" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PUT" && String(call.init.body).includes("Edited description"))).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Sao chép tiêu đề" }));
    await waitFor(() => expect(writes[0]).toBe("Ocean story"));

    fireEvent.click(screen.getByRole("button", { name: "Sao chép tất cả" }));
    await waitFor(() => expect(writes.some((text) => text.includes("Edited description") || text.includes("A calm sea") || text.includes("Ocean story"))).toBe(true));
  });
});
