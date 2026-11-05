import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import {
  ALWAYS_CONFIRM_TOOLS,
  ASSISTANT_TOOLS,
  getToolCatalogForPrompt,
} from "../src/assistant/tools.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import {
  clearAssistantChatScript,
  setAssistantChatScript,
} from "../src/providers/llm/mock.js";
import * as structuredLlm from "../src/providers/llm/structured.js";
import { getAutomationPaused, setAutomationPaused } from "../src/services/automationSettings.js";
import { getNotificationSettings, saveNotificationSettings } from "../src/settings/notifications.js";

const root = mkdtempSync(join(tmpdir(), "vg-assistant-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function sqlite(): Database.Database {
  return (app.vgPublish.service as unknown as { sqlite: Database.Database }).sqlite;
}

function seedCooldown(db: Database.Database): void {
  db.prepare("DELETE FROM llm_cooldowns WHERE provider = 'mock' AND model = 'demo'").run();
  db.prepare(
    "INSERT INTO llm_cooldowns (provider, model, until, reason, set_at) VALUES ('mock', 'demo', '2099-01-01T00:00:00.000Z', 'test', '2026-01-01T00:00:00.000Z')",
  ).run();
}

function cooldownCount(db: Database.Database): number {
  return (db.prepare(
    "SELECT COUNT(*) AS n FROM llm_cooldowns WHERE provider = 'mock' AND model = 'demo'",
  ).get() as { n: number }).n;
}

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "assistant.db"),
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
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/getMe")) {
      return jsonResponse({ ok: true, result: { id: 1, username: "vg_test_bot", first_name: "VG" } });
    }
    if (url.includes("/sendMessage") || url.includes("/sendChatAction") || url.includes("/answerCallbackQuery")) {
      return jsonResponse({ ok: true, result: { message_id: 1 } });
    }
    if (url.includes("/editMessageReplyMarkup")) {
      return jsonResponse({ ok: true, result: true });
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
  clearAssistantChatScript();
  vi.restoreAllMocks();
  await app.close();
  vi.unstubAllGlobals();
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore Windows cleanup races
  }
});

async function createConversation(title?: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/assistant/conversations",
    payload: title ? { title } : {},
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

async function createProject(topic?: string, profileId?: string): Promise<Project> {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      topic: topic ?? `Dự án ${randomUUID().slice(0, 8)}`,
      mode: "ASSISTED",
      ...(profileId ? { profileId } : {}),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Project>();
}

async function sendAssistantMessage(conversationId: string, text: string) {
  return app.inject({
    method: "POST",
    url: `/api/assistant/conversations/${conversationId}/messages`,
    payload: { text },
  });
}

async function configureTelegram(chatId: string) {
  await app.inject({
    method: "PUT",
    url: "/api/notifications/telegram/token",
    payload: { token: "123456:ABC-DEF_secret_token" },
  });
  const current = getNotificationSettings(sqlite());
  saveNotificationSettings(sqlite(), {
    ...current,
    telegram: { enabled: true, chatId, botUsername: "vg_test_bot" },
  });
}

describe("assistant API — mock LLM loop", () => {
  it("read tool result feeds the next step and final reply arrives", async () => {
    setAssistantChatScript([
      {
        reply: "",
        done: false,
        calls: [{ tool: "list_profiles", args: {} }],
      },
      {
        reply: "Đã xem xong danh sách hồ sơ.",
        done: true,
      },
    ]);
    const conversationId = await createConversation();
    const res = await sendAssistantMessage(conversationId, "Liệt kê hồ sơ giúp tôi");
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      messages: Array<{ role: string; content: { text?: string; toolActivity?: Array<{ tool: string }> } }>;
      pendingActions: unknown[];
    }>();
    const assistant = body.messages.filter((m) => m.role === "assistant").pop();
    expect(assistant?.content.text).toContain("Đã xem xong danh sách hồ sơ");
    expect(body.messages.some((m) => m.role === "tool")).toBe(true);
    expect(assistant?.content.toolActivity?.some((a) => a.tool === "list_profiles")).toBe(true);
    expect(body.pendingActions).toHaveLength(0);
  });

  it("ambiguous request returns clarify with options and nothing runs", async () => {
    setAssistantChatScript([
      {
        reply: "",
        done: false,
        clarify: {
          question: "Bạn muốn chỉnh hồ sơ nào?",
          options: ["Hồ sơ A", "Hồ sơ B"],
        },
      },
    ]);
    const conversationId = await createConversation();
    const res = await sendAssistantMessage(conversationId, "Đổi hướng nội dung");
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      messages: Array<{ role: string; content: { clarify?: { question: string; options?: string[] } } }>;
      pendingActions: unknown[];
    }>();
    const assistant = body.messages.filter((m) => m.role === "assistant").pop();
    expect(assistant?.content.clarify?.question).toMatch(/hồ sơ/i);
    expect(assistant?.content.clarify?.options).toEqual(["Hồ sơ A", "Hồ sơ B"]);
    expect(body.pendingActions).toHaveLength(0);

    const listed = await app.inject({
      method: "GET",
      url: `/api/assistant/conversations/${conversationId}/messages`,
    });
    expect(listed.json<{ pendingActions: unknown[] }>().pendingActions).toHaveLength(0);
  });

  it("confirm tool creates pending; confirm runs once; double confirm is no-op; reject works", async () => {
    setAutomationPausedViaApi(true);
    setAssistantChatScript([
      {
        reply: "Cần xác nhận bật lại tự động.",
        done: false,
        calls: [{ tool: "resume_automation_all", args: {} }],
      },
    ]);
    const conversationId = await createConversation();
    const send = await sendAssistantMessage(conversationId, "Bật lại tự động");
    expect(send.statusCode).toBe(200);
    const pending = send.json<{ pendingActions: Array<{ id: string; tool: string; status: string }> }>()
      .pendingActions;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.tool).toBe("resume_automation_all");
    expect(getAutomationPaused(sqlite())).toBe(true);

    const confirm1 = await app.inject({
      method: "POST",
      url: `/api/assistant/actions/${pending[0]!.id}/confirm`,
    });
    expect(confirm1.statusCode).toBe(200);
    expect(getAutomationPaused(sqlite())).toBe(false);
    expect(confirm1.json<{ action: { status: string } }>().action.status).toBe("confirmed");

    const confirm2 = await app.inject({
      method: "POST",
      url: `/api/assistant/actions/${pending[0]!.id}/confirm`,
    });
    expect(confirm2.statusCode).toBe(200);
    expect(confirm2.json<{ action: { status: string } }>().action.status).toBe("confirmed");
    expect(getAutomationPaused(sqlite())).toBe(false);

    // Reject path on a fresh pending action
    setAutomationPausedViaApi(true);
    setAssistantChatScript([
      {
        reply: "",
        done: false,
        calls: [{ tool: "resume_automation_all", args: {} }],
      },
    ]);
    const send2 = await sendAssistantMessage(conversationId, "Thử lại");
    const pending2 = send2.json<{ pendingActions: Array<{ id: string }> }>().pendingActions;
    expect(pending2).toHaveLength(1);
    const reject = await app.inject({
      method: "POST",
      url: `/api/assistant/actions/${pending2[0]!.id}/reject`,
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json<{ action: { status: string } }>().action.status).toBe("rejected");
    expect(getAutomationPaused(sqlite())).toBe(true);
  });

  it("expired pending action cannot run", async () => {
    setAssistantChatScript([
      {
        reply: "",
        done: false,
        calls: [{ tool: "resume_automation_all", args: {} }],
      },
    ]);
    const conversationId = await createConversation();
    const send = await sendAssistantMessage(conversationId, "Bật lại");
    const actionId = send.json<{ pendingActions: Array<{ id: string }> }>().pendingActions[0]!.id;
    sqlite().prepare(
      "UPDATE assistant_pending_actions SET expires_at = ? WHERE id = ?",
    ).run("2020-01-01T00:00:00.000Z", actionId);

    const confirm = await app.inject({
      method: "POST",
      url: `/api/assistant/actions/${actionId}/confirm`,
    });
    expect(confirm.statusCode).toBe(409);
    expect(confirm.json<{ error: { code: string; message: string } }>().error.code).toBe("ACTION_EXPIRED");
    expect(confirm.json<{ error: { message: string } }>().error.message).toMatch(/hết hạn/i);
  });

  it("confirmMode auto and autoConfirm run confirm tools immediately; delete still waits", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/assistant/settings",
      payload: { confirmMode: "auto" },
    });
    seedCooldown(sqlite());

    setAssistantChatScript([
      {
        reply: "Đã xoá chờ.",
        done: true,
        calls: [{ tool: "clear_llm_cooldown", args: { provider: "mock", model: "demo" } }],
      },
    ]);
    const conversationId = await createConversation();
    const autoRes = await sendAssistantMessage(conversationId, "Làm luôn");
    expect(autoRes.statusCode).toBe(200);
    expect(autoRes.json<{ pendingActions: unknown[] }>().pendingActions).toHaveLength(0);
    expect(cooldownCount(sqlite())).toBe(0);

    seedCooldown(sqlite());
    setAssistantChatScript([
      {
        reply: "",
        done: true,
        autoConfirm: true,
        calls: [{ tool: "clear_llm_cooldown", args: { provider: "mock", model: "demo" } }],
      },
    ]);
    const autoConfirmRes = await sendAssistantMessage(conversationId, "Tự động hết");
    expect(autoConfirmRes.statusCode).toBe(200);
    expect(autoConfirmRes.json<{ pendingActions: unknown[] }>().pendingActions).toHaveLength(0);
    expect(cooldownCount(sqlite())).toBe(0);

    setAutomationPausedViaApi(true);
    setAssistantChatScript([
      {
        reply: "Cần duyệt bật tự động.",
        done: false,
        autoConfirm: true,
        calls: [{ tool: "resume_automation_all", args: {} }],
      },
    ]);
    const resumeRes = await sendAssistantMessage(conversationId, "Tự động hết");
    expect(resumeRes.json<{ pendingActions: Array<{ tool: string }> }>().pendingActions[0]?.tool).toBe("resume_automation_all");
    expect(getAutomationPaused(sqlite())).toBe(true);

    const project = await createProject();
    setAssistantChatScript([
      {
        reply: "Cần xác nhận xóa.",
        done: false,
        autoConfirm: true,
        calls: [{ tool: "delete_project", args: { projectId: project.id } }],
      },
    ]);
    const deleteRes = await sendAssistantMessage(conversationId, "Xóa dự án luôn");
    expect(deleteRes.statusCode).toBe(200);
    const delPending = deleteRes.json<{ pendingActions: Array<{ tool: string }> }>().pendingActions;
    expect(delPending).toHaveLength(1);
    expect(delPending[0]?.tool).toBe("delete_project");

    const stillThere = await app.inject({ method: "GET", url: `/api/projects/${project.id}` });
    expect(stillThere.statusCode).toBe(200);
  });

  it("autoConfirm from the LLM only counts when the user's message asks for it", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/assistant/settings",
      payload: { confirmMode: "risky" },
    });
    const step = {
      reply: "",
      done: true,
      autoConfirm: true,
      calls: [{ tool: "clear_llm_cooldown", args: { provider: "mock", model: "demo" } }],
    };
    const conversationId = await createConversation();

    seedCooldown(sqlite());
    setAssistantChatScript([step]);
    const asked = await sendAssistantMessage(conversationId, "Xoá thời gian chờ giúp tôi");
    expect(asked.statusCode).toBe(200);
    expect(asked.json<{ pendingActions: unknown[] }>().pendingActions).toHaveLength(1);
    expect(cooldownCount(sqlite())).toBe(1);

    setAssistantChatScript([step]);
    const allowed = await sendAssistantMessage(conversationId, "Xoá chờ, tự động hết không cần hỏi");
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ pendingActions: unknown[] }>().pendingActions).toHaveLength(0);
    expect(cooldownCount(sqlite())).toBe(0);
  });

  it("invalid tool or args retried once then error; step limit is 6", async () => {
    setAssistantChatScript([
      { reply: "", done: false, calls: [{ tool: "not_real_tool", args: {} }] },
      { reply: "", done: false, calls: [{ tool: "not_real_tool", args: {} }] },
    ]);
    const conversationId = await createConversation();
    const badTool = await sendAssistantMessage(conversationId, "Gọi công cụ lạ");
    expect(badTool.statusCode).toBe(200);
    expect(badTool.json<{ messages: Array<{ content: { text?: string } }> }>().messages
      .filter((m) => m.content.text?.includes("Không thực hiện được"))
      .length).toBeGreaterThan(0);

    setAssistantChatScript([
      {
        reply: "",
        done: false,
        calls: [{ tool: "update_profile_direction", args: { direction: "mới" } }],
      },
      {
        reply: "",
        done: false,
        calls: [{ tool: "update_profile_direction", args: { direction: "mới" } }],
      },
    ]);
    const badArgs = await sendAssistantMessage(conversationId, "Sửa hướng");
    expect(badArgs.statusCode).toBe(200);
    const assistantText = badArgs.json<{ messages: Array<{ role: string; content: { text?: string } }> }>()
      .messages.filter((m) => m.role === "assistant").pop()?.content.text ?? "";
    expect(assistantText).toMatch(/Không thực hiện được.*tham số/i);

    setAssistantChatScript(Array.from({ length: 8 }, (_, i) => ({
      reply: `Bước ${i + 1}`,
      done: false,
    })));
    const originalLoop = structuredLlm.generateRoutedStructured.bind(structuredLlm);
    let llmCalls = 0;
    vi.spyOn(structuredLlm, "generateRoutedStructured").mockImplementation(async (input) => {
      llmCalls += 1;
      return originalLoop(input);
    });
    await sendAssistantMessage(conversationId, "Lặp nhiều bước");
    expect(llmCalls).toBe(6);
  });

  it("tool catalog has no credential or token tools", () => {
    const catalog = getToolCatalogForPrompt();
    const secretPattern = /token|credential|oauth|secret/i;
    for (const entry of catalog) {
      expect(entry.name).not.toMatch(secretPattern);
      expect(entry.description).not.toMatch(/oauth|token thật/i);
    }
    for (const name of Object.keys(ASSISTANT_TOOLS)) {
      expect(name).not.toMatch(secretPattern);
      expect(ALWAYS_CONFIRM_TOOLS.has(name)).toBe(name === "delete_project" || name === "delete_topic");
    }
    expect(catalog.length).toBeGreaterThan(10);
  });

  it("tool catalog uses compact arg signatures", () => {
    const catalog = getToolCatalogForPrompt();
    const text = JSON.stringify(catalog);
    expect(text).not.toContain("$schema");
    expect(text.length).toBeLessThan(12_000);
    const deleteProject = catalog.find((entry) => entry.name === "delete_project");
    expect(deleteProject?.args).toHaveProperty("projectId", "string");
  });

  it("returns 409 when a second message arrives while one is in flight", async () => {
    setAssistantChatScript([{ reply: "Xong.", done: true }]);
    const conversationId = await createConversation();

    const original = structuredLlm.generateRoutedStructured.bind(structuredLlm);
    let delayed = false;
    vi.spyOn(structuredLlm, "generateRoutedStructured").mockImplementation(async (input) => {
      if (!delayed) {
        delayed = true;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return original(input);
    });

    const first = sendAssistantMessage(conversationId, "Tin 1");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await sendAssistantMessage(conversationId, "Tin 2");
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe("ASSISTANT_BUSY");

    const firstRes = await first;
    expect(firstRes.statusCode).toBe(200);
  });
});

describe("assistant Telegram bridge", () => {
  function trackTelegramSent() {
    const sent: Array<{ chatId: string; text: string; body?: unknown }> = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: string | number; text: string };
        sent.push({ chatId: String(body.chat_id), text: body.text, body });
        return jsonResponse({ ok: true, result: { message_id: sent.length } });
      }
      if (url.includes("/sendChatAction") || url.includes("/answerCallbackQuery") || url.includes("/editMessageReplyMarkup")) {
        return jsonResponse({ ok: true, result: true });
      }
      if (url.includes("/getUpdates")) {
        return jsonResponse({ ok: true, result: [] });
      }
      if (url.includes("/getMe")) {
        return jsonResponse({ ok: true, result: { id: 1, username: "vg_test_bot" } });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    return sent;
  }

  it("paired chat message reaches assistant; other chats are ignored", async () => {
    await configureTelegram("42");
    const sent = trackTelegramSent();
    setAssistantChatScript([{ reply: "Phản hồi TG đặc biệt", done: true }]);

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 1,
            message: { message_id: 1, text: "/tl Xin chào trợ lý", chat: { id: 42, type: "private" } },
          }],
        });
      }
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: string | number; text: string };
        sent.push({ chatId: String(body.chat_id), text: body.text });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      if (url.includes("/sendChatAction")) return jsonResponse({ ok: true, result: true });
      return jsonResponse({ ok: true, result: {} });
    });

    await app.vgNotifications.poller.pollOnce();
    expect(sent.some((s) => s.text.includes("Phản hồi TG đặc biệt"))).toBe(true);

    const before = sent.length;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 2,
            message: { message_id: 2, text: "hello stranger", chat: { id: 99, type: "private" } },
          }],
        });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    await app.vgNotifications.poller.pollOnce();
    expect(sent).toHaveLength(before);
  });

  it("callback confirm works for paired chat and ignores unpaired chat", async () => {
    await configureTelegram("42");
    const sent = trackTelegramSent();
    setAutomationPausedViaApi(true);

    const conversation = app.vgAssistant.service.getOrCreateTelegramConversation();
    setAssistantChatScript([
      {
        reply: "",
        done: false,
        calls: [{ tool: "resume_automation_all", args: {} }],
      },
    ]);
    await app.vgAssistant.service.sendMessage(conversation.id, "Bật lại");
    const pending = sqlite().prepare(
      "SELECT id FROM assistant_pending_actions WHERE conversation_id = ? AND status = 'pending'",
    ).get(conversation.id) as { id: string };
    expect(pending?.id).toBeTruthy();
    expect(getAutomationPaused(sqlite())).toBe(true);

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 10,
            callback_query: {
              id: "cq1",
              data: `pa:${pending.id}:y`,
              message: { message_id: 5, chat: { id: 99, type: "private" } },
            },
          }],
        });
      }
      if (url.includes("/answerCallbackQuery") || url.includes("/sendMessage") || url.includes("/editMessageReplyMarkup")) {
        if (url.includes("/sendMessage")) {
          const body = JSON.parse(String(init?.body)) as { text: string };
          sent.push({ chatId: "99", text: body.text });
        }
        return jsonResponse({ ok: true, result: true });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    await app.vgNotifications.poller.pollOnce();
    expect(getAutomationPaused(sqlite())).toBe(true);

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 11,
            callback_query: {
              id: "cq2",
              data: `pa:${pending.id}:y`,
              message: { message_id: 6, chat: { id: 42, type: "private" } },
            },
          }],
        });
      }
      if (url.includes("/answerCallbackQuery") || url.includes("/sendMessage") || url.includes("/editMessageReplyMarkup")) {
        if (url.includes("/sendMessage")) {
          const body = JSON.parse(String(init?.body)) as { text: string };
          sent.push({ chatId: "42", text: body.text });
        }
        return jsonResponse({ ok: true, result: true });
      }
      return jsonResponse({ ok: true, result: {} });
    });
    await app.vgNotifications.poller.pollOnce();
    expect(getAutomationPaused(sqlite())).toBe(false);
    expect(sent.some((s) => s.text.includes("Đã xác nhận"))).toBe(true);
  });

  it("/pause triggers kill switch without consuming assistant LLM script", async () => {
    await configureTelegram("42");
    const sent = trackTelegramSent();
    setAssistantChatScript([{ reply: "LLM không được gọi", done: true }]);

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [{
            update_id: 20,
            message: { message_id: 3, text: "/pause", chat: { id: 42, type: "private" } },
          }],
        });
      }
      if (url.includes("/sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { text: string };
        sent.push({ chatId: "42", text: body.text });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      return jsonResponse({ ok: true, result: {} });
    });

    expect(getAutomationPaused(sqlite())).toBe(false);
    await app.vgNotifications.poller.pollOnce();
    expect(getAutomationPaused(sqlite())).toBe(true);
    expect(sent.some((s) => s.text.includes("tạm dừng"))).toBe(true);
    setAssistantChatScript([{ reply: "LLM không được gọi", done: true }]);
  });
});

function setAutomationPausedViaApi(paused: boolean) {
  setAutomationPaused(sqlite(), paused);
  expect(getAutomationPaused(sqlite())).toBe(paused);
}
