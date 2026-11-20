import { describe, expect, it } from "vitest";
import { installAssistantTelegramHandlers } from "../src/assistant/telegramBridge.js";

// TASK-129c: the /mission route inside the Telegram bridge, with a fake poller and client. No network.
function fakePoller() {
  const sent: Array<{ chatId: string; text: string }> = [];
  let onMessage: ((input: { chatId: string; text: string }) => Promise<void>) | null = null;
  const client = {
    sendMessage: async (chatId: string, text: string) => { sent.push({ chatId, text }); },
    sendChatAction: async () => {},
    answerCallbackQuery: async () => {},
    editMessageReplyMarkup: async () => {},
  };
  const poller = {
    setMessageHandler: (handler: typeof onMessage) => { onMessage = handler; },
    setCallbackHandler: () => {},
    createClient: () => client,
  };
  return { poller: poller as never, sent, deliver: (text: string) => onMessage!({ chatId: "42", text }) };
}

const assistant = { getOrCreateTelegramConversation: () => ({ id: "c" }), sendMessage: async () => ({ messages: [], pendingActions: [] }), startNewTelegramConversation: () => {} } as never;

describe("/mission through installAssistantTelegramHandlers", () => {
  it("routes /mission@bot list to the handler with args 'list'", async () => {
    const f = fakePoller();
    const seen: string[] = [];
    installAssistantTelegramHandlers(f.poller, assistant, { sqlite: {} as never, mission: (args) => { seen.push(args); return "ok-list"; } });
    await f.deliver("/mission@bot list");
    expect(seen).toEqual(["list"]);
    expect(f.sent.at(-1)).toEqual({ chatId: "42", text: "ok-list" });
  });

  it("a throwing handler still sends a readable reply", async () => {
    const f = fakePoller();
    installAssistantTelegramHandlers(f.poller, assistant, { sqlite: {} as never, mission: () => { throw new Error("<boom>"); } });
    await f.deliver("/mission resume x");
    expect(f.sent.at(-1)?.text).toBe("Lỗi mission: &lt;boom&gt;");
  });
});
