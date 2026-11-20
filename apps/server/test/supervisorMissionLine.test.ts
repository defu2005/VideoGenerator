import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testActor, TEST_WORKSPACE_ID } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { AutonomySupervisor } from "../src/operator/supervisor.js";

// TASK-129c: the digest's "Mission:" line text, as printed by supervisor.ts (runPass digest block).
// Drives the real runPass with a fixed clock and a notify spy. Fakes only; no network, no LLM.
const root = mkdtempSync(join(tmpdir(), "vg-supervisor-mission-line-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let dbPath: string;

beforeEach(() => {
  const dataDir = join(root, `run-${randomUUID()}`);
  dbPath = join(dataDir, "app.db");
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: dbPath,
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
  app = buildApp({ testActor, config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows cleanup races */ }
});

/** Inserts a mission row, and optionally a 'published' checkpoint for it, into the app's database. */
function seedMission(id: string, state: string, at: string, published = false): void {
  const sqlite = app.vgPublish.service as unknown as { sqlite: Database.Database };
  const db = sqlite.sqlite;
  db.prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES (?, ?, 'user', ?, '[]', '[]', ?, NULL, 'assist', ?, ?)`,
  ).run(id, TEST_WORKSPACE_ID, `lệnh ${id}`, state, at, at);
  if (published) {
    db.prepare("INSERT INTO mission_checkpoints (mission_id, kind, at, metrics, report) VALUES (?, 'published', ?, NULL, NULL)").run(id, at);
  }
}

/** Runs one supervisor pass at `now` and returns only the digest notes. */
function digestsAt(now: Date): Array<{ id: string; message: string }> {
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

const EVENING = new Date("2026-11-18T14:05:00Z"); // 21:05 on 2026-11-18 in Vietnam
const MORNING = new Date("2026-11-18T00:05:00Z"); // 07:05 on 2026-11-18 in Vietnam
const TODAY_AT = "2026-11-18T03:00:00.000Z"; // 10:00 on 2026-11-18 in Vietnam
const YESTERDAY_AT = "2026-11-17T03:00:00.000Z"; // 10:00 on 2026-11-17 in Vietnam

it("prints the exact Mission line with five distinct counts, after the weekly line (evening)", () => {
  // Target: 4 in flight (2 producing + 2 waiting_user), 2 waiting for the user, 3 published today,
  // 5 ended today (4 done + 1 failed), 1 failed. Distinct values, so a swapped field fails.
  seedMission("p1", "producing", TODAY_AT, true);
  seedMission("p2", "producing", TODAY_AT, true);
  seedMission("w1", "waiting_user", TODAY_AT, true);
  seedMission("w2", "waiting_user", TODAY_AT, false);
  seedMission("d1", "done", TODAY_AT);
  seedMission("d2", "done", TODAY_AT);
  seedMission("d3", "done", TODAY_AT);
  seedMission("d4", "done", TODAY_AT);
  seedMission("f1", "failed", TODAY_AT);

  const digests = digestsAt(EVENING);
  expect(digests.map((d) => d.id)).toEqual(["digest:2026-11-18"]);
  const message = digests[0]!.message;
  const expectedLine = "\nMission: 4 đang chạy, 2 chờ bạn, 3 video đã đăng hôm nay, 5 kết thúc hôm nay (1 lỗi).";
  expect(message.endsWith(expectedLine)).toBe(true);
  // The Mission line comes after the weekly self-improvement line.
  expect(message.indexOf("Tự cải tiến 7 ngày")).toBeLessThan(message.indexOf("Mission:"));
});

it("prints the Mission line with 'hôm qua' on the morning digest, using yesterday's missions", () => {
  seedMission("y1", "producing", YESTERDAY_AT, true);
  seedMission("y2", "done", YESTERDAY_AT);
  seedMission("y3", "failed", YESTERDAY_AT);

  const digests = digestsAt(MORNING);
  expect(digests.map((d) => d.id)).toEqual(["digest-morning:2026-11-17"]);
  // inFlight 1 (y1), waiting 0, published 1 (y1), ended 2 (y2, y3), failed 1 (y3).
  expect(digests[0]!.message.endsWith("\nMission: 1 đang chạy, 0 chờ bạn, 1 video đã đăng hôm qua, 2 kết thúc hôm qua (1 lỗi).")).toBe(true);
});

it("omits the Mission line entirely when there are no missions", () => {
  const digests = digestsAt(EVENING);
  expect(digests.map((d) => d.id)).toEqual(["digest:2026-11-18"]);
  expect(digests[0]!.message).not.toContain("Mission:");
});
