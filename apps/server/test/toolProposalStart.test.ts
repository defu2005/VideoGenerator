import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { startToolProposal } from "../src/operator/toolProposals.js";
import { testActor } from "./testActor.js";

// TASK-074c-6a: accepted → in_progress by the user's mark only. The row must already have a draft (drafted_at set),
// so a draft that is still running cannot lose its marker update. Route: POST /api/operator/tool-proposals/:id/start.
const OLD = "2026-11-20T00:00:00.000Z";
const DRAFTED = "2026-11-20T01:00:00.000Z";

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened;
}

function proposalJson(name: string) {
  return JSON.stringify({
    kind: "internal", name,
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"],
  });
}

function insertRow(
  sqlite: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } },
  row: { id: string; kind?: string; status: string; drafted?: boolean; impNumber?: number },
) {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at, imp_number, drafted_at)
    VALUES (?, ?, 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', ?, 1, ?, ?, ?, ?, ?)`)
    .run(row.id, row.kind ?? "tool", proposalJson(`tool_${row.id.replace(/[^a-z0-9]/gi, "_")}`), row.status,
      `${row.kind ?? "tool"}:internal:${row.id}`, OLD, OLD, row.impNumber ?? null, row.drafted ? DRAFTED : null);
}

function rowOf(sqlite: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } }, id: string) {
  return sqlite.prepare("SELECT id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at, imp_number, drafted_at FROM improvement_requests WHERE id = ?").get(id) as Record<string, unknown>;
}

describe("TASK-074c-6a: startToolProposal moves only a drafted accepted tool row to in_progress", () => {
  it("moves a drafted accepted tool row to in_progress, bumps updated_at and keeps every other column", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "row-drafted", status: "accepted", drafted: true, impNumber: 1 });
    const before = rowOf(sqlite, "row-drafted");
    startToolProposal(sqlite, "row-drafted");
    const after = rowOf(sqlite, "row-drafted");
    expect(after.status).toBe("in_progress");
    expect(after.updated_at).not.toBe(OLD);
    for (const key of Object.keys(before)) {
      if (key === "status" || key === "updated_at") continue;
      expect(after[key], key).toEqual(before[key]);
    }
  });

  it("does nothing to an accepted row that has no draft yet", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "row-undrafted", status: "accepted" });
    const before = rowOf(sqlite, "row-undrafted");
    expect(() => startToolProposal(sqlite, "row-undrafted")).not.toThrow();
    expect(rowOf(sqlite, "row-undrafted")).toEqual(before);
  });

  it.each([
    ["open"],
    ["rejected"],
    ["done"],
    ["in_progress"],
    ["verified"],
    ["failed_verification"],
  ])("does not change a drafted tool row whose status is %s", (status) => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: `row-${status}`, status, drafted: true });
    const before = rowOf(sqlite, `row-${status}`);
    startToolProposal(sqlite, `row-${status}`);
    expect(rowOf(sqlite, `row-${status}`)).toEqual(before);
  });

  it("does not change a non-tool row even when it is accepted and drafted", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "feat-1", kind: "feature", status: "accepted", drafted: true });
    const before = rowOf(sqlite, "feat-1");
    startToolProposal(sqlite, "feat-1");
    expect(rowOf(sqlite, "feat-1")).toEqual(before);
  });

  it("an unknown id is a silent no-op, like accept", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "row-known", status: "accepted", drafted: true });
    expect(() => startToolProposal(sqlite, "does-not-exist")).not.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM improvement_requests").get()).toEqual({ n: 1 });
    expect(rowOf(sqlite, "row-known").status).toBe("accepted");
  });
});

// Route tests go through the real app and the real user-only check. The actor is switched to an API key for the refusal case.
const root = mkdtempSync(join(tmpdir(), "vg-start-"));
let app: ReturnType<typeof buildApp>;

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

beforeAll(() => {
  const config: AppConfig = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "start.db"),
    PORT: "3014",
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
  app = buildApp({ testActor, config });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("TASK-074c-6a: POST /api/operator/tool-proposals/:id/start", () => {
  it("starts for a user and refuses an API-key caller, leaving the row accepted", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, status: "accepted", drafted: true });
    const saved = { kind: testActor.kind, keyId: testActor.keyId };
    try {
      testActor.kind = "apikey";
      testActor.keyId = "start-test-key";
      const refused = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/start` });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: "OPERATOR_TOOL_PROPOSAL_USER_ONLY" } });
      expect(rowOf(sqlite(), id).status).toBe("accepted");

      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
      const started = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/start` });
      expect(started.statusCode).toBe(200);
      expect(started.json()).toEqual({ ok: true });
      expect(rowOf(sqlite(), id).status).toBe("in_progress");
    } finally {
      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
    }
  });

  it("rejects an id that is not a uuid and touches nothing", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, status: "accepted", drafted: true });
    const response = await app.inject({ method: "POST", url: "/api/operator/tool-proposals/not-a-uuid/start" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(rowOf(sqlite(), id).status).toBe("accepted");
  });
});
