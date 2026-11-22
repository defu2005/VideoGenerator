import { afterEach, describe, expect, it } from "vitest";
import { PROTECTED_PROJECT_ID, ScriptSchema, type Job } from "@vg/shared";
import { runAsActor } from "../src/auth/requestContext.js";
import { AgentStageService } from "../src/agents/stageService.js";
import { saveAgentAssignment } from "../src/agents/assignments.js";
import { AgentScriptToolkit, SCRIPT_HANDOFF_ERRORS } from "../src/agents/scriptToolkit.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import type { TrustedAgent } from "../src/supervision/identity.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { actorWith } from "./testActor.js";

// TASK-147d slice 2: AgentScriptToolkit. The gate calls go to the mock provider through a stub that forces the
// critique and fact-check bodies; every other schema still runs the real mock.

const agent: TrustedAgent = { kind: "hermes", name: "script", instance: "hermes/script", model: null, environment: "test", trusted: true, canSupervise: false };
const scoped = <T>(fn: () => T) => runAsActor(actorWith({ role: "owner", kind: "apikey", workspaceId: "A" }), fn);
const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { fixtures.splice(0).forEach((h) => h.close()); });

const PASS_SCORES = { structure: 5, hook: 5, accuracy: 5, ttsNatural: 5, visualizable: 5, originality: 5 };
const LOW_SCORES = { structure: 1, hook: 1, accuracy: 1, ttsNatural: 1, visualizable: 1, originality: 1 };
// `total` is required by ScriptCritiqueSchema; the gate recomputes it from the scores, so 0 is a placeholder.
const critique = (scores = PASS_SCORES) => ({ total: 0, scores, sectionIssues: [], hookPaidOff: true, unclosedLoops: [] });
const factCheck = (notes: Array<{ text: string; severity: "blocking" | "minor" }> = []) => ({ softenedClaims: [], notes });

/** A script that passes the strict Script schema; narration is short so lint stays quiet. */
function goodScript() {
  return ScriptSchema.parse({
    title: "Vũ trụ bắt đầu thế nào",
    hook: "Bạn có biết vũ trụ từng nhỏ hơn hạt cát?",
    sections: [
      { id: "s1", heading: "Mở đầu", narration: "Khoảng mười ba tỷ năm trước, vũ trụ bắt đầu giãn nở.", estDurationSec: 10 },
      { id: "s2", heading: "Kết", narration: "Và chúng ta vẫn đang sống trong hệ quả của sự khởi đầu ấy.", estDurationSec: 10 },
    ],
    outro: "Hẹn gặp lại trong video sau.",
  });
}

function envelope(value: unknown, model: string) {
  return { text: JSON.stringify(value), usage: { inputTokens: 10, outputTokens: 20 }, model, provider: "mock", finishReason: "stop" as const };
}

type Stub = { critique: unknown; factCheck: unknown; fail: string | null; calls: string[] };

function stubMock(registry: LlmProviderRegistry, stub: Stub) {
  const provider = registry.get("mock")!;
  const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
  provider.generate = (async (req: any, ...rest: unknown[]) => {
    stub.calls.push(req.schemaName);
    if (stub.fail === req.schemaName) throw new Error("provider down");
    if (req.schemaName === "ScriptCritique") return envelope(stub.critique, req.model);
    if (req.schemaName === "FactCheck") return envelope(stub.factCheck, req.model);
    return original(req, ...rest);
  }) as typeof provider.generate;
}

function setup(overrides: Partial<Stub> = {}) {
  const h = createPipelineHarness({ config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false } });
  fixtures.push(h);
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
  saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: agent.instance, role: "script_writer" });
  h.repository.ensureStages(h.projectId);
  const registry = new LlmProviderRegistry(h.config);
  const cache = new LlmCache(h.sqlite, false);
  const stub: Stub = { critique: critique(), factCheck: factCheck(), fail: null, calls: [], ...overrides };
  stubMock(registry, stub);
  let toolkit!: AgentScriptToolkit;
  const adapter = {
    stage: "SCRIPT",
    role: "script_writer",
    handoffErrors: SCRIPT_HANDOFF_ERRORS,
    buildContext: (job: Job) => toolkit.context(job),
    validateComplete: (job: Job) => toolkit.validateComplete(job),
  };
  const stages = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, now: h.clock, adapters: [adapter as never] });
  toolkit = new AgentScriptToolkit(h.repository, stages, h.orchestrator, registry, h.config, cache);
  const job = h.repository.createJob({ projectId: h.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
  stages.handoff(job.id, "LLM_QUOTA_EXHAUSTED");
  const claim = scoped(() => stages.claim(agent))!;
  const submit = (input: unknown = goodScript(), leaseId = claim.leaseId) => scoped(() => toolkit.submit(agent, job.id, leaseId, input));
  const scriptRow = () => h.sqlite.prepare("SELECT origin, provider, input_hash, revise_round FROM scripts WHERE project_id=?").get(h.projectId) as
    { origin: string; provider: string; input_hash: string; revise_round: number } | undefined;
  const draftRow = () => h.sqlite.prepare("SELECT author, critique FROM script_drafts WHERE project_id=?").get(h.projectId) as
    { author: string | null; critique: string | null } | undefined;
  const holdCount = () => (h.sqlite.prepare("SELECT agent_hold_count FROM jobs WHERE id=?").get(job.id) as { agent_hold_count: number | null }).agent_hold_count ?? 0;
  return { ...h, stub, registry, stages, toolkit, job, claim, submit, scriptRow, draftRow, holdCount };
}

async function codeOf(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (error) { return (error as { code?: string }).code ?? "UNKNOWN"; }
}

describe("script_writer agent submit gate (TASK-147d)", () => {
  it("passes a good draft, writes it as the agent's, and completes the job", async () => {
    const h = setup();
    const result = await h.submit();
    expect(result).toMatchObject({ status: "passed", version: 1 });
    expect(h.stub.calls).toContain("ScriptCritique");
    expect(h.stub.calls).toContain("FactCheck");
    expect(h.scriptRow()).toMatchObject({ origin: "AGENT", provider: `agent:${h.claim.leaseId}` });
    expect(h.draftRow()?.author).toBe("agent:hermes/script");
    await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "Đã nộp kịch bản."));
    expect(h.repository.getJob(h.job.id)!.status).toBe("SUCCEEDED");
  });

  it("holds a draft whose critique total is under 60 and writes no script row", async () => {
    const h = setup({ critique: critique(LOW_SCORES) });
    const result = await h.submit() as { status: string; attempt: number; remainingResubmits: number };
    expect(result).toMatchObject({ status: "held", attempt: 1, remainingResubmits: 2 });
    expect(h.scriptRow()).toBeUndefined();
    expect(h.draftRow()).toBeUndefined();
    expect(h.holdCount()).toBe(1);
  });

  it("holds a passing total when accuracy is below 3", async () => {
    const h = setup({ critique: critique({ ...PASS_SCORES, accuracy: 2 }) });
    expect(await h.submit()).toMatchObject({ status: "held", attempt: 1 });
    expect(h.scriptRow()).toBeUndefined();
  });

  it("holds a draft that has a blocking fact-check note", async () => {
    const h = setup({ factCheck: factCheck([{ text: "Số liệu sai.", severity: "blocking" }]) });
    expect(await h.submit()).toMatchObject({ status: "held", blockingFacts: 1 });
    expect(h.scriptRow()).toBeUndefined();
  });

  it("gives two resubmits, then returns the job to the app on the third failed submit", async () => {
    const h = setup({ critique: critique(LOW_SCORES) });
    expect(await h.submit()).toMatchObject({ status: "held", attempt: 1, remainingResubmits: 2 });
    expect(await h.submit()).toMatchObject({ status: "held", attempt: 2, remainingResubmits: 1 });
    expect(await h.submit()).toMatchObject({ status: "returned_to_app", failed: 3 });
    expect(h.repository.getJob(h.job.id)!.executor).toBe("app");
    expect(h.scriptRow()).toBeUndefined();
    expect(await codeOf(() => h.submit())).toBe("LEASE_LOST");
  });

  it("records the gate's usage on a held submit", async () => {
    const h = setup({ critique: critique(LOW_SCORES) });
    await h.submit();
    expect(h.repository.getJob(h.job.id)!.usage?.llmCalls ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("treats a critic LLM failure as retryable and does not count it as a hold", async () => {
    const h = setup({ fail: "ScriptCritique" });
    expect(await codeOf(() => h.submit())).toBe("SCRIPT_GATE_UNAVAILABLE");
    expect(h.holdCount()).toBe(0);
    expect(h.scriptRow()).toBeUndefined();
  });

  it("keeps the usage of the critic call when the fact-check call fails", async () => {
    const h = setup({ fail: "FactCheck" });
    expect(await codeOf(() => h.submit())).toBe("SCRIPT_GATE_UNAVAILABLE");
    expect(h.holdCount()).toBe(0);
    expect(h.scriptRow()).toBeUndefined();
    expect(h.repository.getJob(h.job.id)!.usage?.llmCalls ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("refuses an invalid draft shape with 422 before any LLM call", async () => {
    const h = setup();
    expect(await codeOf(() => h.submit({ title: "x" }))).toBe("SCRIPT_AGENT_INVALID");
    expect(h.stub.calls).toHaveLength(0);
    expect(h.holdCount()).toBe(0);
  });

  it("runs lint on the agent draft and stores its findings as notes without holding the draft", async () => {
    const h = setup();
    const lintBad = ScriptSchema.parse({ ...goodScript(), outro: "Cảm ơn các bạn đã xem, đăng ký kênh nhé." });
    expect(await h.submit(lintBad)).toMatchObject({ status: "passed" });
    const notes = h.sqlite.prepare("SELECT review_notes FROM scripts WHERE project_id=?").get(h.projectId) as { review_notes: string | null };
    expect(notes.review_notes ?? "").toContain("[lint] TEMPLATE_OUTRO");
  });

  it("refuses to overwrite a script the user has edited, before any LLM call", async () => {
    const h = setup();
    h.sqlite.prepare("INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, model, updated_at) VALUES (?, '{}', 'USER', 1, 'x', 1, 'x', ?)")
      .run(h.projectId, new Date().toISOString());
    expect(await codeOf(() => h.submit())).toBe("SCRIPT_EDITED");
    expect(h.stub.calls).toHaveLength(0);
  });

  it("refuses when research changes between the gate and the write, keeps the usage, and writes nothing", async () => {
    const h = setup();
    h.sqlite.prepare("INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, 'r1', 'x', 'x', 0, ?, '{}')")
      .run(h.projectId, new Date().toISOString());
    const original = h.orchestrator.recordUsage.bind(h.orchestrator);
    let changed = false;
    h.orchestrator.recordUsage = ((jobId: string, usage: Parameters<typeof original>[1], options?: Parameters<typeof original>[2]) => {
      original(jobId, usage, options);
      if (!changed) {
        changed = true;
        h.sqlite.prepare("UPDATE research_notes SET input_hash = 'r2' WHERE project_id = ?").run(h.projectId);
      }
    }) as typeof h.orchestrator.recordUsage;
    expect(await codeOf(() => h.submit())).toBe("SCRIPT_INPUT_CHANGED");
    expect(h.scriptRow()).toBeUndefined();
    expect(h.holdCount()).toBe(0);
    expect(h.repository.getJob(h.job.id)!.usage?.llmCalls ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("refuses a protected project on context and on submit, with no LLM call", async () => {
    const h = setup();
    h.sqlite.pragma("foreign_keys = OFF");
    h.sqlite.prepare("UPDATE jobs SET project_id = ? WHERE id = ?").run(PROTECTED_PROJECT_ID, h.job.id);
    const job = h.repository.getJob(h.job.id)!;
    expect(await codeOf(() => h.toolkit.context(job))).toBe("STAGE_JOB_NOT_FOUND");
    expect(await codeOf(() => h.submit())).toBe("STAGE_JOB_NOT_FOUND");
    expect(h.stub.calls).toHaveLength(0);
  });

  it("refuses a submit whose leased job is not SCRIPT, before any LLM call or write", async () => {
    // TASK-146 stage fence: a lease on another stage's job of the same project must not write the SCRIPT draft.
    const h = setup();
    h.sqlite.prepare("UPDATE jobs SET stage = 'RESEARCH' WHERE id = ?").run(h.job.id);
    expect(await codeOf(() => h.submit())).toBe("STAGE_TOOL_MISMATCH");
    expect(h.stub.calls).toHaveLength(0);
    expect(h.scriptRow()?.origin).not.toBe("agent");
  });

  it("complete rejects a row written by another lease", async () => {
    const h = setup();
    await h.submit();
    h.sqlite.prepare("UPDATE scripts SET provider = 'agent:someone-else' WHERE project_id = ?").run(h.projectId);
    expect(await codeOf(() => scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "x")))).toBe("SCRIPT_AGENT_INVALID");
  });

  it("complete rejects a row whose input hash no longer matches the project", async () => {
    const h = setup();
    await h.submit();
    h.sqlite.prepare("UPDATE scripts SET input_hash = 'stale-hash' WHERE project_id = ?").run(h.projectId);
    expect(await codeOf(() => scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "x")))).toBe("SCRIPT_AGENT_INVALID");
  });

  it("complete refuses after a held submit, with no passed submit on this lease", async () => {
    const h = setup({ critique: critique(LOW_SCORES) });
    expect(await h.submit()).toMatchObject({ status: "held" });
    expect(await codeOf(() => scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "x")))).toBe("SCRIPT_AGENT_INVALID");
    expect(h.repository.getJob(h.job.id)!.status).not.toBe("SUCCEEDED");
  });

  it("complete refuses an app-written script even after this lease passed once", async () => {
    const h = setup();
    await h.submit();
    h.sqlite.prepare("UPDATE scripts SET provider = 'app' WHERE project_id = ?").run(h.projectId);
    expect(await codeOf(() => scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "x")))).toBe("SCRIPT_AGENT_INVALID");
    expect(h.repository.getJob(h.job.id)!.status).not.toBe("SUCCEEDED");
  });

  it("marks a DONE downstream stage stale when the agent completes", async () => {
    const h = setup();
    // SCRIPT_REVIEW is the first dependent now; it is an auto-passed gate, so the work stage SCENE_PLAN is pinned here.
    h.repository.updateStage(h.projectId, "SCRIPT_REVIEW", { state: "DONE", progress: 100 });
    h.repository.updateStage(h.projectId, "SCENE_PLAN", { state: "DONE", progress: 100 });
    await h.submit();
    await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "Đã nộp kịch bản."));
    expect(h.repository.getJob(h.job.id)!.status).toBe("SUCCEEDED");
    expect(h.repository.getStage(h.projectId, "SCRIPT").state).toBe("DONE");
    expect(h.repository.getStage(h.projectId, "SCENE_PLAN").state).toBe("STALE");
    // The gate went STALE on submit and was passed again when SCRIPT completed; the message shows the auto-pass ran.
    expect(h.repository.getStage(h.projectId, "SCRIPT_REVIEW").state).toBe("DONE");
    expect(h.repository.getStage(h.projectId, "SCRIPT_REVIEW").message).toBe("Passed automatically (script review is off)");
  });

  it("leaves a DONE downstream stage alone when the submit is held", async () => {
    const h = setup({ critique: critique(LOW_SCORES) });
    h.repository.updateStage(h.projectId, "SCENE_PLAN", { state: "DONE", progress: 100 });
    expect(await h.submit()).toMatchObject({ status: "held" });
    expect(h.repository.getStage(h.projectId, "SCENE_PLAN").state).toBe("DONE");
  });

  it("redacts agent text before it is stored in the script row", async () => {
    const h = setup();
    const draft = goodScript();
    draft.sections[0]!.narration = "Liên hệ test.user@example.com để biết thêm.";
    expect(await h.submit(draft)).toMatchObject({ status: "passed" });
    const stored = (h.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(h.projectId) as { data: string }).data;
    expect(stored).not.toContain("test.user@example.com");
    expect(stored).toContain("[email]");
  });

  it("resets revise_round when a passing agent draft replaces the script", async () => {
    const h = setup();
    h.sqlite.prepare("INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, model, updated_at, revise_round) VALUES (?, '{}', 'AGENT', 0, 'x', 1, 'x', ?, 2)")
      .run(h.projectId, new Date().toISOString());
    await h.submit();
    expect(h.scriptRow()?.revise_round).toBe(0);
  });
});
