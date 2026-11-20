import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { consumeSelfImprovementBudget, selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";
import { repoRoot } from "../src/operator/workspace.js";
import { LlmError } from "../src/providers/llm/types.js";
import { testActor } from "./testActor.js";

// TASK-074c-3c-2 (slice a): POST /api/operator/tool-proposals/:id/draft. User-only. The runner and the root come from the
// test (an injected dependency), so no test touches docs/proposals/ or a real model.
const OLD = "2026-11-20T00:00:00.000Z";
// The real docs/proposals is snapshotted before any test runs (existence and entry names). Production creates the directory
// on the first real draft, so a plain absence check would fail there; a snapshot compare still detects writes.
const proposalsDir = join(repoRoot(), "docs", "proposals");
function snapshotProposals(): { exists: boolean; names: string[] } {
  return existsSync(proposalsDir) ? { exists: true, names: readdirSync(proposalsDir).sort() } : { exists: false, names: [] };
}
const proposalsBefore = snapshotProposals();
const dir = mkdtempSync(join(tmpdir(), "vg-draft-route-"));

function configFor(name: string): AppConfig {
  return parseConfig({
    DATA_DIR: join(dir, `data-${name}`),
    DATABASE_PATH: join(dir, `${name}.db`),
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
}

type App = ReturnType<typeof buildApp>;
type Sqlite = import("better-sqlite3").Database;
const sqliteOf = (a: App) => (a.vgPublish.service as unknown as { sqlite: Sqlite }).sqlite;

// The draft dependency is read at request time, so each test can swap the runner or the root.
const draft = { runner: vi.fn(async (_request: unknown) => "# IMP\nBản nháp"), root: "" };
let root = "";
let app: App;
let appNoDraft: App;

beforeAll(() => {
  app = buildApp({ testActor, config: configFor("a"), proposalDraft: draft });
  appNoDraft = buildApp({ testActor, config: configFor("b") });
});

beforeEach(() => {
  root = mkdtempSync(join(dir, "root-"));
  draft.root = root;
  draft.runner = vi.fn(async (_request: unknown) => "# IMP\nBản nháp");
});

afterAll(async () => {
  await app.close();
  await appNoDraft.close();
  rmSync(dir, { recursive: true, force: true });
});

function seed(sqlite: Sqlite, id: string, status = "accepted", kind = "tool") {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, ?, ?, 'Thiếu công cụ mẫu', '{"name":"tool_draft"}', '[]', '[]', ?, 1, ?, ?, ?)`)
    .run(id, kind, `title_${id}`, status, `tool:internal:${id}`, OLD, OLD);
}
const row = (sqlite: Sqlite, id: string) => sqlite.prepare("SELECT status, imp_number, drafted_at FROM improvement_requests WHERE id = ?")
  .get(id) as { status: string; imp_number: number | null; drafted_at: string | null };
const spent = (sqlite: Sqlite) => selfImprovementBudgetStatus(sqlite).used.llmCalls;
const nextImpNumber = (sqlite: Sqlite) => (sqlite.prepare("SELECT COALESCE(MAX(imp_number), 0) + 1 AS n FROM improvement_requests").get() as { n: number }).n;
const post = (a: App, id: string) => a.inject({ method: "POST", url: `/api/operator/tool-proposals/${id}/draft` });

describe("TASK-074c-3c-2 slice (a): POST /api/operator/tool-proposals/:id/draft", () => {
  it("drafts for a user: 200 with status and number only, the file written, drafted_at set, no path or root in the body", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    const before = spent(sqlite);
    const res = await post(app, id);
    expect(res.statusCode).toBe(200);
    const n = row(sqlite, id).imp_number;
    expect(res.json()).toEqual({ status: "drafted", impNumber: n });
    expect(res.body).not.toContain(JSON.stringify(root).slice(1, -1));
    expect(readFileSync(join(root, `IMP-${n}.md`), "utf8")).toBe("# IMP\nBản nháp");
    expect(row(sqlite, id).drafted_at).not.toBeNull();
    expect(spent(sqlite) - before).toBe(1);
    expect(draft.runner).toHaveBeenCalledTimes(1);
  });

  it("returns skipped already_drafted on a second call, with no spend and no runner call", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    await post(app, id);
    const before = spent(sqlite);
    const res = await post(app, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "skipped", reason: "already_drafted" });
    expect(spent(sqlite) - before).toBe(0);
    expect(draft.runner).toHaveBeenCalledTimes(1);
  });

  it("returns skipped not_accepted for an unknown id and for an open row, with no number and no spend", async () => {
    const sqlite = sqliteOf(app);
    const openId = randomUUID();
    seed(sqlite, openId, "open");
    const before = spent(sqlite);
    expect((await post(app, randomUUID())).json()).toEqual({ status: "skipped", reason: "not_accepted" });
    expect((await post(app, openId)).json()).toEqual({ status: "skipped", reason: "not_accepted" });
    expect(row(sqlite, openId)).toEqual({ status: "open", imp_number: null, drafted_at: null });
    expect(spent(sqlite) - before).toBe(0);
    expect(draft.runner).not.toHaveBeenCalled();
  });

  it("returns refused exists when IMP-<n>.md is already there: the number is kept, no spend, no runner call", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    const predicted = nextImpNumber(sqlite);
    writeFileSync(join(root, `IMP-${predicted}.md`), "file cũ");
    const before = spent(sqlite);
    const res = await post(app, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "refused", reason: "exists", impNumber: predicted });
    expect(row(sqlite, id)).toEqual({ status: "accepted", imp_number: predicted, drafted_at: null });
    expect(readFileSync(join(root, `IMP-${predicted}.md`), "utf8")).toBe("file cũ");
    expect(spent(sqlite) - before).toBe(0);
    expect(draft.runner).not.toHaveBeenCalled();
  });

  it("returns refused bad_root for a root that does not exist, with no spend and no runner call", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    draft.root = join(dir, "no-such-root");
    const before = spent(sqlite);
    const res = await post(app, id);
    const n = row(sqlite, id).imp_number;
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "refused", reason: "bad_root", impNumber: n });
    expect(spent(sqlite) - before).toBe(0);
    expect(draft.runner).not.toHaveBeenCalled();
  });

  it("returns skipped in_flight for a second concurrent call while the first is in the runner, one runner call and one spend", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    let started!: () => void;
    const startedP = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    draft.runner = vi.fn(async (_request: unknown) => {
      if (first) { first = false; started(); await gate; }
      return "# IMP\nBản nháp";
    });
    const before = spent(sqlite);
    try {
      const firstReq = post(app, id);
      // Fail fast instead of hanging if the route never reaches the runner.
      await Promise.race([startedP, new Promise<void>((_, reject) => setTimeout(() => reject(new Error("runner never started")), 5000))]);
      const second = await post(app, id);
      expect(second.json()).toEqual({ status: "skipped", reason: "in_flight" });
      release();
      const firstRes = await firstReq;
      expect(firstRes.json()).toEqual({ status: "drafted", impNumber: row(sqlite, id).imp_number });
    } finally {
      release();
    }
    expect(draft.runner).toHaveBeenCalledTimes(1);
    expect(spent(sqlite) - before).toBe(1);
  });

  it("returns 500 INTERNAL_ERROR when the runner throws, keeps the number, and leaves the row accepted with no file", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    draft.runner = vi.fn(async (_request: unknown) => { throw new Error("llm down"); });
    const before = spent(sqlite);
    const res = await post(app, id);
    const n = row(sqlite, id).imp_number;
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(row(sqlite, id)).toEqual({ status: "accepted", imp_number: n, drafted_at: null });
    expect(existsSync(join(root, `IMP-${n}.md`))).toBe(false);
    expect(spent(sqlite) - before).toBe(1);
  });

  it("refuses an API-key caller with 403 OPERATOR_TOOL_PROPOSAL_USER_ONLY, with no number, no spend and no runner call", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    const saved = { kind: testActor.kind, keyId: testActor.keyId };
    const before = spent(sqlite);
    try {
      testActor.kind = "apikey";
      testActor.keyId = "draft-test-key";
      const res = await post(app, id);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: "OPERATOR_TOOL_PROPOSAL_USER_ONLY" } });
      // The user check runs before parsing: a bad id from an API key is still 403, not 400.
      const badId = await post(app, "not-a-uuid");
      expect(badId.statusCode).toBe(403);
      expect(badId.json()).toMatchObject({ error: { code: "OPERATOR_TOOL_PROPOSAL_USER_ONLY" } });
    } finally {
      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
    }
    expect(row(sqlite, id)).toEqual({ status: "accepted", imp_number: null, drafted_at: null });
    expect(spent(sqlite) - before).toBe(0);
    expect(draft.runner).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR for a non-uuid id, with no runner call", async () => {
    const res = await post(app, "not-a-uuid");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(draft.runner).not.toHaveBeenCalled();
  });

  it("returns 503 OPERATOR_PROPOSAL_DRAFT_UNAVAILABLE when no draft dependency is injected, with no number and no spend", async () => {
    const sqlite = sqliteOf(appNoDraft);
    const id = randomUUID();
    seed(sqlite, id);
    const before = spent(sqlite);
    const res = await post(appNoDraft, id);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: "OPERATOR_PROPOSAL_DRAFT_UNAVAILABLE" } });
    expect(row(sqlite, id)).toEqual({ status: "accepted", imp_number: null, drafted_at: null });
    expect(spent(sqlite) - before).toBe(0);
  });

  it("the route does not change docs/proposals under the repository root", () => {
    // Positive anchor first: repoRoot() must point at the real repository, or the snapshot compare proves nothing.
    expect(existsSync(join(repoRoot(), "apps", "server", "package.json"))).toBe(true);
    expect(snapshotProposals()).toEqual(proposalsBefore);
  });

  // TASK-074c-3c-2b (server): an LLM failure becomes a coded non-2xx with a fixed Vietnamese message. The runner's text never reaches the body.
  it("returns 429 OPERATOR_PROPOSAL_DRAFT_BUDGET_WAIT when the autonomy budget stops the model call: number kept, row accepted, no file", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    draft.runner = vi.fn(async (_request: unknown) => {
      throw new LlmError("Đã chạm hạn mức chi. Chờ kỳ ngân sách mới hoặc dùng model miễn phí.", "AUTONOMY_BUDGET_WAIT", true);
    });
    const before = spent(sqlite);
    const res = await post(app, id);
    const n = row(sqlite, id).imp_number;
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: { code: "OPERATOR_PROPOSAL_DRAFT_BUDGET_WAIT", message: "Hạn mức chi của hệ thống đã hết. Chờ kỳ ngân sách mới rồi soạn lại." } });
    expect(res.body).not.toContain("Chờ kỳ ngân sách mới hoặc dùng model miễn phí");
    expect(row(sqlite, id)).toEqual({ status: "accepted", imp_number: n, drafted_at: null });
    expect(existsSync(join(root, `IMP-${n}.md`))).toBe(false);
    // llmCalls is spent before the runner runs, so this wait cost one unit even though no model answered. Named as a limit in the report.
    expect(spent(sqlite) - before).toBe(1);
  });

  it("returns 502 OPERATOR_PROPOSAL_DRAFT_LLM_FAILED for another LLM failure, without the runner's text in the body", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    draft.runner = vi.fn(async (_request: unknown) => {
      throw new LlmError("SECRET_RUNNER_TEXT output cut off", "LLM_OUTPUT_TRUNCATED", false);
    });
    const before = spent(sqlite);
    const res = await post(app, id);
    const n = row(sqlite, id).imp_number;
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: "OPERATOR_PROPOSAL_DRAFT_LLM_FAILED", message: "Model không soạn được bản nháp. Thử lại sau." } });
    expect(res.body).not.toContain("SECRET_RUNNER_TEXT");
    expect(row(sqlite, id)).toEqual({ status: "accepted", imp_number: n, drafted_at: null });
    expect(existsSync(join(root, `IMP-${n}.md`))).toBe(false);
    expect(spent(sqlite) - before).toBe(1);
  });

  // Last on purpose: exhausting llmCalls would make every later spend check return budget_limit.
  it("returns pending budget_limit when llmCalls is exhausted, keeps the number, and calls no runner", async () => {
    const sqlite = sqliteOf(app);
    const id = randomUUID();
    seed(sqlite, id);
    const status = selfImprovementBudgetStatus(sqlite);
    for (let i = status.used.llmCalls; i < status.limits.llmCalls; i++) consumeSelfImprovementBudget(sqlite, "llmCalls");
    const res = await post(app, id);
    const n = row(sqlite, id).imp_number;
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "pending", reason: "budget_limit", impNumber: n });
    expect(row(sqlite, id)).toEqual({ status: "accepted", imp_number: n, drafted_at: null });
    expect(draft.runner).not.toHaveBeenCalled();
  });
});
