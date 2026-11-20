import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { subscribeAgentEvents } from "../src/events/agentBus.js";
import { saveFleetSettings } from "../src/fleet/service.js";
import { saveOperatorSettings } from "../src/operator/settings.js";
import type { BehaviourLlm } from "../src/operator/skillBehaviourEval.js";

// TASK-074b-4 items 4-5: a failed write of an active skill's file must not undo the activation (the DB commit stays),
// must open a supervisor finding, notify once when it opens, and must heal (rewrite the file from the DB and resolve the
// finding) on the next sync. The failure is real, not mocked: a directory sits where <name>.md must be, so writeFileSync
// fails with EISDIR while the skills/user directory stays readable.

const root = mkdtempSync(join(tmpdir(), "vg-skillfile-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

function sqlite() {
  return (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
}

function svc() {
  return app.vgOperator.service;
}

function skillMarkdown(name: string, body: string) {
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

function insertVersion(name: string, version: number, markdown: string, status: string, source: string) {
  sqlite().prepare(
    "INSERT INTO operator_skill_versions (name, version, markdown, evidence, score, status, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
  ).run(name, version, markdown, JSON.stringify({ source, runIds: [] }), status, new Date().toISOString());
}

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

function findingFor(name: string) {
  return sqlite().prepare("SELECT kind, status FROM supervisor_findings WHERE dedupe_key = ?")
    .get(`skill-file-write:${name}`) as { kind: string; status: string } | undefined;
}

function userSkillDir() {
  return join(svc().workspacePath(), "skills", "user");
}

/** A directory where <name>.md must be: the file write for that skill fails, the rest of the directory still reads. */
function blockUserSkillFile(name: string) {
  const path = join(userSkillDir(), `${name}.md`);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function unblockUserSkillFile(name: string) {
  rmSync(join(userSkillDir(), `${name}.md`), { recursive: true, force: true });
}

/** Collects the summaries of supervisor_finding events while the returned off() is not yet called. */
function collectFindingEvents() {
  const hits: string[] = [];
  const off = subscribeAgentEvents((event: AgentEvent) => {
    if (event.type === "supervisor_finding") hits.push(String((event as { summary?: string }).summary));
  });
  return { hits, off };
}

function evalRoute(name: string, version: number) {
  return app.inject({ method: "POST", url: `/api/operator/skills/${name}/versions/${version}/behaviour-eval` });
}

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "skillfile.db"),
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
  (svc() as unknown as { deps: { behaviourLlm?: () => BehaviourLlm } }).deps.behaviourLlm = () => fakeLlm();
});

beforeEach(() => {
  setFlags({ shadow: false, auto: false });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("user skill file write failure (TASK-074b-4 items 4-5)", () => {
  it("auto path: a failed file write keeps the DB activation, opens a finding, and does not throw into routing", async () => {
    const name = "fw-auto-skill";
    seed(name);
    setFlags({ shadow: true, auto: true });
    await evalRoute(name, 2);
    for (let i = 1; i <= 4; i++) svc().findSkills(`thử nghiệm ${name}`, `fw-auto-${i}`);
    expect(statusOf(name, 2)).toBe("shadow");
    // Still healthy after four runs: no finding has opened before the failing write.
    expect(findingFor(name)).toBeUndefined();
    blockUserSkillFile(name);
    expect(() => svc().findSkills(`thử nghiệm ${name}`, "fw-auto-5")).not.toThrow();
    // The DB commit happened before the file write, so the activation stands.
    expect(statusOf(name, 2)).toBe("active");
    expect(statusOf(name, 1)).toBe("archived");
    expect(findingFor(name)).toMatchObject({ kind: "skill_file_write", status: "open" });
    unblockUserSkillFile(name);
  });

  it("manual path: activateSkill returns normally when the file write fails, keeps the activation and opens a finding", async () => {
    const name = "fw-manual-skill";
    seed(name);
    await evalRoute(name, 2);
    blockUserSkillFile(name);
    expect(() => svc().activateSkill(name, 2)).not.toThrow();
    expect(statusOf(name, 2)).toBe("active");
    expect(findingFor(name)).toMatchObject({ kind: "skill_file_write", status: "open" });
    unblockUserSkillFile(name);
  });

  it("a failing AGENTS.md write after a good skill file does not throw out of activateSkill", async () => {
    const name = "fw-handbook-skill";
    seed(name);
    await evalRoute(name, 2);
    const handbook = join(svc().workspacePath(), "AGENTS.md");
    rmSync(handbook, { recursive: true, force: true });
    mkdirSync(handbook, { recursive: true });
    try {
      expect(() => svc().activateSkill(name, 2)).not.toThrow();
      expect(statusOf(name, 2)).toBe("active");
      expect(readFileSync(join(userSkillDir(), `${name}.md`), "utf8")).toContain("Bản thử, không ghi gì.");
      expect(findingFor(name)).toBeUndefined();
    } finally {
      rmSync(handbook, { recursive: true, force: true });
    }
  });

  it("a later sync rewrites the missing file from the DB and resolves the finding", async () => {
    const name = "fw-heal-skill";
    seed(name);
    await evalRoute(name, 2);
    blockUserSkillFile(name);
    svc().activateSkill(name, 2);
    expect(findingFor(name)?.status).toBe("open");
    unblockUserSkillFile(name);
    svc().syncWorkspace();
    expect(readFileSync(join(userSkillDir(), `${name}.md`), "utf8")).toContain("Bản thử, không ghi gì.");
    expect(findingFor(name)?.status).toBe("resolved");
  });

  it("notifies once when the finding opens and not again while it stays open", async () => {
    const name = "fw-event-skill";
    seed(name);
    await evalRoute(name, 2);
    const { hits, off } = collectFindingEvents();
    try {
      blockUserSkillFile(name);
      svc().activateSkill(name, 2);
      svc().syncWorkspace();
      svc().syncWorkspace();
      expect(hits.filter((summary) => summary.includes(name))).toEqual([`Không ghi được file skill ${name}`]);
    } finally {
      off();
      unblockUserSkillFile(name);
    }
  });

  it("a sync writes only the active version, never a draft beside it", async () => {
    const name = "fw-active-only-skill";
    seed(name);
    svc().syncWorkspace();
    const written = readFileSync(join(userSkillDir(), `${name}.md`), "utf8");
    expect(written).toContain("Bản đang chạy.");
    expect(written).not.toContain("Bản thử, không ghi gì.");
  });

  it("a successful write with no earlier failure opens no finding", async () => {
    const name = "fw-clean-skill";
    seed(name);
    await evalRoute(name, 2);
    svc().activateSkill(name, 2);
    expect(statusOf(name, 2)).toBe("active");
    expect(findingFor(name)).toBeUndefined();
  });
});
