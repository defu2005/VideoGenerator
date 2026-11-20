import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ScriptService } from "../src/services/scriptService.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-145 paid fence: a request rejected by a fence must never reach the paid provider.
// Fences checked in code (scriptService.ts): switchHook has the active-job check (357-359) and the
// hook lookup (388-389) before the paid call (412); rescoreCritique has the active-job check (542-544)
// and the expectedVersion check (552-554) before the paid call (598).
// The mock provider's generate is wrapped to count every call. No network, temp DB only.

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
  const provider = registry.get("mock")!;
  const counter = { paidCalls: 0 };
  provider.generate = (async (req: any, ...rest: unknown[]) => {
    counter.paidCalls += 1;
    if (String(req.system ?? "").includes("video script editor")) return switchReply(req);
    return critiqueReply(req);
  }) as typeof provider.generate;
  return { harness, registry, service, counter };
}

async function seedScript(service: ScriptService, projectId: string) {
  await service.save(projectId, {
    title: "TASK-145 paid fence",
    hook: "Old Hook",
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

// Blocks the switchHook and rescore paths by inserting a QUEUED job, the same state getActiveJob reads.
function insertActiveJob(sqlite: ReturnType<typeof setup>["harness"]["sqlite"], projectId: string) {
  const now = new Date().toISOString();
  sqlite
    .prepare("INSERT INTO jobs (id, project_id, stage, scope, status, created_at, run_after) VALUES (?, ?, ?, ?, 'QUEUED', ?, ?)")
    .run(randomUUID(), projectId, "SCRIPT", "other", now, now);
}

const switchReply = (req: { model: string }) => ({
  text: JSON.stringify({ hook: "New Hook", revisedSectionNarration: "Câu mở đầu mới. Câu thứ hai." }),
  provider: "mock",
  model: req.model,
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: "stop",
}) as never;

const critiqueReply = (req: { model: string }) => ({
  text: JSON.stringify({
    total: 100,
    scores: { structure: 5, hook: 5, accuracy: 5, ttsNatural: 5, visualizable: 5, originality: 5 },
    hookPaidOff: true, unclosedLoops: [], sectionIssues: [],
  }),
  provider: "mock", model: req.model, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop",
}) as never;

describe("TASK-145 paid fence: fenced requests never reach the paid provider", () => {
  it("rescoreCritique with a stale expectedVersion is rejected with 0 paid calls", async () => {
    const { harness, service, counter } = setup();
    await seedScript(service, harness.projectId);
    const version = (harness.sqlite.prepare("SELECT version FROM scripts WHERE project_id = ?").get(harness.projectId) as { version: number }).version;

    await expect(service.rescoreCritique(harness.projectId, version + 99)).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION", statusCode: 409 });

    expect(counter.paidCalls).toBe(0);
    const jobs = harness.sqlite.prepare("SELECT id FROM jobs WHERE scope = 'rescoreCritique'").all();
    expect(jobs).toHaveLength(0);
  });

  it("rescoreCritique while another job is active is rejected with 0 paid calls", async () => {
    const { harness, service, counter } = setup();
    await seedScript(service, harness.projectId);
    insertActiveJob(harness.sqlite, harness.projectId);

    await expect(service.rescoreCritique(harness.projectId)).rejects.toMatchObject({ code: "INVALID_PIPELINE_STATE", statusCode: 409 });

    expect(counter.paidCalls).toBe(0);
  });

  it("switchHook while another job is active is rejected with 0 paid calls", async () => {
    const { harness, service, counter } = setup();
    await seedScript(service, harness.projectId);
    seedSwitchDraft(harness.sqlite, harness.projectId);
    insertActiveJob(harness.sqlite, harness.projectId);

    await expect(service.switchHook(harness.projectId, "h2")).rejects.toMatchObject({ code: "INVALID_PIPELINE_STATE", statusCode: 409 });

    expect(counter.paidCalls).toBe(0);
  });

  it("switchHook with an unknown hook id is rejected with 0 paid calls", async () => {
    const { harness, service, counter } = setup();
    await seedScript(service, harness.projectId);
    seedSwitchDraft(harness.sqlite, harness.projectId);

    await expect(service.switchHook(harness.projectId, "no-such-hook")).rejects.toMatchObject({ code: "HOOK_NOT_FOUND", statusCode: 404 });

    expect(counter.paidCalls).toBe(0);
  });

  it("control: a correctly fenced rescoreCritique does call the provider once, so the counter is live", async () => {
    const { harness, service, counter } = setup();
    await seedScript(service, harness.projectId);
    const version = (harness.sqlite.prepare("SELECT version FROM scripts WHERE project_id = ?").get(harness.projectId) as { version: number }).version;

    await service.rescoreCritique(harness.projectId, version);

    expect(counter.paidCalls).toBe(1);
  });

  it("control: a valid switchHook does call the provider once, so the counter is live", async () => {
    const { harness, service, counter } = setup();
    await seedScript(service, harness.projectId);
    seedSwitchDraft(harness.sqlite, harness.projectId);

    await service.switchHook(harness.projectId, "h2");

    expect(counter.paidCalls).toBe(1);
  });
});
