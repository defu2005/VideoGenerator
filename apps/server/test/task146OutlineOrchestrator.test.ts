import { afterEach, describe, expect, it } from "vitest";
import type { PipelineStage } from "@vg/shared";
import type { StageContext, StageExecutor } from "../src/pipeline/stageExecutor.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ScriptExecutor } from "../src/stages/script/scriptExecutor.js";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";

// TASK-146 outline mode (commit C, orchestrator level): SCRIPT parks after the outline, approval resumes it,
// and SCRIPT_REVIEW does not stop again in outline mode.

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
function makeHarness(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  const harness = createPipelineHarness(options);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const stateOf = (harness: ReturnType<typeof createPipelineHarness>, stage: PipelineStage) =>
  harness.repository.getStage(harness.projectId, stage).state;

const phaseOf = (harness: ReturnType<typeof createPipelineHarness>) =>
  (harness.sqlite.prepare("SELECT phase FROM script_drafts WHERE project_id = ?").get(harness.projectId) as { phase: string | null } | undefined)?.phase ?? null;

// Ticks the worker until no job is active, so a second runAll does not hit "A job is already active".
async function settleUntilIdle(harness: ReturnType<typeof createPipelineHarness>): Promise<void> {
  for (let iteration = 0; iteration < 60; iteration += 1) {
    if (!harness.orchestrator.getPipeline(harness.projectId).activeJob) return;
    await harness.worker.tick();
  }
}

// SCRIPT stub that follows the executor contract: the first run parks with phase outline_ready, a resumed run completes.
function installScriptStub(harness: ReturnType<typeof createPipelineHarness>) {
  const counter = { runs: 0 };
  const stub = {
    stage: "SCRIPT",
    async run(_context: StageContext) {
      counter.runs += 1;
      if (phaseOf(harness) === "outline_approved") return { message: "Script written from the approved outline" };
      harness.sqlite.prepare(
        `INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at, phase)
         VALUES (?, '{}', '{"candidates":[],"chosenHookId":null,"hookAssessments":[]}', NULL, NULL, 'off', 'stub-hash', ?, 'outline_ready')
         ON CONFLICT(project_id) DO UPDATE SET phase = 'outline_ready', updated_at = excluded.updated_at`,
      ).run(harness.projectId, new Date().toISOString());
      return { message: "Outline ready for review", waitForUser: "Outline ready for review" };
    },
  } as unknown as StageExecutor;
  harness.executors.set("SCRIPT", stub);
  return counter;
}

describe("TASK-146 outline mode: orchestrator parks and resumes SCRIPT", () => {
  it("parks SCRIPT after the outline: SCRIPT waits, SCRIPT_REVIEW does not stop, and nothing re-runs on its own", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "outline" });
    const counter = installScriptStub(harness);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(stateOf(harness, "SCRIPT")).toBe("WAITING_USER");
    expect(stateOf(harness, "SCRIPT_REVIEW")).not.toBe("WAITING_USER");
    expect(stateOf(harness, "SCENE_PLAN")).toBe("PENDING");
    expect(phaseOf(harness)).toBe("outline_ready");
    await settleUntilIdle(harness);
    expect(counter.runs).toBe(1);
  });

  it("approving the outline resumes SCRIPT once, marks SCRIPT done and the phase done, and the run continues past the gate", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "outline" });
    const counter = installScriptStub(harness);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);

    harness.orchestrator.approveGate(harness.projectId, "SCRIPT");
    // AUTO mode queues the resumed SCRIPT job straight away.
    expect(stateOf(harness, "SCRIPT")).toBe("QUEUED");
    expect(phaseOf(harness)).toBe("outline_approved");

    await settleUntilIdle(harness);
    expect(counter.runs).toBe(2);
    expect(stateOf(harness, "SCRIPT")).toBe("DONE");
    expect(phaseOf(harness)).toBe("done");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
    expect(stateOf(harness, "SCENE_PLAN")).not.toBe("PENDING");
  });

  it("switching the review setting to script before completion sends SCRIPT_REVIEW back to waiting for the user", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "outline" });
    installScriptStub(harness);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    harness.orchestrator.approveGate(harness.projectId, "SCRIPT");
    const settings = JSON.parse((harness.sqlite.prepare("SELECT settings FROM projects WHERE id = ?").get(harness.projectId) as { settings: string }).settings);
    harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?")
      .run(JSON.stringify({ ...settings, scriptOutlineApproval: "script" }), harness.projectId);
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCRIPT")).toBe("DONE");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("WAITING_USER");
    expect(stateOf(harness, "SCENE_PLAN")).toBe("PENDING");
  });

  it("rejects a second approval, and an approval when the phase is not outline_ready", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "outline" });
    installScriptStub(harness);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    harness.orchestrator.approveGate(harness.projectId, "SCRIPT");
    expect(() => harness.orchestrator.approveGate(harness.projectId, "SCRIPT")).toThrow();
    await settleUntilIdle(harness);

    const other = makeHarness({ mode: "AUTO", scriptOutlineApproval: "outline" });
    installScriptStub(other);
    other.orchestrator.runAll(other.projectId);
    await drainUntilGate(other);
    other.sqlite.prepare("UPDATE script_drafts SET phase = NULL WHERE project_id = ?").run(other.projectId);
    expect(() => other.orchestrator.approveGate(other.projectId, "SCRIPT" as PipelineStage)).toThrow();
  });

  it("in MANUAL mode, approving does not auto-continue: SCRIPT waits as PENDING and the run mode is cleared", async () => {
    const harness = makeHarness({ mode: "MANUAL", scriptOutlineApproval: "outline" });
    const counter = installScriptStub(harness);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(stateOf(harness, "SCRIPT")).toBe("WAITING_USER");
    harness.orchestrator.approveGate(harness.projectId, "SCRIPT");
    await settleUntilIdle(harness);
    expect(counter.runs).toBe(1);
    expect(stateOf(harness, "SCRIPT")).toBe("PENDING");
    const row = harness.sqlite.prepare("SELECT run_mode FROM projects WHERE id = ?").get(harness.projectId) as { run_mode: string | null };
    expect(row.run_mode).toBeNull();
  });

  it("if SCRIPT finishes without a parked outline (no approval step), SCRIPT_REVIEW waits for the user and approving it resumes the run", async () => {
    const harness = makeHarness({ mode: "AUTO", scriptOutlineApproval: "outline" });
    harness.executors.set("SCRIPT", { stage: "SCRIPT", async run() { return { message: "Script saved" }; } } as unknown as StageExecutor);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCRIPT")).toBe("DONE");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("WAITING_USER");
    expect(stateOf(harness, "SCENE_PLAN")).toBe("PENDING");

    harness.orchestrator.approveGate(harness.projectId, "SCRIPT_REVIEW");
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
    expect(stateOf(harness, "SCENE_PLAN")).not.toBe("PENDING");
  });

  it("end to end with the real ScriptExecutor: parks, approval resumes, and the run passes SCRIPT_REVIEW", async () => {
    const harness = makeHarness({
      mode: "AUTO",
      scriptOutlineApproval: "outline",
      config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false },
    });
    const settings = JSON.parse((harness.sqlite.prepare("SELECT settings FROM projects WHERE id = ?").get(harness.projectId) as { settings: string }).settings);
    harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(
      JSON.stringify({ ...settings, researchMode: "separate", budget: { mode: "BALANCED", features: { storyEngine: "full", storyMode: "separate" } } }),
      harness.projectId,
    );
    harness.sqlite.prepare(
      "INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, 'research-hash', 'mock', 'mock', 0, ?, ?)",
    ).run(harness.projectId, new Date().toISOString(), JSON.stringify({
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
    }));
    const registry = new LlmProviderRegistry(harness.config);
    harness.executors.set("SCRIPT", new ScriptExecutor(harness.sqlite, registry, harness.config));

    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    expect(stateOf(harness, "SCRIPT")).toBe("WAITING_USER");
    expect(phaseOf(harness)).toBe("outline_ready");

    harness.orchestrator.approveGate(harness.projectId, "SCRIPT");
    await settleUntilIdle(harness);
    expect(stateOf(harness, "SCRIPT")).toBe("DONE");
    expect(phaseOf(harness)).toBe("done");
    expect(stateOf(harness, "SCRIPT_REVIEW")).toBe("DONE");
    expect(stateOf(harness, "SCENE_PLAN")).not.toBe("PENDING");
  });
});
