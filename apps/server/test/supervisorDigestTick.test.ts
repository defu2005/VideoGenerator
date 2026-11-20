import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testActor, TEST_WORKSPACE_ID } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { AutonomySupervisor } from "../src/operator/supervisor.js";

// TASK-129c slice 3, at the supervisor tick: the digest is sent through notify with its id, label, day and
// the Mission line. 07:05 Vietnam time → "digest-morning:<previous day>", "hôm qua"; 21:05 → "digest:<today>", "hôm nay".
// Fakes only: in-memory-style app.db in a temp dir, fixed clock, a notify spy.
const root = mkdtempSync(join(tmpdir(), "vg-supervisor-digest-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "app.db"),
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
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 500 })));
  const dataDir = join(root, `data-${randomUUID()}`);
  app = buildApp({ testActor, config: { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") } });
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows cleanup races */ }
});

/** A mission that ended on the given instant, so the digest's Mission line renders. */
function endedMission(at: string) {
  const sqlite = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
  sqlite.prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES ('m-end', ?, 'user', 'lệnh', '[]', '[]', 'done', NULL, 'assist', ?, ?)`,
  ).run(TEST_WORKSPACE_ID, at, at);
  return sqlite;
}

function tickAt(now: Date) {
  const ctx = app.vgAssistant.service.toolContext();
  const notes: Array<{ id: string; message: string }> = [];
  const supervisor = new AutonomySupervisor({
    repository: ctx.orchestrator.repository,
    usage: ctx.usage,
    stageTimeoutMs: 60_000,
    logger: app.log,
    now: () => now,
    notify: (finding) => notes.push(finding),
  });
  supervisor.runPass();
  return notes.filter((note) => note.id.startsWith("digest"));
}

it("the 07:05 tick sends the morning digest for the previous day, with 'hôm qua' and the Mission line", () => {
  // 07:05 on 2026-11-18 in Vietnam; the mission ended at 10:00 on 2026-11-17 in Vietnam.
  endedMission("2026-11-17T03:00:00.000Z");
  const digests = tickAt(new Date("2026-11-18T00:05:00Z"));
  expect(digests.map((d) => d.id)).toEqual(["digest-morning:2026-11-17"]);
  expect(digests[0]!.message).toMatch(/^Bản tin sáng 2026-11-17/);
  expect(digests[0]!.message).toContain("kết thúc hôm qua");
  expect(digests[0]!.message).not.toContain("hôm nay");
});

it("the 21:05 tick sends the evening digest for today, with 'hôm nay' and the Mission line", () => {
  // 21:05 on 2026-11-18 in Vietnam; the mission ended at 10:00 on 2026-11-18 in Vietnam.
  endedMission("2026-11-18T03:00:00.000Z");
  const digests = tickAt(new Date("2026-11-18T14:05:00Z"));
  expect(digests.map((d) => d.id)).toEqual(["digest:2026-11-18"]);
  expect(digests[0]!.message).toMatch(/^Bản tin 2026-11-18/);
  expect(digests[0]!.message).toContain("kết thúc hôm nay");
});
