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
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { ScriptService } from "../src/services/scriptService.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-146 D1 surface: HTTP approve of a parked outline, the draft phase on GET, and the two in-transaction
// OUTLINE_PENDING rechecks (switchHook and rescoreCritique) that run after the paid call.

const root = mkdtempSync(join(tmpdir(), "vg-task146-api-test-"));
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

// A project whose SCRIPT stage is parked on the outline: stage WAITING_USER, draft phase outline_ready.
async function parkedOutline() {
  const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { title: "Outline API", topic: "Outline" } })).json<Project>();
  const sqlite = new Database(config.DATABASE_PATH);
  const now = new Date().toISOString();
  sqlite.prepare("INSERT OR REPLACE INTO project_stages (project_id, stage, state, progress, updated_at) VALUES (?, 'SCRIPT', 'WAITING_USER', 0, ?)").run(project.id, now);
  sqlite.prepare("UPDATE projects SET status = 'REVIEW', stage = 'SCRIPT', run_mode = NULL WHERE id = ?").run(project.id);
  sqlite.prepare(
    `INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at, phase)
     VALUES (?, '{}', '{"candidates":[],"chosenHookId":null,"hookAssessments":[]}', NULL, NULL, 'off', 'api-hash', ?, 'outline_ready')`,
  ).run(project.id, now);
  return { project, sqlite };
}

describe("TASK-146 outline approval over HTTP", () => {
  it("GET script exposes draft.phase outline_ready while parked, then approve moves it to outline_approved", async () => {
    const { project, sqlite } = await parkedOutline();
    const before = await app.inject({ method: "GET", url: `/api/projects/${project.id}/script` });
    expect(before.statusCode).toBe(200);
    expect(before.json<{ draft: { phase: string } }>().draft.phase).toBe("outline_ready");

    const approval = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/SCRIPT/approve` });
    expect({ status: approval.statusCode, body: approval.body }).toMatchObject({ status: 200 });
    const phase = (sqlite.prepare("SELECT phase FROM script_drafts WHERE project_id = ?").get(project.id) as { phase: string }).phase;
    expect(phase).toBe("outline_approved");
    sqlite.close();
  });

  it("a second approval of the same outline is rejected and does not change the phase again", async () => {
    const { project, sqlite } = await parkedOutline();
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/SCRIPT/approve` });
    const second = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/gates/SCRIPT/approve` });
    expect(second.statusCode).toBeGreaterThanOrEqual(400);
    const phase = (sqlite.prepare("SELECT phase FROM script_drafts WHERE project_id = ?").get(project.id) as { phase: string }).phase;
    expect(phase).toBe("outline_approved");
    sqlite.close();
  });
});

// In-transaction recheck: approval can land during the paid call, so the phase is read again inside the transaction.
const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function setupService() {
  const harness = createPipelineHarness({
    config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false },
  });
  harnesses.push(harness);
  const registry = new LlmProviderRegistry(harness.config);
  const service = new ScriptService(
    harness.sqlite,
    new JobRepository(harness.sqlite, new PipelineEventBus()),
    harness.orchestrator,
    harness.config,
    registry,
  );
  return { harness, registry, service };
}

async function seedScriptAndDraft(service: ScriptService, sqlite: ReturnType<typeof setupService>["harness"]["sqlite"], projectId: string) {
  await service.save(projectId, {
    title: "TASK-146 recheck",
    hook: "Old Hook",
    sections: [{
      id: "sec-1", sectionKey: "hook", heading: "Mở đầu", narration: "Câu mở đầu ban đầu. Câu thứ hai.",
      visualQueries: { primary: "v", alternatives: [] }, visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
    }],
    outro: "Hẹn gặp lại.",
    music: { mood: "calm", energy: "medium", keywords: [] },
  });
  sqlite
    .prepare("INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      projectId,
      JSON.stringify({ centralQuestion: "Q", promise: "P", framework: "three_act", surprises: [], beats: [], loops: [], setupPayoffs: [] }),
      JSON.stringify({
        candidates: [
          { id: "h1", tactic: "question", text: "Old Hook", promise: "p1" },
          { id: "h2", tactic: "cold_open", text: "New Hook", promise: "p2" },
        ],
        chosenHookId: "h1",
        hookAssessments: [],
      }),
      JSON.stringify({ total: 80, scores: { structure: 4, hook: 4, accuracy: 4, ttsNatural: 4, visualizable: 4, originality: 4 }, hookPaidOff: true, unclosedLoops: [], sectionIssues: [], history: [] }),
      JSON.stringify([]),
      "full",
      "hash-recheck",
      new Date().toISOString(),
    );
}

// Sets the draft phase to outline_ready while the paid call is in flight, the way a parked outline appears mid-call.
function parkDuringCall(registry: LlmProviderRegistry, sqlite: ReturnType<typeof setupService>["harness"]["sqlite"], projectId: string) {
  const provider = registry.get("mock")!;
  const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
  provider.generate = (async (req: any, ...rest: unknown[]) => {
    const res = await original(req, ...rest);
    sqlite.prepare("UPDATE script_drafts SET phase = 'outline_ready' WHERE project_id = ?").run(projectId);
    return res;
  }) as typeof provider.generate;
}

describe("TASK-146 in-transaction OUTLINE_PENDING rechecks", () => {
  it("switchHook: a phase that becomes outline_ready during the paid call returns 409 OUTLINE_PENDING and writes nothing", async () => {
    const { harness, registry, service } = setupService();
    await seedScriptAndDraft(service, harness.sqlite, harness.projectId);
    const before = harness.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(harness.projectId) as { data: string };
    const beforeDraft = harness.sqlite.prepare("SELECT hook_candidates, input_hash FROM script_drafts WHERE project_id = ?").get(harness.projectId) as { hook_candidates: string; input_hash: string };
    parkDuringCall(registry, harness.sqlite, harness.projectId);

    await expect(service.switchHook(harness.projectId, "h2")).rejects.toMatchObject({ statusCode: 409, code: "OUTLINE_PENDING" });

    const after = harness.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(harness.projectId) as { data: string };
    const afterDraft = harness.sqlite.prepare("SELECT hook_candidates, input_hash FROM script_drafts WHERE project_id = ?").get(harness.projectId) as { hook_candidates: string; input_hash: string };
    expect(after.data).toBe(before.data);
    expect(afterDraft).toEqual(beforeDraft);
    expect(JSON.parse(after.data).hook).toBe("Old Hook");
  });

  it("rescoreCritique: a phase that becomes outline_ready during the paid call returns 409 OUTLINE_PENDING and writes nothing", async () => {
    const { harness, registry, service } = setupService();
    await seedScriptAndDraft(service, harness.sqlite, harness.projectId);
    const beforeDraft = harness.sqlite.prepare("SELECT critique, critique_history, input_hash FROM script_drafts WHERE project_id = ?").get(harness.projectId) as { critique: string | null; critique_history: string | null; input_hash: string };
    const beforeScript = harness.sqlite.prepare("SELECT quality_score, blocking_facts FROM scripts WHERE project_id = ?").get(harness.projectId) as { quality_score: number | null; blocking_facts: string | null };
    parkDuringCall(registry, harness.sqlite, harness.projectId);

    await expect(service.rescoreCritique(harness.projectId)).rejects.toMatchObject({ statusCode: 409, code: "OUTLINE_PENDING" });

    const afterDraft = harness.sqlite.prepare("SELECT critique, critique_history, input_hash FROM script_drafts WHERE project_id = ?").get(harness.projectId) as { critique: string | null; critique_history: string | null; input_hash: string };
    const afterScript = harness.sqlite.prepare("SELECT quality_score, blocking_facts FROM scripts WHERE project_id = ?").get(harness.projectId) as { quality_score: number | null; blocking_facts: string | null };
    expect(afterDraft).toEqual(beforeDraft);
    expect(afterScript).toEqual(beforeScript);
  });
});
