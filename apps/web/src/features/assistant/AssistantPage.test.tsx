import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, AssistantPendingAction } from "@vg/shared";
import { jsonResponse, renderWithProviders } from "../../test/testUtils";
import { AssistantPage } from "./AssistantPage";

afterEach(() => vi.unstubAllGlobals());

const conversationId = "11111111-1111-4111-8111-111111111111";
const actionId = "22222222-2222-4222-8222-222222222222";
const userMessageId = "33333333-3333-4333-8333-333333333333";
const assistantMessageId = "44444444-4444-4444-8444-444444444444";
const clarifyMessageId = "55555555-5555-4555-8555-555555555555";

const conversation = {
  id: conversationId,
  channel: "web" as const,
  title: "Hỏi lịch đăng",
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T01:00:00.000Z",
};

const pendingAction: AssistantPendingAction = {
  id: actionId,
  conversationId,
  tool: "run_pipeline",
  args: { projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  summary: "Chạy pipeline cho dự án demo",
  status: "pending",
  result: null,
  createdAt: "2026-11-05T01:00:00.000Z",
  expiresAt: "2026-11-05T01:30:00.000Z",
};

function assistantReply(text: string, id = assistantMessageId): AssistantMessage {
  return {
    id,
    conversationId,
    role: "assistant",
    content: { text },
    createdAt: "2026-11-05T01:01:00.000Z",
  };
}

describe("AssistantPage", () => {
  it("sending a message renders the reply", async () => {
    let messageItems: AssistantMessage[] = [];

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/assistant/settings")) {
        return init?.method === "PUT"
          ? jsonResponse({ confirmMode: "risky" })
          : jsonResponse({ confirmMode: "risky" });
      }
      if (url.includes(`/assistant/conversations/${conversationId}/messages`)) {
        if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { text: string };
        messageItems = [
          {
            id: userMessageId,
            conversationId,
            role: "user",
            content: { text: body.text },
            createdAt: "2026-11-05T01:00:30.000Z",
          },
          assistantReply("Tuần này có 3 bài đã lên lịch."),
        ];
          return jsonResponse({ messages: messageItems, pendingActions: [] });
        }
        return jsonResponse({ items: messageItems, pendingActions: [] });
      }
      if (url.includes("/assistant/conversations") && init?.method === "POST") {
        return jsonResponse(conversation, 201);
      }
      if (url.includes("/assistant/conversations")) {
        return jsonResponse({ items: [conversation] });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AssistantPage />);
    expect(await screen.findByRole("heading", { name: "Trợ lý AI" })).toBeInTheDocument();

    const textarea = await screen.findByLabelText("Tin nhắn");
    fireEvent.change(textarea, { target: { value: "Lịch đăng tuần này?" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));

    expect(await screen.findByText("Tuần này có 3 bài đã lên lịch.")).toBeInTheDocument();
  });

  it("pending card confirm calls the API", async () => {
    const calls: string[] = [];
    const messagesWithPending: AssistantMessage[] = [
      assistantReply("Tôi cần bạn xác nhận thao tác sau."),
    ];

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/assistant/settings")) return jsonResponse({ confirmMode: "risky" });
      if (url.endsWith(`/assistant/actions/${actionId}/confirm`) && init?.method === "POST") {
        calls.push("confirm");
        return jsonResponse({
          action: { ...pendingAction, status: "confirmed" },
        });
      }
      if (url.includes(`/assistant/conversations/${conversationId}/messages`)) {
        return jsonResponse({
          items: messagesWithPending,
          pendingActions: calls.includes("confirm") ? [] : [pendingAction],
        });
      }
      if (url.includes("/assistant/conversations")) {
        return jsonResponse({ items: [conversation] });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText("Chạy pipeline cho dự án demo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(calls).toContain("confirm"));
  });

  it("quick-reply chips send the option text", async () => {
    const sentBodies: unknown[] = [];
    let threadItems: AssistantMessage[] = [];
    const clarifyMessage: AssistantMessage = {
      id: clarifyMessageId,
      conversationId,
      role: "assistant",
      content: {
        text: "",
        clarify: {
          question: "Bạn muốn xem hồ sơ nào?",
          options: ["Hồ sơ A", "Hồ sơ B"],
        },
      },
      createdAt: "2026-11-05T01:00:00.000Z",
    };
    threadItems = [clarifyMessage];

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/assistant/settings")) return jsonResponse({ confirmMode: "risky" });
      if (url.includes(`/assistant/conversations/${conversationId}/messages`)) {
        if (init?.method === "POST") {
          sentBodies.push(JSON.parse(String(init.body)));
          threadItems = [
            clarifyMessage,
            {
              id: userMessageId,
              conversationId,
              role: "user",
              content: { text: (sentBodies.at(-1) as { text: string }).text },
              createdAt: "2026-11-05T01:00:10.000Z",
            },
            assistantReply("Đã chọn hồ sơ."),
          ];
          return jsonResponse({
            messages: threadItems.slice(1),
            pendingActions: [],
          });
        }
        return jsonResponse({ items: threadItems, pendingActions: [] });
      }
      if (url.includes("/assistant/conversations")) {
        return jsonResponse({ items: [conversation] });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AssistantPage />);
    expect(await screen.findByText("Bạn muốn xem hồ sơ nào?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hồ sơ B" }));
    await waitFor(() => {
      expect(sentBodies).toContainEqual({ text: "Hồ sơ B" });
    });
    expect(await screen.findByText("Đã chọn hồ sơ.")).toBeInTheDocument();
  });

  it("switches to the Agent operator chat without loading it first", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/assistant/settings")) return jsonResponse({ confirmMode: "risky" });
      if (url.includes("/assistant/conversations")) return jsonResponse({ items: [conversation] });
      if (url.includes("/operator/overview")) {
        return jsonResponse({
          killed: false,
          cli: { found: true, version: "2026.11.05", loggedIn: null, model: null },
          queue: [],
          activeRunId: null,
          pending: [],
          orders: [],
          runs: [],
          audit: [],
          notes: [],
          settings: { killed: false, cursorPath: "", tickCron: null, maxRunsPerDay: 30 },
          resumeCommand: "cursor-agent",
          workspacePath: "C:/data/operator",
          usage: { today: 0, month: 0, cap: 30 },
          conversationId: conversationId,
        });
      }
      if (url.includes("/operator/conversations/")) return jsonResponse({ messages: [] });
      return jsonResponse({});
    }));
    renderWithProviders(<AssistantPage />);
    expect(await screen.findByRole("button", { name: "Agent operator" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Nhắn Agent operator")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Agent operator" }));
    expect(await screen.findByLabelText("Nhắn Agent operator")).toBeInTheDocument();
  });
});
