import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import type { AssistantService } from "../src/assistant/service.js";
import { findRule } from "../src/auth/routePermissions.js";
import { registerOperatorRoutes } from "../src/api/operator.js";
import { ASSISTANT_TOOLS, runTool } from "../src/assistant/tools.js";
import { setOperatorToolHooks } from "../src/operator/hooks.js";
import { runCursorProcess } from "../src/operator/runtime.js";
import { AppError } from "../src/lib/errors.js";
import { OperatorService } from "../src/operator/service.js";
import { type BehaviourLlm, registryBehaviourLlm } from "../src/operator/skillBehaviourEval.js";
import { getOperatorSettings, saveOperatorSettings } from "../src/operator/settings.js";
import { markShadowVersion, clearShadowVersion } from "../src/operator/skillVersions.js";
import { shadowProgress } from "../src/operator/shadow.js";
import { OPERATOR_SKILLS, renderSkillMarkdown } from "../src/operator/skills.js";
import { saveSelfImprovementSettings, selfImprovementBudgetStatus } from "../src/operator/autonomyBudget.js";

// TASK-074b-3b. The shadow path must never reach the tool executor or the cursor runner. The eval
// path must never reach them either. Both are mocked to throw, so any call fails the test.
const generate = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/llm/structured.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/providers/llm/structured.js")>();
  return { ...actual, generateRoutedStructured: generate };
});
vi.mock("../src/assistant/tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/assistant/tools.js")>();
  return {
    ...actual,
    runTool: vi.fn(() => {
      throw new Error("runTool must not be called by shadow or eval");
    }),
  };
});
vi.mock("../src/operator/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/operator/runtime.js")>();
  return {
    ...actual,
    runCursorProcess: vi.fn(() => {
      throw new Error("runCursorProcess must not be called by shadow or eval");
    }),
  };
});

const roots: string[] = [];
const handles: Array<{ close(): void }> = [];
const NOW = new Date("2026-11-19T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const QUERY = "thử nghiệm shadow probe";
const ACTIVE_TOOLS = ["list_projects"];
const SHADOW_TOOLS = ["list_projects", "list_renders"];

type Sqlite = ReturnType<typeof setup>["sqlite"];

function skillMd(name: string, tools: string[], note: string) {
  return `---
name: ${name}
description: Thử nghiệm shadow probe trong app Video Agent
operator: true
area: tu-van-hanh
triggers:
  - ${QUERY}
tools:
${tools.map((tool) => `  - ${tool}`).join("\n")}
risk: read
---

# Thử nghiệm shadow

${note}
`;
}

function fakeLlm(mode: "pass" | "judge-throws" = "pass"): BehaviourLlm {
  return {
    model: "fake-model",
    act: async () => ({ calls: [], reply: "Đã trả lời." }),
    judge: async () => {
      if (mode === "judge-throws") throw new Error("judge down");
      return { answers_request: 1, no_extra_calls: 1, says_waiting: 1 };
    },
  };
}

function setup(opts: { behaviourLlm?: () => BehaviourLlm; providers?: unknown } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vg-shadow-gate-"));
  roots.push(root);
  const opened = openDatabase(join(root, "app.db"));
  migrateDatabase(opened.db);
  handles.push(opened.sqlite);
  const sqlite = opened.sqlite;
  // overview() reaches ensureCallerConversation through createConversation when no web conversation exists.
  const assistant = { setPendingListener: () => undefined, ensureCallerConversation: () => "conv-shadow-test" } as unknown as AssistantService;
  const service = new OperatorService({
    sqlite: sqlite as never,
    dataDir: root,
    apiUrl: "http://127.0.0.1:1",
    assistant,
    llmProviders: (opts.providers ?? {}) as never,
    behaviourLlm: opts.behaviourLlm,
    now: () => NOW,
  });
  insertVersion(sqlite, "shadow-probe", 1, skillMd("shadow-probe", ACTIVE_TOOLS, "Bản đang chạy."), "active");
  return { sqlite, service };
}

function insertVersion(sqlite: Sqlite, name: string, version: number, markdown: string, status: string) {
  sqlite.prepare(
    "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
  ).run(name, version, markdown, JSON.stringify({ source: "user_review", runIds: [] }), status, NOW.toISOString());
}

function insertRun(sqlite: Sqlite, row: { id: string; runId: string | null; createdAt: string; version?: number }) {
  sqlite.prepare(
    `INSERT INTO operator_skill_shadow_runs (id, skill_name, shadow_version, active_version, run_id, query, rank, planned, created_at)
     VALUES (?, 'shadow-probe', ?, 1, ?, ?, 1, '[]', ?)`,
  ).run(row.id, row.version ?? 2, row.runId, QUERY, row.createdAt);
}

function statusOf(sqlite: Sqlite, version: number, name = "shadow-probe"): string {
  return (sqlite.prepare("SELECT status FROM operator_skill_versions WHERE name = ? AND version = ?").get(name, version) as { status: string }).status;
}

/** The error code thrown by fn, or null when fn does not throw. */
function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED:${String(error)}`;
  }
}

async function codeOfAsync(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : `UNEXPECTED:${String(error)}`;
  }
}

beforeEach(() => {
  generate.mockReset();
  vi.mocked(runTool).mockClear();
  vi.mocked(runCursorProcess).mockClear();
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("shadow gate (TASK-074b-3b)", () => {
  // TASK-152 Việc 2 and Việc 4 at service level: a corrupt eval row (here the literal null) is a coded refusal,
  // skillVersions() still lists every row with its reason, and needs_merge is shown as not activatable.
  it("a corrupt eval row is a coded refusal from setShadowSkill, and skillVersions() still lists it with the reason", () => {
    const { sqlite, service } = setup();
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    insertVersion(sqlite, "shadow-probe", 3, skillMd("shadow-probe", SHADOW_TOOLS, "Bản đang gộp."), "needs_merge");
    sqlite.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run("operator.behaviourEval.shadow-probe.v2", "null", NOW.toISOString());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(codeOf(() => service.setShadowSkill("shadow-probe", 2))).toBe("SKILL_BEHAVIOUR_NOT_RUN");
      expect(statusOf(sqlite, 2)).toBe("draft");
      const byVersion = new Map((service.skillVersions() as Array<{ version: number; activation: { allowed: boolean; reasons: string[] } }>)
        .map((item) => [item.version, item]));
      expect(byVersion.get(2)?.activation).toEqual({ allowed: false, reasons: ["eval hành vi không đọc được: chạy lại eval hành vi"] });
      expect(byVersion.get(3)?.activation.allowed).toBe(false);
      expect(byVersion.get(3)?.activation.reasons[0]).toContain("Gộp thay đổi");
    } finally {
      warn.mockRestore();
    }
  });

  it("refuses a version with no stored eval result: SKILL_BEHAVIOUR_NOT_RUN", () => {
    const { sqlite, service } = setup();
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    expect(codeOf(() => service.setShadowSkill("shadow-probe", 2))).toBe("SKILL_BEHAVIOUR_NOT_RUN");
    expect(statusOf(sqlite, 2)).toBe("draft");
  });

  it("a passing eval lets the version become shadow", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    const result = await service.runSkillBehaviourEval("shadow-probe", 2);
    expect(result).toMatchObject({ passed: true, judgeStatus: "ok", baseline: "active", activeVersion: 1 });
    expect(statusOf(sqlite, 2)).toBe("draft");
    service.setShadowSkill("shadow-probe", 2);
    expect(statusOf(sqlite, 2)).toBe("shadow");
  });

  it("refuses when the judge was unavailable: SKILL_BEHAVIOUR_NOT_PASSED", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm("judge-throws") });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    const result = await service.runSkillBehaviourEval("shadow-probe", 2);
    expect(result.judgeStatus).toBe("unavailable");
    expect(codeOf(() => service.setShadowSkill("shadow-probe", 2))).toBe("SKILL_BEHAVIOUR_NOT_PASSED");
  });

  it("refuses an insufficient result (unparseable markdown): SKILL_BEHAVIOUR_NOT_PASSED", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, "không phải skill", "draft");
    const result = await service.runSkillBehaviourEval("shadow-probe", 2);
    expect(result.judgeStatus).toBe("insufficient");
    expect(codeOf(() => service.setShadowSkill("shadow-probe", 2))).toBe("SKILL_BEHAVIOUR_NOT_PASSED");
  });

  it("refuses when the stored result compared against an older active version: SKILL_BEHAVIOUR_NOT_PASSED", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    expect((await service.runSkillBehaviourEval("shadow-probe", 2)).passed).toBe(true);
    // The active version changes after the eval: the stored result is for version 1, not version 3.
    sqlite.prepare("UPDATE operator_skill_versions SET status = 'archived' WHERE name = 'shadow-probe' AND version = 1").run();
    insertVersion(sqlite, "shadow-probe", 3, skillMd("shadow-probe", ACTIVE_TOOLS, "Bản mới."), "active");
    expect(codeOf(() => service.setShadowSkill("shadow-probe", 2))).toBe("SKILL_BEHAVIOUR_NOT_PASSED");
  });

  it("refuses a skill with no baseline: SKILL_NO_BASELINE, even when the eval passed", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "draft-only-probe", 1, skillMd("draft-only-probe", SHADOW_TOOLS, "Chỉ có bản nháp."), "draft");
    const result = await service.runSkillBehaviourEval("draft-only-probe", 1);
    expect(result).toMatchObject({ passed: true, baseline: "none" });
    expect(codeOf(() => service.setShadowSkill("draft-only-probe", 1))).toBe("SKILL_NO_BASELINE");
    expect(statusOf(sqlite, 1, "draft-only-probe")).toBe("draft");
  });

  it("a built-in skill with no DB row is an allowed baseline", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    const builtin = OPERATOR_SKILLS.find((skill) => !skill.research);
    if (!builtin) throw new Error("test setup: no built-in skill");
    insertVersion(sqlite, builtin.name, 1, renderSkillMarkdown(builtin), "draft");
    const result = await service.runSkillBehaviourEval(builtin.name, 1);
    expect(result).toMatchObject({ baseline: "builtin", activeVersion: null, passed: true });
    service.setShadowSkill(builtin.name, 1);
    expect(sqlite.prepare("SELECT status FROM operator_skill_versions WHERE name = ? AND version = 1").get(builtin.name))
      .toEqual({ status: "shadow" });
  });

  it("setting a new shadow sends the old one back to draft, not archived", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    insertVersion(sqlite, "shadow-probe", 3, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử thứ hai."), "draft");
    await service.runSkillBehaviourEval("shadow-probe", 2);
    await service.runSkillBehaviourEval("shadow-probe", 3);
    service.setShadowSkill("shadow-probe", 2);
    service.setShadowSkill("shadow-probe", 3);
    expect(statusOf(sqlite, 2)).toBe("draft");
    expect(statusOf(sqlite, 3)).toBe("shadow");
  });

  it("the eval route stores the result and does not change any status", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    await service.runSkillBehaviourEval("shadow-probe", 2);
    expect(statusOf(sqlite, 2)).toBe("draft");
    expect(statusOf(sqlite, 1)).toBe("active");
    expect(runTool).not.toHaveBeenCalled();
    expect(runCursorProcess).not.toHaveBeenCalled();
    const stored = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get("operator.behaviourEval.shadow-probe.v2");
    expect(stored).toBeTruthy();
  });

  it("clearShadowSkill turns the shadow back into a draft and reports how many changed", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    await service.runSkillBehaviourEval("shadow-probe", 2);
    service.setShadowSkill("shadow-probe", 2);
    expect(service.clearShadowSkill("shadow-probe")).toBe(1);
    expect(statusOf(sqlite, 2)).toBe("draft");
    expect(service.clearShadowSkill("shadow-probe")).toBe(0);
  });

  it("missing version gives 404 on eval and on shadow", async () => {
    const { service } = setup({ behaviourLlm: () => fakeLlm() });
    expect(await codeOfAsync(() => service.runSkillBehaviourEval("shadow-probe", 99))).toBe("SKILL_VERSION_NOT_FOUND");
    expect(codeOf(() => service.setShadowSkill("shadow-probe", 99))).toBe("SKILL_VERSION_NOT_FOUND");
  });

  it("a provider registry that reports configured:false gives 503 before any budget is used", async () => {
    const { sqlite, service } = setup({
      providers: { resolveTask: () => ({ provider: { configured: false }, model: "x" }) },
    });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    expect(await codeOfAsync(() => service.runSkillBehaviourEval("shadow-probe", 2))).toBe("BEHAVIOUR_LLM_UNAVAILABLE");
    expect(generate).not.toHaveBeenCalled();
    expect(selfImprovementBudgetStatus(sqlite as never, NOW).used.behaviourEvals).toBe(0);
    expect(sqlite.prepare("SELECT 1 FROM app_settings WHERE key = ?").get("operator.behaviourEval.shadow-probe.v2")).toBeUndefined();
  });

  it("a registry with no resolveTask at all also gives 503 and uses no budget", async () => {
    const { sqlite, service } = setup({ providers: {} });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    expect(await codeOfAsync(() => service.runSkillBehaviourEval("shadow-probe", 2))).toBe("BEHAVIOUR_LLM_UNAVAILABLE");
    expect(selfImprovementBudgetStatus(sqlite as never, NOW).used.behaviourEvals).toBe(0);
  });

  it("shadowEnabled is off by default", () => {
    const { sqlite } = setup();
    expect(getOperatorSettings(sqlite as never).shadowEnabled).toBe(false);
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    expect(getOperatorSettings(sqlite as never).shadowEnabled).toBe(true);
  });
});

describe("shadow routes (TASK-074b-3b)", () => {
  async function routeApp(sqlite: Sqlite, service: OperatorService) {
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
      }
      return reply.code(500).send({ error: { code: "INTERNAL", message: String(error) } });
    });
    registerOperatorRoutes(app, service, sqlite as never);
    await app.ready();
    handles.push({ close: () => void app.close() });
    return app;
  }

  it("eval, shadow, unshadow: draft, then shadow, then draft; a refusal returns the gate code", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    const app = await routeApp(sqlite, service);

    const refused = await app.inject({ method: "POST", url: "/api/operator/skills/shadow-probe/versions/2/shadow" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("SKILL_BEHAVIOUR_NOT_RUN");

    const evalRes = await app.inject({ method: "POST", url: "/api/operator/skills/shadow-probe/versions/2/behaviour-eval" });
    expect(evalRes.statusCode).toBe(200);
    expect(evalRes.json()).toMatchObject({ passed: true });

    const shadowRes = await app.inject({ method: "POST", url: "/api/operator/skills/shadow-probe/versions/2/shadow" });
    expect(shadowRes.statusCode).toBe(200);
    expect(statusOf(sqlite, 2)).toBe("shadow");

    const cleared = await app.inject({ method: "DELETE", url: "/api/operator/skills/shadow-probe/shadow" });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ ok: true, cleared: 1 });
    expect(statusOf(sqlite, 2)).toBe("draft");
  });

  it("eval over the daily budget gives 429 and stores nothing", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    saveSelfImprovementSettings(sqlite as never, { budget: { behaviourEvals: 0 } }, NOW);
    const app = await routeApp(sqlite, service);
    const res = await app.inject({ method: "POST", url: "/api/operator/skills/shadow-probe/versions/2/behaviour-eval" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("SELF_IMPROVEMENT_BUDGET_LIMIT");
    expect(sqlite.prepare("SELECT 1 FROM app_settings WHERE key = ?").get("operator.behaviourEval.shadow-probe.v2")).toBeUndefined();
    expect(runTool).not.toHaveBeenCalled();
  });

  it("the shadow switch saves through PUT /api/operator/settings and the overview reads it back", async () => {
    // overview() calls llmProviders.list(), so the fake providers must expose it.
    const { sqlite, service } = setup({ providers: { list: () => [] } });
    const app = await routeApp(sqlite, service);
    const before = await app.inject({ method: "GET", url: "/api/operator/overview" });
    expect(before.statusCode).toBe(200);
    expect(before.json().settings.shadowEnabled).toBe(false);
    // Put other settings to non-default values first: the shadow switch must not reset or flip them.
    const other = await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { killed: true, maxRunsPerDay: 42 } });
    expect(other.statusCode).toBe(200);
    const beforeShadow = (await app.inject({ method: "GET", url: "/api/operator/overview" })).json().settings;
    const put = await app.inject({ method: "PUT", url: "/api/operator/settings", payload: { shadowEnabled: true } });
    expect(put.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/operator/overview" });
    expect(after.json().settings.shadowEnabled).toBe(true);
    const { shadowEnabled: _shadow, ...restAfter } = after.json().settings;
    const { shadowEnabled: _prev, ...restBefore } = beforeShadow;
    expect(restAfter).toEqual(restBefore);
    expect(restAfter.killed).toBe(true);
    expect(restAfter.maxRunsPerDay).toBe(42);
    expect(runTool).not.toHaveBeenCalled();
    expect(runCursorProcess).not.toHaveBeenCalled();
  });

  // findRule returns the first match. Asserting on the explicit pattern (not only the action) proves the
  // row is the explicit one and not the ANY /api/operator/* catch-all, which also needs operator.use.
  it("the new routes have their own explicit permission rows that need operator.use", () => {
    const cases: Array<[string, string]> = [
      ["POST", "/api/operator/skills/:name/versions/:version/behaviour-eval"],
      ["POST", "/api/operator/skills/:name/versions/:version/shadow"],
      ["DELETE", "/api/operator/skills/:name/shadow"],
    ];
    for (const [method, template] of cases) {
      const rule = findRule(method, template);
      expect(rule?.pattern).toBe(template);
      expect(rule?.action).toBe("operator.use");
    }
  });
});

describe("shadow counting and progress (TASK-074b-3b)", () => {
  it("two rows with the same run id count once", () => {
    const { sqlite } = setup();
    insertRun(sqlite, { id: "a", runId: "r1", createdAt: NOW.toISOString() });
    insertRun(sqlite, { id: "b", runId: "r1", createdAt: NOW.toISOString() });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, NOW).runs).toBe(1);
  });

  it("two rows with no run id count twice", () => {
    const { sqlite } = setup();
    insertRun(sqlite, { id: "a", runId: null, createdAt: NOW.toISOString() });
    insertRun(sqlite, { id: "b", runId: null, createdAt: NOW.toISOString() });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, NOW).runs).toBe(2);
  });

  it("a legacy row with no run id plus a row with a run id counts twice (old 3a data is not backfilled)", () => {
    const { sqlite } = setup();
    insertRun(sqlite, { id: "a", runId: null, createdAt: NOW.toISOString() });
    insertRun(sqlite, { id: "b", runId: "r1", createdAt: NOW.toISOString() });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, NOW).runs).toBe(2);
  });

  it("findSkills and suggestion in the same run count once, and the routing log keeps run id null", () => {
    const { sqlite, service } = setup();
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    markShadowVersion(sqlite as never, "shadow-probe", 2);
    const withoutRun = JSON.stringify(service.findSkills(QUERY));
    // The no-run call above is its own counted run; clear it so the r9 pair is measured alone.
    sqlite.prepare("DELETE FROM operator_skill_shadow_runs").run();
    const withRun = JSON.stringify(service.findSkills(QUERY, "r9"));
    expect(withRun).toBe(withoutRun);
    expect(runTool).not.toHaveBeenCalled();
    expect(runCursorProcess).not.toHaveBeenCalled();
    // findSkills alone must not tag the routing log with the run id.
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM operator_routing_log WHERE run_id = 'r9'").get()).toEqual({ n: 0 });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, NOW).runs).toBe(1);
    (service as unknown as { suggestion(p: string, r: string): string }).suggestion(QUERY, "r9");
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, NOW).runs).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM operator_skill_shadow_runs WHERE run_id = 'r9'").get()).toEqual({ n: 2 });
  });

  it("zero rows is dang_thu with no clock", () => {
    const { sqlite } = setup();
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, NOW)).toEqual({ runs: 0, firstAt: null, status: "dang_thu" });
  });

  it("five runs inside the window is du_mau", () => {
    const { sqlite } = setup();
    for (let i = 0; i < 5; i++) insertRun(sqlite, { id: `r${i}`, runId: null, createdAt: new Date(NOW.getTime() + i * 3600_000).toISOString() });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, new Date(NOW.getTime() + DAY))).toMatchObject({ runs: 5, status: "du_mau" });
  });

  it("the fifth run exactly at the 7-day mark still counts (du_mau)", () => {
    const { sqlite } = setup();
    for (let i = 0; i < 4; i++) insertRun(sqlite, { id: `r${i}`, runId: null, createdAt: NOW.toISOString() });
    insertRun(sqlite, { id: "r4", runId: null, createdAt: new Date(NOW.getTime() + 7 * DAY).toISOString() });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, new Date(NOW.getTime() + 7 * DAY))).toMatchObject({ status: "du_mau" });
  });

  it("four runs and the window still open is dang_thu", () => {
    const { sqlite } = setup();
    for (let i = 0; i < 4; i++) insertRun(sqlite, { id: `r${i}`, runId: null, createdAt: NOW.toISOString() });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, new Date(NOW.getTime() + DAY))).toMatchObject({ runs: 4, status: "dang_thu" });
  });

  it("four runs after the window is chua_du_mau", () => {
    const { sqlite } = setup();
    for (let i = 0; i < 4; i++) insertRun(sqlite, { id: `r${i}`, runId: null, createdAt: NOW.toISOString() });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, new Date(NOW.getTime() + 8 * DAY))).toMatchObject({ status: "chua_du_mau" });
  });

  it("a fifth run that arrives after the window does not rescue it: chua_du_mau", () => {
    const { sqlite } = setup();
    for (let i = 0; i < 4; i++) insertRun(sqlite, { id: `r${i}`, runId: null, createdAt: NOW.toISOString() });
    insertRun(sqlite, { id: "late", runId: null, createdAt: new Date(NOW.getTime() + 8 * DAY).toISOString() });
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, new Date(NOW.getTime() + 8 * DAY))).toMatchObject({ runs: 5, status: "chua_du_mau" });
  });

  it("re-shadowing the same version does not restart the clock (pinned; see the report)", () => {
    const { sqlite } = setup();
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    markShadowVersion(sqlite as never, "shadow-probe", 2);
    for (let i = 0; i < 4; i++) insertRun(sqlite, { id: `r${i}`, runId: null, createdAt: NOW.toISOString() });
    clearShadowVersion(sqlite as never, "shadow-probe");
    markShadowVersion(sqlite as never, "shadow-probe", 2);
    const later = new Date(NOW.getTime() + 10 * DAY);
    expect(shadowProgress(sqlite as never, "shadow-probe", 2, later)).toEqual({
      runs: 4, firstAt: NOW.toISOString(), status: "chua_du_mau",
    });
  });
});

describe("shadow production wiring and read model (TASK-074b-3b)", () => {
  it("find_skills through the real tool passes ctx.runId to the shadow rows and leaves the routing log null", async () => {
    const { sqlite, service } = setup();
    saveOperatorSettings(sqlite as never, { shadowEnabled: true });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    markShadowVersion(sqlite as never, "shadow-probe", 2);
    setOperatorToolHooks({ findSkills: (query: string, runId?: string | null) => service.findSkills(query, runId ?? null) } as never);
    try {
      const tool = Object.values(ASSISTANT_TOOLS).find((item) => item.name === "find_skills");
      if (!tool) throw new Error("test setup: no find_skills tool");
      await (tool.execute as unknown as (args: unknown, ctx: unknown) => Promise<unknown>)({ query: QUERY }, { runId: "r-tool" });
    } finally {
      setOperatorToolHooks(null);
    }
    expect(sqlite.prepare("SELECT DISTINCT run_id AS r FROM operator_skill_shadow_runs").all()).toEqual([{ r: "r-tool" }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM operator_routing_log WHERE run_id IS NOT NULL").get()).toEqual({ n: 0 });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("skillVersions: behaviour on every item, shadow only on shadow items, with both tool lists", async () => {
    const { sqlite, service } = setup({ behaviourLlm: () => fakeLlm() });
    insertVersion(sqlite, "shadow-probe", 2, skillMd("shadow-probe", SHADOW_TOOLS, "Bản thử."), "draft");
    insertVersion(sqlite, "shadow-probe", 3, skillMd("shadow-probe", SHADOW_TOOLS, "Bản chưa chạy eval."), "draft");
    await service.runSkillBehaviourEval("shadow-probe", 2);
    service.setShadowSkill("shadow-probe", 2);
    const byVersion = new Map((service.skillVersions() as Array<{ version: number }>).map((item) => [item.version, item]));
    expect(byVersion.get(1)).toMatchObject({ status: "active", behaviour: null, shadow: null });
    expect(byVersion.get(3)).toMatchObject({ status: "draft", behaviour: null, shadow: null });
    expect(byVersion.get(2)).toMatchObject({
      status: "shadow",
      behaviour: { passed: true },
      shadow: { runs: 0, firstAt: null, status: "dang_thu", shadowTools: SHADOW_TOOLS, baselineTools: ACTIVE_TOOLS },
    });
  });

  it("skillVersions: baselineTools is null with no baseline, and shadowTools is [] when the shadow declares none", () => {
    const { sqlite, service } = setup();
    insertVersion(sqlite, "no-base", 1, skillMd("no-base", [], "Không khai báo công cụ."), "shadow");
    const row = (service.skillVersions() as Array<{ name: string; shadow: { shadowTools: string[]; baselineTools: string[] | null } | null }>)
      .find((item) => item.name === "no-base");
    expect(row?.shadow).toMatchObject({ shadowTools: [], baselineTools: null });
  });
});

describe("production behaviour adapter (TASK-074b-3b)", () => {
  it("routes act and judge through generateRoutedStructured with the operatorPlan task", async () => {
    const { sqlite } = setup();
    generate.mockImplementation(async ({ schemaName }: { schemaName: string }) => ({
      value: schemaName === "BehaviourVerdict"
        ? { answers_request: 1, no_extra_calls: 1, says_waiting: 1 }
        : { calls: [], reply: "ok" },
    }));
    const registry = { resolveTask: () => ({ provider: { configured: true }, model: "stub-route-model" }) };
    const llm = registryBehaviourLlm(registry as never, sqlite as never);
    expect(llm.model).toBe("stub-route-model");
    expect(await llm.act({ system: "s", request: "r", transcript: [] })).toEqual({ calls: [], reply: "ok" });
    expect(await llm.judge({ system: "s", request: "r", transcript: [] })).toEqual({ answers_request: 1, no_extra_calls: 1, says_waiting: 1 });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ task: "operatorPlan", schemaName: "BehaviourAct" }));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ task: "operatorPlan", schemaName: "BehaviourVerdict" }));
  });

  it("an unconfigured provider throws before any model call", () => {
    const { sqlite } = setup();
    const registry = { resolveTask: () => ({ provider: { configured: false }, model: "x" }) };
    expect(() => registryBehaviourLlm(registry as never, sqlite as never)).toThrow();
    expect(generate).not.toHaveBeenCalled();
  });
});
