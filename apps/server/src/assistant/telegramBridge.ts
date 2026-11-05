import type Database from "better-sqlite3";
import type { AssistantPendingAction } from "@vg/shared";
import { setAutomationPaused } from "../services/automationSettings.js";
import type { TelegramClient, TelegramPoller } from "../notifications/telegram.js";
import { escapeHtml } from "../notifications/telegram.js";
import type { AssistantService } from "./service.js";

/** Wire Telegram poller to the LLM assistant (replaces TASK-031 placeholder). */
export function installAssistantTelegramHandlers(
  poller: TelegramPoller,
  assistant: AssistantService,
  options: {
    sqlite: Database.Database;
    getAutomationStatusText?: () => Promise<string>;
    operator?: {
      handleTelegram: (input: { chatId: string; text: string }) => Promise<boolean>;
      setOrderEnabled: (id: string, enabled: boolean) => void;
    };
  },
): void {
  poller.setMessageHandler(async (input) => {
    const client = poller.createClient();
    if (!client) return;
    const command = input.text.split(/\s+/)[0]?.toLowerCase() ?? "";
    const base = command.split("@")[0] ?? command;

    if (base === "/help") {
      await client.sendMessage(
        input.chatId,
        [
          "<b>Video Agent — lệnh</b>",
          "/status — lượt operator, hàng đợi, lượt hôm nay",
          "/pause — tạm dừng mọi tự động hoá",
          "/op — nhờ Cursor operator",
          "/tl — hỏi trợ lý tích hợp",
          "/stop — dừng lượt operator",
          "/new — phiên operator mới",
          "/orders — lệnh thường trực",
          "/help — trợ giúp",
        ].join("\n"),
      );
      return;
    }

    if (options.operator) {
      const handled = await options.operator.handleTelegram(input);
      if (handled) return;
    }

    if (base === "/status") {
      const statusText = options.getAutomationStatusText
        ? await options.getAutomationStatusText()
        : "Không có dữ liệu trạng thái.";
      await client.sendMessage(input.chatId, statusText);
      return;
    }

    if (base === "/pause") {
      setAutomationPaused(options.sqlite, true);
      await client.sendMessage(input.chatId, "⏸ Đã tạm dừng mọi tự động hoá (kill switch).");
      return;
    }

    if (base === "/new") {
      assistant.startNewTelegramConversation();
      await client.sendMessage(input.chatId, "Đã mở cuộc trò chuyện trợ lý mới.");
      return;
    }

    if (base.startsWith("/") && base !== "/start") {
      await client.sendMessage(input.chatId, "Lệnh không rõ. Gõ /help để xem danh sách.");
      return;
    }

    const conversation = assistant.getOrCreateTelegramConversation();
    try {
      await client.sendChatAction(input.chatId, "typing");
    } catch {
      // ignore typing failures
    }

    try {
      const result = await assistant.sendMessage(conversation.id, input.text);
      const assistantMsgs = result.messages.filter((m) => m.role === "assistant");
      const last = assistantMsgs[assistantMsgs.length - 1];
      let text = last?.content.text?.trim() || "Đã xử lý.";
      if (last?.content.clarify) {
        text = last.content.clarify.question;
        if (last.content.clarify.options?.length) {
          text += `\n\nGợi ý: ${last.content.clarify.options.join(" · ")}`;
        }
      }
      const buttons = pendingActionButtons(result.pendingActions, conversation.id);
      await client.sendMessage(input.chatId, escapeHtml(text), buttons.length ? { buttons } : {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await client.sendMessage(input.chatId, `Lỗi trợ lý: ${escapeHtml(message)}`);
    }
  });

  poller.setCallbackHandler(async (input) => {
    const client = poller.createClient();
    if (!client) return;

    const data = input.data;
    try {
      if (data.startsWith("pa:") && data.endsWith(":y") && !data.startsWith("pa:all:")) {
        const id = data.slice(3, -2);
        const action = await assistant.confirmAction(id);
        await finishCallback(client, input, `Đã xác nhận: ${action.summary}`);
        return;
      }
      if (data.startsWith("pa:") && data.endsWith(":n") && !data.startsWith("pa:all:")) {
        const id = data.slice(3, -2);
        const action = await assistant.rejectAction(id);
        await finishCallback(client, input, `Đã bỏ qua: ${action.summary}`);
        return;
      }
      if (data.startsWith("pa:all:") && data.endsWith(":y")) {
        const conversationId = data.slice("pa:all:".length, -2);
        const actions = await assistant.confirmAll(conversationId);
        await finishCallback(client, input, `Đã xác nhận ${actions.length} thao tác.`);
        return;
      }
      if (data.startsWith("ord:") && options.operator) {
        const parts = data.split(":");
        const id = parts[1] ?? "";
        const mode = parts[2];
        if (id && (mode === "on" || mode === "off")) {
          options.operator.setOrderEnabled(id, mode === "on");
          await finishCallback(client, input, mode === "on" ? "Đã bật lệnh thường trực." : "Đã tắt lệnh thường trực.");
          return;
        }
      }
      if (data.startsWith("ag:")) {
        // waiting_approval shortcut: ag:<pendingActionId>:y
        const id = data.slice(3).replace(/:y$/, "");
        const action = await assistant.confirmAction(id);
        await finishCallback(client, input, `Đã duyệt: ${action.summary}`);
        return;
      }
      await client.answerCallbackQuery(input.callbackQueryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await client.answerCallbackQuery(input.callbackQueryId, message.slice(0, 180));
      if (input.messageId != null) {
        try {
          await client.editMessageReplyMarkup(input.chatId, input.messageId);
        } catch {
          // ignore
        }
      }
    }
  });
}

function pendingActionButtons(
  actions: AssistantPendingAction[],
  conversationId: string,
): Array<Array<{ text: string; data: string }>> {
  const pending = actions.filter((a) => a.status === "pending");
  if (!pending.length) return [];
  const rows = pending.slice(0, 6).map((action) => [
    { text: `✓ ${action.summary.slice(0, 40)}`, data: `pa:${action.id}:y` },
    { text: "Bỏ qua", data: `pa:${action.id}:n` },
  ]);
  if (pending.length > 1) {
    rows.push([{ text: "Xác nhận tất cả", data: `pa:all:${conversationId}:y` }]);
  }
  return rows;
}

async function finishCallback(
  client: TelegramClient,
  input: { chatId: string; callbackQueryId: string; messageId?: number },
  text: string,
): Promise<void> {
  await client.answerCallbackQuery(input.callbackQueryId, text.slice(0, 180));
  if (input.messageId != null) {
    try {
      await client.editMessageReplyMarkup(input.chatId, input.messageId);
    } catch {
      // ignore
    }
  }
  await client.sendMessage(input.chatId, escapeHtml(text));
}
