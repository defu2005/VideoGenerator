import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_HINT_VI } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { scriptedProcess, type Spawned } from "../src/operator/runtime.js";
import { failInterruptedOperatorRuns } from "../src/operator/service.js";
import { clearAssistantChatScript, setAssistantChatScript } from "../src/providers/llm/mock.js";
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

function arm(script: { stdout?: string[]; stderr?: string[]; hang?: boolean; exitCode?: number }) {
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
    OPENAI_API_KEY: "fixture",
    OPENAI_BASE_URL: "https://operator-fixture.test/v1",
    OPENAI_MODEL: "fixture-model",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  app = buildApp({ testActor,  config });
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
  it("drafts a skill after repeated failures, requires approval and can roll back", async () => {
    arm({
      stdout: [JSON.stringify({ type: "tool_use", name: "list_projects" })],
      stderr: ["Fixture: project listing interrupted"],
      exitCode: 1,
    });
    const runIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      runIds.push(app.vgOperator.service.submit({ prompt: "Kiểm tra danh sách dự án" }).runId);
      await app.vgOperator.service.waitForIdle();
    }
    const list = () => app.inject({ method: "GET", url: "/api/operator/skills" });
    const { items: [draft] } = (await list()).json();
    expect(draft).toMatchObject({ status: "draft", version: 1, evidence: { source: "repeated_failure" } });
    expect(draft.evidence.runIds).toEqual(expect.arrayContaining(runIds));
    const find = (source: string) => app.inject({
      method: "POST", url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": source },
      payload: { name: "find_skills", args: { query: "lỗi list_projects" } },
    });
    expect((await find("operator")).body).not.toContain(draft.name);
    const activate = (version: number) => app.inject({
      method: "POST", url: `/api/operator/skills/${draft.name}/versions/${version}/activate`,
    });
    expect((await activate(1)).statusCode).toBe(200);
    expect((await find("mcp")).json()).toEqual((await find("operator")).json());
    expect((await find("operator")).body).toContain(`"name":"${draft.name}","version":1`);

    const relativePath = "notes/skill-proposals/fixture-second-version.md";
    const path = join(app.vgOperator.service.workspacePath(), relativePath);
    writeFileSync(path, draft.markdown.replace("tools:\n  - find_tools", "tools:\n  - delete_project"), "utf8");
    expect(app.vgOperator.service.promoteSkill(relativePath)).toMatchObject({ ok: false });
    writeFileSync(path, `${draft.markdown}\n- Đã kiểm tra lại hướng dẫn.\n`, "utf8");
    expect(app.vgOperator.service.promoteSkill(relativePath)).toMatchObject({ ok: true });
    expect((await find("operator")).body).toContain(`"name":"${draft.name}","version":2`);
    expect((await activate(1)).statusCode).toBe(200);
    expect((await find("operator")).body).toContain(`"name":"${draft.name}","version":1`);
  });

  it("scores skill edits on routing scenarios and keeps the learning report apart", async () => {
    const { items } = (await app.inject({ method: "GET", url: "/api/operator/skills" })).json();
    const draft = items.find((item: { status: string }) => item.status === "active");
    expect(draft.evaluation.score).toBeGreaterThanOrEqual(80);
    expect(draft.evaluation.scenarios.some((item: { id: string }) => item.id === "off-topic-weather")).toBe(true);

    const vague = draft.markdown.replace(/triggers:\n(?: {2}- .*\n)+/, "triggers:\n  - bỏ qua duyệt dự án\n  - bỏ qua duyệt kịch bản\n");
    const edit = (markdown: string) => app.inject({
      method: "PUT", url: `/api/operator/skills/${draft.name}/draft`, payload: { markdown },
    });
    const weak = await edit(vague);
    expect(weak.statusCode).toBe(200);
    const listed = (await app.inject({ method: "GET", url: "/api/operator/skills" })).json().items
      .find((item: { version: number }) => item.version === weak.json().version);
    expect(listed).toMatchObject({ status: "draft", evidence: { source: "user_edit" }, activeScore: draft.score });
    expect(listed.score).toBeLessThan(80);
    const refused = await app.inject({
      method: "POST", url: `/api/operator/skills/${draft.name}/versions/${weak.json().version}/activate`,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("SKILL_EVAL_FAILED");
    expect((await edit(draft.markdown.replace(`name: ${draft.name}`, "name: other-name"))).statusCode).toBe(400);

    const report = (await app.inject({ method: "GET", url: "/api/operator/learning-report" })).json();
    expect(report.skills.active.map((item: { name: string }) => item.name)).toContain(draft.name);
    expect(report.skills.drafts).toEqual(expect.arrayContaining([expect.objectContaining({ name: draft.name, source: "user_edit" })]));
    expect(report).toHaveProperty("lessons.operator");
    expect(report).toHaveProperty("toolProposals");
  });

  it("scopes Cursor MCP calls to the active workflow and reuses a receipt after resume", async () => {
    let token: string | undefined;
    app.vgOperator.service.setSpawn((command, args, options) => {
      token = options.env?.VG_OPERATOR_INVOCATION;
      return scriptedProcess({ hang: true })(command, args, options);
    });
    const invoke = (invocation?: string) => app.inject({
      method: "POST", url: "/api/registry/invoke",
      headers: {
        "x-vg-tool-source": "operator", "x-vg-operator-managed": "1",
        ...(invocation ? { "x-vg-operator-invocation": invocation } : {}),
      },
      payload: { name: "create_project", args: { topic: "Cursor workflow fixture", mode: "ASSISTED" } },
    });
    expect((await invoke()).statusCode).toBe(403);
    const run = app.vgOperator.service.submit({ prompt: "Cursor workflow fixture" });
    const firstToken = token;
    expect(firstToken).toBeTruthy();
    const first = await invoke(firstToken);
    expect(first.statusCode).toBe(200);
    app.vgOperator.service.stopActive();
    await app.vgOperator.service.waitForIdle();
    expect((await invoke(firstToken)).statusCode).toBe(403);
    const resumed = await app.inject({ method: "POST", url: `/api/operator/runs/${run.runId}/resume` });
    expect(resumed.statusCode).toBe(200);
    expect(token).not.toBe(firstToken);
    expect((await invoke(token)).statusCode).toBe(200);
    app.vgOperator.service.stopActive();
    await app.vgOperator.service.waitForIdle();
    expect(sqlite().prepare("SELECT count(*) AS total FROM projects WHERE topic = ?").get("Cursor workflow fixture"))
      .toEqual({ total: 1 });
    expect(sqlite().prepare("SELECT run_id FROM operator_tool_audit WHERE tool = 'create_project' AND run_id = ?")
      .get(run.runId)).toEqual({ run_id: run.runId });
  });

  it.each([true, false])("reconciles a workflow after interruption (recorded receipt: %s)", async (recorded) => {
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "mock" } } });
    try {
      const topic = `Checkpoint fixture ${recorded}`;
      const action = { tool: "create_project", args: { topic, mode: "ASSISTED" } };
      setAssistantChatScript([
        { done: false, calls: [action] },
        { done: false, calls: [{ tool: "invalid_checkpoint_fixture", args: {} }] },
      ]);
      const root = app.vgOperator.service.submit({ prompt: topic });
      await app.vgOperator.service.waitForIdle();
      expect(app.vgOperator.service.getRun(root.runId)).toMatchObject({ status: "failed", workflowId: root.runId });
      expect(sqlite().prepare("SELECT count(*) AS total FROM operator_checkpoints WHERE workflow_id = ?")
        .get(root.runId)).toEqual({ total: 1 });
      if (!recorded) sqlite().prepare("UPDATE operator_checkpoints SET receipt = NULL WHERE workflow_id = ?").run(root.runId);
      sqlite().prepare("UPDATE operator_runs SET status = 'running' WHERE id = ?").run(root.runId);
      expect(failInterruptedOperatorRuns(sqlite(), new Date())).toBe(1);

      if (recorded) {
        await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "openai" } } });
        const fetchMock = vi.fn()
          .mockImplementationOnce(async (_url: string, options: RequestInit) => {
            const body = JSON.parse(String(options.body));
            expect(body.messages[1].content).toContain("checkpoint");
            return jsonResponse({ choices: [{
              finish_reason: "tool_calls", message: { tool_calls: [{ type: "function", function: {
                name: action.tool, arguments: JSON.stringify({ mode: "ASSISTED", topic }),
              } }] },
            }] });
          })
          .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "Đã tiếp tục." } }] }));
        vi.stubGlobal("fetch", fetchMock);
      }
      const url = `/api/operator/runs/${root.runId}/resume`;
      const response = await app.inject({ method: "POST", url });
      if (recorded) {
        expect(response.statusCode).toBe(200);
        const { runId } = response.json<{ runId: string }>();
        await app.vgOperator.service.waitForIdle();
        expect(app.vgOperator.service.getRun(runId)).toMatchObject({
          status: "done", workflowId: root.runId, runtimeId: "openai",
        });
        expect((await app.inject({ method: "POST", url })).statusCode).toBe(409);
      } else {
        expect(response.statusCode).toBe(409);
        expect(response.body).toContain("OPERATOR_OUTCOME_UNKNOWN");
      }
      expect(sqlite().prepare("SELECT count(*) AS total FROM projects WHERE topic = ?").get(topic)).toEqual({ total: 1 });
    } finally {
      vi.unstubAllGlobals();
      clearAssistantChatScript();
      await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "cursor" } } });
    }
  });

  it("reports an unavailable configured provider without silently switching to Cursor", async () => {
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "claude-cli" } } });
    try {
      const overview = app.vgOperator.service.overview();
      expect(overview.runtime).toBeNull();
      expect(overview.runtimeOptions).toContainEqual(expect.objectContaining({
        id: "claude-cli", available: false, reason: expect.stringContaining("đang tắt"),
      }));
      const run = app.vgOperator.service.submit({ prompt: "Kiểm tra runtime" });
      expect(run).toMatchObject({ status: "refused", message: expect.stringContaining("đang tắt") });
      expect(spawned).toEqual([]);
    } finally {
      await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "cursor" } } });
    }
  });

  it("routes native function calls through the same confirmation policy", async () => {
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "openai" } } });
    try {
      const created = await app.inject({
        method: "POST", url: "/api/projects",
        payload: { topic: "Dự án thử native", mode: "ASSISTED" },
      });
      const { id } = created.json<{ id: string }>();
      const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
        expect(url).toBe("https://operator-fixture.test/v1/chat/completions");
        const body = JSON.parse(String(options.body));
        expect(body.tools).toContainEqual(expect.objectContaining({
          type: "function", function: expect.objectContaining({ name: "delete_project" }),
        }));
        return jsonResponse({ choices: [{
          finish_reason: "tool_calls",
          message: { tool_calls: [{ type: "function", function: {
            name: "delete_project", arguments: JSON.stringify({ projectId: id }),
          } }] },
        }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      });
      vi.stubGlobal("fetch", fetchMock);
      const run = app.vgOperator.service.submit({ prompt: "Xóa dự án thử native" });
      await app.vgOperator.service.waitForIdle();
      expect(app.vgOperator.service.getRun(run.runId)).toMatchObject({
        result: expect.stringContaining("Cần bạn duyệt"), model: "fixture-model",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect((await app.inject({ method: "GET", url: `/api/projects/${id}` })).statusCode).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "cursor" } } });
    }
  });

  it("runs a text provider through the operator registry and stops at confirmation", async () => {
    const update = await app.inject({
      method: "PUT", url: "/api/operator/settings",
      payload: { runtimeByChannel: { web: "mock" } },
    });
    expect(update.statusCode).toBe(200);
    try {
      const created = await app.inject({
        method: "POST", url: "/api/projects",
        payload: { topic: "Dự án thử của agent", mode: "ASSISTED" },
      });
      expect(created.statusCode).toBe(201);
      const { id } = created.json<{ id: string }>();
      setAssistantChatScript([
        { done: false, calls: [{ tool: "get_project", args: { projectId: id } }] },
        { done: false, autoConfirm: true, calls: [{ tool: "delete_project", args: { projectId: id } }] },
      ]);
      const run = app.vgOperator.service.submit({ prompt: "Đọc rồi xóa dự án thử" });
      await app.vgOperator.service.waitForIdle();
      expect(app.vgOperator.service.getRun(run.runId)).toMatchObject({
        status: "done", result: expect.stringContaining("Cần bạn duyệt"),
        toolChips: ["get_project", "delete_project"],
      });
      expect(spawned).toEqual([]);
      expect((await app.inject({ method: "GET", url: `/api/projects/${id}` })).statusCode).toBe(200);
      expect(sqlite().prepare("SELECT decision FROM operator_tool_audit WHERE run_id = ? ORDER BY rowid").all(run.runId))
        .toEqual([{ decision: "executed" }, { decision: "pending" }]);
      const usageJob = sqlite().prepare("SELECT usage FROM jobs WHERE id = ? AND stage = 'ASSISTANT'")
        .get(run.runId) as { usage: string };
      expect(JSON.parse(usageJob.usage)).toMatchObject({ provider: "mock", llmCalls: 2 });
      const earlyResume = await app.inject({ method: "POST", url: `/api/operator/runs/${run.runId}/resume` });
      expect(earlyResume.statusCode).toBe(409);
      expect(earlyResume.body).toContain("OPERATOR_WAITING_APPROVAL");
    } finally {
      clearAssistantChatScript();
      await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "cursor" } } });
    }
  });

  it("fails a model run when the output stays malformed after the repair turn", async () => {
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "mock" } } });
    try {
      setAssistantChatScript([{ calls: "không phải mảng" }, { done: "sai kiểu" }]);
      const run = app.vgOperator.service.submit({ prompt: "Định dạng sai" });
      await app.vgOperator.service.waitForIdle();
      expect(app.vgOperator.service.getRun(run.runId)).toMatchObject({ status: "failed" });
      expect(sqlite().prepare("SELECT COUNT(*) AS n FROM operator_tool_audit WHERE run_id = ?").get(run.runId))
        .toEqual({ n: 0 });
      expect(spawned).toEqual([]);
    } finally {
      clearAssistantChatScript();
      await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "cursor" } } });
    }
  });

  it("refuses self-approval, secret writes and the protected project for a model adapter", async () => {
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "mock" } } });
    try {
      setAssistantChatScript([
        { done: false, calls: [
          { tool: "approve_pending_action", args: { id: "x" } },
          { tool: "update_notification_settings", args: { telegram: { botToken: "123:abc", apiKey: "sk-test-secret" } } },
          { tool: "get_project", args: { projectId: "56374fb2-54cf-48ff-9441-2e6c653295d4" } },
        ] },
        { done: true, reply: "Xong" },
      ]);
      const run = app.vgOperator.service.submit({ prompt: "Thử chặn cứng" });
      await app.vgOperator.service.waitForIdle();
      expect(sqlite().prepare("SELECT tool, decision FROM operator_tool_audit WHERE run_id = ? ORDER BY rowid").all(run.runId))
        .toEqual([
          { tool: "approve_pending_action", decision: "refused" },
          { tool: "update_notification_settings", decision: "refused" },
          { tool: "get_project", decision: "refused" },
        ]);
      const audit = JSON.stringify(sqlite().prepare("SELECT * FROM operator_tool_audit WHERE run_id = ?").all(run.runId));
      expect(audit).not.toContain("sk-test-secret");
    } finally {
      clearAssistantChatScript();
      await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "cursor" } } });
    }
  });

  it("reports a disconnected provider and stops a hung model run", async () => {
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "openai" } } });
    try {
      vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed: ECONNREFUSED"); }));
      const lost = app.vgOperator.service.submit({ prompt: "Mất kết nối" });
      await app.vgOperator.service.waitForIdle();
      expect(app.vgOperator.service.getRun(lost.runId)).toMatchObject({ status: "failed" });

      vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })));
      const hung = app.vgOperator.service.submit({ prompt: "Treo model" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      app.vgOperator.service.stopActive();
      await app.vgOperator.service.waitForIdle();
      expect(app.vgOperator.service.getRun(hung.runId)).toMatchObject({ status: "killed" });
    } finally {
      vi.unstubAllGlobals();
      await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { runtimeByChannel: { web: "cursor" } } });
    }
  });

  it("writes the workspace, runs one mocked CLI, and resumes the chat", async () => {
    expect(app.vgOperator.service.overview().runtime).toEqual({
      id: "cursor",
      capabilities: { mcp: true, resume: true, streaming: true, cancel: true },
    });
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
    expect(cli).not.toHaveProperty("version");
    expect(cli).not.toHaveProperty("approvalMode");
    expect(cli).not.toHaveProperty("sandbox");

    sqlite().prepare(
      `INSERT INTO operator_runs
       (id, conversation_id, kind, status, prompt, result, partial_text, tool_chips, model, error, outcome, origin, day_key, pending_action_ids, started_at, finished_at, created_at)
       VALUES (?, ?, 'chat', 'running', 'lượt bị cắt', NULL, '', '[]', NULL, NULL, NULL, 'user', '2026-11-05', '[]', ?, NULL, ?)`,
    ).run("11111111-1111-4111-8111-111111111111", app.vgOperator.service.latestConversation("web"), new Date().toISOString(), new Date().toISOString());
    const queuedId = "22222222-2222-4222-8222-222222222222";
    const conversationIdForRestart = app.vgOperator.service.latestConversation("web");
    sqlite().prepare(
      `INSERT INTO operator_runs
       (id, conversation_id, kind, status, prompt, tool_chips, origin, day_key, pending_action_ids, created_at)
       VALUES (?, ?, 'order', 'queued', 'lượt đang chờ', '[]', 'schedule', '2026-11-05', '[]', ?)`,
    ).run(queuedId, conversationIdForRestart, new Date().toISOString());
    expect(failInterruptedOperatorRuns(sqlite(), new Date())).toBe(2);
    expect(failInterruptedOperatorRuns(sqlite(), new Date())).toBe(0);
    expect(app.vgOperator.service.getRun(queuedId)?.status).toBe("failed");
    expect(app.vgOperator.service.listMessages(conversationIdForRestart).filter((message) => message.runId === queuedId))
      .toEqual([expect.objectContaining({ role: "assistant", text: expect.stringContaining("khởi động lại") })]);
    expect(app.vgOperator.service.getRun("11111111-1111-4111-8111-111111111111")?.status).toBe("failed");
    expect(String(app.vgOperator.service.getRun("11111111-1111-4111-8111-111111111111")?.result)).toMatch(/khởi động lại/);
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
      queueMicrotask(() => {
        emitter.emit("exit", 1, null);
        queueMicrotask(() => {
          stderr.write("Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY.\n");
          stderr.end();
          stdout.end();
        });
      });
      return {
        stdout,
        stderr,
        kill: () => true,
        on: (event: string, listener: (...args: never[]) => void) => {
          emitter.on(event, listener);
        },
      };
    });
    const late = app.vgOperator.service.submit({ conversationId, prompt: "bước nào lỗi" });
    await app.vgOperator.service.waitForIdle();
    expect(String(app.vgOperator.service.getRun(late.runId)?.result)).toContain(LOGIN_HINT_VI);

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

  it("catches up only the latest occurrence per schedule after an outage", async () => {
    const now = new Date("2026-11-10T09:31:15.000Z");
    const heartbeat = "2026-11-10T00:00:00.000Z";
    const service = app.vgOperator.service;
    const frequent = service.saveStandingOrder({ title: "Hàng phút", prompt: "Tóm tắt trạng thái", cron: "* * * * *", enabled: true });
    const stale = service.saveStandingOrder({ title: "Quá hạn", prompt: "Kiểm tra", cron: "0 8 * * *", enabled: true });
    await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { tickCron: "30 * * * *" } });
    const db = sqlite();
    const unrelated = db.prepare("UPDATE standing_orders SET enabled = 0 WHERE enabled = 1 AND id NOT IN (?, ?) RETURNING id")
      .all(frequent.id, stale.id) as { id: string }[];
    db.prepare("UPDATE standing_orders SET updated_at = ? WHERE id IN (?, ?)").run(heartbeat, frequent.id, stale.id);
    db.prepare("UPDATE app_settings SET updated_at = ? WHERE key = 'operator'").run(heartbeat);
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('operator.tickLastFired', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(heartbeat, heartbeat);
    arm({ stdout: [JSON.stringify({ type: "result", result: "Đã kiểm tra" })] });
    try {
      expect(service.recoverSchedules(heartbeat, now)).toMatchObject({ started: 2, refused: 0, skippedBefore: "2026-11-10T03:31:15.000Z" });
      expect(service.recoverSchedules(heartbeat, now).started).toBe(0);
      expect(service.tick(now).started).toEqual([]);
      await service.waitForIdle();
      expect(service.listOrders().find((order) => order.id === stale.id)?.lastFiredAt).toBeNull();
    } finally {
      for (const order of unrelated) db.prepare("UPDATE standing_orders SET enabled = 1 WHERE id = ?").run(order.id);
      db.prepare("DELETE FROM standing_orders WHERE id IN (?, ?)").run(frequent.id, stale.id);
    }
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
