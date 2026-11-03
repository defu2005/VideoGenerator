import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Job, JobUsage, Project, Scene, Script } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ScenePlanExecutor } from "../src/stages/scenes/scenePlanExecutor.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

const root = mkdtempSync(join(tmpdir(), "vg-scene-plan-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let dataDir: string;

beforeEach(() => {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    LLM_DEFAULT_PROVIDER: "mock",
    LLM_ENABLE_MOCK: "true",
  });
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const script: Script = {
  title: "Scene test",
  hook: "",
  sections: [{
    id: "intro",
    heading: "Introduction",
    narration: "First two words. More five words here now. End with two.",
    visualQueries: { primary: "opening city", alternatives: ["busy street", "city skyline"] },
    visualNotes: "A city",
    musicMood: "curious",
    energy: "medium",
    estDurationSec: 0,
  }],
  outro: "",
  music: { mood: "", energy: "medium", keywords: [] },
};

async function createProject(budget: "BALANCED" | "QUALITY" = "BALANCED"): Promise<Project> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      title: "Scene project",
      topic: "Scene API",
      settings: { budget: { mode: budget }, sceneDurationSec: 3, wordsPerMinute: 100 },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

function makeContext(project: Project): { context: StageContext; usage: Partial<JobUsage>[]; progress: string[] } {
  const timestamp = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    projectId: project.id,
    stage: "SCENE_PLAN",
    scope: null,
    status: "RUNNING",
    progress: 0,
    message: null,
    attempt: 1,
    maxAttempts: 3,
    error: null,
    usage: null,
    createdAt: timestamp,
    startedAt: timestamp,
    finishedAt: null,
    runAfter: timestamp,
  };
  const usage: Partial<JobUsage>[] = [];
  const progress: string[] = [];
  return {
    usage,
    progress,
    context: {
      project,
      job,
      signal: new AbortController().signal,
      reportProgress: (_value, message) => { if (message) progress.push(message); },
      recordUsage: (entry) => usage.push(entry),
      logger: app.log,
    },
  };
}

async function saveScript(projectId: string, value: Script = script) {
  const response = await app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/script`,
    payload: value,
  });
  expect(response.statusCode).toBe(200);
}

async function execute(project: Project, registry = new LlmProviderRegistry(config)) {
  const instance = new Database(config.DATABASE_PATH);
  const executor = new ScenePlanExecutor(instance, registry, config);
  const fixture = makeContext(project);
  try {
    const result = await executor.run(fixture.context);
    return { result, usage: fixture.usage, progress: fixture.progress };
  } finally {
    instance.close();
  }
}

describe("SCENE_PLAN executor and API", () => {
  it("fails non-retryably when no script exists", async () => {
    const project = await createProject();
    const instance = new Database(config.DATABASE_PATH);
    const executor = new ScenePlanExecutor(instance, new LlmProviderRegistry(config), config);
    const fixture = makeContext(project);
    await expect(executor.run(fixture.context)).rejects.toMatchObject({
      code: "SCRIPT_MISSING",
      retryable: false,
    });
    instance.close();
  });

  it("replaces scene output, hashes its inputs, reports counts, and uses one QUALITY assist call only for split units", async () => {
    const project = await createProject("QUALITY");
    await saveScript(project.id);
    const first = await execute(project);
    expect(first.result.message).toContain(`(target ${project.settings.targetDurationSec}s) · ~3s/scene`);
    expect(first.usage.reduce((sum, item) => sum + (item.llmCalls ?? 0), 0)).toBe(1);
    expect(first.usage[0]?.features).toEqual({ sceneQueryAssist: 1 });
    expect(first.progress).toContain("Planning scenes deterministically");

    const instance = new Database(config.DATABASE_PATH);
    const before = instance.prepare("SELECT id, input_hash FROM scenes WHERE project_id = ? ORDER BY \"order\"")
      .all(project.id) as { id: string; input_hash: string }[];
    expect(before.length).toBeGreaterThan(1);
    expect(before.every((row) => row.input_hash === before[0].input_hash && row.input_hash.length === 64)).toBe(true);
    const firstIds = before.map((row) => row.id);
    instance.close();

    await execute(project);
    const again = new Database(config.DATABASE_PATH);
    const after = again.prepare("SELECT id FROM scenes WHERE project_id = ? ORDER BY \"order\"")
      .all(project.id) as { id: string }[];
    again.close();
    expect(after.map((row) => row.id)).not.toEqual(firstIds);
  });

  it("assists every planned scene and falls back when the provider is unavailable", async () => {
    const project = await createProject("QUALITY");
    const singleSceneScript: Script = {
      ...script,
      sections: [{ ...script.sections[0], narration: "One scene only." }],
    };
    await saveScript(project.id, singleSceneScript);
    const noSplit = await execute(project);
    expect(noSplit.usage.reduce((sum, item) => sum + (item.llmCalls ?? 0), 0)).toBe(1);

    const splitProject = { ...project, settings: { ...project.settings, budget: { mode: "QUALITY" as const } } };
    await saveScript(project.id, script);
    const unavailableConfig = { ...config, LLM_DEFAULT_PROVIDER: undefined, LLM_ENABLE_MOCK: false };
    const fallback = await execute(splitProject, new LlmProviderRegistry(unavailableConfig));
    expect(fallback.result.message).toContain("AI query assist skipped (LLM_NOT_CONFIGURED)");
    expect(fallback.usage.reduce((sum, item) => sum + (item.llmCalls ?? 0), 0)).toBe(0);
  });

  it("persists deterministic query-variant markers in the existing visual query JSON", async () => {
    const project = await createProject();
    const variantScript: Script = {
      ...script,
      sections: [{
        ...script.sections[0],
        narration: Array.from({ length: 12 }, (_, index) => `Phrase ${index} has words.`).join(" "),
        visualQueries: { primary: "single visual query", alternatives: [] },
      }],
    };
    await saveScript(project.id, variantScript);
    await execute(project);
    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/scenes` });
    expect(response.statusCode).toBe(200);
    const scenes = response.json<{ scenes: Scene[] }>().scenes;
    expect(scenes.some((scene) => scene.queryVariant)).toBe(true);
    for (let index = 1; index < scenes.length; index += 1) {
      expect(scenes[index].visualQueries.primary).not.toBe(scenes[index - 1].visualQueries.primary);
    }
  });

  it("supports edits, split, merge, reorder, delete, timing, invalidation, and overwrite confirmation", async () => {
    const project = await createProject();
    await saveScript(project.id);
    await execute(project);
    const get = () => app.inject({ method: "GET", url: `/api/projects/${project.id}/scenes` });
    const initialResponse = await get();
    expect(initialResponse.statusCode).toBe(200);
    const initial = initialResponse.json();
    expect(initial.scenes.length).toBeGreaterThan(1);
    const firstId = initial.scenes[0].id as string;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/scenes/${firstId}`,
      payload: {
        narration: "One small sentence. Another small sentence.",
        durationOverrideSec: 5,
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().scenes[0]).toMatchObject({
      edited: true,
      durationOverrideSec: 5,
      estDurationSec: 3.6,
      startSec: 0,
    });
    expect(patch.json().scenes[1].startSec).toBe(5);

    const instance = new Database(config.DATABASE_PATH);
    instance.prepare("UPDATE project_stages SET state = 'DONE' WHERE project_id = ? AND stage = 'VISUAL_SEARCH'").run(project.id);
    instance.close();
    const split = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/${firstId}/split`,
      payload: { sentenceIndex: 0 },
    });
    expect(split.statusCode).toBe(200);
    expect(split.json().scenes).toHaveLength(initial.scenes.length + 1);
    expect(split.json().scenes[1].startSec).toBeGreaterThanOrEqual(1);
    expect((await get()).json().stale).toBe(false);
    const pipeline = await app.inject({ method: "GET", url: `/api/projects/${project.id}/pipeline` });
    expect(pipeline.json().stages.find((record: { stage: string }) => record.stage === "VISUAL_SEARCH").state).toBe("STALE");

    const splitScenes = split.json().scenes as Array<{ id: string }>;
    const merge = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/merge`,
      payload: { sceneIds: [splitScenes[0].id, splitScenes[1].id] },
    });
    expect(merge.statusCode).toBe(200);
    expect(merge.json().scenes).toHaveLength(initial.scenes.length);
    expect(merge.json().scenes[0].durationOverrideSec).toBeNull();

    const beforeReorder = merge.json().scenes as Array<{ id: string }>;
    const reordered = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/reorder`,
      payload: { sceneIds: beforeReorder.map((scene) => scene.id).reverse() },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().scenes[0].id).toBe(beforeReorder.at(-1)?.id);
    const invalidOrder = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scenes/reorder`,
      payload: { sceneIds: [beforeReorder[0].id, beforeReorder[0].id] },
    });
    expect(invalidOrder.statusCode).toBe(400);

    const currentScenes = reordered.json().scenes as Array<{ id: string }>;
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/scenes/${currentScenes[0].id}`,
    });
    expect(deleted.statusCode).toBe(200);
    let remaining = deleted.json().scenes as Array<{ id: string }>;
    while (remaining.length > 1) {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.id}/scenes/${remaining[0].id}`,
      });
      remaining = response.json().scenes as Array<{ id: string }>;
    }
    const lastDelete = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/scenes/${remaining[0].id}`,
    });
    expect(lastDelete.statusCode).toBe(400);

    const noConfirm = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/pipeline/run`,
      payload: { stage: "SCENE_PLAN" },
    });
    expect(noConfirm.statusCode).toBe(409);
    expect(noConfirm.json().error.code).toBe("SCENES_EDITED");
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/pipeline/run`,
      payload: { stage: "SCENE_PLAN", confirmOverwrite: true },
    });
    expect(confirmed.statusCode).toBe(202);
    const activeMutation = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/scenes/${remaining[0].id}`,
      payload: { label: "Blocked while active" },
    });
    expect(activeMutation.statusCode).toBe(409);
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/cancel` });
  });
});
