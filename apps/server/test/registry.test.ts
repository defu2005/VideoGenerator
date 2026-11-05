import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-registry-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "registry.db"),
    PORT: "3012",
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

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("tool registry", () => {
  it("lists the assistant tools and has no approve-pending tool", async () => {
    const listed = await app.inject({ method: "GET", url: "/api/registry/tools" });
    expect(listed.statusCode).toBe(200);
    const names = listed.json<{ tools: Array<{ name: string }> }>().tools.map((tool) => tool.name).sort();
    expect(names).toEqual(Object.keys(ASSISTANT_TOOLS).sort());
    expect(names).not.toContain("approve_pending_action");
    expect(names).toContain("find_skills");
    expect(names).toContain("save_standing_order");
  });

  it("turns a confirm tool from the operator into a pending action", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Dự án chờ duyệt", mode: "ASSISTED" },
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json<{ id: string }>().id;
    const pending = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "operator" },
      payload: { name: "delete_project", args: { projectId } },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json<{ pendingActionId: string }>().pendingActionId).toBeTruthy();
    const still = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
    expect(still.statusCode).toBe(200);
    const audit = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite.prepare(
      "SELECT source, decision FROM operator_tool_audit WHERE tool = 'delete_project' ORDER BY created_at DESC LIMIT 1",
    ).get() as { source: string; decision: string };
    expect(audit).toEqual({ source: "operator", decision: "pending" });
  });

  it("refuses the protected project, paid fallback, and any approve tool", async () => {
    const blocked = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      headers: { "x-vg-tool-source": "assistant" },
      payload: { name: "get_project", args: { projectId: PROTECTED_PROJECT_ID } },
    });
    expect(blocked.statusCode).toBe(403);
    const audit = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite.prepare(
      "SELECT source FROM operator_tool_audit WHERE tool = 'get_project' ORDER BY created_at DESC LIMIT 1",
    ).get() as { source: string };
    expect(audit.source).toBe("mcp");

    const paid = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      payload: { name: "update_llm_settings", args: { quotaPolicy: "paid_fallback", paidFallbackDailyUsd: 5 } },
    });
    expect(paid.statusCode).toBe(403);

    const approve = await app.inject({
      method: "POST",
      url: "/api/registry/invoke",
      payload: { name: "approve_pending_action", args: {} },
    });
    expect(approve.statusCode).toBe(403);
  });
});
