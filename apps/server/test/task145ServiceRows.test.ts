import { afterEach, describe, expect, it } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ScriptService } from "../src/services/scriptService.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-145 rereview rows 2 and 12. Fixtures mirror storyEngineGates.test.ts (not edited there).
// No network, no real LLM: the mock provider's generate is replaced per test. Temp DB only.

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function setup() {
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

async function seedScript(service: ScriptService, projectId: string, hook: string) {
  await service.save(projectId, {
    title: "TASK-145 rows",
    hook,
    sections: [{
      id: "sec-1", sectionKey: "hook", heading: "Mở đầu", narration: "Câu mở đầu ban đầu. Câu thứ hai.",
      visualQueries: { primary: "v", alternatives: [] }, visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
    }],
    outro: "Hẹn gặp lại.",
    music: { mood: "calm", energy: "medium", keywords: [] },
  });
}

function seedSwitchDraft(sqlite: ReturnType<typeof setup>["harness"]["sqlite"], projectId: string) {
  sqlite
    .prepare("INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      projectId,
      JSON.stringify({
        centralQuestion: "Q", promise: "P", framework: "three_act", surprises: [],
        beats: [], loops: [], setupPayoffs: [],
      }),
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
      "hash-switch",
      new Date().toISOString(),
    );
}

const switchReply = (req: { model: string }) => ({
  text: JSON.stringify({ hook: "New Hook", revisedSectionNarration: "Câu mở đầu mới. Câu thứ hai." }),
  provider: "mock",
  model: req.model,
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: "stop",
}) as never;

describe("TASK-145 row 2: switchHook version check and job/usage path", () => {
  it("returns 409 CONCURRENT_MODIFICATION when the script version changes during the paid call", async () => {
    const { harness, registry, service } = setup();
    await seedScript(service, harness.projectId, "Old Hook");
    seedSwitchDraft(harness.sqlite, harness.projectId);
    const provider = registry.get("mock")!;
    const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
    provider.generate = (async (req: any, ...rest: unknown[]) => {
      const res = await original(req, ...rest);
      if (String(req.system ?? "").includes("video script editor")) {
        harness.sqlite.prepare("UPDATE scripts SET version = version + 1 WHERE project_id = ?").run(harness.projectId);
      }
      return res;
    }) as typeof provider.generate;

    await expect(service.switchHook(harness.projectId, "h2")).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION", statusCode: 409 });
  });

  it("on a 409 the script and draft are unchanged and exactly one FAILED switchHook job with llmCalls 1 is kept", async () => {
    const { harness, registry, service } = setup();
    await seedScript(service, harness.projectId, "Old Hook");
    seedSwitchDraft(harness.sqlite, harness.projectId);
    const before = harness.sqlite.prepare("SELECT data, hook_candidates FROM scripts s JOIN script_drafts d USING(project_id) WHERE project_id = ?").get(harness.projectId) as { data: string; hook_candidates: string };
    const provider = registry.get("mock")!;
    const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
    provider.generate = (async (req: any, ...rest: unknown[]) => {
      const res = await original(req, ...rest);
      if (String(req.system ?? "").includes("video script editor")) {
        harness.sqlite.prepare("UPDATE scripts SET version = version + 1 WHERE project_id = ?").run(harness.projectId);
      }
      return res;
    }) as typeof provider.generate;

    await expect(service.switchHook(harness.projectId, "h2")).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });

    const after = harness.sqlite.prepare("SELECT data, hook_candidates FROM scripts s JOIN script_drafts d USING(project_id) WHERE project_id = ?").get(harness.projectId) as { data: string; hook_candidates: string };
    expect(after.data).toBe(before.data);
    expect(after.hook_candidates).toBe(before.hook_candidates);
    expect(JSON.parse(after.data).hook).toBe("Old Hook");

    const jobs = harness.sqlite
      .prepare("SELECT status, usage FROM jobs WHERE scope = 'switchHook'")
      .all() as Array<{ status: string; usage: string }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("FAILED");
    expect(JSON.parse(jobs[0]!.usage)).toMatchObject({ llmCalls: 1, provider: "mock" });
  });

  it("returns 409 when script content changes without a version bump (content-hash guard alone)", async () => {
    const { harness, registry, service } = setup();
    await seedScript(service, harness.projectId, "Old Hook");
    seedSwitchDraft(harness.sqlite, harness.projectId);
    const versionBefore = (harness.sqlite.prepare("SELECT version FROM scripts WHERE project_id = ?").get(harness.projectId) as { version: number }).version;
    const provider = registry.get("mock")!;
    const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
    provider.generate = (async (req: any, ...rest: unknown[]) => {
      const res = await original(req, ...rest);
      if (String(req.system ?? "").includes("video script editor")) {
        const row = harness.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(harness.projectId) as { data: string };
        const edited = { ...JSON.parse(row.data), outro: "Sửa ở nơi khác" };
        harness.sqlite.prepare("UPDATE scripts SET data = ? WHERE project_id = ?").run(JSON.stringify(edited), harness.projectId);
      }
      return res;
    }) as typeof provider.generate;

    await expect(service.switchHook(harness.projectId, "h2")).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION", statusCode: 409 });

    const row = harness.sqlite.prepare("SELECT version, data FROM scripts WHERE project_id = ?").get(harness.projectId) as { version: number; data: string };
    expect(row.version).toBe(versionBefore);
    expect(JSON.parse(row.data).outro).toBe("Sửa ở nơi khác");
    expect(JSON.parse(row.data).hook).toBe("Old Hook");
  });

  it("happy path commits the new hook, bumps the version, and records one SUCCEEDED job with the call's usage", async () => {
    const { harness, registry, service } = setup();
    await seedScript(service, harness.projectId, "Old Hook");
    seedSwitchDraft(harness.sqlite, harness.projectId);
    const versionBefore = (harness.sqlite.prepare("SELECT version FROM scripts WHERE project_id = ?").get(harness.projectId) as { version: number }).version;
    const provider = registry.get("mock")!;
    const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
    provider.generate = (async (req: any, ...rest: unknown[]) => {
      if (String(req.system ?? "").includes("video script editor")) return switchReply(req);
      return original(req, ...rest);
    }) as typeof provider.generate;

    const data = await service.switchHook(harness.projectId, "h2");

    expect(data.script?.data.hook).toBe("New Hook");
    const row = harness.sqlite.prepare("SELECT version, data FROM scripts WHERE project_id = ?").get(harness.projectId) as { version: number; data: string };
    expect(row.version).toBe(versionBefore + 1);
    expect(JSON.parse(row.data).hook).toBe("New Hook");

    const jobs = harness.sqlite
      .prepare("SELECT status, usage FROM jobs WHERE scope = 'switchHook'")
      .all() as Array<{ status: string; usage: string }>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("SUCCEEDED");
    expect(JSON.parse(jobs[0]!.usage)).toMatchObject({ llmCalls: 1, inputTokens: 1, outputTokens: 1, provider: "mock" });
  });
});

describe("TASK-145 row 12: rescore blocking_facts is a max, not a reassignment", () => {
  // Stored value and the new critique's accuracy decide the result. accuracy < 3 means new blocking = 1.
  async function rescoreWith(storedBlocking: number, accuracy: number): Promise<number> {
    const { harness, registry, service } = setup();
    await seedScript(service, harness.projectId, "Hook?");
    harness.sqlite.prepare("UPDATE scripts SET blocking_facts = ? WHERE project_id = ?").run(storedBlocking, harness.projectId);
    const provider = registry.get("mock")!;
    provider.generate = (async (req: any) => ({
      text: JSON.stringify({
        total: 100,
        scores: { structure: 5, hook: 5, accuracy, ttsNatural: 5, visualizable: 5, originality: 5 },
        hookPaidOff: true, unclosedLoops: [], sectionIssues: [],
      }),
      provider: "mock", model: req.model, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop",
    })) as typeof provider.generate;
    await service.rescoreCritique(harness.projectId);
    const row = harness.sqlite.prepare("SELECT blocking_facts FROM scripts WHERE project_id = ?").get(harness.projectId) as { blocking_facts: number };
    return row.blocking_facts;
  }

  // Each pair differs under max, sum, newest-wins and oldest-wins, so none of them can pass the set.
  it("stored 1 with a clean new critique (accuracy 5) stays 1: max gives 1, newest-wins gives 0", async () => {
    expect(await rescoreWith(1, 5)).toBe(1);
  });

  it("stored 0 with a new blocking critique (accuracy 2) becomes 1: max gives 1, oldest-wins gives 0", async () => {
    expect(await rescoreWith(0, 2)).toBe(1);
  });

  it("stored 1 with a new blocking critique (accuracy 2) stays 1: max gives 1, sum gives 2", async () => {
    expect(await rescoreWith(1, 2)).toBe(1);
  });

  it("stored 0 with a clean critique (accuracy 5) stays 0", async () => {
    expect(await rescoreWith(0, 5)).toBe(0);
  });
});
