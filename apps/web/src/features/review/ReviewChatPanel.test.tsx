import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, ReviewGetResponse, ReviewMessage } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { ReviewChatPanel } from "./ReviewChatPanel";

const projectId = "77777777-7777-4777-8777-777777777777";
const messageId = "88888888-8888-4888-8888-888888888888";

const project: Project = {
  id: projectId,
  title: "Review fixture",
  topic: "Ocean",
  description: "",
  mode: "ASSISTED",
  settings: {
    budget: { mode: "ECO" }, language: "vi", targetDurationSec: 60, aspectRatio: "16:9",
    platform: "youtube", style: "documentary", tone: "neutral", audience: "general",
    wordsPerMinute: 150, sceneDurationSec: 7, visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 }, music: { enabled: true, volume: 0.15 },
    userSet: [], stageExecutors: {}, autoRender: false, guidelines: { platformPack: "auto", customRules: [] },
  },
  status: "REVIEW", stage: "FINAL_APPROVAL", thumbnailPath: null, durationSec: 60, version: 1,
  createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z", archivedAt: null,
};

const emptyReview: ReviewGetResponse = {
  thread: null,
  estimate: { inputTokens: 1200, outputTokens: 800 },
  contextHash: "abc",
};

const assistant: ReviewMessage = {
  id: messageId,
  threadId: "99999999-9999-4999-8999-999999999999",
  role: "assistant",
  content: "Đề xuất chỉnh nhạc nhẹ hơn.",
  proposals: [
    { type: "MUSIC_MIX", volume: 0.12, duckingDb: -16 },
    { type: "NOTE", text: "Hook ổn rồi." },
  ],
  appliedIndexes: [],
  usage: { inputTokens: 10, outputTokens: 20 },
  createdAt: project.updatedAt,
};

afterEach(() => vi.unstubAllGlobals());

describe("ReviewChatPanel", () => {
  it("renders collapsed, sends a message, applies a proposal, and shows the rerun banner", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let reviewState: ReviewGetResponse = emptyReview;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/review/messages") && init?.method === "POST") {
        reviewState = {
          thread: {
            id: assistant.threadId,
            projectId,
            contextHash: "abc",
            createdAt: project.updatedAt,
            messages: [
              {
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                threadId: assistant.threadId,
                role: "user",
                content: "AI xem lại toàn bộ",
                proposals: null,
                appliedIndexes: [],
                usage: null,
                createdAt: project.updatedAt,
              },
              assistant,
            ],
          },
          estimate: { inputTokens: 1300, outputTokens: 800 },
          contextHash: "abc",
        };
        return jsonResponse(assistant);
      }
      if (url.includes("/proposals/") && init?.method === "POST") {
        reviewState = {
          ...reviewState,
          thread: reviewState.thread
            ? {
              ...reviewState.thread,
              messages: reviewState.thread.messages.map((message) =>
                message.id === messageId ? { ...message, appliedIndexes: [0] } : message),
            }
            : null,
        };
        return jsonResponse({ result: { ok: true }, staleStages: ["TIMELINE", "RENDER"] });
      }
      if (url.includes("/pipeline/run")) return jsonResponse({ ok: true });
      if (url.includes("/review")) return jsonResponse(reviewState);
      return jsonResponse({});
    }));

    renderWithProviders(<ReviewChatPanel project={project} />);
    expect(screen.getByLabelText("Góp ý với AI")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI xem lại toàn bộ" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Mở/ }));
    expect(await screen.findByRole("button", { name: "AI xem lại toàn bộ" })).toBeInTheDocument();
    expect(screen.getByText(/Ước tính ≈/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI xem lại toàn bộ" }));
    expect(await screen.findByText("Đề xuất chỉnh nhạc nhẹ hơn.")).toBeInTheDocument();
    expect(screen.getByText(/Chỉnh mix nhạc/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(await screen.findByText(/Chạy lại các bước bị ảnh hưởng/)).toBeInTheDocument();
    expect(screen.getByText(/TIMELINE, RENDER/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chạy lại" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/pipeline/run"))).toBe(true));
  });
});
