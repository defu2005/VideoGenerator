import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-stage-lessons-api-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "boot.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", HOST: "127.0.0.1" });
});
beforeEach(() => {
  const dataDir = join(root, `run-${randomUUID()}`);
  config = { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") };
  app = buildApp({ testActor, config });
});
afterEach(async () => {
  await app.close();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("stage lessons API (TASK-148a)", () => {
  it("lists channel and global lessons and lets a user approve then undo", async () => {
    const profile = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Lessons channel" } });
    expect(profile.statusCode).toBe(201);
    const profileId = profile.json<{ id: string }>().id;
    const sqlite = new Database(config.DATABASE_PATH);
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses) VALUES ('n-own', ?, 'SCRIPT', 'own rule', '[\"e1\"]', 'proposed', ?, 0)").run(profileId, now);
    sqlite.prepare("INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses) VALUES ('n-glob', NULL, 'SCRIPT', 'global rule', '[\"e2\"]', 'proposed', ?, 0)").run(now);
    sqlite.prepare("INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses) VALUES ('n-foreign', 'someone-else', 'SCRIPT', 'x', '[]', 'proposed', ?, 0)").run(now);
    sqlite.close();
    const pid = profileId;
    const list = await app.inject({ method: "GET", url: `/api/profiles/${pid}/stage-notes` });
    expect(list.statusCode).toBe(200);
    const ids = list.json<Array<{ id: string }>>().map((row) => row.id).sort();
    expect(ids).toEqual(["n-glob", "n-own"]);

    const approve = await app.inject({ method: "POST", url: `/api/profiles/${pid}/stage-notes/n-own/decision`, payload: { decision: "approve" } });
    expect(approve.statusCode).toBe(200);
    expect(approve.json()).toEqual({ status: "approved" });
    const undo = await app.inject({ method: "POST", url: `/api/profiles/${pid}/stage-notes/n-own/decision`, payload: { decision: "undo" } });
    expect(undo.json()).toEqual({ status: "proposed" });

    const foreign = await app.inject({ method: "POST", url: `/api/profiles/${pid}/stage-notes/n-foreign/decision`, payload: { decision: "approve" } });
    expect(foreign.statusCode).toBe(404);
  });

  it("lets an agent API key reject a lesson but never approve or undo it", async () => {
    const dataDir = join(root, `agent-${randomUUID()}`);
    const agentConfig = { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") };
    const agentApp = buildApp({ testActor: { ...testActor, kind: "apikey", keyId: "agent-key" } as typeof testActor, config: agentConfig });
    try {
      const profile = await agentApp.inject({ method: "POST", url: "/api/profiles", payload: { name: "Agent channel" } });
      const pid = profile.json<{ id: string }>().id;
      const sqlite = new Database(agentConfig.DATABASE_PATH);
      const now = new Date().toISOString();
      sqlite.prepare("INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses) VALUES ('a-note', ?, 'SCRIPT', 'agent rule', '[\"e1\"]', 'proposed', ?, 0)").run(pid, now);
      sqlite.close();
      const approve = await agentApp.inject({ method: "POST", url: `/api/profiles/${pid}/stage-notes/a-note/decision`, payload: { decision: "approve" } });
      expect(approve.statusCode).toBe(403);
      const reject = await agentApp.inject({ method: "POST", url: `/api/profiles/${pid}/stage-notes/a-note/decision`, payload: { decision: "reject" } });
      expect(reject.statusCode).toBe(200);
    } finally {
      await agentApp.close();
    }
  });

  it("puts an approved stage lesson into the SCRIPT prompt of that channel only", async () => {
    const profile = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Prompt channel" } });
    const pid = profile.json<{ id: string }>().id;
    const project = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Prompt lesson", profileId: pid } });
    expect(project.statusCode).toBe(201);
    const projectId = project.json<Project>().id;
    const sqlite = new Database(config.DATABASE_PATH);
    sqlite.prepare("INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses) VALUES ('p-lesson', ?, 'SCRIPT', 'Lesson XYZ approved', '[\"e1\"]', 'approved', ?, 0)").run(pid, new Date().toISOString());
    sqlite.close();
    const prompt = await app.inject({ method: "GET", url: `/api/projects/${projectId}/prompts/SCRIPT` });
    expect(prompt.statusCode).toBe(200);
    const body = prompt.json<{ user: string; system: string }>();
    expect(`${body.system}
${body.user}`).toContain("Lesson XYZ approved");
  });
});
