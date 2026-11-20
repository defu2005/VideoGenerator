import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
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
    const app = buildApp({ testActor,  config });
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
      // Derivation (packages/shared/src/budget/modes.ts, QUALITY: storyEngine full, repairAttempts 2,
      // guidelineCheck checkAndFix, formatPick on, factCheck off, sceneQueryAssist and continuityPlan on):
      // TASK-141: SCRIPT max = sum of its task maxes (story engine calls each retry, so they are not one constant).
      // SCRIPT min = 4 + 1 (guideline) + 0 + 1 (format) = 6; max = 29 (was 21 before the story-engine task sum).
      // SCENE_PLAN min = 1 + 1 = 2; max = 1 + 2 * 1 = 3. Total min 14, max 44 (outline 2 + repairs 2 = 4 max, was 3).
      total: { min: 14, max: 44 },
      perStage: [
        { stage: "RESEARCH", calls: { min: 2, max: 4 } },
        { stage: "VISUAL_SEARCH", calls: { min: 1, max: 4 } },
        { stage: "SCRIPT", calls: { min: 6, max: 30 } },
        { stage: "SCENE_PLAN", calls: { min: 2, max: 3 } },
        { stage: "MUSIC_SEARCH", calls: { min: 1, max: 1 } },
        { stage: "TIMELINE", calls: { min: 2, max: 2 } },
      ],
      tokens: { input: expect.any(Number), output: expect.any(Number) },
    });

    const db = new Database(config.DATABASE_PATH);
    db.prepare("UPDATE project_stages SET state = 'DONE' WHERE project_id = ? AND stage IN ('RESEARCH', 'SCRIPT', 'SCENE_PLAN', 'VISUAL_SEARCH', 'MUSIC_SEARCH', 'TIMELINE')")
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
    const app = buildApp({ testActor,  config });
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
