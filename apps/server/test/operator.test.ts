import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_HINT_VI } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { scriptedProcess, type Spawned } from "../src/operator/runtime.js";
import { registerSeededStandingOrder } from "../src/operator/extensions.js";
import { getNotificationSettings, saveNotificationSettings } from "../src/settings/notifications.js";

const root = mkdtempSync(join(tmpdir(), "vg-operator-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
const spawned: string[][] = [];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

function arm(script: { stdout?: string[]; stderr?: string[]; hang?: boolean }) {
  spawned.length = 0;
  app.vgOperator.service.setSpawn((command, args) => {
    spawned.push([command, ...args]);
    return scriptedProcess(script)(command, args, { cwd: app.vgOperator.service.workspacePath() });
  });
}

beforeAll(() => {
  registerSeededStandingOrder({
    id: "seed-operator-test",
    title: "Việc mô-đun",
    prompt: "Không được tự chạy",
    cron: "* * * * *",
    enabled: false,
    moduleId: "test",
  });
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "operator.db"),
    PORT: "3011",
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
  app = buildApp({ config });
});

beforeEach(async () => {
  app.vgOperator.service.progressIntervalMs = 0;
  await app.inject({
    method: "PUT",
    url: "/api/operator/settings",
    payload: { cursorPath: "cursor-agent", killed: false, maxRunsPerDay: 30, tickCron: null, runTimeoutMs: 1000 },
  });
  arm({
    stdout: [
      JSON.stringify({ type: "system", subtype: "init", session_id: "chat-1" }),
      JSON.stringify({ type: "tool_use", name: "list_projects" }),
      JSON.stringify({ type: "result", result: "Xong việc" }),
    ],
  });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("operator runtime", () => {
  it("writes the workspace, runs one mocked CLI, and resumes the chat", async () => {
    const dir = app.vgOperator.service.workspacePath();
    const handbook = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(handbook).toContain("publish-project:");
    expect(handbook).not.toContain("Kiểm tra tài khoản đã kết nối trước khi tạo lượt đăng.");
    expect(readFileSync(join(dir, "skills", "dang-bai", "publish-project.md"), "utf8")).toContain(
      "Kiểm tra tài khoản đã kết nối trước khi tạo lượt đăng.",
    );
    const cli = JSON.parse(readFileSync(join(dir, ".cursor", "cli.json"), "utf8")) as {
      permissions: { deny: string[]; allow: string[] };
    };
    expect(cli.permissions.deny).toContain("Shell(*)");
    expect(cli.permissions.allow).toContain("Write(notes/**)");
    const mcp = readFileSync(join(dir, ".cursor", "mcp.json"), "utf8");
    expect(mcp).toContain("\"video-agent\"");
    expect(mcp).toContain("VG_TOOL_SOURCE");

    const conversationId = app.vgOperator.service.latestConversation("web");
    const first = await app.inject({
      method: "POST",
      url: `/api/operator/conversations/${conversationId}/messages`,
      payload: { text: "Kiểm tra dự án" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ message: string }>().message).toMatch(/Đã nhận/);
    await app.vgOperator.service.waitForIdle();
    expect(spawned[0]?.join(" ")).toContain("stream-json");
    expect(spawned[0]).not.toContain("--force");
    expect(spawned[0]).not.toContain("--yolo");
    const run = app.vgOperator.service.getRun(first.json<{ runId: string }>().runId);
    expect(run?.result).toContain("Xong việc");
    expect(run?.toolChips).toContain("list_projects");
    const logged = sqlite().prepare(
      "SELECT outcome FROM operator_routing_log WHERE run_id = ?",
    ).get(first.json<{ runId: string }>().runId) as { outcome: string };
    expect(logged.outcome).toBe("success");

    arm({
      stdout: [JSON.stringify({ type: "result", result: "Lượt hai" })],
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/operator/conversations/${conversationId}/messages`,
      payload: { text: "Tiếp tục" },
    });
    await app.vgOperator.service.waitForIdle();
    expect(spawned.at(-1)).toContain("--resume");
    expect(spawned.at(-1)).toContain("chat-1");

    await app.inject({
      method: "POST",
      url: `/api/operator/conversations/${conversationId}/new-session`,
    });
    arm({ stdout: [JSON.stringify({ type: "result", result: "Phiên mới" })] });
    await app.inject({
      method: "POST",
      url: `/api/operator/conversations/${conversationId}/messages`,
      payload: { text: "Bắt đầu lại" },
    });
    await app.vgOperator.service.waitForIdle();
    expect(spawned.at(-1)).not.toContain("--resume");
    expect(second.statusCode).toBe(200);
  });

  it("does not spawn when the kill switch is on and refuses the daily cap", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/operator/settings",
      payload: { killed: true },
    });
    let calls = 0;
    app.vgOperator.service.setSpawn(() => {
      calls += 1;
      throw new Error("không được spawn");
    });
    const off = app.vgOperator.service.submit({ prompt: "làm gì đó" });
    expect(off.status).toBe("refused");
    expect(off.message).toMatch(/tắt/);
    expect(calls).toBe(0);
    expect(app.vgOperator.service.wakeOperator("lý do", "prompt").status).toBe("refused");

    await app.inject({
      method: "PUT",
      url: "/api/operator/settings",
      payload: { killed: false, maxRunsPerDay: 1 },
    });
    arm({ stdout: [JSON.stringify({ type: "result", result: "một" })] });
    const conversationId = app.vgOperator.service.latestConversation("web");
    await app.inject({
      method: "POST",
      url: `/api/operator/conversations/${conversationId}/messages`,
      payload: { text: "Lượt trong hạn" },
    });
    await app.vgOperator.service.waitForIdle();
    const blocked = await app.inject({
      method: "POST",
      url: `/api/operator/conversations/${conversationId}/messages`,
      payload: { text: "Lượt vượt hạn" },
    });
    expect(blocked.json<{ message: string }>().message).toMatch(/hết số lượt/);
  });

  it("queues a second message, stops a hung run, and restores files outside notes", async () => {
    const conversationId = app.vgOperator.service.latestConversation("web");
    let calls = 0;
    let release: (() => void) | undefined;
    app.vgOperator.service.setSpawn((_command, _args, options) => {
      calls += 1;
      if (calls > 1) {
        return scriptedProcess({
          stdout: [JSON.stringify({ type: "result", result: "Xong hàng đợi" })],
        })(_command, _args, options);
      }
      writeFileSync(join(options.cwd, "evil.txt"), "no");
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const emitter = new EventEmitter();
      const child: Spawned = {
        stdout,
        stderr,
        kill: () => {
          emitter.emit("exit", null, "SIGTERM");
          return true;
        },
        on: (event, listener) => {
          emitter.on(event, listener);
        },
      };
      release = () => {
        stdout.write(`${JSON.stringify({ type: "result", result: "Xong việc lâu" })}\n`);
        stdout.end();
        emitter.emit("exit", 0, null);
      };
      return child;
    });
    const first = app.vgOperator.service.submit({ conversationId, prompt: "việc lâu" });
    const second = app.vgOperator.service.submit({ conversationId, prompt: "việc chờ" });
    expect(second.position).toBeGreaterThan(0);
    expect(second.message).toMatch(/Đang chờ/);
    release?.();
    await app.vgOperator.service.waitForIdle();
    expect(existsSync(join(app.vgOperator.service.workspacePath(), "evil.txt"))).toBe(false);
    expect(readFileSync(join(app.vgOperator.service.workspacePath(), "notes", "write-guard.md"), "utf8")).toContain("evil.txt");
    expect(first.runId).toBeTruthy();
  });

  it("stops on the login hint and on timeout", async () => {
    arm({ stderr: ["Please log in"], stdout: [] });
    const conversationId = app.vgOperator.service.latestConversation("web");
    const login = await app.inject({
      method: "POST",
      url: `/api/operator/conversations/${conversationId}/messages`,
      payload: { text: "đăng nhập chưa" },
    });
    await app.vgOperator.service.waitForIdle();
    expect(String(app.vgOperator.service.getRun(login.json<{ runId: string }>().runId)?.result)).toContain(LOGIN_HINT_VI);

    app.vgOperator.service.setSpawn(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const emitter = new EventEmitter();
      return {
        stdout,
        stderr,
        kill: () => {
          emitter.emit("exit", null, "SIGTERM");
          return true;
        },
        on: (event: string, listener: (...args: never[]) => void) => {
          emitter.on(event, listener);
        },
      };
    });
    const hung = app.vgOperator.service.submit({ conversationId, prompt: "treo" });
    await app.vgOperator.service.waitForIdle();
    expect(app.vgOperator.service.getRun(hung.runId)?.status).toBe("failed");
  });

  it("runs a due tick and an enabled standing order, and leaves seeded orders off", async () => {
    const orders = app.vgOperator.service.listOrders();
    expect(orders.some((order) => order.id === "seed-operator-test" && order.enabled === false)).toBe(true);
    await app.inject({
      method: "POST",
      url: "/api/operator/orders",
      payload: { title: "Kênh A", prompt: "Làm 3 video kênh A", cron: "* * * * *", enabled: true },
    });
    await app.inject({
      method: "PUT",
      url: "/api/operator/settings",
      payload: { tickCron: "* * * * *" },
    });
    arm({ stdout: [JSON.stringify({ type: "result", result: "Đã kiểm tra" })] });
    const started = app.vgOperator.service.tick(new Date());
    expect(started.started.length).toBeGreaterThanOrEqual(2);
    await app.vgOperator.service.waitForIdle();
    const again = app.vgOperator.service.tick(new Date());
    expect(again.started).toEqual([]);
  });
});

describe("operator telegram", () => {
  const sent: Array<{ text: string; method: string }> = [];

  beforeEach(() => {
    sent.length = 0;
    const current = getNotificationSettings(sqlite());
    saveNotificationSettings(sqlite(), {
      ...current,
      telegram: { ...current.telegram, enabled: true, chatId: "42" },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = url.split("/").pop() ?? "";
      if (url.includes("/sendMessage") || url.includes("/editMessageText")) {
        const body = JSON.parse(String(init?.body)) as { text?: string };
        sent.push({ text: body.text ?? "", method });
      }
      if (url.includes("/getUpdates")) return jsonResponse({ ok: true, result: [] });
      return jsonResponse({ ok: true, result: { message_id: sent.length + 1 } });
    }));
  });

  it("acks an operator job, ignores the kill switch with /tl, and edits tool chips", async () => {
    app.vgOperator.service.progressIntervalMs = 0;
    let edited = false;
    app.vgOperator.service.setSpawn(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const emitter = new EventEmitter();
      setTimeout(() => {
        stdout.write(`${JSON.stringify({ type: "tool_use", name: "list_projects" })}\n`);
        stdout.write(`${JSON.stringify({ type: "result", result: "Trả lời operator" })}\n`);
        stdout.end();
        emitter.emit("exit", 0, null);
      }, 30);
      return {
        stdout,
        stderr,
        kill: () => true,
        on: (event: string, listener: (...args: never[]) => void) => {
          emitter.on(event, listener);
        },
      };
    });
    await app.inject({
      method: "PUT",
      url: "/api/notifications/telegram/token",
      payload: { token: "123456:ABC-DEF_secret_token" },
    });
    const current = getNotificationSettings(sqlite());
    saveNotificationSettings(sqlite(), {
      ...current,
      telegram: { ...current.telegram, enabled: true, chatId: "42" },
    });
    await app.vgOperator.service.handleTelegram({ chatId: "42", text: "/op kiểm tra" });
    await app.vgOperator.service.waitForIdle();
    expect(sent.some((item) => item.text.includes("Đã nhận"))).toBe(true);
    expect(sent.some((item) => item.text.includes("Trả lời operator"))).toBe(true);
    edited = sent.some((item) => item.method === "editMessageText");
    expect(edited).toBe(true);

    sent.length = 0;
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { killed: true } });
    await app.vgOperator.service.handleTelegram({ chatId: "42", text: "tin thường" });
    expect(sent.some((item) => item.text.includes("Operator đang tắt"))).toBe(true);
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { killed: false } });
  });
});
