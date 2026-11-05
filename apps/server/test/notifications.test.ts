import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationSettingsStatus, PairingCodeResponse } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { NotificationService } from "../src/notifications/notificationService.js";
import {
  escapeHtml,
  maskTelegramSecret,
  splitTelegramMessage,
  TelegramClient,
  TelegramPoller,
} from "../src/notifications/telegram.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import {
  getNotificationSettings,
  getPairingCode,
  getTelegramUpdateOffset,
  saveNotificationSettings,
  savePairingCode,
  TELEGRAM_BOT_TOKEN_KEY,
} from "../src/settings/notifications.js";

const root = mkdtempSync(join(tmpdir(), "vg-notify-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "notify.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    WEB_BASE_URL: "http://localhost:5180",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
});

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/getMe")) {
      return jsonResponse({ ok: true, result: { id: 1, username: "vg_test_bot", first_name: "VG" } });
    }
    if (url.includes("/sendMessage")) {
      return jsonResponse({ ok: true, result: { message_id: 1 } });
    }
    if (url.includes("/getUpdates")) {
      return jsonResponse({ ok: true, result: [] });
    }
    return jsonResponse({ ok: false, description: "unexpected" }, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);

  const dataDir = join(root, `data-${randomUUID()}`);
  config = {
    ...config,
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
  };
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows may still hold a DB handle briefly; ignore cleanup races.
  }
});

describe("notifications API + vault", () => {
  it("stores token encrypted and never returns it", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/notifications/telegram/token",
      payload: { token: "123456:ABC-DEF_secret_token" },
    });
    expect(put.statusCode).toBe(200);
    const status = put.json<NotificationSettingsStatus>();
    expect(status.tokenConfigured).toBe(true);
    expect(status.telegram.botUsername).toBe("vg_test_bot");
    expect(JSON.stringify(status)).not.toContain("ABC-DEF_secret_token");
    expect(JSON.stringify(status)).not.toContain("123456:");

    const get = await app.inject({ method: "GET", url: "/api/notifications/settings" });
    expect(get.statusCode).toBe(200);
    expect(JSON.stringify(get.json())).not.toContain("ABC-DEF_secret_token");

    const loaded = app.vgPublish.vault.loadSecret(TELEGRAM_BOT_TOKEN_KEY);
    expect(loaded).toBe("123456:ABC-DEF_secret_token");
  });

  it("rejects invalid token with Vietnamese 400", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ ok: false, description: "Unauthorized" }, { status: 401 }));
    const put = await app.inject({
      method: "PUT",
      url: "/api/notifications/telegram/token",
      payload: { token: "bad-token-value" },
    });
    expect(put.statusCode).toBe(400);
    const body = put.json<{ error: { message: string } }>();
    expect(body.error.message).toMatch(/Token Telegram không hợp lệ/);
    expect(body.error.message).not.toContain("bad-token-value");
  });

  it("saves settings toggles and lists log", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/notifications/settings",
      payload: {
        telegram: { enabled: true, chatId: null, botUsername: null },
        events: {
          attention: true,
          published: false,
          waitingApproval: true,
          dailySummary: false,
        },
        dailySummaryTime: "20:30",
        timezone: "Asia/Ho_Chi_Minh",
        quietHours: { from: "22:00", to: "07:00" },
      },
    });
    expect(put.statusCode).toBe(200);
    const status = put.json<NotificationSettingsStatus>();
    expect(status.events.published).toBe(false);
    expect(status.dailySummaryTime).toBe("20:30");
    expect(status.quietHours).toEqual({ from: "22:00", to: "07:00" });

    const log = await app.inject({ method: "GET", url: "/api/notifications/log" });
    expect(log.statusCode).toBe(200);
    expect(log.json()).toEqual({ items: [] });
  });

  it("creates a 6-digit pairing code", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/notifications/telegram/token",
      payload: { token: "123456:ABC-DEF_secret_token" },
    });
    const pair = await app.inject({ method: "POST", url: "/api/notifications/telegram/pair" });
    expect(pair.statusCode).toBe(200);
    const body = pair.json<PairingCodeResponse>();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.startCommand).toBe(`/start ${body.code}`);
    expect(body.botUsername).toBe("vg_test_bot");
  });
});

describe("TelegramClient helpers", () => {
  it("escapes HTML and splits long messages", () => {
    expect(escapeHtml("a <b> & c >")).toBe("a &lt;b&gt; &amp; c &gt;");
    const parts = splitTelegramMessage("x".repeat(8500), 4000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4000)).toBe(true);
  });

  it("masks token in error text and retries once on 429", async () => {
    const token = "999:SECRETTOKEN";
    expect(maskTelegramSecret(`fail bot${token}/sendMessage`, token)).not.toContain("SECRETTOKEN");

    let calls = 0;
    const client = new TelegramClient(token, async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { ok: false, description: "Too Many Requests", parameters: { retry_after: 0 } },
          { status: 429, headers: { "retry-after": "0" } },
        );
      }
      return jsonResponse({ ok: true, result: { id: 1, username: "x", first_name: "y" } });
    });
    const me = await client.getMe();
    expect(me.username).toBe("x");
    expect(calls).toBe(2);
  });
});

describe("Telegram pairing + poller", () => {
  function makeHarness(nowMs: number) {
    const dataDir = join(root, `poll-${randomUUID()}`);
    const database = openDatabase(join(dataDir, "app.db"));
    migrateDatabase(database.db, { info() {}, warn() {}, error() {} } as never, database.sqlite);
    const vault = new TokenVault(database.sqlite, dataDir, Buffer.alloc(32, 3).toString("base64"));
    vault.storeSecret(TELEGRAM_BOT_TOKEN_KEY, "111:tok");
    saveNotificationSettings(database.sqlite, {
      ...getNotificationSettings(database.sqlite),
      telegram: { enabled: true, chatId: null, botUsername: "bot" },
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const sent: Array<{ chatId: string; text: string }> = [];
    const localFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
        sent.push({ chatId: String(body.chat_id), text: body.text });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      if (url.includes("/getUpdates")) {
        return jsonResponse({ ok: true, result: [] });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    const poller = new TelegramPoller({
      sqlite: database.sqlite,
      vault,
      logger: logger as never,
      fetchImpl: localFetch as never,
      now: () => new Date(nowMs),
      workerEnabled: false,
      sleep: async () => undefined,
    });
    poller.installDefaultHandlers();
    return { database, vault, poller, sent, localFetch, logger, dataDir };
  }

  it("pairs with the right code and ignores wrong/expired/unpaired", async () => {
    const now = Date.parse("2026-11-05T10:00:00.000Z");
    const h = makeHarness(now);
    savePairingCode(h.database.sqlite, {
      code: "123456",
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    });

    // Wrong code — no reply
    h.localFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 1,
            message: {
              message_id: 1,
              text: "/start 000000",
              chat: { id: 42, type: "private" },
            },
          }],
        });
      }
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
        h.sent.push({ chatId: String(body.chat_id), text: body.text });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    await h.poller.pollOnce();
    expect(h.sent).toHaveLength(0);
    expect(getNotificationSettings(h.database.sqlite).telegram.chatId).toBeNull();

    // Correct code — pairs
    h.localFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 2,
            message: {
              message_id: 2,
              text: "/start 123456",
              chat: { id: 42, type: "private" },
            },
          }],
        });
      }
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
        h.sent.push({ chatId: String(body.chat_id), text: body.text });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    await h.poller.pollOnce();
    expect(getNotificationSettings(h.database.sqlite).telegram.chatId).toBe("42");
    expect(h.sent.some((s) => s.text.includes("Đã ghép nối"))).toBe(true);

    // Unpaired other chat — ignored, no reply
    const before = h.sent.length;
    h.localFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 3,
            message: {
              message_id: 3,
              text: "hello",
              chat: { id: 99, type: "private" },
            },
          }],
        });
      }
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
        h.sent.push({ chatId: String(body.chat_id), text: body.text });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    await h.poller.pollOnce();
    expect(h.sent).toHaveLength(before);
    expect(h.logger.debug).toHaveBeenCalled();

    h.database.sqlite.close();
    rmSync(h.dataDir, { recursive: true, force: true });
  });

  it("pairs while Telegram is still disabled, and skips polling with no active code", async () => {
    const now = Date.parse("2026-11-05T10:00:00.000Z");
    const h = makeHarness(now);
    saveNotificationSettings(h.database.sqlite, {
      ...getNotificationSettings(h.database.sqlite),
      telegram: { enabled: false, chatId: null, botUsername: "bot" },
    });

    // Disabled and no pairing code: no getUpdates call.
    await h.poller.pollOnce();
    expect(h.localFetch.mock.calls.some(([u]) => String(u).includes("/getUpdates"))).toBe(false);

    savePairingCode(h.database.sqlite, {
      code: "654321",
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    });
    h.localFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 7,
            message: { message_id: 7, text: "/start 654321", chat: { id: 77, type: "private" } },
          }],
        });
      }
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
        h.sent.push({ chatId: String(body.chat_id), text: body.text });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    await h.poller.pollOnce();
    const settings = getNotificationSettings(h.database.sqlite);
    expect(settings.telegram.chatId).toBe("77");
    expect(settings.telegram.enabled).toBe(true);

    h.database.sqlite.close();
    rmSync(h.dataDir, { recursive: true, force: true });
  });

  it("invalidates the pairing code after too many wrong attempts", async () => {
    const now = Date.parse("2026-11-05T10:00:00.000Z");
    const h = makeHarness(now);
    savePairingCode(h.database.sqlite, {
      code: "123456",
      expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    });
    let updateId = 100;
    h.localFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        updateId += 1;
        return jsonResponse({
          ok: true,
          result: [{
            update_id: updateId,
            message: { message_id: updateId, text: `/start ${String(updateId).padStart(6, "0")}`, chat: { id: 77, type: "private" } },
          }],
        });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    for (let i = 0; i < 4; i += 1) await h.poller.pollOnce();
    expect(getPairingCode(h.database.sqlite)?.code).toBe("123456");
    await h.poller.pollOnce();
    expect(getPairingCode(h.database.sqlite)).toBeNull();
    expect(getNotificationSettings(h.database.sqlite).telegram.chatId).toBeNull();
  });

  it("persists update offset across polls", async () => {
    const now = Date.now();
    const h = makeHarness(now);
    saveNotificationSettings(h.database.sqlite, {
      ...getNotificationSettings(h.database.sqlite),
      telegram: { enabled: true, chatId: "42", botUsername: "bot" },
    });
    let requestedOffset: number | undefined;
    h.localFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        // body has offset
        return jsonResponse({
          ok: true,
          result: [{ update_id: 10, message: { message_id: 1, text: "/help", chat: { id: 42, type: "private" } } }],
        });
      }
      if (url.includes("/sendMessage")) return jsonResponse({ ok: true, result: { message_id: 1 } });
      return jsonResponse({ ok: true, result: {} });
    });
    // Intercept body for offset via mockImplementation that reads init
    h.localFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        const body = JSON.parse(String(init?.body)) as { offset: number };
        requestedOffset = body.offset;
        return jsonResponse({
          ok: true,
          result: [{ update_id: 10, message: { message_id: 1, text: "/help", chat: { id: 42, type: "private" } } }],
        });
      }
      if (url.includes("/sendMessage")) return jsonResponse({ ok: true, result: { message_id: 1 } });
      return jsonResponse({ ok: true, result: {} });
    });
    await h.poller.pollOnce();
    expect(getTelegramUpdateOffset(h.database.sqlite)).toBe(11);
    expect(requestedOffset).toBe(0);

    await h.poller.pollOnce();
    expect(requestedOffset).toBe(11);

    h.database.sqlite.close();
    rmSync(h.dataDir, { recursive: true, force: true });
  });
});

describe("NotificationService", () => {
  function makeService(opts: {
    now: () => Date;
    enabled?: boolean;
    chatId?: string | null;
    events?: Partial<ReturnType<typeof getNotificationSettings>["events"]>;
    quietHours?: { from: string; to: string } | null;
    fetchImpl?: typeof fetch;
  }) {
    const dataDir = join(root, `svc-${randomUUID()}`);
    const database = openDatabase(join(dataDir, "app.db"));
    migrateDatabase(database.db, { info() {}, warn() {}, error() {} } as never, database.sqlite);
    const vault = new TokenVault(database.sqlite, dataDir, Buffer.alloc(32, 9).toString("base64"));
    vault.storeSecret(TELEGRAM_BOT_TOKEN_KEY, "111:tok");
    saveNotificationSettings(database.sqlite, {
      telegram: {
        enabled: opts.enabled ?? true,
        chatId: opts.chatId === undefined ? "42" : opts.chatId,
        botUsername: "bot",
      },
      events: {
        attention: true,
        published: true,
        waitingApproval: true,
        dailySummary: true,
        ...opts.events,
      },
      dailySummaryTime: "21:00",
      timezone: "UTC",
      quietHours: opts.quietHours ?? null,
    });
    const sent: string[] = [];
    const fetchImpl = opts.fetchImpl ?? (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { text: string };
        sent.push(body.text);
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    const service = new NotificationService({
      sqlite: database.sqlite,
      vault,
      config: { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db"), WEB_BASE_URL: "http://localhost:5180" },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
      fetchImpl: fetchImpl as never,
      now: opts.now,
      sleep: async () => undefined,
    });
    return { service, database, vault, sent, dataDir };
  }

  it("respects toggles, dedups 6h, retries, never throws, logs skipped", async () => {
    const now = Date.parse("2026-11-05T12:00:00.000Z");
    const h = makeService({ now: () => new Date(now), events: { published: false } });
    await h.service.notify({
      kind: "publish_succeeded",
      publicationId: "pub-1",
      profile: "P",
      account: "A",
      platform: "youtube",
      title: "T",
      url: "https://example.com",
    });
    expect(h.sent).toHaveLength(0);
    // toggle off → no log either (early return)
    expect(h.service.listLog()).toHaveLength(0);

    // disabled → skipped
    const disabled = makeService({ now: () => new Date(now), enabled: false });
    await disabled.service.notify({
      kind: "stage_failed",
      projectId: "p1",
      project: "Proj",
      stage: "SCRIPT",
      error: "boom",
    });
    expect(disabled.sent).toHaveLength(0);
    expect(disabled.service.listLog()[0]?.status).toBe("skipped");

    // send + dedup
    let attempts = 0;
    const flakySent: string[] = [];
    const flaky = makeService({
      now: () => new Date(now),
      fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/sendMessage")) {
          attempts += 1;
          if (attempts < 2) throw new Error(`network fail bot111:tok`);
          const body = JSON.parse(String(init?.body)) as { text: string };
          flakySent.push(body.text);
          return jsonResponse({ ok: true, result: { message_id: 1 } });
        }
        return jsonResponse({ ok: true, result: {} });
      },
    });
    await flaky.service.notify({
      kind: "stage_failed",
      projectId: "p2",
      project: "Proj <x>",
      stage: "SCRIPT",
      error: "err",
    });
    expect(flakySent).toHaveLength(1);
    expect(flakySent[0]).toContain("&lt;x&gt;");
    expect(attempts).toBe(2);

    await flaky.service.notify({
      kind: "stage_failed",
      projectId: "p2",
      project: "Proj <x>",
      stage: "SCRIPT",
      error: "err",
    });
    expect(flakySent).toHaveLength(1); // deduped

    // never throws when telegram always fails
    const alwaysFail = makeService({
      now: () => new Date(now),
      fetchImpl: async () => {
        throw new Error("down");
      },
    });
    await expect(alwaysFail.service.notify({
      kind: "automation_paused",
    })).resolves.toBeUndefined();
    expect(alwaysFail.service.listLog()[0]?.status).toBe("failed");

    h.database.sqlite.close();
    disabled.database.sqlite.close();
    flaky.database.sqlite.close();
    alwaysFail.database.sqlite.close();
    rmSync(h.dataDir, { recursive: true, force: true });
    rmSync(disabled.dataDir, { recursive: true, force: true });
    rmSync(flaky.dataDir, { recursive: true, force: true });
    rmSync(alwaysFail.dataDir, { recursive: true, force: true });
  });

  it("holds published during quiet hours and sends daily summary once", async () => {
    // Quiet hours 12:00-14:00 UTC; now = 12:30
    let nowMs = Date.parse("2026-11-05T12:30:00.000Z");
    const h = makeService({
      now: () => new Date(nowMs),
      quietHours: { from: "12:00", to: "14:00" },
    });

    await h.service.notify({
      kind: "publish_succeeded",
      publicationId: "pub-q",
      profile: "P",
      account: "A",
      platform: "youtube",
      title: "T",
      url: "https://example.com",
    });
    expect(h.sent).toHaveLength(0);
    expect(h.service.listLog()[0]?.status).toBe("skipped");
    expect(h.service.listLog()[0]?.error).toBe("quiet_hours");

    // attention still sends during quiet hours
    await h.service.notify({
      kind: "automation_paused",
    });
    expect(h.sent.length).toBeGreaterThan(0);

    // leave quiet hours → flush
    nowMs = Date.parse("2026-11-05T14:05:00.000Z");
    await h.service.tick();
    expect(h.sent.some((t) => t.includes("Đã đăng"))).toBe(true);

    // daily summary at 21:00 UTC, once
    nowMs = Date.parse("2026-11-05T21:05:00.000Z");
    const before = h.sent.length;
    await h.service.tick();
    expect(h.sent.length).toBeGreaterThan(before);
    expect(h.sent.some((t) => t.includes("Tóm tắt ngày"))).toBe(true);
    const afterFirst = h.sent.length;
    await h.service.tick();
    expect(h.sent.length).toBe(afterFirst);

    h.database.sqlite.close();
    rmSync(h.dataDir, { recursive: true, force: true });
  });
});

describe("waiting_approval notify rules via orchestrator hooks", () => {
  it("sends waiting_approval for ASSISTED and attention for stuck AUTO", async () => {
    const dataDir = join(root, `orch-${randomUUID()}`);
    const database = openDatabase(join(dataDir, "app.db"));
    migrateDatabase(database.db, { info() {}, warn() {}, error() {} } as never, database.sqlite);
    const vault = new TokenVault(database.sqlite, dataDir, Buffer.alloc(32, 1).toString("base64"));
    vault.storeSecret(TELEGRAM_BOT_TOKEN_KEY, "111:tok");
    saveNotificationSettings(database.sqlite, {
      telegram: { enabled: true, chatId: "42", botUsername: "bot" },
      events: { attention: true, published: true, waitingApproval: true, dailySummary: true },
      dailySummaryTime: "21:00",
      timezone: "UTC",
      quietHours: null,
    });
    const sent: string[] = [];
    const service = new NotificationService({
      sqlite: database.sqlite,
      vault,
      config: { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") },
      logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } as never,
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { text: string };
        sent.push(body.text);
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }) as never,
      now: () => new Date("2026-11-05T12:00:00.000Z"),
      sleep: async () => undefined,
    });

    await service.notify({
      kind: "waiting_approval",
      projectId: "p-assisted",
      project: "Assisted",
      gate: "SCRIPT_APPROVAL",
      link: "http://localhost:5180/projects/p-assisted",
    });
    expect(sent.some((t) => t.includes("Chờ duyệt"))).toBe(true);

    await service.notify({
      kind: "waiting_approval",
      projectId: "p-auto",
      project: "Auto",
      gate: "SCRIPT_APPROVAL",
      link: "http://localhost:5180/projects/p-auto",
      unexpectedAutoStop: true,
    });
    expect(sent.some((t) => t.includes("Dự án tự động bị dừng"))).toBe(true);

    // waitingApproval toggle off → no approval message (attention still ok for unexpected)
    saveNotificationSettings(database.sqlite, {
      ...getNotificationSettings(database.sqlite),
      events: { attention: true, published: true, waitingApproval: false, dailySummary: true },
    });
    const before = sent.length;
    await service.notify({
      kind: "waiting_approval",
      projectId: "p-assisted-2",
      project: "Assisted2",
      gate: "SCRIPT_APPROVAL",
      link: "http://localhost:5180/projects/p-assisted-2",
    });
    expect(sent.length).toBe(before);

    database.sqlite.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
});

describe("publish success/failure notifications", () => {
  it("sends one message on publish success and final failure only", async () => {
    const sentBodies: string[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getMe")) {
        return jsonResponse({ ok: true, result: { id: 1, username: "bot", first_name: "b" } });
      }
      if (url.includes("/sendMessage")) {
        sentBodies.push(String(init?.body));
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      return jsonResponse({ ok: true, result: {} });
    });

    await app.inject({
      method: "PUT",
      url: "/api/notifications/telegram/token",
      payload: { token: "123:tok" },
    });
    await app.inject({
      method: "PUT",
      url: "/api/notifications/settings",
      payload: {
        telegram: { enabled: true, chatId: "99", botUsername: "bot" },
        events: { attention: true, published: true, waitingApproval: true, dailySummary: true },
        dailySummaryTime: "21:00",
        timezone: "UTC",
        quietHours: null,
      },
    });

    await app.vgNotifications.service.notify({
      kind: "publish_succeeded",
      publicationId: "pub-ok",
      profile: "P",
      account: "A",
      platform: "mock",
      title: "Video",
      url: "https://example.com/v",
    });
    await app.vgNotifications.service.notify({
      kind: "publish_failed",
      publicationId: "pub-fail",
      profile: "P",
      account: "A",
      platform: "mock",
      title: "Video",
      error: "final",
    });
    expect(sentBodies.filter((b) => b.includes("Đã đăng"))).toHaveLength(1);
    expect(sentBodies.filter((b) => b.includes("Đăng thất bại"))).toHaveLength(1);
  });
});
