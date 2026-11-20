import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { testActor } from "./testActor.js";

// TASK-074c-6k: dismiss is a user decision, like accept/start/check-done/draft. An API-key caller must be refused
// with OPERATOR_TOOL_PROPOSAL_USER_ONLY and the open row must stay open. Route: POST /api/operator/tool-proposals/:id/dismiss.
const OLD = "2026-11-20T00:00:00.000Z";

function proposalJson(name: string) {
  return JSON.stringify({
    kind: "internal", name,
    operation: "Đọc bản chép lời đã tạo", reproduction: "Mở dự án thử có file chép lời",
    impact: "Agent lấy được văn bản", inputSchema: { type: "object" }, outputSchema: { type: "object" },
    permissions: ["Đọc dự án được chọn"], dataSent: "Không gửi ra ngoài", requiresConfirmation: false,
    acceptance: ["Trả bản chép lời đúng dự án"],
  });
}

function insertOpenTool(
  sqlite: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } },
  id: string,
) {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at, imp_number, drafted_at)
    VALUES (?, 'tool', 'Tiêu đề', 'Vấn đề', ?, '[]', '[]', 'open', 1, ?, ?, ?, NULL, NULL)`)
    .run(id, proposalJson(`tool_${id.replace(/[^a-z0-9]/gi, "_")}`), `tool:internal:${id}`, OLD, OLD);
}

function statusOf(sqlite: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } }, id: string) {
  return (sqlite.prepare("SELECT status FROM improvement_requests WHERE id = ?").get(id) as { status: string } | undefined)?.status;
}

const root = mkdtempSync(join(tmpdir(), "vg-dismiss-"));
let app: ReturnType<typeof buildApp>;

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

beforeAll(() => {
  const config: AppConfig = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "dismiss.db"),
    PORT: "3015",
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

describe("TASK-074c-6k: POST /api/operator/tool-proposals/:id/dismiss is user-only", () => {
  it("refuses an API-key caller with 403 and leaves the open row open", async () => {
    const id = randomUUID();
    insertOpenTool(sqlite(), id);
    const saved = { kind: testActor.kind, keyId: testActor.keyId };
    try {
      testActor.kind = "apikey";
      testActor.keyId = "dismiss-test-key";
      const refused = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/dismiss` });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: "OPERATOR_TOOL_PROPOSAL_USER_ONLY" } });
      expect(statusOf(sqlite(), id)).toBe("open");
    } finally {
      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
    }
  });

  it("lets a user dismiss an open tool row, which becomes rejected", async () => {
    const id = randomUUID();
    insertOpenTool(sqlite(), id);
    const ok = await app.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/dismiss` });
    expect(ok.statusCode).toBe(200);
    expect(statusOf(sqlite(), id)).toBe("rejected");
  });
});
