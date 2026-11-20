import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTECTED_PROJECT_ID, STAGE_ORDER } from "@vg/shared";
import { AgentStageService, STAGE_AGENT_LEASE_MS } from "../src/agents/stageService.js";
import { saveAgentAssignment } from "../src/agents/assignments.js";
import { runAsActor } from "../src/auth/requestContext.js";
import type { TrustedAgent } from "../src/supervision/identity.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { actorWith } from "./testActor.js";
import { StageError } from "../src/pipeline/stageExecutor.js";
import { UsageService } from "../src/services/usageService.js";
import { ImageProviderError } from "../src/providers/images/http.js";
import { listOverdueChecks } from "../src/jobs/overdueStore.js";
import type { StageAgentAdapter } from "../src/agents/stageAdapters/types.js";

const agent = (name = "one"): TrustedAgent => ({ kind: "hermes", name, instance: `hermes/${name}`, trusted: true, canSupervise: false, model: null, environment: "test" });
const asAgent = <T>(fn: () => T, workspaceId = "A") => runAsActor(actorWith({ role: "owner", kind: "apikey", workspaceId }), fn);
const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { fixtures.splice(0).forEach((h) => h.close()); });

function setup(validateComplete = vi.fn(async () => {}), projectId?: string, openReason?: () => string | null) {
  const h = createPipelineHarness(); fixtures.push(h);
  if (projectId) h.sqlite.prepare("UPDATE projects SET id=? WHERE id=?").run(projectId, h.projectId);
  const id = projectId ?? h.projectId;
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(id);
  saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: "*", role: "visual_scout" });
  h.repository.ensureStages(id);
  const job = h.repository.createJob({ projectId: id, stage: "VISUAL_SEARCH", maxAttempts: 3, previousState: "PENDING" });
  const service = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, now: h.clock, context: () => ({ openScenes: [] }), validateComplete, openReason });
  return { ...h, service, job };
}

describe("agent stage fences (TASK-118 lease columns)", () => {
  it("recovers an app queue configured for an agent without a local tick and respects take-back", () => {
    const h = setup(), project = h.repository.getProject(h.projectId)!;
    h.sqlite.prepare("UPDATE projects SET settings=? WHERE id=?").run(JSON.stringify({ ...project.settings, stageExecution: { VISUAL_SEARCH: "agent" } }), h.projectId);
    h.service.sweep();
    expect(h.repository.getJob(h.job.id)?.executor).toBe("agent");
    runAsActor(actorWith({ role: "owner", kind: "user", workspaceId: "A" }), () => h.service.takeBack(h.job.id));
    h.service.sweep();
    expect(h.repository.getJob(h.job.id)?.executor).toBe("app");
  });
  it("counts an owned legacy project's lease toward the same workspace instance slot", () => {
    const h = setup();
    h.sqlite.prepare("UPDATE projects SET workspace_id=NULL WHERE id=?").run(h.projectId);
    h.service.handoff(h.job.id, "legacy");
    expect(asAgent(() => h.service.claim(agent()))).toBeNull();
    runAsActor({ ...actorWith({ role: "owner", kind: "apikey", workspaceId: "A" }), ownsUnassigned: true }, () => {
      expect(h.service.claim(agent())).not.toBeNull();
      const next = h.repository.createJob({ projectId: h.projectId, stage: "VISUAL_SEARCH", previousState: "PENDING", maxAttempts: 3 });
      h.service.handoff(next.id, "legacy");
      expect(h.service.claim(agent())).toBeNull();
    });
  });
  it("feeds a leased agent heartbeat into TASK-125 overdue facts without stopping the job", async () => {
    const h = setup(), project = h.repository.getProject(h.projectId)!;
    h.sqlite.prepare("UPDATE projects SET settings=? WHERE id=?").run(JSON.stringify({ ...project.settings, onOverdue: "check", stageTimeouts: { source: "mixed", inputHash: "fixture", summary: "fixture", stages: { VISUAL_SEARCH: { timeoutMs: 10, reason: "test", source: "user" } } } }), h.projectId);
    h.worker.setOverdue({ sqlite: h.sqlite });
    h.service.handoff(h.job.id, "quota");
    const claim = asAgent(() => h.service.claim(agent()))!;
    h.advance(1000);
    asAgent(() => h.service.heartbeat(agent(), h.job.id, claim.leaseId, 25, "Đang nhìn ảnh"));
    try {
      (h.worker as unknown as { sweepRemote: () => void }).sweepRemote();
      await vi.waitFor(() => expect(listOverdueChecks(h.sqlite, h.job.id).length).toBeGreaterThan(0));
      expect(listOverdueChecks(h.sqlite, h.job.id)[0].facts).toMatchObject({ childAlive: true, childNote: "Agent hermes/one còn gửi nhịp tim" });
      expect(h.repository.getJob(h.job.id)?.status).toBe("RUNNING");
      expect(h.repository.getExecutionLease(h.job.id)?.leaseId).toBe(claim.leaseId);
    } finally { await h.worker.stop(); }
  });
  it("rescues exhausted image repairs with a new job and retains continuation, without a delegation loop", () => {
    const h = setup(undefined, undefined, () => "Cảnh 2 chưa có ảnh");
    h.repository.updateJob(h.job.id, { status: "SUCCEEDED", progress: 100, finishedAt: h.clock().toISOString() });
    for (const stage of STAGE_ORDER.slice(0, STAGE_ORDER.indexOf("VISUAL_REVIEW"))) h.repository.updateStage(h.projectId, stage, { state: "DONE" });
    h.repository.updateStage(h.projectId, "VISUAL_REVIEW", { state: "WAITING_USER" });
    const rescued = h.service.handoffAfterRepair(h.projectId, "Hết lượt sửa ảnh");
    expect(rescued).toMatchObject({ status: "QUEUED", executor: "agent", stage: "VISUAL_SEARCH" });
    expect(rescued!.id).not.toBe(h.job.id);
    expect(h.repository.getJob(h.job.id)?.status).toBe("SUCCEEDED");
    expect(h.repository.getRunMode(h.projectId)).toBe("ALL");
    expect(h.service.handoffAfterRepair(h.projectId, "lặp")).toMatchObject({ id: rescued!.id });
    asAgent(() => { const claim = h.service.claim(agent())!; h.service.release(agent(), claim.job.id, claim.leaseId, "cannot_do"); });
    expect(h.service.handoffAfterRepair(h.projectId, "không lặp lại")).toBeNull();
  });
  it("hands off without running locally; two callers can only claim once", async () => {
    const h = setup();
    expect(h.service.handoff(h.job.id, "vision_unavailable")?.executor).toBe("agent");
    expect(h.repository.getNextQueuedJob(h.clock())).toBeUndefined();
    const claims = await Promise.all(["one", "two"].map((name) => asAgent(async () => h.service.claim(agent(name)))));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = claims.find(Boolean)!;
    expect(winner.job.status).toBe("RUNNING");
    expect(winner.context).toEqual({ openScenes: [] });
    expect(h.repository.getExecutionLease(h.job.id)).toMatchObject({ nodeId: null, agentInstance: winner.job.agentInstance, leaseId: winner.leaseId });
    expect(h.repository.getJobLease(h.job.id)).toBeNull();
  });

  it("renews the same fence and rejects the wrong owner, fence and expired lease", () => {
    const h = setup(); h.service.handoff(h.job.id, "quota");
    asAgent(() => {
      const first = h.service.claim(agent())!;
      expect(() => h.service.heartbeat(agent("two"), h.job.id, first.leaseId)).toThrow(/Lease/);
      expect(() => h.service.heartbeat(agent(), h.job.id, "wrong")).toThrow(/Lease/);
      h.advance(60_000);
      const renewed = h.service.heartbeat(agent(), h.job.id, first.leaseId, 42, "còn sống");
      expect(Date.parse(renewed.leaseUntil)).toBe(h.clock().getTime() + STAGE_AGENT_LEASE_MS);
      expect(h.repository.getJob(h.job.id)?.progress).toBe(42);
      h.advance(STAGE_AGENT_LEASE_MS);
      expect(() => h.service.heartbeat(agent(), h.job.id, first.leaseId)).toThrow(/Lease/);
      const second = h.service.claim(agent("two"))!;
      expect(second.leaseId).not.toBe(first.leaseId);
      expect(() => h.service.release(agent(), h.job.id, first.leaseId, "retry")).toThrow(/Lease/);
    });
  });

  it("returns cannot_do to the app and other releases to the agent queue", () => {
    const h = setup(); h.service.handoff(h.job.id, "quota");
    asAgent(() => {
      const first = h.service.claim(agent())!;
      expect(h.service.release(agent(), h.job.id, first.leaseId, "retry").executor).toBe("agent");
      expect(h.repository.getExecutionLease(h.job.id)).toBeNull();
      const second = h.service.claim(agent())!;
      expect(h.service.release(agent(), h.job.id, second.leaseId, "cannot_do").executor).toBe("app");
    });
    expect(h.repository.getNextQueuedJob(h.clock())?.id).toBe(h.job.id);
    expect(h.repository.getStage(h.projectId, "VISUAL_SEARCH")?.state).toBe("QUEUED");
  });

  it("fences a completion if the user takes back the job during async validation", async () => {
    let finish!: () => void;
    const validating = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const h = setup(validating); h.service.handoff(h.job.id, "quota");
    const claim = asAgent(() => h.service.claim(agent()))!;
    const completing = asAgent(() => h.service.complete(agent(), h.job.id, claim.leaseId, "done"));
    runAsActor(actorWith({ role: "owner", workspaceId: "A" }), () => h.service.takeBack(h.job.id));
    finish();
    await expect(completing).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(h.repository.getJob(h.job.id)).toMatchObject({ executor: "app", status: "QUEUED", agentInstance: null });
  });

  it("completes through the orchestrator only after successful validation", async () => {
    const validate = vi.fn(async () => {}), h = setup(validate);
    h.service.handoff(h.job.id, "quota");
    await asAgent(async () => {
      const claim = h.service.claim(agent())!;
      expect((await h.service.complete(agent(), h.job.id, claim.leaseId, "đã đủ ảnh")).status).toBe("SUCCEEDED");
    });
    expect(validate).toHaveBeenCalledOnce();
    expect(h.repository.getExecutionLease(h.job.id)).toBeNull();
    expect(h.repository.getJob(h.job.id)?.agentInstance).toBe("hermes/one");
    expect(h.repository.getStage(h.projectId, "VISUAL_SEARCH")?.state).toBe("DONE");
  });

  it("does not expose another workspace or accept an untrusted identity", () => {
    const h = setup(); h.service.handoff(h.job.id, "quota");
    expect(asAgent(() => h.service.claim(agent()), "B")).toBeNull();
    asAgent(() => expect(() => h.service.claim({ ...agent(), trusted: false })).toThrow(/khóa máy/));
    expect(() => h.service.claim(agent())).toThrow(/khóa máy/);
    expect(h.repository.getJob(h.job.id)?.status).toBe("QUEUED");
  });

  it("never delegates the protected project", () => {
    const h = setup(undefined, PROTECTED_PROJECT_ID);
    expect(h.service.handoff(h.job.id, "quota")).toBeNull();
    expect(asAgent(() => h.service.claim(agent()))).toBeNull();
  });

  it("keeps a live external lease through restart/shutdown recovery", () => {
    const h = setup(); h.service.handoff(h.job.id, "quota");
    const claim = asAgent(() => h.service.claim(agent()))!;
    h.orchestrator.resumeRunningJobs();
    h.orchestrator.requeueRunningJobs();
    expect(h.repository.getJob(h.job.id)?.status).toBe("RUNNING");
    expect(h.repository.getExecutionLease(h.job.id)?.leaseId).toBe(claim.leaseId);
  });

  it("requeues a lost heartbeat, then fails after the bounded wait", () => {
    const h = setup(); h.service.handoff(h.job.id, "quota");
    asAgent(() => h.service.claim(agent()));
    h.advance(STAGE_AGENT_LEASE_MS);
    h.service.sweep();
    expect(h.repository.getJob(h.job.id)?.status).toBe("QUEUED");
    expect(h.repository.getExecutionLease(h.job.id)).toBeNull();
    h.advance(29 * 60_000); h.service.sweep();
    expect(h.repository.getJob(h.job.id)?.status).toBe("QUEUED");
    h.advance(60_000); h.service.sweep();
    expect(h.repository.getJob(h.job.id)).toMatchObject({ status: "FAILED", error: { code: "STAGE_AGENT_UNAVAILABLE", retryable: false } });
    expect(h.repository.getJob(h.job.id)?.message).toContain("không có agent nào nhận");
  });

  it("does not bounce a returned job back to the same configured agent", () => {
    const h = setup();
    const project = h.repository.getProject(h.projectId)!;
    h.sqlite.prepare("UPDATE projects SET settings=? WHERE id=?").run(JSON.stringify({ ...project.settings, stageExecution: { VISUAL_SEARCH: "agent" } }), h.projectId);
    expect(h.service.beforeLocal(h.job)).toBe(true);
    asAgent(() => {
      const claim = h.service.claim(agent())!;
      h.service.release(agent(), h.job.id, claim.leaseId, "cannot_do");
    });
    expect(h.service.beforeLocal(h.repository.getJob(h.job.id)!)).toBe(false);
  });

  it("hands an always-agent job over before invoking its local executor", async () => {
    const h = setup(), run = vi.fn(async () => ({ message: "local" }));
    const project = h.repository.getProject(h.projectId)!;
    h.sqlite.prepare("UPDATE projects SET settings=? WHERE id=?").run(JSON.stringify({ ...project.settings, stageExecution: { VISUAL_SEARCH: "agent" } }), h.projectId);
    h.executors.set("VISUAL_SEARCH", { stage: "VISUAL_SEARCH", run });
    h.worker.setAgentStages(h.service);
    await h.worker.tick();
    expect(run).not.toHaveBeenCalled();
    expect(h.repository.getJob(h.job.id)).toMatchObject({ status: "QUEUED", executor: "agent", attempt: 1 });
  });

  it("hands exhausted providers off without consuming a retry or losing progress", async () => {
    const h = setup();
    h.executors.set("VISUAL_SEARCH", { stage: "VISUAL_SEARCH", run: async (ctx) => {
      ctx.reportProgress(48, "đã tìm xong một số cảnh");
      throw new StageError("Không còn provider", "LLM_ALL_PROVIDERS_EXHAUSTED", true);
    } });
    h.worker.setAgentStages(h.service);
    await h.worker.tick();
    expect(h.repository.getJob(h.job.id)).toMatchObject({ status: "QUEUED", executor: "agent", progress: 48, attempt: 1, error: null });
    expect(h.repository.getJob(h.job.id)?.handoffReason).toContain("LLM_ALL_PROVIDERS_EXHAUSTED");
  });

  it("keeps agent costs unknown and never allocates app costs to its calls", async () => {
    const h = setup();
    h.repository.updateJob(h.job.id, { usage: { llmCalls: 1, inputTokens: 10, outputTokens: 20, costUsd: 2,
      calls: [{ task: "vision", provider: "mock", model: "app-model", inputTokens: 10, outputTokens: 20, cached: false, fallback: false, ok: true, costUsd: 2 }] } });
    h.service.handoff(h.job.id, "quota");
    await asAgent(async () => { const claim = h.service.claim(agent())!; await h.service.complete(agent(), h.job.id, claim.leaseId, "xong"); });
    const usage = new UsageService(h.sqlite, 25_000).getProjectUsage(h.projectId);
    expect(usage.totals).toMatchObject({ llmCalls: 1, callsUnknown: true, costUsd: 2, costUnknown: true });
    expect(usage.runs[0].calls.find((call) => call.provider === "mock")?.costUsd).toBe(2);
    expect(usage.runs[0].calls.find((call) => call.provider === "agent:hermes/one")).toMatchObject({ callCount: 0, costUsd: 0, costUnknown: true, tokensUnknown: true });
  });

  it("hands image provider rate limits off only after the normal retry attempts", async () => {
    const h = setup();
    h.executors.set("VISUAL_SEARCH", { stage: "VISUAL_SEARCH", run: async () => { throw new ImageProviderError("HTTP 429", 429, true); } });
    h.worker.setAgentStages(h.service);
    await h.worker.tick();
    expect(h.repository.getJob(h.job.id)).toMatchObject({ executor: "app", status: "QUEUED", attempt: 2 });
    h.repository.updateJob(h.job.id, { attempt: 3, runAfter: h.clock().toISOString() });
    await h.worker.tick();
    expect(h.repository.getJob(h.job.id)).toMatchObject({ executor: "agent", status: "QUEUED", attempt: 3 });
  });

  it("accepts reported external usage under the bound agent provider only", async () => {
    const h = setup(); h.service.handoff(h.job.id, "quota");
    await asAgent(async () => { const claim = h.service.claim(agent())!; await h.service.complete(agent(), h.job.id, claim.leaseId, "xong", { calls: [{ model: "own-model", inputTokens: 100, outputTokens: 50, costUsd: 0.2 }] }); });
    const usage = new UsageService(h.sqlite, 25_000).getProjectUsage(h.projectId);
    expect(usage.totals.costUsd).toBe(0.2);
    expect(usage.totals.llmCalls).toBe(1);
    expect(usage.totals.callsUnknown).not.toBe(true);
    expect(usage.totals.costUnknown).not.toBe(true);
    expect(usage.runs[0].calls[0]).toMatchObject({ provider: "agent:hermes/one", model: "own-model", inputTokens: 100, outputTokens: 50, costUsd: 0.2 });
  });
});

describe("stage agent adapter framework (TASK-147a)", () => {
  it("offers no implicit adapter when legacy context and validator are absent", () => {
    const h = setup();
    const service = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator });
    expect(service.supportedStages).toEqual([]);
    expect(service.handoff(h.job.id, "fixture")).toBeNull();
  });

  it("does not apply legacy visual quota rules to a different stage adapter", () => {
    const h = setup();
    const project = h.repository.getProject(h.projectId)!;
    h.sqlite.prepare("UPDATE projects SET settings=? WHERE id=?")
      .run(JSON.stringify({ ...project.settings, stageExecution: { RESEARCH: "app_then_agent" } }), h.projectId);
    const job = h.repository.createJob({ projectId: h.projectId, stage: "RESEARCH", maxAttempts: 1, previousState: "PENDING" });
    h.sqlite.prepare("UPDATE jobs SET attempt=1 WHERE id=?").run(job.id);
    const adapter: StageAgentAdapter = { stage: "RESEARCH", role: "research_scout", buildContext: () => ({}), validateComplete: () => {}, handoffErrors: [] };
    const service = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, adapters: [adapter] });
    expect(service.afterError(h.repository.getJob(job.id)!, new StageError("fixture", "IMAGE_RATE_LIMIT", true))).toBe(false);
    expect(h.repository.getJob(job.id)!.executor).toBe("app");
  });

  it("rejects claim when caller agent does not have the required stage role", () => {
    const h = setup();
    h.sqlite.prepare("DELETE FROM agent_assignments").run();
    saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: "*", role: "researcher" });
    h.service.handoff(h.job.id, "quota");
    expect(asAgent(() => h.service.claim(agent()))).toBeNull();
  });

  it("excludes channel_manager role from stage claims", () => {
    const h = setup();
    h.sqlite.prepare("DELETE FROM agent_assignments").run();
    saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: "*", role: "channel_manager" });
    h.service.handoff(h.job.id, "quota");
    expect(asAgent(() => h.service.claim(agent()))).toBeNull();
  });

  it("does not offer a stage that has no registered adapter", () => {
    const h = createPipelineHarness(); fixtures.push(h);
    h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
    saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: "*", role: "scriptwriter" });
    h.repository.ensureStages(h.projectId);
    const scriptJob = h.repository.createJob({ projectId: h.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
    const mockAdapter: StageAgentAdapter = {
      stage: "VISUAL_SEARCH",
      role: "visual_scout",
      buildContext: async () => ({ openScenes: [] }),
      validateComplete: async () => {},
      openReason: () => null,
      handoffErrors: ["LLM_ALL_PROVIDERS_EXHAUSTED"],
    };
    const service = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, now: h.clock, adapters: [mockAdapter] });
    service.handoff(scriptJob.id, "quota");
    expect(asAgent(() => service.claim(agent()))).toBeNull();
  });

  it("respects adapter handoffErrors decision in afterError", () => {
    const h = createPipelineHarness(); fixtures.push(h);
    h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
    h.repository.ensureStages(h.projectId);
    const job = h.repository.createJob({ projectId: h.projectId, stage: "VISUAL_SEARCH", maxAttempts: 3, previousState: "PENDING" });
    const mockAdapter: StageAgentAdapter = {
      stage: "VISUAL_SEARCH",
      role: "visual_scout",
      buildContext: async () => ({}),
      validateComplete: async () => {},
      openReason: () => null,
      handoffErrors: ["CUSTOM_HANDOFF_ERROR"],
    };
    const service = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, now: h.clock, adapters: [mockAdapter] });

    const matchingError = new StageError("Test error", "CUSTOM_HANDOFF_ERROR", true);
    expect(service.afterError(job, matchingError)).toBe(true);

    const nonMatchingError = new StageError("Test error", "OTHER_ERROR", true);
    expect(service.afterError(job, nonMatchingError)).toBe(false);
  });
});
