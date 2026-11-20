import { mkdtempSync, readFileSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";
import { draftProposal } from "../src/operator/proposalDraft.js";
import { createProposalRunner } from "../src/operator/proposalRunner.js";
import type { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import type { LlmProvider } from "../src/providers/llm/types.js";

// TASK-074c-3c-2b: the real draft runner. The stub registry has one route, so these tests pin a single provider call.
// Failover paths (chain, gateway, quota swap) are not exercised here; they are recorded as limits in the slice report.
// Every test uses a stub provider and a temp root. No test starts the app or touches docs/proposals/.
const OLD = "2026-11-20T00:00:00.000Z";

function freshDb() {
  const opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  return opened.sqlite;
}
type Sqlite = ReturnType<typeof freshDb>;

const roots: string[] = [];
function tempRoot(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "imp-runner-")));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seed(sqlite: Sqlite, id: string) {
  sqlite.prepare(`INSERT INTO improvement_requests (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, 'tool', ?, 'Thiếu công cụ mẫu', '{"name":"tool_draft"}', '[]', '[]', 'accepted', 1, ?, ?, ?)`)
    .run(id, `title_${id}`, `tool:internal:${id}`, OLD, OLD);
}
const row = (sqlite: Sqlite, id: string) => sqlite.prepare("SELECT imp_number, drafted_at, status FROM improvement_requests WHERE id = ?")
  .get(id) as { imp_number: number | null; drafted_at: string | null; status: string };
const spentLlm = (sqlite: Sqlite) => selfImprovementBudgetStatus(sqlite).used.llmCalls;

// A provider that answers once with the given text and finish reason.
function providerReturning(text: string, finishReason: "stop" | "length" = "stop") {
  return {
    id: "mock",
    label: "Mock",
    defaultModel: "mock-v1",
    generate: vi.fn(async () => ({
      text,
      usage: { inputTokens: 3, outputTokens: 5 },
      model: "mock-v1",
      provider: "mock",
      finishReason,
    })),
  } as unknown as LlmProvider & { generate: ReturnType<typeof vi.fn> };
}

// The smallest registry that createProposalRunner's routed call can use: one route, no chain, gateway off, no quota.
function registryFor(provider: ReturnType<typeof providerReturning>): LlmProviderRegistry {
  return {
    quota: undefined,
    failover: {
      cooldownFor: () => undefined,
      recordSuccess: () => undefined,
      recordFailure: () => undefined,
      recordFailover: () => undefined,
    },
    getGatewaySettings: () => ({ mode: "off", mappings: [] }),
    resolveTask: () => ({ provider, model: "mock-v1", source: "default" }),
  } as unknown as LlmProviderRegistry;
}

const validAnswer = JSON.stringify({ markdown: "# IMP-1\nBản nháp guide" });

describe("TASK-074c-3c-2b: createProposalRunner with a single-route stub", () => {
  it("returns the markdown from one provider call, and the draft is written and marked", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "run-1");
    const provider = providerReturning(validAnswer);
    const runner = createProposalRunner({ registry: registryFor(provider), sqlite });

    const result = await draftProposal(sqlite, "run-1", { runner, root });

    expect(result).toMatchObject({ status: "drafted", impNumber: 1 });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.generate.mock.calls[0][0]).toMatchObject({ maxOutputTokens: 4096 });
    expect(readFileSync(join(root, "IMP-1.md"), "utf8")).toBe("# IMP-1\nBản nháp guide");
    expect(row(sqlite, "run-1").drafted_at).not.toBeNull();
    expect(spentLlm(sqlite)).toBe(1);
    sqlite.close();
  });

  it("a truncated answer throws LLM_OUTPUT_TRUNCATED: no file, drafted_at NULL, row still accepted, number kept, one spend", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "run-2");
    const provider = providerReturning("{\"markdown\":\"# IMP-1 cut off", "length");
    const runner = createProposalRunner({ registry: registryFor(provider), sqlite });

    await expect(draftProposal(sqlite, "run-2", { runner, root })).rejects.toMatchObject({ code: "LLM_OUTPUT_TRUNCATED" });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(existsSync(join(root, "IMP-1.md"))).toBe(false);
    expect(row(sqlite, "run-2")).toMatchObject({ status: "accepted", imp_number: 1, drafted_at: null });
    expect(spentLlm(sqlite)).toBe(1);
    sqlite.close();
  });

  it("an answer that is not the schema throws LLM_INVALID_OUTPUT with no repair call, no file, one spend", async () => {
    const sqlite = freshDb();
    const root = tempRoot();
    seed(sqlite, "run-3");
    const provider = providerReturning("không phải JSON");
    const runner = createProposalRunner({ registry: registryFor(provider), sqlite });

    await expect(draftProposal(sqlite, "run-3", { runner, root })).rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT" });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(existsSync(join(root, "IMP-1.md"))).toBe(false);
    expect(row(sqlite, "run-3").drafted_at).toBeNull();
    expect(spentLlm(sqlite)).toBe(1);
    sqlite.close();
  });
});
