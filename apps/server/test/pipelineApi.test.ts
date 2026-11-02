import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-pipeline-api-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    HOST: "127.0.0.1",
  });
});

beforeEach(() => {
  const dataDir = join(root, `run-${randomUUID()}`);
  config = { ...config, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, "app.db") };
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function createProject() {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { title: "Pipeline API", topic: "API test" },
  });
  return response.json<Project>();
}

describe("pipeline API", () => {
  it("supports pipeline actions, job listing, conflict responses, and recent errors", async () => {
    const project = await createProject();
    const initial = await app.inject({ method: "GET", url: `/api/projects/${project.id}/pipeline` });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().stages).toHaveLength(12);

    const run = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/run`, payload: {} });
    expect(run.statusCode).toBe(202);
    expect(run.json().activeJob.stage).toBe("RESEARCH");
    const conflict = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/run`, payload: {} });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("INVALID_PIPELINE_STATE");
    expect((await app.inject({ method: "GET", url: `/api/projects/${project.id}/jobs` })).json()).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${project.id}` })).statusCode).toBe(409);

    expect((await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/cancel` })).statusCode).toBe(200);
    const sqlite = new Database(config.DATABASE_PATH);
    sqlite.prepare("UPDATE project_stages SET state = 'WAITING_USER' WHERE project_id = ? AND stage = 'VISUAL_REVIEW'").run(project.id);
    sqlite.prepare("UPDATE projects SET status = 'REVIEW', stage = 'VISUAL_REVIEW', run_mode = 'ALL' WHERE id = ?").run(project.id);
    sqlite.close();
    const approval = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/VISUAL_REVIEW/approve` });
    expect(approval.statusCode).toBe(200);

    await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/cancel` });
    const retryDb = new Database(config.DATABASE_PATH);
    retryDb.prepare("UPDATE project_stages SET state = 'FAILED', error = ? WHERE project_id = ? AND stage = 'RESEARCH'")
      .run(JSON.stringify({ code: "FAKE", message: "Failed stage", retryable: true }), project.id);
    retryDb.prepare("UPDATE jobs SET status = 'FAILED', error = ?, finished_at = ? WHERE project_id = ? AND stage = 'RESEARCH'")
      .run(JSON.stringify({ code: "FAKE", message: "Failed stage", retryable: true }), new Date().toISOString(), project.id);
    retryDb.close();
    expect((await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/stages/RESEARCH/retry` })).statusCode).toBe(202);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard/stats" });
    expect(dashboard.json().recentErrors[0]).toMatchObject({
      projectId: project.id,
      projectTitle: "Pipeline API",
      stage: "RESEARCH",
      code: "FAKE",
    });
  });

  it("streams a full snapshot followed by job updates over SSE", async () => {
    const project = await createProject();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/${project.id}/events`, { signal: controller.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const snapshot = decoder.decode((await reader.read()).value);
    expect(snapshot).toContain("event: pipeline.snapshot");
    expect(snapshot).toContain('"currentStage":"TOPIC"');

    await fetch(`http://127.0.0.1:${address.port}/api/projects/${project.id}/pipeline/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    let update = "";
    for (let attempt = 0; attempt < 5 && !update.includes("event: job.updated"); attempt += 1) {
      update += decoder.decode((await reader.read()).value);
    }
    expect(update).toContain("event: job.updated");
    await reader.cancel();
    controller.abort();
  });
});
