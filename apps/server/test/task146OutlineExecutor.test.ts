import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ScriptExecutor } from "../src/stages/script/scriptExecutor.js";
import { ScriptService } from "../src/services/scriptService.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

// TASK-146 outline mode (commit C, executor and guard level): park, resume, invalid resume, and 409 guards while an outline is pending.

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const OUTLINE_MARK = "master story architect";
const WRITER_MARK = "Preserve beat metadata";

function setup(options: { tuned?: boolean } = {}) {
  const harness = createPipelineHarness({
    scriptOutlineApproval: "outline",
    config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false },
  });
  harnesses.push(harness);
  // tuned (default): force the full story engine. Untuned: the project's own default budget and research mode.
  if (options.tuned !== false) {
    const settings = JSON.parse((harness.sqlite.prepare("SELECT settings FROM projects WHERE id = ?").get(harness.projectId) as { settings: string }).settings);
    harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(
      JSON.stringify({ ...settings, researchMode: "separate", budget: { mode: "BALANCED", features: { storyEngine: "full", storyMode: "separate" } } }),
      harness.projectId,
    );
  }
  // Stored research must satisfy StoredResearchNotesSchema (5 to 16 key facts); without it the engine falls back to the legacy path.
  const research = {
    summary: "Tóm tắt.",
    keyFacts: [
      { fact: "Vụ nổ Big Bang xảy ra khoảng 13.8 tỷ năm trước.", confidence: "high", sourceHint: "NASA" },
      { fact: "Bức xạ tàn dư vũ trụ được phát hiện năm 1965.", confidence: "high", sourceHint: "Penzias" },
      { fact: "Vũ trụ đang giãn nở.", confidence: "high", sourceHint: "Hubble" },
      { fact: "Vật chất tối chiếm phần lớn khối lượng vũ trụ.", confidence: "high", sourceHint: "Planck" },
      { fact: "Ánh sáng từ thiên hà xa được dịch đỏ.", confidence: "high", sourceHint: "Hubble" },
    ],
    timeline: [{ date: "13.8 tỷ năm", event: "Big Bang" }],
    angles: ["Nguồn gốc"],
    outline: [
      { section: "Mở đầu", purpose: "Big Bang", points: ["Khởi đầu"] },
      { section: "Bằng chứng", purpose: "CMB", points: ["Khám phá"] },
      { section: "Tương lai", purpose: "Số phận", points: ["Giãn nở"] },
    ],
    cautions: ["Không nhầm vật chất tối"],
  };
  harness.sqlite.prepare(
    "INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, 'research-hash', 'mock', 'mock', 0, ?, ?)",
  ).run(harness.projectId, new Date().toISOString(), JSON.stringify(research));
  const registry = new LlmProviderRegistry(harness.config);
  const generate = vi.spyOn(registry.get("mock")!, "generate");
  const executor = new ScriptExecutor(harness.sqlite, registry, harness.config);
  const counts = () => ({
    outline: generate.mock.calls.filter((call) => String(call[0].system ?? "").includes(OUTLINE_MARK)).length,
    writer: generate.mock.calls.filter((call) => String(call[0].system ?? "").includes(WRITER_MARK)).length,
  });
  return { harness, registry, generate, executor, counts };
}

function contextFor(harness: ReturnType<typeof createPipelineHarness>, options: { canPark?: boolean } = {}) {
  const job = harness.repository.createJob({
    projectId: harness.projectId,
    stage: "SCRIPT",
    maxAttempts: harness.config.JOB_MAX_ATTEMPTS,
    previousState: "PENDING",
  });
  const usage: unknown[] = [];
  const context: StageContext = {
    project: harness.repository.getProject(harness.projectId)!,
    job,
    signal: new AbortController().signal,
    reportProgress() {},
    recordUsage(value) { usage.push(value); },
    logger: Fastify({ logger: false }).log,
    ...(options.canPark ? { canPark: true } : {}),
  };
  return { context, usage };
}

const draftOf = (harness: ReturnType<typeof createPipelineHarness>) =>
  harness.sqlite.prepare("SELECT phase, input_hash, outline FROM script_drafts WHERE project_id = ?").get(harness.projectId) as
    | { phase: string | null; input_hash: string; outline: string | null }
    | undefined;

describe("TASK-146 outline mode: ScriptExecutor parks and resumes", () => {
  it("parks under the project's default budget and research mode too (no override)", async () => {
    const { harness, executor, counts } = setup({ tuned: false });
    const result = await executor.run(contextFor(harness, { canPark: true }).context);
    expect(result.waitForUser).toBeTruthy();
    expect(counts().writer).toBe(0);
    expect(draftOf(harness)?.phase).toBe("outline_ready");
  });

  it("with canPark, parks after the outline: waitForUser, phase outline_ready, no writer call, usage recorded once", async () => {
    const { harness, executor, counts } = setup();
    const { context, usage } = contextFor(harness, { canPark: true });
    const result = await executor.run(context);
    expect(result.waitForUser).toBeTruthy();
    expect(counts()).toEqual({ outline: 1, writer: 0 });
    expect(draftOf(harness)?.phase).toBe("outline_ready");
    expect(usage).toHaveLength(1);
  });

  it("without canPark, outline mode still writes the full script and leaves the phase NULL", async () => {
    const { harness, executor, counts } = setup();
    const { context } = contextFor(harness);
    const result = await executor.run(context);
    expect(result.waitForUser).toBeUndefined();
    expect(counts().writer).toBeGreaterThan(0);
    expect(draftOf(harness)?.phase ?? null).toBeNull();
  });

  it("resumes an approved outline with a matching hash: no new outline call, writer runs, phase stays outline_approved", async () => {
    const { harness, executor, generate, counts } = setup();
    await executor.run(contextFor(harness, { canPark: true }).context);
    harness.sqlite.prepare("UPDATE script_drafts SET phase = 'outline_approved' WHERE project_id = ?").run(harness.projectId);
    generate.mockClear();
    const result = await executor.run(contextFor(harness).context);
    expect(result.waitForUser).toBeUndefined();
    expect(counts().outline).toBe(0);
    expect(counts().writer).toBeGreaterThan(0);
    expect(draftOf(harness)?.phase).toBe("outline_approved");
  });

  it("with a hash mismatch, the approval is not used: the engine generates a new outline and parks again", async () => {
    const { harness, executor, generate, counts } = setup();
    await executor.run(contextFor(harness, { canPark: true }).context);
    harness.sqlite.prepare("UPDATE script_drafts SET phase = 'outline_approved', input_hash = 'stale-hash' WHERE project_id = ?").run(harness.projectId);
    generate.mockClear();
    const result = await executor.run(contextFor(harness, { canPark: true }).context);
    expect(result.waitForUser).toBeTruthy();
    expect(counts().outline).toBe(1);
    expect(counts().writer).toBe(0);
    expect(draftOf(harness)?.phase).toBe("outline_ready");
  });

  it("an invalid stored outline rejects with APPROVED_OUTLINE_INVALID, clears the phase, and a later canPark run parks again", async () => {
    const { harness, executor, generate, counts } = setup();
    await executor.run(contextFor(harness, { canPark: true }).context);
    harness.sqlite.prepare("UPDATE script_drafts SET phase = 'outline_approved', outline = '{}' WHERE project_id = ?").run(harness.projectId);
    generate.mockClear();
    await expect(executor.run(contextFor(harness).context)).rejects.toMatchObject({ code: "APPROVED_OUTLINE_INVALID", retryable: true });
    expect(counts().outline).toBe(0);
    expect(draftOf(harness)?.phase ?? null).toBeNull();
    const again = await executor.run(contextFor(harness, { canPark: true }).context);
    expect(again.waitForUser).toBeTruthy();
    expect(draftOf(harness)?.phase).toBe("outline_ready");
  });
});

describe("TASK-146 outline mode: hook switch and rescore wait while the outline is pending", () => {
  // Builds a valid scripts row with a full run, then parks the draft as outline_ready.
  async function pendingFixture() {
    const fixture = setup();
    const { harness, executor, generate } = fixture;
    await executor.run(contextFor(harness).context);
    // The direct executor run leaves its job queued; finish it so the service sees no active job.
    harness.sqlite.prepare("UPDATE jobs SET status = 'SUCCEEDED' WHERE status IN ('QUEUED', 'RUNNING')").run();
    harness.sqlite.prepare(
      `INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at, phase)
       VALUES (?, '{}', '{"candidates":[],"chosenHookId":null,"hookAssessments":[]}', NULL, NULL, 'off', 'parked-hash', ?, 'outline_ready')
       ON CONFLICT(project_id) DO UPDATE SET phase = 'outline_ready', input_hash = 'parked-hash', hook_candidates = excluded.hook_candidates`,
    ).run(harness.projectId, new Date().toISOString());
    generate.mockClear();
    const service = new ScriptService(harness.sqlite, harness.repository, harness.orchestrator, harness.config, fixture.registry);
    return { ...fixture, service };
  }

  it("switchHook returns 409 OUTLINE_PENDING, makes no LLM call, and leaves the draft hash unchanged", async () => {
    const { harness, generate, service } = await pendingFixture();
    await expect(service.switchHook(harness.projectId, "any-hook")).rejects.toMatchObject({ statusCode: 409, code: "OUTLINE_PENDING" });
    expect(generate).not.toHaveBeenCalled();
    expect(draftOf(harness)?.input_hash).toBe("parked-hash");
  });

  it("rescoreCritique returns 409 OUTLINE_PENDING, makes no LLM call, and leaves the draft hash unchanged", async () => {
    const { harness, generate, service } = await pendingFixture();
    await expect(service.rescoreCritique(harness.projectId)).rejects.toMatchObject({ statusCode: 409, code: "OUTLINE_PENDING" });
    expect(generate).not.toHaveBeenCalled();
    expect(draftOf(harness)?.input_hash).toBe("parked-hash");
  });
});

describe("TASK-146 outline editing: approval resumes narration with the edited outline", () => {
  const EDITED_QUESTION = "Câu hỏi đã được người dùng sửa?";
  const EDITED_MOMENT = "Khoảnh khắc đã được người dùng sửa";

  it("park, edit the central question and one beat moment, approve, then the narration prompt carries both edits", async () => {
    const fixture = setup();
    const { harness, executor, generate, registry, counts } = fixture;
    await executor.run(contextFor(harness, { canPark: true }).context);
    // The direct executor run leaves its job queued; finish it so the service sees no active job.
    harness.sqlite.prepare("UPDATE jobs SET status = 'SUCCEEDED' WHERE status IN ('QUEUED', 'RUNNING')").run();
    harness.repository.updateStage(harness.projectId, "SCRIPT", { state: "WAITING_USER", progress: 0, message: "Outline ready for review", jobId: null, error: null });
    const parked = JSON.parse(draftOf(harness)!.outline!) as { beats: { id: string }[] };
    const service = new ScriptService(harness.sqlite, harness.repository, harness.orchestrator, harness.config, registry);
    service.editOutline(harness.projectId, { centralQuestion: EDITED_QUESTION, beats: [{ id: parked.beats[0]!.id, concreteMoment: EDITED_MOMENT }] });
    // Approval moves the phase; the approve path itself is covered by task146OutlineApi.test.ts.
    harness.sqlite.prepare("UPDATE script_drafts SET phase = 'outline_approved' WHERE project_id = ?").run(harness.projectId);
    generate.mockClear();

    const result = await executor.run(contextFor(harness).context);
    expect(result.waitForUser).toBeUndefined();
    expect(counts().outline).toBe(0);
    const writerPayloads = generate.mock.calls
      .filter((call) => String(call[0].system ?? "").includes(WRITER_MARK))
      .map((call) => JSON.stringify(call[0]));
    expect(writerPayloads.length).toBeGreaterThan(0);
    expect(writerPayloads.some((payload) => payload.includes(EDITED_QUESTION) && payload.includes(EDITED_MOMENT))).toBe(true);
  });
});
