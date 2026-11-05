import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { CommentsPage } from "./CommentsPage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

function item(id: string, author: string, reply: string) {
  return {
    id,
    publicationId: "33333333-3333-4333-8333-333333333333",
    projectId: "44444444-4444-4444-8444-444444444444",
    profileId: null,
    platform: "youtube",
    externalId: id,
    parentExternalId: null,
    authorName: author,
    text: "Hay quá",
    likeCount: 1,
    publishedAt: "2026-11-05T10:00:00.000Z",
    status: "new",
    classification: "praise",
    priority: 30,
    toxic: false,
    confidence: "high",
    suggestedReply: reply,
    repliedAt: null,
    repliedBy: null,
    videoTitle: "Biển đêm",
    thumbnailUrl: null,
    externalUrl: "https://example.com/v",
  };
}

describe("CommentsPage", () => {
  it("sends the edited reply text", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/profiles")) return jsonResponse({ items: [] });
      if (url.includes("/reply")) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ok: true });
      }
      if (url.includes("/api/comments")) {
        return jsonResponse({
          items: [item(firstId, "Lan", "Gợi ý gốc")],
          tiktok: [{
            accountId: "55555555-5555-4555-8555-555555555555",
            displayName: "Kênh TikTok",
            note: "TikTok chưa hỗ trợ đọc bình luận qua API",
            videos: [{ title: "Clip dọc", url: "https://www.tiktok.com/@me/video/1" }],
          }],
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<CommentsPage />);
    expect(await screen.findByText("TikTok chưa hỗ trợ đọc bình luận qua API")).toBeInTheDocument();
    const box = await screen.findByLabelText("Trả lời Lan");
    fireEvent.change(box, { target: { value: "Câu đã sửa" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await screen.findByLabelText("Trả lời Lan");
    expect(bodies.at(-1)).toEqual({ text: "Câu đã sửa" });
  });

  it("sends the selected ids for bulk spam", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/profiles")) return jsonResponse({ items: [] });
      if (url.includes("/bulk-spam")) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ updated: 2 });
      }
      if (url.includes("/api/comments")) {
        return jsonResponse({
          items: [item(firstId, "Lan", "A"), item(secondId, "Minh", "B")],
          tiktok: [],
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<CommentsPage />);
    fireEvent.click(await screen.findByLabelText("Chọn bình luận của Lan"));
    fireEvent.click(screen.getByLabelText("Chọn bình luận của Minh"));
    fireEvent.click(screen.getByRole("button", { name: "Đánh dấu spam" }));
    await screen.findByLabelText("Chọn bình luận của Lan");
    expect(bodies.at(-1)).toEqual({ ids: [firstId, secondId] });
  });
});
