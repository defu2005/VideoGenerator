import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

// TASK-148e: route tests for the stage prompt variant registry. No network, no LLM.
const root = mkdtempSync(join(tmpdir(), "vg-prompt-variants-api-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let agentApp: ReturnType<typeof buildApp> | null = null;
let agentDbPath: string | null = null;

beforeEach(() => {
  const dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    HOST: "127.0.0.1",
  });
  app = buildApp({ testActor, config });
});

afterEach(async () => {
  await app.close();
  if (agentApp) await agentApp.close();
  agentApp = null;
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function agentFor(): ReturnType<typeof buildApp> {
  const dataDir = join(root, `agent-${randomUUID()}`);
  const agentConfig = { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") };
  agentDbPath = agentConfig.DATABASE_PATH;
  agentApp = buildApp({ testActor: { ...testActor, kind: "apikey", keyId: "agent-key" } as typeof testActor, config: agentConfig });
  return agentApp;
}

function sqliteOf(): Database.Database {
  return new Database(config.DATABASE_PATH);
}

describe("stage prompt variants API (TASK-148e)", () => {
  it("a user registers a candidate, reads it, and promotes it; a second promote retires the first", async () => {
    const reg1 = await app.inject({ method: "POST", url: "/api/stage-prompt-variants", payload: { stage: "SCRIPT", text: "Viết ngắn, nhịp nhanh." } });
    expect(reg1.statusCode).toBe(200);
    const first = reg1.json<{ id: string; status: string }>();
    expect(first.status).toBe("candidate");

    const reg2 = await app.inject({ method: "POST", url: "/api/stage-prompt-variants", payload: { stage: "SCRIPT", text: "Kể chuyện theo ba màn." } });
    const second = reg2.json<{ id: string }>();

    const get = await app.inject({ method: "GET", url: `/api/stage-prompt-variants/${first.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ id: string }>().id).toBe(first.id);

    const promote1 = await app.inject({ method: "POST", url: `/api/stage-prompt-variants/${first.id}/promote` });
    expect(promote1.statusCode).toBe(200);
    expect(promote1.json()).toMatchObject({ id: first.id, status: "active", decidedBy: "user" });

    const promote2 = await app.inject({ method: "POST", url: `/api/stage-prompt-variants/${second.id}/promote` });
    expect(promote2.statusCode).toBe(200);
    expect(promote2.json()).toMatchObject({ id: second.id, status: "active" });

    const sqlite = sqliteOf();
    const statuses = sqlite.prepare("SELECT id, status FROM stage_prompt_variants WHERE stage='SCRIPT' ORDER BY id").all() as Array<{ id: string; status: string }>;
    sqlite.close();
    expect(statuses.find((row) => row.id === first.id)?.status).toBe("retired");
    expect(statuses.find((row) => row.id === second.id)?.status).toBe("active");
  });

  it("an agent API key gets 403 on register and promote, and writes nothing in its own database", async () => {
    const agent = agentFor();
    // Create the agent database (migrations run on app build), then seed a candidate directly in it.
    await agent.inject({ method: "GET", url: "/api/stage-prompt-variants/warmup" });
    const id = "agent-db-candidate";
    const seedDb = new Database(agentDbPath!);
    seedDb.prepare(`INSERT INTO stage_prompt_variants (id,stage,text_hash,text,status,evidence,created_at,decided_at,decided_by)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, "SCRIPT", "hash-agent", "agent-side candidate", "candidate", "[]", new Date().toISOString(), null, null);
    const countBefore = (seedDb.prepare("SELECT COUNT(*) AS n FROM stage_prompt_variants").get() as { n: number }).n;
    seedDb.close();

    const reg = await agent.inject({ method: "POST", url: "/api/stage-prompt-variants", payload: { stage: "SCRIPT", text: "agent idea" } });
    expect(reg.statusCode).toBe(403);
    expect(reg.json<{ error?: { code?: string }; code?: string }>().error?.code ?? reg.json<{ code?: string }>().code).toBe("AGENT_CANNOT_DECIDE");

    const promote = await agent.inject({ method: "POST", url: `/api/stage-prompt-variants/${id}/promote` });
    expect(promote.statusCode).toBe(403);
    expect(promote.json<{ error?: { code?: string }; code?: string }>().error?.code ?? promote.json<{ code?: string }>().code).toBe("AGENT_CANNOT_DECIDE");

    const after = new Database(agentDbPath!);
    const row = after.prepare("SELECT status, decided_at, decided_by FROM stage_prompt_variants WHERE id=?").get(id) as { status: string; decided_at: string | null; decided_by: string | null };
    const countAfter = (after.prepare("SELECT COUNT(*) AS n FROM stage_prompt_variants").get() as { n: number }).n;
    after.close();
    expect(row).toMatchObject({ status: "candidate", decided_at: null, decided_by: null });
    expect(countAfter).toBe(countBefore); // the agent added no rows
  });

  it("an unknown id returns 404 on read and on promote", async () => {
    const get = await app.inject({ method: "GET", url: "/api/stage-prompt-variants/does-not-exist" });
    expect(get.statusCode).toBe(404);
    expect(get.json<{ error?: { code?: string }; code?: string }>().error?.code ?? get.json<{ code?: string }>().code).toBe("PROMPT_VARIANT_NOT_FOUND");

    const promote = await app.inject({ method: "POST", url: "/api/stage-prompt-variants/does-not-exist/promote" });
    expect(promote.statusCode).toBe(404);
  });

  it("rejects a stage other than SCRIPT", async () => {
    const res = await app.inject({ method: "POST", url: "/api/stage-prompt-variants", payload: { stage: "RESEARCH", text: "x" } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
