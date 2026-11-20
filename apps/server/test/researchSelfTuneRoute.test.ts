import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { actorWith } from "./testActor.js";

// TASK-074c-5b: GET /api/research carries a read-only selfTune object beside budget. budget itself keeps its shape.
const opened: Array<{ app: ReturnType<typeof buildApp>; root: string }> = [];
afterEach(async () => { for (const { app, root } of opened.splice(0)) { await app.close(); rmSync(root, { recursive: true, force: true }); } });

function app() {
  const root = mkdtempSync(join(tmpdir(), "vg-research-selftune-"));
  const server = buildApp({
    config: parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "db.sqlite"), LOG_LEVEL: "silent", WORKER_ENABLED: "false", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" }),
    testActor: actorWith({ role: "owner", kind: "user" }),
  });
  opened.push({ app: server, root });
  return server;
}
type Sqlite = Database.Database;
const sqliteOf = (server: ReturnType<typeof buildApp>) => (server.vgPublish.service as unknown as { sqlite: Sqlite }).sqlite;

const at = (minute: number) => new Date(Date.UTC(2026, 10, 1) + minute * 60_000).toISOString();
function seedStatuses(sqlite: Sqlite, statuses: string[]) {
  statuses.forEach((status, index) => {
    sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
      VALUES (?, 'tool', ?, 'Thiếu', '{}', '[]', '[]', ?, 1, ?, ?, ?)`)
      .run(`row-${index}`, `title_${index}`, status, `tool:internal:seed_${index}`, at(index), at(index));
  });
}
const repeat = (value: string, count: number) => Array.from({ length: count }, () => value);

it("reports the self-tune stats, the user's limit and the effective limit when the rate is below 30%", async () => {
  const server = app();
  seedStatuses(sqliteOf(server), [...repeat("rejected", 15), ...repeat("accepted", 5)]);
  const res = await server.inject({ method: "GET", url: "/api/research" });
  expect(res.statusCode).toBe(200);
  expect(res.json().selfTune).toEqual({ window: 20, decided: 20, accepted: 5, rate: 0.25, halved: true, userLimit: 10, effectiveLimit: 5 });
});

it("reports rate null and the full effective limit below 20 decided rows", async () => {
  const server = app();
  const res = await server.inject({ method: "GET", url: "/api/research" });
  expect(res.statusCode).toBe(200);
  expect(res.json().selfTune).toEqual({ window: 20, decided: 0, accepted: 0, rate: null, halved: false, userLimit: 10, effectiveLimit: 10 });
});

it("is read-only: no settings row is written, the user's limit is unchanged, and budget keeps its shape", async () => {
  const server = app();
  const sqlite = sqliteOf(server);
  seedStatuses(sqlite, [...repeat("rejected", 15), ...repeat("accepted", 5)]);
  const countSettings = () => (sqlite.prepare("SELECT COUNT(*) AS n, COALESCE(group_concat(key || '=' || value), '') AS dump FROM app_settings").get() as { n: number; dump: string });
  const before = countSettings();
  const res = await server.inject({ method: "GET", url: "/api/research" });
  expect(res.statusCode).toBe(200);
  expect(countSettings()).toEqual(before);
  const body = res.json();
  expect(body.budget.limits.improvementRequests).toBe(10);
  expect(Object.keys(body.budget).sort()).toEqual(["day", "limits", "used"]);
});
