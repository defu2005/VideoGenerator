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
import { captureStageFeedback } from "../src/learning/stageFeedback.js";

const root = mkdtempSync(join(tmpdir(), "vg-gate-feedback-test-"));
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

async function waitingGate(gateOpenedAt: string) {
  const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { title: "Gate feedback", topic: "Gate" } })).json<Project>();
  const sqlite = new Database(config.DATABASE_PATH);
  sqlite.prepare("INSERT OR REPLACE INTO project_stages (project_id, stage, state, progress, updated_at) VALUES (?, 'VISUAL_REVIEW', 'WAITING_USER', 0, ?)").run(project.id, gateOpenedAt);
  sqlite.prepare("UPDATE projects SET status = 'REVIEW', stage = 'VISUAL_REVIEW', run_mode = NULL WHERE id = ?").run(project.id);
  return { project, sqlite };
}

describe("gate approval feedback (TASK-148a)", () => {
  it("records gate_approve_with_edit only when a user edit for that stage came after the gate opened", async () => {
    const opened = new Date(Date.now() - 60_000).toISOString();
    const { project, sqlite } = await waitingGate(opened);
    captureStageFeedback(sqlite, { projectId: project.id, stage: "VISUAL_REVIEW", kind: "user_edit", target: "scene:1", before: "a", after: "b", source: "user" });
    const approval = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/VISUAL_REVIEW/approve` });
    expect({ status: approval.statusCode, body: approval.body }).toMatchObject({ status: 200 });
    const kinds = sqlite.prepare("SELECT kind FROM stage_feedback WHERE project_id = ? AND stage = 'VISUAL_REVIEW' ORDER BY created_at").all(project.id) as Array<{ kind: string }>;
    expect(kinds.map((row) => row.kind)).toEqual(["user_edit", "gate_approve_with_edit"]);
    sqlite.close();
  });

  it("does not record an approval without any edit since the gate opened", async () => {
    const opened = new Date(Date.now() - 60_000).toISOString();
    const { project, sqlite } = await waitingGate(opened);
    const approval = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/VISUAL_REVIEW/approve` });
    expect({ status: approval.statusCode, body: approval.body }).toMatchObject({ status: 200 });
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM stage_feedback WHERE project_id = ?").get(project.id) as { n: number };
    expect(count.n).toBe(0);
    sqlite.close();
  });

  it("ignores a user edit made before the gate opened", async () => {
    const opened = new Date(Date.now() + 60_000).toISOString();
    const { project, sqlite } = await waitingGate(opened);
    captureStageFeedback(sqlite, { projectId: project.id, stage: "VISUAL_REVIEW", kind: "user_edit", target: "scene:1", before: "a", after: "b", source: "user" });
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/VISUAL_REVIEW/approve` });
    const kinds = sqlite.prepare("SELECT kind FROM stage_feedback WHERE project_id = ?").all(project.id) as Array<{ kind: string }>;
    expect(kinds.map((row) => row.kind)).toEqual(["user_edit"]);
    sqlite.close();
  });
});
