import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";
import { acceptToolProposal, dismissToolProposal, listToolProposals, recordToolProposal } from "../src/operator/toolProposals.js";
import { testActor } from "./testActor.js";

// TASK-074c-4b-1: the accept transition only. Accept is the human's decision, so the route is user-only.
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
  row: { id: string; kind?: string; status: string; fingerprint?: string },
) {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, ?, 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', ?, 1, ?, ?, ?)`)
    .run(row.id, row.kind ?? "tool", JSON.stringify(proposalArgs(`tool_${row.id.replace(/[^a-z0-9]/gi, "_")}`)), row.status,
      row.fingerprint ?? `tool:internal:${row.id}`, OLD, OLD);
}

function rowOf(sqlite: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } }, id: string) {
  return sqlite.prepare("SELECT id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at FROM improvement_requests WHERE id = ?").get(id) as Record<string, unknown>;
}

describe("TASK-074c-4b-1: acceptToolProposal moves only an open tool row to accepted", () => {
  it("accepts an open tool row, bumps updated_at and keeps every other column", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "row-open", status: "open" });
    const before = rowOf(sqlite, "row-open");
    acceptToolProposal(sqlite, "row-open");
    const after = rowOf(sqlite, "row-open");
    expect(after.status).toBe("accepted");
    expect(after.updated_at).not.toBe(OLD);
    for (const key of Object.keys(before)) {
      if (key === "status" || key === "updated_at") continue;
      expect(after[key], key).toEqual(before[key]);
    }
  });

  it("a second accept leaves the row accepted and does not change updated_at", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "row-twice", status: "open" });
    acceptToolProposal(sqlite, "row-twice");
    const first = rowOf(sqlite, "row-twice");
    expect(() => acceptToolProposal(sqlite, "row-twice")).not.toThrow();
    expect(rowOf(sqlite, "row-twice")).toEqual(first);
  });

  it.each([
    ["rejected"],
    ["done"],
    ["in_progress"],
    ["verified"],
    ["failed_verification"],
  ])("does not change a tool row whose status is %s", (status) => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: `row-${status}`, status });
    const before = rowOf(sqlite, `row-${status}`);
    acceptToolProposal(sqlite, `row-${status}`);
    expect(rowOf(sqlite, `row-${status}`)).toEqual(before);
  });

  it("does not change a non-tool row even when it is open", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "feat-1", kind: "feature", status: "open", fingerprint: "feature:x" });
    const before = rowOf(sqlite, "feat-1");
    acceptToolProposal(sqlite, "feat-1");
    expect(rowOf(sqlite, "feat-1")).toEqual(before);
  });

  it("an unknown id is a silent no-op, like dismiss", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "row-known", status: "open" });
    expect(() => acceptToolProposal(sqlite, "does-not-exist")).not.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM improvement_requests").get()).toEqual({ n: 1 });
    expect(rowOf(sqlite, "row-known").status).toBe("open");
  });

  it("dismiss after accept changes nothing", () => {
    const { sqlite } = freshDb();
    insertRow(sqlite, { id: "row-then-dismiss", status: "open" });
    acceptToolProposal(sqlite, "row-then-dismiss");
    const accepted = rowOf(sqlite, "row-then-dismiss");
    dismissToolProposal(sqlite, "row-then-dismiss");
    expect(rowOf(sqlite, "row-then-dismiss")).toEqual(accepted);
  });

  it("an accepted row is no longer listed as open, and a repeat request bumps its weight without spending budget", () => {
    const { sqlite } = freshDb();
    const args = proposalArgs("read_fixture_transcript");
    expect(recordToolProposal(sqlite, args as never, new Set()).status).toBe("proposed");
    const id = (sqlite.prepare("SELECT id FROM improvement_requests WHERE kind = 'tool'").get() as { id: string }).id;
    acceptToolProposal(sqlite, id);
    expect(listToolProposals(sqlite).map((item) => item.id)).toEqual([]);

    const spentBefore = selfImprovementBudgetStatus(sqlite).used.improvementRequests;
    const repeat = recordToolProposal(sqlite, args as never, new Set());
    expect(repeat.status).toBe("duplicate");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM improvement_requests WHERE kind = 'tool'").get()).toEqual({ n: 1 });
    expect(rowOf(sqlite, id)).toMatchObject({ status: "accepted", weight: 2 });
    expect(selfImprovementBudgetStatus(sqlite).used.improvementRequests).toBe(spentBefore);
  });
});

// Route tests go through the real app and the real user-only check. The actor is switched to an API key for the refusal case.
const root = mkdtempSync(join(tmpdir(), "vg-accept-"));
let app: ReturnType<typeof buildApp>;

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

beforeAll(() => {
  const config: AppConfig = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "accept.db"),
    PORT: "3013",
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

describe("TASK-074c-4b-1: POST /api/operator/tool-proposals/:id/accept", () => {
  it("accepts for a user and refuses an API-key caller, leaving the row open", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, status: "open" });
    const saved = { kind: testActor.kind, keyId: testActor.keyId };
    try {
      testActor.kind = "apikey";
      testActor.keyId = "accept-test-key";
      const refused = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/accept` });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: "OPERATOR_TOOL_PROPOSAL_USER_ONLY" } });
      expect(rowOf(sqlite(), id).status).toBe("open");

      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
      const accepted = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/accept` });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({ ok: true });
      expect(rowOf(sqlite(), id).status).toBe("accepted");
    } finally {
      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
    }
  });

  it("rejects an id that is not a uuid and touches nothing", async () => {
    const id = randomUUID();
    insertRow(sqlite(), { id, status: "open" });
    const response = await app.inject({ method: "POST", url: "/api/operator/tool-proposals/not-a-uuid/accept" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(rowOf(sqlite(), id).status).toBe("open");
  });
});
