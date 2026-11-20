import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { saveFleetSettings } from "../src/fleet/service.js";
import { readBehaviourEval } from "../src/operator/behaviourGate.js";
import { saveOperatorSettings } from "../src/operator/settings.js";
import type { BehaviourLlm } from "../src/operator/skillBehaviourEval.js";
import { shadowVersionFor } from "../src/operator/skillVersions.js";
import { storePassingBehaviourEval } from "./helpers/behaviour.js";
import { runTool } from "../src/assistant/tools.js";
import { runCursorProcess } from "../src/operator/runtime.js";
import { createModelRuntime } from "../src/operator/modelRuntime.js";

// Pass-through spies: the real executor still runs, and the non-execution test can see whether it was reached.
vi.mock("../src/assistant/tools.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/assistant/tools.js")>();
  return { ...mod, runTool: vi.fn(mod.runTool) };
});
vi.mock("../src/operator/runtime.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/operator/runtime.js")>();
  return { ...mod, runCursorProcess: vi.fn(mod.runCursorProcess) };
});
vi.mock("../src/operator/modelRuntime.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/operator/modelRuntime.js")>();
  return { ...mod, createModelRuntime: vi.fn(mod.createModelRuntime) };
});

// TASK-074b-4 wiring. These tests go through the real routes and the real find_skills path (the service method
// it calls), with a fake behaviour model. They prove the auto path is connected to the eval route, the routing
// path and the manual activate gate, not only the functions in autoActivation.ts.

const root = mkdtempSync(join(tmpdir(), "vg-autowire-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

function svc() {
  return app.vgOperator.service;
}

function skillMarkdown(name: string, body = "Liệt kê dự án, không ghi gì.") {
  return `---
name: ${name}
description: Kiểm tra danh sách dự án ${name}
operator: true
area: tu-van-hanh
triggers:
  - thử nghiệm ${name}
tools:
  - list_projects
risk: read
---

${body}
`;
}

function fakeLlm(): BehaviourLlm {
  return {
    model: "fake-model",
    act: async () => ({ calls: [], reply: "Đã trả lời." }),
    judge: async () => ({ answers_request: 1, no_extra_calls: 1, says_waiting: 1 }),
  };
}

/** Inserts a version row directly, so a test controls its evidence (source) and status. */
function insertVersion(name: string, version: number, markdown: string, status: string, source: string) {
  sqlite().prepare(
    "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
  ).run(name, version, markdown, JSON.stringify({ source, runIds: [] }), status, new Date().toISOString());
}

/** v1 active (user_review) and v2 a pattern draft: the usual setup for the auto path. */
function seed(name: string) {
  insertVersion(name, 1, skillMarkdown(name, "Bản đang chạy."), "active", "user_review");
  insertVersion(name, 2, skillMarkdown(name, "Bản thử, không ghi gì."), "draft", "pattern");
}

function setFlags({ shadow, auto }: { shadow: boolean; auto: boolean }) {
  saveOperatorSettings(sqlite(), { shadowEnabled: shadow });
  saveFleetSettings(sqlite(), { autoActivateReadOnlySkills: auto });
}

function statusOf(name: string, version: number): string {
  return (sqlite().prepare("SELECT status FROM operator_skill_versions WHERE name = ? AND version = ?").get(name, version) as { status: string }).status;
}

function evalRoute(name: string, version: number) {
  return app.inject({ method: "POST", url: `/api/operator/skills/${name}/versions/${version}/behaviour-eval` });
}

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "wiring.db"),
    PORT: "3012",
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
  // The eval route reads deps.behaviourLlm when it is set; the real route then runs the real runBehaviourEval.
  (svc() as unknown as { deps: { behaviourLlm?: () => BehaviourLlm } }).deps.behaviourLlm = () => fakeLlm();
});

beforeEach(() => {
  setFlags({ shadow: false, auto: false });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("auto activation wiring (TASK-074b-4)", () => {
  it("with the flags off, the eval route reports no automatic shadow and changes nothing", async () => {
    const name = "wire-off-skill";
    seed(name);
    const res = await evalRoute(name, 2);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ passed: true, autoShadow: { shadowed: false, reasons: [] } });
    expect(shadowVersionFor(sqlite(), name)).toBeNull();
    expect(statusOf(name, 2)).toBe("draft");
  });

  it("with both flags on, a passed eval through the route makes the draft the shadow version", async () => {
    const name = "wire-on-skill";
    seed(name);
    setFlags({ shadow: true, auto: true });
    const res = await evalRoute(name, 2);
    expect(res.json()).toMatchObject({ passed: true, autoShadow: { shadowed: true, reasons: [] } });
    expect(shadowVersionFor(sqlite(), name)).toMatchObject({ version: 2 });
  });

  it("with auto on but the shadow switch off, a passed eval does not shadow the draft", async () => {
    const name = "wire-noshadow-skill";
    seed(name);
    setFlags({ shadow: false, auto: true });
    const res = await evalRoute(name, 2);
    expect(res.json()).toMatchObject({ passed: true, autoShadow: { shadowed: false } });
    expect(shadowVersionFor(sqlite(), name)).toBeNull();
    expect(statusOf(name, 2)).toBe("draft");
  });

  it("five find_skills runs activate the shadow and write the user skill file; four do not",async () => {
    const name = "wire-run-skill";
    seed(name);
    setFlags({ shadow: true, auto: true });
    await evalRoute(name, 2);
    const query = `thử nghiệm ${name}`;
    for (let i = 1; i <= 4; i++) svc().findSkills(query, `run-${i}`);
    expect(statusOf(name, 1)).toBe("active");
    expect(statusOf(name, 2)).toBe("shadow");
    svc().findSkills(query, "run-5");
    expect(statusOf(name, 1)).toBe("archived");
    expect(statusOf(name, 2)).toBe("active");
    expect(readFileSync(join(svc().workspacePath(), "skills", "user", `${name}.md`), "utf8")).toContain("Bản thử, không ghi gì.");
  });

  it("a manual activate of a pattern draft with no eval is refused 409; a user_edit draft activates", async () => {
    const name = "wire-gate-skill";
    seed(name);
    const refused = await app.inject({ method: "POST", url: `/api/operator/skills/${name}/versions/2/activate` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: "SKILL_BEHAVIOUR_NOT_PASSED" } });
    expect(statusOf(name, 2)).toBe("draft");

    insertVersion(name, 3, skillMarkdown(name, "Bản người dùng sửa."), "draft", "user_edit");
    const accepted = await app.inject({ method: "POST", url: `/api/operator/skills/${name}/versions/3/activate` });
    expect(accepted.statusCode).toBe(200);
    expect(statusOf(name, 3)).toBe("active");
  });

  it("the skills listing shows why a pattern draft cannot be activated yet", async () => {
    const name = "wire-list-skill";
    seed(name);
    const items = (await app.inject({ method: "GET", url: "/api/operator/skills" })).json().items as Array<{
      name: string; version: number; activation?: { allowed: boolean; reasons: string[] };
    }>;
    const draft = items.find((item) => item.name === name && item.version === 2);
    expect(draft?.activation).toEqual({ allowed: false, reasons: ["chưa chạy eval hành vi"] });
  });

  it("TASK-152 4: the listing marks a shadow version as not activatable, so the UI disables it", async () => {
    const name = "wire-shadow-list-skill";
    seed(name);
    sqlite().prepare("UPDATE operator_skill_versions SET status = 'shadow' WHERE name = ? AND version = 2").run(name);
    const items = (await app.inject({ method: "GET", url: "/api/operator/skills" })).json().items as Array<{
      name: string; version: number; status: string; activation?: { allowed: boolean; reasons: string[] };
    }>;
    const shadow = items.find((item) => item.name === name && item.version === 2);
    expect(shadow?.status).toBe("shadow");
    expect(shadow?.activation?.allowed).toBe(false);
    expect(shadow?.activation?.reasons.join(" ")).toContain("shadow");
  });

  it("TASK-152 5: an archived version stays activatable (rollback), so the listing says allowed", async () => {
    const name = "wire-archived-list-skill";
    seed(name);
    sqlite().prepare("UPDATE operator_skill_versions SET status = 'archived' WHERE name = ? AND version = 1").run(name);
    const items = (await app.inject({ method: "GET", url: "/api/operator/skills" })).json().items as Array<{
      name: string; version: number; status: string; activation?: { allowed: boolean; reasons: string[] };
    }>;
    const archived = items.find((item) => item.name === name && item.version === 1);
    expect(archived?.status).toBe("archived");
    expect(archived?.activation?.allowed).toBe(true);
  });

  it("promoting a proposal with no eval saves it as a draft and does not activate it", () => {
    const name = "wire-promote-skill";
    const base = (svc().skillVersions() as Array<{ status: string; markdown: string }>).find((item) => item.status === "active")!;
    const markdown = base.markdown.replace(/^name: .*$/m, `name: ${name}`);
    const relativePath = `notes/skill-proposals/${name}.md`;
    mkdirSync(join(svc().workspacePath(), "notes", "skill-proposals"), { recursive: true });
    writeFileSync(join(svc().workspacePath(), relativePath), markdown, "utf8");
    expect(svc().promoteSkill(relativePath)).toMatchObject({ ok: false, saved: true, activated: false });
    expect(sqlite().prepare("SELECT status FROM operator_skill_versions WHERE name = ?").all(name)).toEqual([{ status: "draft" }]);
  });

  it("an API key bound to an owner cannot write a user_edit draft or activate by hand; a user can", async () => {
    const name = "wire-key-skill";
    seed(name);
    const saved = { kind: testActor.kind, keyId: testActor.keyId };
    try {
      testActor.kind = "apikey";
      testActor.keyId = "wire-test-key";
      const put = await app.inject({ method: "PUT", url: `/api/operator/skills/${name}/draft`, payload: { markdown: skillMarkdown(name, "Bản do khóa sửa.") } });
      expect(put.statusCode).toBe(403);
      expect(put.json()).toMatchObject({ error: { code: "OPERATOR_SKILL_USER_ONLY" } });
      expect(sqlite().prepare("SELECT COUNT(*) AS n FROM operator_skill_versions WHERE name = ? AND evidence LIKE '%user_edit%'").get(name)).toEqual({ n: 0 });
      insertVersion(name, 3, skillMarkdown(name, "Bản người dùng sửa."), "draft", "user_edit");
      const act = await app.inject({ method: "POST", url: `/api/operator/skills/${name}/versions/3/activate` });
      expect(act.statusCode).toBe(403);
      expect(act.json()).toMatchObject({ error: { code: "OPERATOR_SKILL_USER_ONLY" } });
      expect(statusOf(name, 3)).toBe("draft");

      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
      const ok = await app.inject({ method: "PUT", url: `/api/operator/skills/${name}/draft`, payload: { markdown: skillMarkdown(name, "Bản người dùng sửa qua giao diện.") } });
      expect(ok.statusCode).toBe(200);
      // v3 was inserted above as a user_edit row; the user PUT adds one more.
      expect(sqlite().prepare("SELECT COUNT(*) AS n FROM operator_skill_versions WHERE name = ? AND evidence LIKE '%user_edit%'").get(name)).toEqual({ n: 2 });
    } finally {
      testActor.kind = saved.kind;
      testActor.keyId = saved.keyId;
    }
  });

  it("the test helper stores the same shape a real eval run stores", async () => {
    const name = "wire-shape-skill";
    const helper = "wire-shape-helper";
    seed(name);
    seed(helper);
    await evalRoute(name, 2);
    storePassingBehaviourEval(sqlite(), helper, 2, { baseline: "active", activeVersion: 1 });
    const real = readBehaviourEval(sqlite(), name, 2);
    const fixture = readBehaviourEval(sqlite(), helper, 2);
    expect(real?.passed).toBe(true);
    expect(fixture?.passed).toBe(true);
    expect(Object.keys(fixture ?? {}).sort()).toEqual(Object.keys(real ?? {}).sort());
  });

  it("a non-AppError throw on the auto path is logged; find_skills still answers and the shadow stays a shadow", async () => {
    const name = "wire-throw-skill";
    seed(name);
    setFlags({ shadow: true, auto: true });
    await evalRoute(name, 2);
    for (let i = 1; i <= 4; i++) svc().findSkills(`thử nghiệm ${name}`, `throw-${i}`);
    const service = svc() as unknown as { logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void } };
    const original = service.logger;
    const error = vi.fn();
    service.logger = { info: () => undefined, error };
    try {
      // Break the shadow row's evidence JSON: the auto path's JSON.parse throws a SyntaxError, which is not an AppError.
      sqlite().prepare("UPDATE operator_skill_versions SET evidence = '{not json' WHERE name = ? AND version = 2").run(name);
      const result = svc().findSkills(`thử nghiệm ${name}`, "throw-5");
      expect(result).toHaveProperty("parts");
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(SyntaxError) }), "operator auto activation failed");
      expect(statusOf(name, 2)).toBe("shadow");
      expect(statusOf(name, 1)).toBe("active");
    } finally {
      service.logger = original;
    }
  });

  it("the eval route and five find_skills runs call no tool runner, cursor process or model runtime", async () => {
    const name = "wire-exec-skill";
    seed(name);
    setFlags({ shadow: true, auto: true });
    // The spies must really be the mocked modules, or the zero counts below prove nothing.
    expect(vi.isMockFunction(runTool)).toBe(true);
    expect(vi.isMockFunction(runCursorProcess)).toBe(true);
    expect(vi.isMockFunction(createModelRuntime)).toBe(true);
    vi.mocked(runTool).mockClear();
    vi.mocked(runCursorProcess).mockClear();
    vi.mocked(createModelRuntime).mockClear();
    await evalRoute(name, 2);
    for (let i = 1; i <= 5; i++) svc().findSkills(`thử nghiệm ${name}`, `exec-${i}`);
    // The auto path did run (the draft became active), so the zero counts are meaningful.
    expect(statusOf(name, 2)).toBe("active");
    expect(vi.mocked(runTool)).not.toHaveBeenCalled();
    expect(vi.mocked(runCursorProcess)).not.toHaveBeenCalled();
    expect(vi.mocked(createModelRuntime)).not.toHaveBeenCalled();
  });

  it("after the auto activation, the next find_skills run serves the new version", async () => {
    const name = "wire-next-skill";
    seed(name);
    setFlags({ shadow: true, auto: true });
    await evalRoute(name, 2);
    for (let i = 1; i <= 5; i++) svc().findSkills(`thử nghiệm ${name}`, `next-${i}`);
    expect(statusOf(name, 2)).toBe("active");
    const next = svc().findSkills(`thử nghiệm ${name}`, "next-6") as { parts: Array<{ hits: Array<{ name: string; version?: number }> }> };
    const hit = next.parts.flatMap((part) => part.hits).find((item) => item.name === name);
    expect(hit).toMatchObject({ version: 2 });
  });
});
