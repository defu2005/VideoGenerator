import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { STAGE_ORDER, type PipelineStage } from "@vg/shared";
import { markStaleFrom } from "../src/pipeline/invalidation.js";
import { deriveProjectStatus } from "../src/pipeline/orchestrator.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { AppError } from "../src/lib/errors.js";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
function makeHarness(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  const harness = createPipelineHarness(options);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("pipeline state machine", () => {
  it("derives project status for every required branch", () => {
    const pending = [{ state: "PENDING" as const }];
    expect(deriveProjectStatus({ activeJob: { stage: "RENDER" }, stages: pending, projectStage: "TOPIC" })).toBe("RENDERING");
    expect(deriveProjectStatus({ activeJob: { stage: "SCRIPT" }, stages: pending, projectStage: "TOPIC" })).toBe("GENERATING");
    expect(deriveProjectStatus({
      activeJob: { stage: "SUBTITLE" },
      stages: [{ state: "WAITING_USER" }, { state: "RUNNING" }],
      projectStage: "VISUAL_REVIEW",
    })).toBe("REVIEW");
    expect(deriveProjectStatus({ activeJob: null, stages: [{ state: "WAITING_USER" }], projectStage: "VISUAL_REVIEW" })).toBe("REVIEW");
    expect(deriveProjectStatus({ activeJob: null, stages: [{ state: "FAILED" }], projectStage: "SCRIPT" })).toBe("FAILED");
    expect(deriveProjectStatus({ activeJob: null, stages: pending, projectStage: "DONE" })).toBe("COMPLETED");
    expect(deriveProjectStatus({ activeJob: null, stages: pending, projectStage: "TOPIC" })).toBe("DRAFT");
  });

  it("runs assisted mode through gates and finishes after approvals", async () => {
    const harness = makeHarness();
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    let state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("VISUAL_REVIEW");
    expect(state.status).toBe("REVIEW");
    expect(state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.state).toBe("WAITING_USER");

    harness.orchestrator.approveGate(harness.projectId, "VISUAL_REVIEW");
    await drainUntilGate(harness);
    state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("MUSIC_REVIEW");
    harness.orchestrator.approveGate(harness.projectId, "MUSIC_REVIEW");
    await drainUntilGate(harness);
    state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("FINAL_APPROVAL");
    harness.orchestrator.approveGate(harness.projectId, "FINAL_APPROVAL");
    await harness.worker.tick();
    state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.status).toBe("COMPLETED");
    expect(state.currentStage).toBe("DONE");
    expect(state.stages.every((stage) => stage.state === "DONE")).toBe(true);
  });

  it("automatically passes visual and music gates but pauses at final approval", async () => {
    const harness = makeHarness({ mode: "AUTO" });
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    const state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("FINAL_APPROVAL");
    expect(state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.message).toBe("Auto-approved (AUTO mode)");
    expect(state.stages.find((stage) => stage.stage === "MUSIC_REVIEW")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "FINAL_APPROVAL")?.state).toBe("WAITING_USER");
  });

  it("pauses AUTO at visual review when selected images are not ready", async () => {
    const harness = makeHarness({
      mode: "AUTO",
      canApprove: (_project, gate) => gate === "VISUAL_REVIEW"
        ? { allowed: false, message: "1 scene needs attention before visual review can be approved." }
        : { allowed: true },
    });
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    const state = harness.orchestrator.getPipeline(harness.projectId);
    const visualGate = state.stages.find((stage) => stage.stage === "VISUAL_REVIEW");
    expect(state.currentStage).toBe("VISUAL_REVIEW");
    expect(visualGate?.state).toBe("WAITING_USER");
    expect(visualGate?.message).toContain("1 scene needs attention");
  });

  it("auto-renders when enabled and manual approval never continues automatically", async () => {
    const automatic = makeHarness({ mode: "AUTO", autoRender: true });
    automatic.orchestrator.runAll(automatic.projectId);
    for (let step = 0; step < 20; step += 1) {
      const state = automatic.orchestrator.getPipeline(automatic.projectId);
      if (!state.activeJob || state.activeJob.status !== "QUEUED") break;
      await automatic.worker.tick();
    }
    expect(automatic.orchestrator.getPipeline(automatic.projectId).status).toBe("COMPLETED");

    const manual = makeHarness({ mode: "MANUAL" });
    expect(() => manual.orchestrator.runStage(manual.projectId, "SCRIPT")).toThrowError(AppError);
    manual.orchestrator.runAll(manual.projectId);
    await drainUntilGate(manual);
    manual.orchestrator.approveGate(manual.projectId, "VISUAL_REVIEW");
    const state = manual.orchestrator.getPipeline(manual.projectId);
    expect(state.runMode).toBeNull();
    expect(state.stages.find((stage) => stage.stage === "TIMELINE")?.state).toBe("PENDING");
  });

  it("allows only one active job per project and marks downstream completed stages stale", () => {
    const harness = makeHarness();
    harness.orchestrator.runAll(harness.projectId);
    expect(() => harness.orchestrator.runAll(harness.projectId)).toThrowError(
      expect.objectContaining({ statusCode: 409, code: "INVALID_PIPELINE_STATE" }),
    );
    harness.repository.atomic(() => {
      for (const stage of STAGE_ORDER.slice(2, 5)) {
        harness.repository.updateStage(harness.projectId, stage, { state: "DONE", progress: 100 });
      }
    });
    markStaleFrom(harness.repository, harness.projectId, "SCRIPT");
    for (const stage of STAGE_ORDER.slice(2, 5)) {
      expect(harness.repository.getStage(harness.projectId, stage).state).toBe("STALE");
    }
  });

  it("enforces earlier stage completion before a single-stage run", () => {
    const harness = makeHarness();
    expect(() => harness.orchestrator.runStage(harness.projectId, "SCENE_PLAN")).toThrowError(
      expect.objectContaining({ statusCode: 409, code: "INVALID_PIPELINE_STATE" }),
    );
    expect(() => harness.orchestrator.runStage(harness.projectId, "VISUAL_REVIEW")).toThrowError(AppError);
  });

  it("waits at a USER voice stage until every narrated scene has a track", () => {
    const harness = makeHarness();
    const project = harness.repository.getProject(harness.projectId)!;
    harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(
      JSON.stringify({ ...project.settings, stageExecutors: { voice: "USER" } }),
      harness.projectId,
    );
    harness.repository.atomic(() => {
      harness.repository.ensureStages(harness.projectId);
      for (const stage of STAGE_ORDER.slice(0, STAGE_ORDER.indexOf("VOICE"))) {
        harness.repository.updateStage(harness.projectId, stage, { state: "DONE", progress: 100 });
      }
    });
    const sceneId = randomUUID();
    const now = new Date().toISOString();
    harness.sqlite.prepare(
      `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
        music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
        input_hash, created_at, updated_at)
       VALUES (?, ?, 0, 'section', NULL, 'Narrated scene', 'Hello', '', ?, '', 'medium', 4, NULL, 0, '', 'USER', 0, 'input', ?, ?)`,
    ).run(sceneId, harness.projectId, JSON.stringify({ primary: "", alternatives: [], queryVariant: false }), now, now);

    harness.orchestrator.runAll(harness.projectId);
    expect(harness.repository.getStage(harness.projectId, "VOICE")).toMatchObject({
      state: "WAITING_USER",
      message: "Upload a voice track for every narrated scene, then continue.",
    });

    harness.sqlite.prepare(
      `INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec,
        cues, input_hash, narration_hash, created_at, updated_at)
       VALUES (?, ?, ?, 'USER', 'user-upload', '+0%', 'USER', 'fixture.wav', 1, '[]', 'input', 'narration', ?, ?)`,
    ).run(randomUUID(), harness.projectId, sceneId, now, now);
    harness.orchestrator.runStage(harness.projectId, "VOICE");

    expect(harness.repository.getStage(harness.projectId, "VOICE")).toMatchObject({ state: "DONE", message: "Provided by user" });
    expect(harness.repository.getStage(harness.projectId, "SUBTITLE").state).toBe("QUEUED");
  });

  it("stales later completed stages when re-running a completed stage", () => {
    const harness = makeHarness();
    harness.repository.atomic(() => {
      for (const stage of STAGE_ORDER.slice(0, 5)) {
        harness.repository.updateStage(harness.projectId, stage, { state: "DONE", progress: 100 });
      }
    });
    harness.orchestrator.runStage(harness.projectId, "RESEARCH");
    expect(harness.repository.getStage(harness.projectId, "RESEARCH").state).toBe("QUEUED");
    for (const stage of STAGE_ORDER.slice(1, 5)) {
      expect(harness.repository.getStage(harness.projectId, stage).state).toBe("STALE");
    }
  });

  it("keeps checkpoint progress when a running job is resumed", () => {
    const harness = makeHarness();
    const job = harness.repository.createJob({
      projectId: harness.projectId,
      stage: "VISUAL_SEARCH",
      maxAttempts: 1,
      previousState: "PENDING",
    });
    harness.repository.updateJob(job.id, {
      status: "RUNNING",
      progress: 70,
      message: "Vision-checking candidate images",
      startedAt: harness.clock().toISOString(),
    });
    harness.repository.updateStage(harness.projectId, "VISUAL_SEARCH", {
      state: "RUNNING",
      progress: 70,
      message: "Vision-checking candidate images",
      jobId: job.id,
    });
    harness.orchestrator.resumeRunningJobs();
    const queued = harness.repository.getStage(harness.projectId, "VISUAL_SEARCH");
    expect(queued.progress).toBe(70);
    expect(queued.state).toBe("QUEUED");
    expect(queued.message).toContain("Vision-checking candidate images");
    expect(harness.repository.getJob(job.id)?.progress).toBe(70);

    const started = harness.orchestrator.startJob(job.id);
    expect(started?.status).toBe("RUNNING");
    expect(started?.progress).toBe(70);
    expect(harness.repository.getStage(harness.projectId, "VISUAL_SEARCH").progress).toBe(70);
  });

  it("derives visual-search resume progress from checkpoints when the job progress is still zero", () => {
    const harness = makeHarness();
    const now = harness.clock().toISOString();
    for (const sceneId of ["scene-a", "scene-b"]) {
      harness.sqlite.prepare(
        `INSERT INTO visual_search_checkpoints (scene_id, project_id, search_hash, queries, candidates, created_at)
         VALUES (?, ?, 'hash', '[]', '[]', ?)`,
      ).run(sceneId, harness.projectId, now);
    }
    const job = harness.repository.createJob({
      projectId: harness.projectId,
      stage: "VISUAL_SEARCH",
      maxAttempts: 1,
      previousState: "PENDING",
    });
    harness.repository.updateJob(job.id, { status: "RUNNING", progress: 0, startedAt: now });
    harness.repository.updateStage(harness.projectId, "VISUAL_SEARCH", {
      state: "RUNNING",
      progress: 0,
      message: "Searching visuals: scene 1/2",
      jobId: job.id,
    });
    harness.orchestrator.resumeRunningJobs();
    expect(harness.repository.getStage(harness.projectId, "VISUAL_SEARCH").progress).toBe(55);
    expect(harness.repository.getJob(job.id)?.progress).toBe(55);
  });

  it("releases every project event listener after repeated subscriptions", () => {
    const events = new PipelineEventBus();
    const projectId = "55555555-5555-4555-8555-555555555555";
    const unsubscribe = Array.from({ length: 20 }, () => events.subscribe(projectId, () => undefined));
    expect(events.listenerCount(projectId)).toBe(20);
    for (const remove of unsubscribe) remove();
    expect(events.listenerCount(projectId)).toBe(0);
  });

  it("does not publish events from a nested transaction when the outer transaction rolls back", () => {
    const harness = makeHarness();
    let published = 0;
    const unsubscribe = harness.events.subscribe(harness.projectId, () => { published += 1; });

    expect(() => harness.repository.atomic(() => {
      harness.repository.atomic(() => {
        harness.repository.updateStage(harness.projectId, "RESEARCH", { state: "RUNNING" });
      });
      throw new Error("rollback outer transaction");
    })).toThrow("rollback outer transaction");

    unsubscribe();
    expect(published).toBe(0);
    expect(harness.repository.getStage(harness.projectId, "RESEARCH").state).toBe("PENDING");
  });

  it("queues visuals and voice together, then starts timeline only after both gates", async () => {
    const harness = makeHarness({ config: { FAKE_STAGE_DELAY_MS: 0, WORKER_CONCURRENCY: 3 } });
    harness.orchestrator.runAll(harness.projectId);
    for (let step = 0; step < 8; step += 1) {
      const state = harness.orchestrator.getPipeline(harness.projectId);
      const visual = state.stages.find((stage) => stage.stage === "VISUAL_SEARCH")?.state;
      const voice = state.stages.find((stage) => stage.stage === "VOICE")?.state;
      if (visual === "QUEUED" && voice === "QUEUED") break;
      await harness.worker.tick();
    }
    let state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.stages.find((stage) => stage.stage === "VISUAL_SEARCH")?.state).toBe("QUEUED");
    expect(state.stages.find((stage) => stage.stage === "VOICE")?.state).toBe("QUEUED");

    for (let step = 0; step < 12; step += 1) {
      state = harness.orchestrator.getPipeline(harness.projectId);
      const review = state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.state;
      const music = state.stages.find((stage) => stage.stage === "MUSIC_REVIEW")?.state;
      if (review === "WAITING_USER" && music === "WAITING_USER") break;
      await harness.worker.tick();
    }
    state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.status).toBe("REVIEW");
    expect(state.currentStage).toBe("VISUAL_REVIEW");
    expect(state.stages.find((stage) => stage.stage === "VOICE")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "SUBTITLE")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "MUSIC_SEARCH")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "TIMELINE")?.state).toBe("PENDING");

    harness.orchestrator.approveGate(harness.projectId, "VISUAL_REVIEW");
    expect(harness.repository.getStage(harness.projectId, "TIMELINE").state).toBe("PENDING");
    harness.orchestrator.approveGate(harness.projectId, "MUSIC_REVIEW");
    expect(harness.repository.getStage(harness.projectId, "TIMELINE").state).toBe("QUEUED");
    expect(harness.repository.listJobs(harness.projectId, 30).filter((job) => job.stage === "TIMELINE")).toHaveLength(1);
  });

  it("keeps voice done and stales timeline when visuals are searched again", () => {
    const harness = makeHarness();
    const done = ["RESEARCH", "SCRIPT", "SCENE_PLAN", "VISUAL_SEARCH", "VISUAL_REVIEW", "VOICE", "SUBTITLE", "MUSIC_SEARCH", "MUSIC_REVIEW", "TIMELINE"] as const;
    harness.repository.atomic(() => {
      for (const stage of done) {
        harness.repository.updateStage(harness.projectId, stage, { state: "DONE", progress: 100 });
      }
    });
    harness.orchestrator.runStage(harness.projectId, "VISUAL_SEARCH");
    expect(harness.repository.getStage(harness.projectId, "VISUAL_SEARCH").state).toBe("QUEUED");
    expect(harness.repository.getStage(harness.projectId, "VOICE").state).toBe("DONE");
    expect(harness.repository.getStage(harness.projectId, "SUBTITLE").state).toBe("DONE");
    expect(harness.repository.getStage(harness.projectId, "MUSIC_SEARCH").state).toBe("DONE");
    expect(harness.repository.getStage(harness.projectId, "TIMELINE").state).toBe("STALE");
    expect(harness.repository.getStage(harness.projectId, "VISUAL_REVIEW").state).toBe("STALE");
  });

  it("cancels one lane while the other stays queued", async () => {
    const harness = makeHarness({ config: { FAKE_STAGE_DELAY_MS: 0, WORKER_CONCURRENCY: 3 } });
    harness.orchestrator.runAll(harness.projectId);
    for (let step = 0; step < 8; step += 1) {
      const state = harness.orchestrator.getPipeline(harness.projectId);
      const visual = state.stages.find((stage) => stage.stage === "VISUAL_SEARCH")?.state;
      const voice = state.stages.find((stage) => stage.stage === "VOICE")?.state;
      if (visual === "QUEUED" && voice === "QUEUED") break;
      await harness.worker.tick();
    }
    harness.orchestrator.cancel(harness.projectId, "VOICE");
    const state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.runMode).toBe("ALL");
    expect(state.stages.find((stage) => stage.stage === "VISUAL_SEARCH")?.state).toBe("QUEUED");
    expect(state.activeJobs?.some((job) => job.stage === "VISUAL_SEARCH")).toBe(true);
    expect(state.activeJobs?.some((job) => job.stage === "VOICE")).toBe(false);
    expect(harness.repository.listJobs(harness.projectId, 10).find((job) => job.stage === "VOICE")?.status).toBe("CANCELLED");
    harness.orchestrator.cancel(harness.projectId);
    const cleared = harness.orchestrator.getPipeline(harness.projectId);
    expect(cleared.runMode).toBeNull();
    expect(cleared.activeJob).toBeNull();
    expect(cleared.stages.find((stage) => stage.stage === "VISUAL_SEARCH")?.state).not.toBe("QUEUED");
  });

  it("resumes two running jobs and keeps the visual checkpoint", () => {
    const harness = makeHarness();
    const now = harness.clock().toISOString();
    const visual = harness.repository.createJob({
      projectId: harness.projectId,
      stage: "VISUAL_SEARCH",
      maxAttempts: 1,
      previousState: "PENDING",
    });
    const voice = harness.repository.createJob({
      projectId: harness.projectId,
      stage: "VOICE",
      maxAttempts: 1,
      previousState: "PENDING",
    });
    harness.repository.updateJob(visual.id, { status: "RUNNING", progress: 70, message: "Vision-checking candidate images", startedAt: now });
    harness.repository.updateJob(voice.id, { status: "RUNNING", progress: 15, message: "Reading", startedAt: now });
    harness.repository.updateStage(harness.projectId, "VISUAL_SEARCH", {
      state: "RUNNING", progress: 70, message: "Vision-checking candidate images", jobId: visual.id,
    });
    harness.repository.updateStage(harness.projectId, "VOICE", {
      state: "RUNNING", progress: 15, message: "Reading", jobId: voice.id,
    });
    harness.orchestrator.resumeRunningJobs();
    expect(harness.repository.getStage(harness.projectId, "VISUAL_SEARCH")).toMatchObject({
      state: "QUEUED",
      progress: 70,
    });
    expect(harness.repository.getStage(harness.projectId, "VISUAL_SEARCH").message).toContain("Vision-checking candidate images");
    expect(harness.repository.getStage(harness.projectId, "VOICE")).toMatchObject({ state: "QUEUED", progress: 15 });
    expect(harness.repository.getJob(visual.id)?.status).toBe("QUEUED");
    expect(harness.repository.getJob(voice.id)?.status).toBe("QUEUED");
  });
});
