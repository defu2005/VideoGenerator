import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";
import { draftProposal, type DraftRunner } from "../src/operator/proposalDraft.js";
import { ensureProposalRoot } from "../src/operator/proposalWiring.js";
import { repoRoot } from "../src/operator/workspace.js";

// TASK-074c-3c-2b: ensureRoot inside draftProposal. It runs after the row checks and before the target check and the spend.
// Temp roots only. The tripwire checks that the real docs/proposals is unchanged across this file.
const OLD = "2026-11-20T00:00:00.000Z";
const proposalsDir = join(repoRoot(), "docs", "proposals");
const existedBefore = existsSync(proposalsDir);

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}
type Sqlite = ReturnType<typeof freshDb>;

const dirs: string[] = [];
function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "imp-root-")));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

beforeAll(() => {
  // Positive anchor: repoRoot() must point at the real repository, or the tripwire proves nothing.
  expect(existsSync(join(repoRoot(), "apps", "server", "package.json"))).toBe(true);
});
afterAll(() => {
  expect(existsSync(proposalsDir)).toBe(existedBefore);
});

function seed(sqlite: Sqlite, id: string, status: "accepted" | "open" = "accepted") {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, 'tool', ?, 'Thiếu công cụ mẫu', '{"name":"tool_draft"}', '[]', '[]', ?, 1, ?, ?, ?)`)
    .run(id, `title_${id}`, status, `tool:internal:${id}`, OLD, OLD);
}
const row = (sqlite: Sqlite, id: string) => sqlite.prepare("SELECT imp_number, drafted_at, status FROM improvement_requests WHERE id = ?")
  .get(id) as { imp_number: number | null; drafted_at: string | null; status: string };
const spentLlm = (sqlite: Sqlite) => selfImprovementBudgetStatus(sqlite).used.llmCalls;
const okRunner = (): DraftRunner => vi.fn(async () => "# IMP-1\nBản nháp");

describe("TASK-074c-3c-2b: draftProposal with ensureRoot", () => {
  it("creates a missing leaf under an existing parent, then drafts the file", async () => {
    const sqlite = freshDb();
    const root = join(tempDir(), "proposals");
    seed(sqlite, "root-1");
    const runner = okRunner();

    const result = await draftProposal(sqlite, "root-1", { runner, root, ensureRoot: ensureProposalRoot });

    expect(result).toMatchObject({ status: "drafted", impNumber: 1 });
    expect(readFileSync(join(root, "IMP-1.md"), "utf8")).toBe("# IMP-1\nBản nháp");
    expect(spentLlm(sqlite)).toBe(1);
    sqlite.close();
  });

  it("a missing parent is refused as bad_root before any spend, and no runner call; the row stays accepted", async () => {
    const sqlite = freshDb();
    const root = join(tempDir(), "missing", "proposals");
    seed(sqlite, "root-2");
    const runner = okRunner();

    const result = await draftProposal(sqlite, "root-2", { runner, root, ensureRoot: ensureProposalRoot });

    expect(result).toMatchObject({ status: "refused", reason: "bad_root" });
    expect(existsSync(root)).toBe(false);
    expect(runner).not.toHaveBeenCalled();
    expect(spentLlm(sqlite)).toBe(0);
    expect(row(sqlite, "root-2")).toMatchObject({ status: "accepted", drafted_at: null });
    sqlite.close();
  });

  it("a row that is not accepted never triggers ensureRoot", async () => {
    const sqlite = freshDb();
    const root = join(tempDir(), "proposals");
    seed(sqlite, "root-3", "open");
    const ensureRoot = vi.fn();

    const result = await draftProposal(sqlite, "root-3", { runner: okRunner(), root, ensureRoot });

    expect(result).toMatchObject({ status: "skipped", reason: "not_accepted" });
    expect(ensureRoot).not.toHaveBeenCalled();
    expect(existsSync(root)).toBe(false);
    sqlite.close();
  });

  it("an ensureRoot that throws is swallowed; the target check then decides", async () => {
    const sqlite = freshDb();
    const root = tempDir();
    seed(sqlite, "root-4");
    const ensureRoot = vi.fn(() => { throw new Error("boom"); });

    const result = await draftProposal(sqlite, "root-4", { runner: okRunner(), root, ensureRoot });

    expect(ensureRoot).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "drafted", impNumber: 1 });
    sqlite.close();
  });
});
