import {
  ApiErrorSchema,
  NotificationLogListSchema,
  NotificationSettingsSchema,
  NotificationSettingsStatusSchema,
  PairingCodeResponseSchema,
  TelegramTokenBodySchema,
} from "@vg/shared";
import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import type { NotificationService } from "../notifications/notificationService.js";
import type { TelegramPoller } from "../notifications/telegram.js";
import { TelegramClient, maskTelegramSecret } from "../notifications/telegram.js";
import {
  clearPairingCode,
  getNotificationSettings,
  getNotificationSettingsStatus,
  saveNotificationSettings,
  savePairingCode,
  TELEGRAM_BOT_TOKEN_KEY,
} from "../settings/notifications.js";

const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  500: ApiErrorSchema,
};

const TestResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
}).strict();

export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: {
    sqlite: Database.Database;
    vault: TokenVault;
    notifications: NotificationService;
    poller: TelegramPoller;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  },
): void {
  const now = deps.now ?? (() => new Date());
  const fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  app.get("/api/notifications/settings", {
    schema: {
      response: { 200: NotificationSettingsStatusSchema, ...ErrorResponses },
    },
  }, async () => getNotificationSettingsStatus(deps.sqlite, deps.vault));

  app.put("/api/notifications/settings", {
    schema: {
      body: NotificationSettingsSchema,
      response: { 200: NotificationSettingsStatusSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const body = NotificationSettingsSchema.parse(request.body);
    const current = getNotificationSettings(deps.sqlite);
    // Preserve chatId / botUsername from server state unless explicitly provided.
    const merged = NotificationSettingsSchema.parse({
      ...body,
      telegram: {
        ...body.telegram,
        chatId: body.telegram.chatId !== undefined ? body.telegram.chatId : current.telegram.chatId,
        botUsername: body.telegram.botUsername !== undefined
          ? body.telegram.botUsername
          : current.telegram.botUsername,
      },
    });
    saveNotificationSettings(deps.sqlite, merged);
    void deps.poller.restart();
    return getNotificationSettingsStatus(deps.sqlite, deps.vault);
  });

  app.put("/api/notifications/telegram/token", {
    schema: {
      body: TelegramTokenBodySchema,
      response: { 200: NotificationSettingsStatusSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { token } = TelegramTokenBodySchema.parse(request.body);
    try {
      const client = new TelegramClient(token, fetchImpl);
      const me = await client.getMe();
      deps.vault.storeSecret(TELEGRAM_BOT_TOKEN_KEY, token);
      const settings = getNotificationSettings(deps.sqlite);
      saveNotificationSettings(deps.sqlite, {
        ...settings,
        telegram: {
          ...settings.telegram,
          botUsername: me.username,
        },
      });
      void deps.poller.restart();
      return getNotificationSettingsStatus(deps.sqlite, deps.vault);
    } catch (error) {
      const message = maskTelegramSecret(
        error instanceof Error ? error.message : String(error),
        token,
      );
      throw new AppError(
        400,
        "TELEGRAM_TOKEN_INVALID",
        `Token Telegram không hợp lệ: ${message}`,
      );
    }
  });

  app.delete("/api/notifications/telegram/token", {
    schema: {
      response: { 200: NotificationSettingsStatusSchema, ...ErrorResponses },
    },
  }, async () => {
    deps.vault.deleteSecret(TELEGRAM_BOT_TOKEN_KEY);
    const settings = getNotificationSettings(deps.sqlite);
    saveNotificationSettings(deps.sqlite, {
      ...settings,
      telegram: {
        ...settings.telegram,
        botUsername: null,
        enabled: false,
      },
    });
    void deps.poller.restart();
    return getNotificationSettingsStatus(deps.sqlite, deps.vault);
  });

  app.post("/api/notifications/telegram/pair", {
    schema: {
      response: { 200: PairingCodeResponseSchema, ...ErrorResponses },
    },
  }, async () => {
    if (!deps.vault.hasSecret(TELEGRAM_BOT_TOKEN_KEY)) {
      throw new AppError(400, "TELEGRAM_TOKEN_MISSING", "Chưa lưu token bot Telegram.");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
    savePairingCode(deps.sqlite, { code, expiresAt });
    const settings = getNotificationSettings(deps.sqlite);
    const botUsername = settings.telegram.botUsername;
    return {
      code,
      expiresAt,
      botUsername,
      startCommand: `/start ${code}`,
    };
  });

  app.post("/api/notifications/test", {
    schema: {
      response: { 200: TestResponseSchema, ...ErrorResponses },
    },
  }, async () => deps.notifications.sendTest());

  app.get("/api/notifications/log", {
    schema: {
      response: { 200: NotificationLogListSchema, ...ErrorResponses },
    },
  }, async () => ({ items: deps.notifications.listLog(100) }));
}
