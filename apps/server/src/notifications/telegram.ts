import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import type { TokenVault } from "../publishing/tokenVault.js";
import {
  clearPairingCode,
  getNotificationSettings,
  getPairingCode,
  getTelegramUpdateOffset,
  saveNotificationSettings,
  saveTelegramUpdateOffset,
  TELEGRAM_BOT_TOKEN_KEY,
} from "../settings/notifications.js";

const MAX_MESSAGE_CHARS = 4000;
const POLL_TIMEOUT_SEC = 25;
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

export type InlineButton = { text: string; data: string };
export type TelegramMessageHandler = (input: {
  chatId: string;
  text: string;
  isPrivate: boolean;
  username?: string;
}) => Promise<void> | void;
export type TelegramCallbackHandler = (input: {
  chatId: string;
  data: string;
  callbackQueryId: string;
  messageId?: number;
}) => Promise<void> | void;

/** Wrong /start codes allowed before the pairing code is invalidated. */
export const MAX_PAIRING_ATTEMPTS = 5;

export function maskTelegramSecret(text: string, token?: string | null): string {
  let out = text;
  if (token) {
    out = out.split(token).join("[TELEGRAM_TOKEN]");
  }
  out = out.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[TELEGRAM_TOKEN]");
  return out;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function splitTelegramMessage(text: string, max = MAX_MESSAGE_CHARS): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining) parts.push(remaining);
  return parts;
}

type FetchImpl = typeof fetch;

export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async getMe(signal?: AbortSignal): Promise<{ id: number; username: string | null; firstName: string }> {
    const data = await this.call<{ id: number; username?: string; first_name?: string }>("getMe", {}, signal);
    return {
      id: data.id,
      username: data.username ?? null,
      firstName: data.first_name ?? "bot",
    };
  }

  async sendMessage(
    chatId: string,
    text: string,
    options: { buttons?: InlineButton[][]; signal?: AbortSignal } = {},
  ): Promise<number | undefined> {
    const chunks = splitTelegramMessage(text);
    let messageId: number | undefined;
    for (let i = 0; i < chunks.length; i += 1) {
      const replyMarkup = i === chunks.length - 1 && options.buttons?.length
        ? {
          inline_keyboard: options.buttons.map((row) =>
            row.map((btn) => ({
              text: btn.text,
              callback_data: btn.data.slice(0, 64),
            }))
          ),
        }
        : undefined;
      const sent = await this.call<{ message_id?: number }>("sendMessage", {
        chat_id: chatId,
        text: chunks[i],
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }, options.signal);
      if (typeof sent?.message_id === "number") messageId = sent.message_id;
    }
    return messageId;
  }

  async editMessageText(chatId: string, messageId: number, text: string, signal?: AbortSignal): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, MAX_MESSAGE_CHARS),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }, signal);
  }

  async sendChatAction(chatId: string, action: "typing" | "upload_document" = "typing", signal?: AbortSignal): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action }, signal);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, signal?: AbortSignal): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    }, signal);
  }

  async editMessageReplyMarkup(
    chatId: string,
    messageId: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    }, signal);
  }

  async getUpdates(offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    const data = await this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSec,
      allowed_updates: ["message", "callback_query"],
    }, signal);
    return Array.isArray(data) ? data : [];
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    retried = false,
  ): Promise<T> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      const message = maskTelegramSecret(error instanceof Error ? error.message : String(error), this.token);
      throw new Error(`Telegram ${method} failed: ${message}`);
    }

    if (response.status === 429 && !retried) {
      const retryAfterHeader = response.headers.get("retry-after");
      let retryAfter = retryAfterHeader ? Number(retryAfterHeader) : 1;
      try {
        const errBody = await response.json() as { parameters?: { retry_after?: number } };
        if (errBody.parameters?.retry_after) retryAfter = errBody.parameters.retry_after;
      } catch {
        // ignore parse errors
      }
      await sleep(Math.max(1, retryAfter) * 1000);
      return this.call(method, body, signal, true);
    }

    let payload: { ok?: boolean; result?: T; description?: string };
    try {
      payload = await response.json() as typeof payload;
    } catch (error) {
      const message = maskTelegramSecret(error instanceof Error ? error.message : String(error), this.token);
      throw new Error(`Telegram ${method} bad JSON: ${message}`);
    }

    if (!response.ok || !payload.ok) {
      const desc = maskTelegramSecret(payload.description ?? `HTTP ${response.status}`, this.token);
      throw new Error(`Telegram ${method} error: ${desc}`);
    }
    return payload.result as T;
  }
}

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number; type: string } };
  };
};

export type TelegramPollerDeps = {
  sqlite: Database.Database;
  vault: TokenVault;
  logger: FastifyBaseLogger;
  fetchImpl?: FetchImpl;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  workerEnabled?: boolean;
  getAutomationStatusText?: () => Promise<string> | string;
};

/**
 * Long-polling Telegram updates. Start/stop with the server like PublishTicker.
 * Handlers are pluggable so TASK-032 can replace the message handler.
 */
export class TelegramPoller {
  private started = false;
  private loopPromise: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private messageHandler: TelegramMessageHandler | null = null;
  private callbackHandler: TelegramCallbackHandler | null = null;
  private backoffMs = BACKOFF_START_MS;
  private failedPairingAttempts = 0;
  private readonly now: () => Date;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly fetchImpl: FetchImpl;
  private readonly workerEnabled: boolean;

  constructor(private readonly deps: TelegramPollerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleepFn = deps.sleep ?? sleep;
    this.fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.workerEnabled = deps.workerEnabled ?? true;
  }

  setMessageHandler(handler: TelegramMessageHandler | null): void {
    this.messageHandler = handler;
  }

  setCallbackHandler(handler: TelegramCallbackHandler | null): void {
    this.callbackHandler = handler;
  }

  /** Install default /start /status /help handlers for TASK-031. */
  installDefaultHandlers(): void {
    this.setMessageHandler(async (input) => {
      await this.handleDefaultMessage(input);
    });
    this.setCallbackHandler(async (input) => {
      const client = this.createClient();
      if (!client) return;
      await client.answerCallbackQuery(input.callbackQueryId);
    });
  }

  start(): void {
    if (!this.workerEnabled || this.started) return;
    this.started = true;
    this.controller = new AbortController();
    this.loopPromise = this.loop(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.controller?.abort();
    this.controller = undefined;
    if (this.loopPromise) {
      try {
        await this.loopPromise;
      } catch {
        // ignore
      }
      this.loopPromise = undefined;
    }
  }

  /** Restart after settings/token changes. */
  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }

  createClient(): TelegramClient | null {
    const token = this.deps.vault.loadSecret(TELEGRAM_BOT_TOKEN_KEY);
    if (!token) return null;
    return new TelegramClient(token, this.fetchImpl);
  }

  /** Exposed for tests — process one getUpdates cycle. */
  async pollOnce(signal?: AbortSignal): Promise<void> {
    if (!this.shouldPoll()) return;
    const client = this.createClient();
    if (!client) return;

    const offset = getTelegramUpdateOffset(this.deps.sqlite);
    const updates = await client.getUpdates(offset, 0, signal);
    for (const update of updates) {
      await this.dispatchUpdate(client, update);
      saveTelegramUpdateOffset(this.deps.sqlite, update.update_id + 1);
    }
    this.backoffMs = BACKOFF_START_MS;
  }

  /**
   * Poll when Telegram is enabled, or while a pairing code is active so that
   * "/start <code>" can be read before the chat is paired (pairing enables it).
   */
  private shouldPoll(): boolean {
    const settings = getNotificationSettings(this.deps.sqlite);
    if (settings.telegram.enabled) return true;
    const pairing = getPairingCode(this.deps.sqlite);
    return pairing != null && Date.parse(pairing.expiresAt) > this.now().getTime();
  }

  private async loop(signal: AbortSignal): Promise<void> {
    while (this.started && !signal.aborted) {
      try {
        if (!this.shouldPoll() || !this.deps.vault.hasSecret(TELEGRAM_BOT_TOKEN_KEY)) {
          await this.sleepFn(2_000);
          continue;
        }
        const client = this.createClient();
        if (!client) {
          await this.sleepFn(2_000);
          continue;
        }
        const offset = getTelegramUpdateOffset(this.deps.sqlite);
        const updates = await client.getUpdates(offset, POLL_TIMEOUT_SEC, signal);
        for (const update of updates) {
          await this.dispatchUpdate(client, update);
          saveTelegramUpdateOffset(this.deps.sqlite, update.update_id + 1);
        }
        this.backoffMs = BACKOFF_START_MS;
      } catch (error) {
        if (signal.aborted) return;
        const token = this.deps.vault.loadSecret(TELEGRAM_BOT_TOKEN_KEY);
        const message = maskTelegramSecret(
          error instanceof Error ? error.message : String(error),
          token,
        );
        this.deps.logger.warn({ err: message }, "Telegram poller error");
        await this.sleepFn(this.backoffMs);
        this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs * 2);
      }
    }
  }

  private async dispatchUpdate(client: TelegramClient, update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = String(cq.message?.chat.id ?? "");
      if (!chatId) return;
      if (!this.isPairedChat(chatId)) {
        this.deps.logger.debug({ chatId }, "Ignored Telegram callback from unpaired chat");
        return;
      }
      if (this.callbackHandler) {
        await this.callbackHandler({
          chatId,
          data: cq.data ?? "",
          callbackQueryId: cq.id,
          messageId: cq.message?.message_id,
        });
      }
      return;
    }

    const message = update.message;
    if (!message?.text) return;
    const chatId = String(message.chat.id);
    const isPrivate = message.chat.type === "private";
    const text = message.text.trim();

    // Pairing is allowed from any private chat; other commands require paired chat.
    if (text.startsWith("/start")) {
      if (!isPrivate) {
        this.deps.logger.debug({ chatId }, "Ignored /start from non-private chat");
        return;
      }
      await this.handleStart(client, chatId, text);
      return;
    }

    if (!this.isPairedChat(chatId)) {
      this.deps.logger.debug({ chatId }, "Ignored Telegram message from unpaired chat");
      return;
    }

    if (this.messageHandler) {
      await this.messageHandler({
        chatId,
        text,
        isPrivate,
        username: message.chat.username,
      });
    }
  }

  private isPairedChat(chatId: string): boolean {
    const settings = getNotificationSettings(this.deps.sqlite);
    return Boolean(settings.telegram.chatId && settings.telegram.chatId === chatId);
  }

  private async handleStart(client: TelegramClient, chatId: string, text: string): Promise<void> {
    const match = /^\/start(?:@\w+)?\s+(\d{6})\s*$/i.exec(text);
    if (!match) {
      // Already paired: greet; unpaired without code: ignore (no reply to strangers).
      if (this.isPairedChat(chatId)) {
        await client.sendMessage(chatId, "Video Agent đã ghép nối. Gõ /help để xem lệnh.");
      } else {
        this.deps.logger.debug({ chatId }, "Ignored /start without code from unpaired chat");
      }
      return;
    }

    const code = match[1]!;
    const pairing = getPairingCode(this.deps.sqlite);
    if (!pairing || pairing.code !== code || Date.parse(pairing.expiresAt) <= this.now().getTime()) {
      this.deps.logger.debug({ chatId }, "Ignored /start with wrong or expired code");
      // Brute-force guard: too many wrong codes invalidate the current pairing code.
      if (pairing) {
        this.failedPairingAttempts += 1;
        if (this.failedPairingAttempts >= MAX_PAIRING_ATTEMPTS) {
          clearPairingCode(this.deps.sqlite);
          this.failedPairingAttempts = 0;
          this.deps.logger.warn("Telegram pairing code invalidated after too many wrong attempts");
        }
      }
      return;
    }
    this.failedPairingAttempts = 0;

    const settings = getNotificationSettings(this.deps.sqlite);
    saveNotificationSettings(this.deps.sqlite, {
      ...settings,
      telegram: { ...settings.telegram, chatId, enabled: true },
    });
    clearPairingCode(this.deps.sqlite);
    await client.sendMessage(chatId, "Đã ghép nối với Video Agent");
  }

  private async handleDefaultMessage(input: {
    chatId: string;
    text: string;
    isPrivate: boolean;
  }): Promise<void> {
    const client = this.createClient();
    if (!client) return;
    const command = input.text.split(/\s+/)[0]?.toLowerCase() ?? "";

    if (command === "/help" || command === "/help@") {
      await client.sendMessage(
        input.chatId,
        [
          "<b>Video Agent — lệnh</b>",
          "/status — trạng thái tự động hoá",
          "/help — trợ giúp",
          "",
          "Trợ lý AI sẽ có ở bản sau",
        ].join("\n"),
      );
      return;
    }

    if (command === "/status" || command.startsWith("/status@")) {
      const statusText = this.deps.getAutomationStatusText
        ? await this.deps.getAutomationStatusText()
        : "Không có dữ liệu trạng thái.";
      await client.sendMessage(input.chatId, statusText);
      return;
    }

    if (command.startsWith("/")) {
      await client.sendMessage(input.chatId, "Trợ lý AI sẽ có ở bản sau");
      return;
    }

    await client.sendMessage(input.chatId, "Trợ lý AI sẽ có ở bản sau");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
