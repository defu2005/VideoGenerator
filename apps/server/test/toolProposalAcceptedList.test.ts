import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { acceptToolProposal, listAcceptedToolProposals, recordToolProposal } from "../src/operator/toolProposals.js";
import { testActor } from "./testActor.js";

// TASK-074c-4b-2: read-only listing of accepted tool rows. No transition, no draft, no migration.
const OLD = "2026-11-20T00:00:00.000Z";

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened;
}

function proposalArgs(name: string) {
  return {
    kind: "internal", name,
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"],
  };
}

function insertRow(
  sqlite: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } },
  row: { id: string; kind?: string; status: string; proposal?: string; createdAt?: string },
) {
  const created = row.createdAt ?? OLD;
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, ?, 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', ?, 1, ?, ?, ?)`)
    .run(row.id, row.kind ?? "tool", row.proposal ?? JSON.stringify(proposalArgs(`tool_${row.id.replace(/[^a-z0-9]/gi, "_")}`)),
      row.status, `tool:internal:${row.id}`, created, created);
}

function idsOf(items: Array<{ id: string }>) {
  return items.map((item) => item.id);
}

describe("TASK-074c-4b-2: listAcceptedToolProposals returns only accepted tool rows", () => {
  it("lists accepted tool rows and nothing else", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "acc-1", status: "accepted" });
    insertRow(sqlite, { id: "open-1", status: "open" });
    insertRow(sqlite, { id: "rej-1", status: "rejected" });
    insertRow(sqlite, { id: "prog-1", status: "in_progress" });
    insertRow(sqlite, { id: "done-1", status: "done" });
    insertRow(sqlite, { id: "feat-1", kind: "feature", status: "accepted" });
    expect(idsOf(listAcceptedToolProposals(sqlite))).toEqual(["acc-1"]);
  });

  it("returns the same item shape as the open list, with id, createdAt and the parsed proposal", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "acc-shape", status: "accepted", createdAt: "2026-11-20T01:02:03.000Z" });
    const [item] = listAcceptedToolProposals(sqlite);
    expect(item).toMatchObject({
      id: "acc-shape",
      createdAt: "2026-11-20T01:02:03.000Z",
      kind: "internal",
      name: "tool_acc_shape",
      reproduction: "Mở dự án thử có file chép lời",
      acceptance: ["Trả bản chép lời đúng dự án"],
    });
  });

  it("orders newest first and caps the result at 50", () => {
    const { sqlite } = freshDb();
    for (let i = 0; i <= 50; i += 1) {
      insertRow(sqlite, { id: `acc-${i}`, status: "accepted", createdAt: `2026-11-20T00:00:${String(i).padStart(2, "0")}.000Z` });
    }
    const items = listAcceptedToolProposals(sqlite);
    expect(items).toHaveLength(50);
    expect(items[0]?.id).toBe("acc-50");
    expect(idsOf(items)).not.toContain("acc-0");
  });

  it("skips a row whose stored proposal is not valid, and warns with its id", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "acc-good", status: "accepted" });
    insertRow(sqlite, { id: "acc-bad", status: "accepted", proposal: "{not json" });
    const warnings: unknown[] = [];
    const logger = { warn: (obj: unknown) => { warnings.push(obj); } };
    expect(idsOf(listAcceptedToolProposals(sqlite, logger))).toEqual(["acc-good"]);
    expect(warnings).toEqual([{ id: "acc-bad" }]);
  });

  it("lists a row right after accept, and no longer lists it once it is gone from accepted", () => {
    const { sqlite } = freshDb();
    expect(recordToolProposal(sqlite, proposalArgs("read_fixture_transcript") as never, new Set()).status).toBe("proposed");
    const id = (sqlite.prepare("SELECT id FROM improvement_requests WHERE kind = 'tool'").get() as { id: string }).id;
    expect(listAcceptedToolProposals(sqlite)).toEqual([]);
    acceptToolProposal(sqlite, id);
    expect(idsOf(listAcceptedToolProposals(sqlite))).toEqual([id]);
    sqlite.prepare("UPDATE improvement_requests SET status = 'in_progress' WHERE id = ?").run(id);
    expect(listAcceptedToolProposals(sqlite)).toEqual([]);
  });
});

// Route tests go through the real app. Reading is not a decision, so the route has no user-only check.
const root = mkdtempSync(join(tmpdir(), "vg-accepted-list-"));
let app: ReturnType<typeof buildApp>;

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

beforeAll(() => {
  const config: AppConfig = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "accepted-list.db"),
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

describe("TASK-074c-4b-2: GET /api/operator/tool-proposals/accepted", () => {
  it("returns { items } of accepted tool rows for a user", async () => {
    const accId = randomUUID();
    const openId = randomUUID();
    insertRow(sqlite(), { id: accId, status: "accepted" });
    insertRow(sqlite(), { id: openId, status: "open" });
    const response = await app.inject({ method: "GET", url: "/api/operator/tool-proposals/accepted" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ id: string }> };
    expect(idsOf(body.items)).toContain(accId);
    expect(idsOf(body.items)).not.toContain(openId);
  });

  it("is readable by an API-key caller, so reading has no user-only check", async () => {
    const accId = randomUUID();
    insertRow(sqlite(), { id: accId, status: "accepted" });
    const saved = { kind: testActor.kind, keyId: testActor.keyId };
    try {
      testActor.kind = "apikey";
      testActor.keyId = "accepted-list-test-key";
      const response = await app.inject({ method: "GET", url: "/api/operator/tool-proposals/accepted" });
      expect(response.statusCode).toBe(200);
      expect(idsOf((response.json() as { items: Array<{ id: string }> }).items)).toContain(accId);
    } finally {
      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
    }
  });
});
