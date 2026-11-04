import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

const storageState = vi.hoisted(() => ({ failProjectRemoval: false }));

vi.mock("../src/storage/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/storage/paths.js")>();
  return {
    ...actual,
    removeProjectDir: (...args: Parameters<typeof actual.removeProjectDir>) => {
      if (storageState.failProjectRemoval) {
        throw new Error("Simulated project directory removal failure");
      }
      return actual.removeProjectDir(...args);
    },
  };
});

const root = mkdtempSync(join(tmpdir(), "vg-projects-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "projects.db"),
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
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function createProject(
  payload: Record<string, unknown> = { title: "Test project", topic: "A test topic" },
): Promise<Project> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

describe("project API", () => {
  it("creates a topic-only project with explained deterministic recommendations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { topic: "Lịch sử trận đấu AlphaGo và Lee Sedol năm 2016" },
    });
    const created = response.json<Project & { recommendations: Record<string, { value: unknown; reason: string; source: string }> }>();

    expect(response.statusCode).toBe(201);
    expect(created).toMatchObject({
      title: "Lịch sử trận đấu AlphaGo và Lee Sedol năm 2016",
      settings: {
        budget: { mode: "BALANCED" },
        language: "vi",
        platform: "youtube",
        aspectRatio: "16:9",
        targetDurationSec: 180,
        style: "documentary",
        userSet: [],
      },
    });
    expect(created.recommendations.title.source).toBe("recommended");
    expect(created.recommendations.language).toMatchObject({
      value: "vi",
      reason: "Detected Vietnamese characters in the topic",
      source: "recommended",
    });
    expect(created.recommendations.style.reason).toContain("lịch sử");
  });

  it("resolves partial platform briefs without replacing the user's platform", async () => {
    const created = await createProject({
      topic: "5 sự thật về mèo",
      platform: "tiktok",
    });
    expect(created).toMatchObject({
      title: "5 sự thật về mèo",
      settings: {
        platform: "tiktok",
        aspectRatio: "9:16",
        targetDurationSec: 45,
        sceneDurationSec: 3,
        style: "listicle",
        userSet: ["platform"],
      },
    });
  });

  it("recommends changed brief values without overwriting user-set values and supports reset", async () => {
    const created = await createProject({
      topic: "An introduction to science",
      settings: { tone: "humorous" },
    });
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.id}`,
      payload: { topic: "How to learn science" },
    });
    expect(updated.json<Project>()).toMatchObject({
      topic: "How to learn science",
      settings: { style: "explainer", tone: "humorous", userSet: ["tone"] },
    });

    const reset = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.id}`,
      payload: { resetToRecommended: ["tone"] },
    });
    expect(reset.json<Project>()).toMatchObject({
      settings: { style: "explainer", tone: "neutral", userSet: [] },
    });
  });

  it("previews recommendations without writing a project", async () => {
    const database = new Database(config.DATABASE_PATH);
    const before = database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    database.close();
    const response = await app.inject({
      method: "POST",
      url: "/api/recommendations",
      payload: { topic: "5 things about space", platform: "tiktok" },
    });
    const readback = new Database(config.DATABASE_PATH);
    const after = readback.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    readback.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      values: { settings: { platform: "tiktok", aspectRatio: "9:16", targetDurationSec: 45, style: "listicle" } },
      recommendations: { platform: { source: "user" }, style: { source: "recommended" } },
      warnings: [],
    });
    expect(after.count).toBe(before.count);
  });

  it("creates and retrieves a project with defaults", async () => {
    const created = await createProject({ title: "  Sample video  ", topic: "  Sample topic  " });
    const response = await app.inject({ method: "GET", url: `/api/projects/${created.id}` });
    const received = response.json<Project>();

    expect(response.statusCode).toBe(200);
    expect(received).toMatchObject({
      id: created.id,
      title: "Sample video",
      topic: "Sample topic",
      mode: "ASSISTED",
      settings: {
        budget: { mode: "BALANCED" },
        language: "en",
        targetDurationSec: 180,
        aspectRatio: "16:9",
        stageExecutors: {},
        autoRender: false,
      },
      status: "DRAFT",
      stage: "TOPIC",
      version: 1,
      thumbnailPath: null,
      durationSec: null,
      archivedAt: null,
    });
    expect(received.createdAt).toBe(received.updatedAt);
  });

  it("keeps explicitly user-set researchMode as a legacy story-mode override", async () => {
    const created = await createProject({
      topic: "A topic",
      settings: { budget: { mode: "BALANCED" }, researchMode: "merged" },
    });
    expect(created.settings.userSet).toContain("researchMode");
    const estimate = await app.inject({ method: "GET", url: `/api/projects/${created.id}/budget-estimate` });
    expect(estimate.json()).toMatchObject({
      mode: "BALANCED",
      features: { storyMode: "separate" },
      total: { min: 5, max: 9 },
    });
  });

  it("removes the database row when project directory creation fails", async () => {
    writeFileSync(join(config.DATA_DIR, "projects"), "not a directory");

    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Unable to create", topic: "topic" },
    });
    const database = new Database(config.DATABASE_PATH);
    const projectCount = database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    database.close();

    expect(response.statusCode).toBe(500);
    expect(projectCount.count).toBe(0);
  });

  it.each([
    [{ title: "", topic: "topic" }],
    [{ title: "x".repeat(201), topic: "topic" }],
    [{ title: "title", topic: "topic", mode: "UNKNOWN" }],
  ])("rejects invalid create input", async (payload) => {
    const response = await app.inject({ method: "POST", url: "/api/projects", payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("patches project fields and deep-merges partial settings", async () => {
    const created = await createProject({
      title: "Editable",
      topic: "topic",
      settings: { stageExecutors: { visuals: "USER" }, autoRender: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 3));
    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.id}`,
      payload: {
        title: "Updated",
        settings: { language: "en", stageExecutors: { voice: "USER" } },
      },
    });
    const updated = response.json<Project>();

    expect(response.statusCode).toBe(200);
    expect(updated.title).toBe("Updated");
    expect(updated.settings).toMatchObject({
      language: "en",
      targetDurationSec: 180,
      aspectRatio: "16:9",
      stageExecutors: { visuals: "USER", voice: "USER" },
      autoRender: true,
    });
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(updated.version).toBe(1);
  });

  it("rejects an empty patch body", async () => {
    const created = await createProject();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.id}`,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("searches, filters, sorts, and paginates projects", async () => {
    await createProject({ title: "Zebra", topic: "wildlife" });
    await createProject({ title: "Alpha", topic: "wildlife documentary" });
    const completed = await createProject({ title: "Middle", topic: "cooking" });
    const database = new Database(config.DATABASE_PATH);
    database.prepare("UPDATE projects SET status = ? WHERE id = ?").run("COMPLETED", completed.id);
    database.close();

    const search = await app.inject({ method: "GET", url: "/api/projects?q=WILDLIFE" });
    expect(search.json().total).toBe(2);

    const filtered = await app.inject({
      method: "GET",
      url: "/api/projects?status=DRAFT,COMPLETED&sort=title&order=asc&page=1&pageSize=2",
    });
    expect(filtered.json().total).toBe(3);
    expect(filtered.json().items.map((item: Project) => item.title)).toEqual(["Alpha", "Middle"]);
    expect(filtered.json()).toMatchObject({ page: 1, pageSize: 2 });

    const nextPage = await app.inject({
      method: "GET",
      url: "/api/projects?sort=title&order=asc&page=2&pageSize=2",
    });
    expect(nextPage.json().items.map((item: Project) => item.title)).toEqual(["Zebra"]);
  });

  it("archives and unarchives idempotently and filters archived projects", async () => {
    const created = await createProject();
    const archivedResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${created.id}/archive`,
    });
    const archived = archivedResponse.json<Project>();
    const repeatedArchive = await app.inject({
      method: "POST",
      url: `/api/projects/${created.id}/archive`,
    });
    expect(repeatedArchive.json<Project>().archivedAt).toBe(archived.archivedAt);

    expect((await app.inject({ method: "GET", url: "/api/projects" })).json().total).toBe(0);
    expect((await app.inject({
      method: "GET",
      url: "/api/projects?includeArchived=true",
    })).json().total).toBe(1);
    expect((await app.inject({
      method: "GET",
      url: "/api/projects?archivedOnly=true",
    })).json().total).toBe(1);

    const unarchived = await app.inject({
      method: "POST",
      url: `/api/projects/${created.id}/unarchive`,
    });
    expect(unarchived.json<Project>().archivedAt).toBeNull();
    const repeatedUnarchive = await app.inject({
      method: "POST",
      url: `/api/projects/${created.id}/unarchive`,
    });
    expect(repeatedUnarchive.json<Project>().archivedAt).toBeNull();
  });

  it("duplicates with a fresh identity and initial pipeline state", async () => {
    const original = await createProject({
      title: "Original",
      topic: "topic",
      description: "description",
      mode: "AUTO",
      settings: { language: "en", autoRender: true },
    });
    const database = new Database(config.DATABASE_PATH);
    database.prepare("UPDATE projects SET status = ?, stage = ?, version = ? WHERE id = ?")
      .run("COMPLETED", "DONE", 8, original.id);
    database.close();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${original.id}/duplicate`,
    });
    const duplicate = response.json<Project>();

    expect(response.statusCode).toBe(201);
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.title).toBe("Original (copy)");
    expect(duplicate).toMatchObject({
      topic: "topic",
      description: "description",
      mode: "AUTO",
      settings: { language: "en", autoRender: true },
      status: "DRAFT",
      stage: "TOPIC",
      version: 1,
      archivedAt: null,
    });
  });

  it("deletes the database row and project directory", async () => {
    const created = await createProject();
    const directory = join(config.DATA_DIR, "projects", created.id);
    expect(existsSync(directory)).toBe(true);

    const deletion = await app.inject({ method: "DELETE", url: `/api/projects/${created.id}` });
    expect(deletion.statusCode).toBe(204);
    expect(existsSync(directory)).toBe(false);
    const lookup = await app.inject({ method: "GET", url: `/api/projects/${created.id}` });
    expect(lookup.statusCode).toBe(404);
    expect(lookup.json().error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("returns deleted and warns when project directory removal fails", async () => {
    await app.close();
    config = { ...config, LOG_LEVEL: "warn" };
    app = buildApp({ config });
    const created = await createProject();
    const warning = vi.spyOn(app.log, "warn");

    storageState.failProjectRemoval = true;
    const response = await app.inject({ method: "DELETE", url: `/api/projects/${created.id}` })
      .finally(() => {
        storageState.failProjectRemoval = false;
      });
    const lookup = await app.inject({ method: "GET", url: `/api/projects/${created.id}` });

    expect(response.statusCode).toBe(204);
    expect(lookup.statusCode).toBe(404);
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: created.id }),
      "Failed to remove project directory after deleting project",
    );
    warning.mockRestore();
  });

  it("prevents deleting projects that are generating or rendering", async () => {
    const created = await createProject();
    const database = new Database(config.DATABASE_PATH);
    database.prepare("UPDATE projects SET status = ? WHERE id = ?").run("GENERATING", created.id);
    database.close();

    const response = await app.inject({ method: "DELETE", url: `/api/projects/${created.id}` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PROJECT_BUSY");
    expect(existsSync(join(config.DATA_DIR, "projects", created.id))).toBe(true);
  });

  it("returns not-found for unknown ids and validation errors for malformed ids", async () => {
    const missing = await app.inject({
      method: "GET",
      url: `/api/projects/${randomUUID()}`,
    });
    const malformed = await app.inject({ method: "GET", url: "/api/projects/not-a-uuid" });

    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("PROJECT_NOT_FOUND");
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("VALIDATION_ERROR");
  });
});
