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

const root = mkdtempSync(join(tmpdir(), "vg-dashboard-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "dashboard.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
  });
});

beforeEach(() => {
  const dataDir = join(root, `data-${randomUUID()}`);
  config = {
    ...config,
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
  };
  app = buildApp({ testActor,  config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("dashboard stats API", () => {
  it("counts active projects by status and lists at most five recent projects", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { title: `Project ${index}`, topic: "topic" },
      });
      ids.push(response.json<Project>().id);
    }

    const database = new Database(config.DATABASE_PATH);
    database.prepare("UPDATE projects SET status = 'COMPLETED' WHERE id = ?").run(ids[0]);
    database.prepare("UPDATE projects SET archived_at = ? WHERE id = ?")
      .run(new Date().toISOString(), ids[1]);
    database.close();

    const response = await app.inject({ method: "GET", url: "/api/dashboard/stats" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 6,
      byStatus: {
        DRAFT: 5,
        GENERATING: 0,
        REVIEW: 0,
        RENDERING: 0,
        COMPLETED: 1,
        FAILED: 0,
      },
      archived: 1,
      recentErrors: [],
    });
    expect(response.json().recent).toHaveLength(5);
  });
});
