import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-budget-test-"));
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("budget estimate API", () => {
  it("uses the shared estimate for mode bounds, token visibility, and completed stages", async () => {
    const dataDir = join(root, randomUUID());
    const config = parseConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: join(dataDir, "app.db"),
      WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
      LLM_DEFAULT_PROVIDER: "mock",
    });
    const app = buildApp({ config });
    apps.push(app);
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Budget estimate", settings: { budget: { mode: "QUALITY" } } },
    });
    const project = createdResponse.json<Project>();

    const estimateResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/budget-estimate`,
    });
    expect(estimateResponse.statusCode).toBe(200);
    expect(estimateResponse.json()).toMatchObject({
      mode: "QUALITY",
      total: { min: 6, max: 15 },
      perStage: [
        { stage: "RESEARCH", calls: { min: 1, max: 3 } },
        { stage: "VISUAL_SEARCH", calls: { min: 1, max: 2 } },
        { stage: "SCRIPT", calls: { min: 3, max: 9 } },
        { stage: "SCENE_PLAN", calls: { min: 1, max: 1 } },
      ],
      tokens: { input: expect.any(Number), output: expect.any(Number) },
    });

    const db = new Database(config.DATABASE_PATH);
    db.prepare("UPDATE project_stages SET state = 'DONE' WHERE project_id = ? AND stage IN ('RESEARCH', 'SCRIPT', 'SCENE_PLAN', 'VISUAL_SEARCH')")
      .run(project.id);
    db.close();
    const completed = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/budget-estimate`,
    });
    expect(completed.json()).toMatchObject({ total: { min: 0, max: 0 } });
  });

  it("omits token estimates for request-counting CLI providers", async () => {
    const dataDir = join(root, randomUUID());
    const config = parseConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: join(dataDir, "app.db"),
      WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
      LLM_DEFAULT_PROVIDER: "copilot-cli",
    });
    const app = buildApp({ config });
    apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "CLI estimate" } });
    const project = created.json<Project>();
    const estimate = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/budget-estimate`,
    });
    expect(estimate.statusCode).toBe(200);
    expect(estimate.json()).not.toHaveProperty("tokens");
  });
});
