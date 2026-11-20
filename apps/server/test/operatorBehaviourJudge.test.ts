import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { generateRoutedStructured } from "../src/providers/llm/structured.js";
import type { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { registryBehaviourLlm, runBehaviourEval } from "../src/operator/skillBehaviourEval.js";

// TASK-074b-2 review point 3: the judge must score the request and the run only, never the skill body.
// The structured-call module is stubbed so the exact prompts can be read back.
vi.mock("../src/providers/llm/structured.js", () => ({
  generateRoutedStructured: vi.fn(async ({ schemaName }: { schemaName: string }) =>
    schemaName === "BehaviourVerdict"
      ? { value: { answers_request: 1, no_extra_calls: 1, says_waiting: 1 } }
      : { value: { calls: [], reply: "đã xong" } },
  ),
}));

const SKILL_MARK = "SKILL_BODY_SECRET_MARK";
const NOW = new Date("2026-11-20T00:00:00.000Z");

const SKILL_MD = `---
name: probe-judge-prompt
description: Skill thử nghiệm prompt của judge
operator: true
area: tu-van-hanh
triggers:
  - kiểm tra dự án
tools:
  - list_projects
risk: read
---

# Thử nghiệm

${SKILL_MARK}
`;

// The registry is only read for the route; the structured call itself is mocked.
const fakeRegistry = {
  resolveTask: () => ({ provider: { configured: true }, model: "fake-model" }),
} as unknown as LlmProviderRegistry;

let root: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "vg-judge-prompt-"));
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  sqlite = opened.sqlite;
});

afterEach(() => {
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

describe("behaviour judge prompt", () => {
  it("the act prompt carries the skill body, the judge prompt does not", async () => {
    sqlite.prepare(
      "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
    ).run("probe-judge-prompt", 1, SKILL_MD, JSON.stringify({ source: "user_review", runIds: [] }), "draft", NOW.toISOString());

    const llm = registryBehaviourLlm(fakeRegistry, sqlite);
    const result = await runBehaviourEval(sqlite, "probe-judge-prompt", 1, { llm, now: NOW });
    expect(result.judgeStatus).toBe("ok");

    const { mock } = vi.mocked(generateRoutedStructured);
    const calls = mock.calls.map((args) => args[0] as { schemaName: string; system: string; prompt: string });
    const acts = calls.filter((item) => item.schemaName === "BehaviourAct");
    const judges = calls.filter((item) => item.schemaName === "BehaviourVerdict");

    expect(acts.length).toBeGreaterThan(0);
    expect(judges.length).toBeGreaterThan(0);
    for (const act of acts) expect(act.system).toContain(SKILL_MARK);
    for (const judge of judges) {
      expect(judge.system).not.toContain(SKILL_MARK);
      expect(judge.prompt).not.toContain(SKILL_MARK);
      expect(judge.prompt).toContain("request");
      expect(judge.prompt).toContain("transcript");
      expect(judge.prompt).not.toContain('"skill"');
    }
  });
});
