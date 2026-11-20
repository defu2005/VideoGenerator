import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  STORY_ENGINE_BENCHMARK_FIXTURES,
  type Project,
  type ResearchNotes,
} from "@vg/shared";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import { runStoryEngine, bindSectionsToBeats, keepScriptMetadata } from "../src/stages/script/storyEngine.js";
import { ScriptService } from "../src/services/scriptService.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("storyEngine", () => {
  it("runs the full story engine multi-step pipeline under mock provider", async () => {
    const harness = createPipelineHarness({
      config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: true },
    });
    harnesses.push(harness);

    const project = harness.repository.getProject(harness.projectId)!;
    const registry = new LlmProviderRegistry(harness.config);
    const cache = new LlmCache(harness.sqlite, true);

    const mockResearch: ResearchNotes = {
      summary: "Tóm tắt về lịch sử hình thành vũ trụ.",
      keyFacts: [
        { fact: "Vụ nổ Big Bang xảy ra khoảng 13.8 tỷ năm trước.", confidence: "high", sourceHint: "NASA" },
        { fact: "Bức xạ tàn dư vũ trụ (CMB) được phát hiện năm 1965.", confidence: "high", sourceHint: "Penzias and Wilson" },
        { fact: "Vũ trụ đang giãn nở với tốc độ gia tăng.", confidence: "high", sourceHint: "Hubble Telescope" },
        { fact: "Vật chất tối chiếm khoảng 27% tổng năng lượng vũ trụ.", confidence: "medium", sourceHint: "Planck" },
        { fact: "Năng lượng tối chiếm khoảng 68% tổng năng lượng vũ trụ.", confidence: "high", sourceHint: "Supernova Survey" },
      ],
      timeline: [{ date: "13.8 tỷ năm", event: "Big Bang" }],
      angles: ["Nguồn gốc thời gian", "Sự giãn nở gia tốc"],
      outline: [
        { section: "Mở đầu", purpose: "Gợi mở về Big Bang", points: ["Khoảnh khắc khởi đầu"] },
        { section: "Bằng chứng", purpose: "Bức xạ nền CMB", points: ["Khám phá bất ngờ"] },
        { section: "Tương lai", purpose: "Số phận của vũ trụ", points: ["Giãn nở vĩnh viễn"] },
      ],
      cautions: ["Tránh nhầm lẫn giữa vật chất tối và năng lượng tối"],
    };

    const job = harness.repository.createJob({
      projectId: harness.projectId,
      stage: "SCRIPT",
      maxAttempts: 3,
      previousState: "PENDING",
    });

    const context: StageContext = {
      project,
      job,
      signal: new AbortController().signal,
      reportProgress() {},
      recordUsage() {},
      logger: Fastify({ logger: false }).log,
    };

    const result = await runStoryEngine({
      project,
      applicableResearch: mockResearch,
      engineMode: "full",
      scriptGuidance: "",
      context,
      sqlite: harness.sqlite,
      registry,
      cache,
      config: harness.config,
      inputHash: "test-hash",
      cacheKeyExtra: "test-cache",
    });

    expect(result.fallback).toBe(false);
    if (!result.fallback) {
      expect(result.script.sections.length).toBeGreaterThanOrEqual(2);
      expect(result.draft.outline.centralQuestion).toBeTruthy();
      expect(result.draft.hookCandidates).toHaveLength(3);
      expect(result.draft.critique.total).toBeGreaterThanOrEqual(80);
      expect(result.draft.critique.scores.structure).toBe(5);
      expect(result.draft.critique.scores.hook).toBe(5);
    }
  });

  it("handles hook switching and critique rescoring via ScriptService", async () => {
    const harness = createPipelineHarness({
      config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: true },
    });
    harnesses.push(harness);

    const registry = new LlmProviderRegistry(harness.config);
    const events = new PipelineEventBus();
    const service = new ScriptService(
      harness.sqlite,
      new JobRepository(harness.sqlite, events),
      harness.orchestrator,
      harness.config,
      registry,
    );

    // Save a script first
    await service.save(harness.projectId, {
      title: "Test Script",
      hook: "Old Hook",
      sections: [
        {
          id: "sec-1",
          sectionKey: "hook",
          heading: "Mở đầu",
          narration: "Câu mở đầu ban đầu. Câu thứ hai giữ nguyên sau khi đổi hook.",
          visualQueries: { primary: "visual 1", alternatives: [] },
          visualNotes: "",
          musicMood: "calm",
          energy: "medium",
          estDurationSec: 15,
        },
      ],
      outro: "Hẹn gặp lại.",
      music: { mood: "calm", energy: "medium", keywords: [] },
    });

    // Insert a draft record
    harness.sqlite
      .prepare(
        `INSERT INTO script_drafts (
          project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        harness.projectId,
        JSON.stringify({
          centralQuestion: "Tại sao lại thế?",
          promise: "Lời hứa",
          framework: "three_act",
          surprises: [
            { fact: "Sự thật 1", factIds: ["f1"] },
            { fact: "Sự thật 2", factIds: ["f2"] },
          ],
          beats: [
            {
              id: "b1",
              sectionKey: "hook",
              purpose: "hook",
              emotion: "curious",
              concreteMoment: "Mở đầu",
              newInformation: "Info 1",
              opensLoops: ["l1"],
              closesLoops: [],
              factIds: ["f1"],
              visualIntent: "Intent 1",
              targetSec: 30,
            },
            {
              id: "b2",
              sectionKey: "cta",
              purpose: "cta",
              emotion: "warm",
              concreteMoment: "Kết",
              newInformation: "Info 2",
              opensLoops: [],
              closesLoops: ["l1"],
              factIds: ["f2"],
              visualIntent: "Intent 2",
              targetSec: 30,
            },
          ],
          loops: [{ id: "l1", question: "Loop?", opensAtBeatId: "b1", closesAtBeatId: "b2" }],
          setupPayoffs: [],
        }),
        JSON.stringify({
          candidates: [
            { id: "h1", tactic: "question", text: "Old Hook", promise: "Lời hứa 1" },
            { id: "h2", tactic: "cold_open", text: "New Hook", promise: "Lời hứa 2" },
          ],
          chosenHookId: "h1",
          hookAssessments: [],
        }),
        JSON.stringify({
          total: 80,
          scores: { structure: 4, hook: 4, accuracy: 4, ttsNatural: 4, visualizable: 4, originality: 4 },
          hookPaidOff: true,
          unclosedLoops: [],
          sectionIssues: [],
          history: [],
        }),
        JSON.stringify([]),
        "full",
        "hash-123",
        new Date().toISOString(),
      );

    // Verify draft retrieval
    const scriptData = service.get(harness.projectId);
    expect(scriptData.draft).toBeTruthy();
    expect(scriptData.draft?.chosenHookId).toBe("h1");

    // Switch hook
    const afterSwitch = await service.switchHook(harness.projectId, "h2");
    expect(afterSwitch.draft?.chosenHookId).toBe("h2");
    // Switching the hook changes only the first sentence; the rest of the narration and the outro stay byte-identical.
    expect(afterSwitch.script?.data.sections[0]?.narration).toMatch(/ Câu thứ hai giữ nguyên sau khi đổi hook.$/);
    expect(afterSwitch.script?.data.outro).toBe("Hẹn gặp lại.");

    // Rescore critique
    const afterRescore = await service.rescoreCritique(harness.projectId);
    // Derivation: mock critic scores structure 5, hook 5, accuracy 5, ttsNatural 4, visualizable 4, originality 4.
    // total = 20*5 + 20*5 + 20*5 + 15*4 + 15*4 + 10*4 = 460, /5 = 92. The mock's raw total (88) is ignored by design.
    expect(afterRescore.draft?.critique?.total).toBe(92);
    expect(harness.sqlite.prepare("SELECT quality_score FROM scripts WHERE project_id = ?").get(harness.projectId)).toMatchObject({ quality_score: 9.2 });
    // Rescore stores the hash of the scored script, so a fresh GET must not report the critique stale (review 145 line 27).
    const reread = service.get(harness.projectId);
    expect(reread.draft?.critique?.total).toBe(92);
    expect(reread.draft?.critiqueStale).toBe(false);
    const succeeded = harness.sqlite
      .prepare("SELECT usage FROM jobs WHERE scope = 'rescoreCritique' AND status = 'SUCCEEDED'")
      .all() as Array<{ usage: string }>;
    expect(succeeded).toHaveLength(1);
    expect(JSON.parse(succeeded[0]!.usage).llmCalls).toBe(1);
  });

  it("records the paid rescore usage as FAILED when the script changes during the call (TASK-145)", async () => {
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
    await service.save(harness.projectId, {
      title: "Concurrent",
      hook: "Hook?",
      sections: [{
        id: "sec-1", sectionKey: "hook", heading: "One", narration: "First sentence. Second sentence.",
        visualQueries: { primary: "v", alternatives: [] }, visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
      }],
      outro: "End.",
      music: { mood: "calm", energy: "medium", keywords: [] },
    });
    const provider = registry.get("mock")!;
    const response = {
      total: 100,
      scores: { structure: 4, hook: 4, accuracy: 4, ttsNatural: 4, visualizable: 4, originality: 4 },
      hookPaidOff: true,
      unclosedLoops: [],
      sectionIssues: [],
    };
    provider.generate = async (req) => {
      // Simulate a concurrent script edit while the critic call is in flight.
      harness.sqlite.prepare("UPDATE scripts SET version = version + 1 WHERE project_id = ?").run(harness.projectId);
      return { text: JSON.stringify(response), provider: "mock", model: req.model, usage: { inputTokens: 11, outputTokens: 5 }, finishReason: "stop" } as never;
    };

    await expect(service.rescoreCritique(harness.projectId)).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });

    const rows = harness.sqlite
      .prepare("SELECT status, usage FROM jobs WHERE scope = 'rescoreCritique'")
      .all() as Array<{ status: string; usage: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("FAILED");
    expect(JSON.parse(rows[0]!.usage).llmCalls).toBe(1);
    expect(JSON.parse(rows[0]!.usage).inputTokens).toBe(11);
    // The discarded commit must not write a critique or a quality score.
    expect(harness.sqlite.prepare("SELECT quality_score FROM scripts WHERE project_id = ?").get(harness.projectId)).toMatchObject({ quality_score: null });
  });

  const RW_RESEARCH = {
    summary: "Tóm tắt.",
    keyFacts: [
      { fact: "Vụ nổ Big Bang xảy ra khoảng 13.8 tỷ năm trước.", confidence: "high", sourceHint: "NASA" },
      { fact: "Bức xạ tàn dư vũ trụ được phát hiện năm 1965.", confidence: "high", sourceHint: "Penzias" },
      { fact: "Vũ trụ đang giãn nở.", confidence: "high", sourceHint: "Hubble" },
    ],
    timeline: [{ date: "13.8 tỷ năm", event: "Big Bang" }],
    angles: ["Nguồn gốc"],
    outline: [
      { section: "Mở đầu", purpose: "Big Bang", points: ["Khởi đầu"] },
      { section: "Bằng chứng", purpose: "CMB", points: ["Khám phá"] },
      { section: "Tương lai", purpose: "Số phận", points: ["Giãn nở"] },
    ],
    cautions: ["Không nhầm vật chất tối"],
  } as never;
  it("rewrite merge changes only failing sections and drops ids outside the failing set (TASK-145)", async () => {
    const harness = createPipelineHarness({
      config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false },
    });
    harnesses.push(harness);
    const project = harness.repository.getProject(harness.projectId)!;
    const registry = new LlmProviderRegistry(harness.config);
    const cache = new LlmCache(harness.sqlite, false);
    const job = harness.repository.createJob({ projectId: harness.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
    const context: StageContext = {
      project, job, signal: new AbortController().signal, reportProgress() {}, recordUsage() {},
      logger: Fastify({ logger: false }).log as never,
    };
    const provider = registry.get("mock")!;
    const original = provider.generate.bind(provider);
    const base = {
      id: "x", sectionKey: "body", heading: "H", narration: "Đoạn.", visualQueries: { primary: "v", alternatives: [] },
      visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
    };
    const ok = (value: unknown, req: { model: string }) => ({
      text: JSON.stringify(value), provider: "mock", model: req.model, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop",
    }) as never;
    let criticCalls = 0;
    let failingId = "";
    let untouchedId = "";
    let untouchedBefore = "";
    provider.generate = (async (req: { system?: string; messages: { content: string }[]; model: string }, ...rest: unknown[]) => {
      const sys = String(req.system ?? "");
      if (sys.includes("independent narrative critic")) {
        criticCalls += 1;
        if (criticCalls === 1) {
          // The mock narration uses fixed section ids (hook, context, opening, takeaway, cta).
          failingId = "context";
          return ok({ total: 0, scores: { structure: 0, hook: 0, accuracy: 0, ttsNatural: 0, visualizable: 0, originality: 0 },
            hookPaidOff: true, unclosedLoops: [], sectionIssues: [{ sectionId: failingId, criterion: "structure", problem: "p", fix: "f" }] }, req);
        }
        return ok({ scores: { structure: 5, hook: 5, accuracy: 5, ttsNatural: 5, visualizable: 5, originality: 5 },
          hookPaidOff: true, unclosedLoops: [], sectionIssues: [] }, req);
      }
      if (sys.includes("You rewrite ONLY")) {
        const sections = JSON.parse(req.messages[0]!.content).sections as Array<{ id: string; isFailing: boolean; currentNarration: string }>;
        // Capture the baseline on the first rewrite call only: a later call would read back any
        // change already made by an earlier round, which would hide a non-failing overwrite.
        if (!untouchedId) {
          const untouched = sections.find((x) => !x.isFailing)!;
          untouchedId = untouched.id;
          untouchedBefore = untouched.currentNarration;
        }
        return ok({ sections: [
          { ...base, id: failingId, narration: "Đoạn đã sửa." },
          { ...base, id: untouchedId, narration: "Không được ghi đè." },
          { ...base, id: "ghost-section", narration: "Id lạ." },
        ] }, req);
      }
      if (sys.includes("timing editor for video narration")) {
        return ok(JSON.parse(req.messages[0]!.content).currentScript, req);
      }
      return (original as (...args: unknown[]) => unknown)(req, ...rest);
    }) as typeof provider.generate;

    const result = await runStoryEngine({
      project, applicableResearch: RW_RESEARCH, engineMode: "full", scriptGuidance: "", context,
      sqlite: harness.sqlite, registry, cache, config: harness.config, inputHash: "test-hash", cacheKeyExtra: "rewrite-allowlist",
    });
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    const ids = result.script.sections.map((x) => x.id);
    expect(ids).not.toContain("ghost-section");
    expect(result.script.sections.find((x) => x.id === failingId)?.narration).toBe("Đoạn đã sửa.");
    expect(result.script.sections.find((x) => x.id === untouchedId)?.narration).toBe(untouchedBefore);
  });

  it("verifies the 10 benchmark fixtures satisfy schema and recipes", () => {
    expect(STORY_ENGINE_BENCHMARK_FIXTURES).toHaveLength(10);
    for (const fixture of STORY_ENGINE_BENCHMARK_FIXTURES) {
      expect(fixture.topic.length).toBeGreaterThan(5);
      expect(fixture.research.keyFacts.length).toBeGreaterThanOrEqual(5);
      expect(fixture.research.outline.length).toBeGreaterThanOrEqual(3);
      expect(["60", "180", "600"]).toContain(String(fixture.targetDurationSec));
      expect(["vi", "en"]).toContain(fixture.language);
    }
  });
});

describe("beat metadata binding (TASK-145 P2)", () => {
  const sec = (id: string, extra: Record<string, unknown> = {}) => ({ id, heading: id, narration: "x", sectionKey: undefined, factIds: ["writer-fact"], opensLoops: ["writer-loop"], closesLoops: [], ...extra }) as never;
  const beat = (sectionKey: string, factIds: string[], opensLoops: string[] = [], closesLoops: string[] = []) => ({ sectionKey, purpose: "hook", factIds, opensLoops, closesLoops });

  it("binds by order: the approved beat wins over wrong writer factIds and loops", () => {
    const beats = [beat("a", ["f1"], ["L1"], []), beat("b", ["f2"], [], ["L1"])];
    const out = bindSectionsToBeats([sec("s1", { sectionKey: "b" }), sec("s2")], beats).sections;
    expect(out[0]).toMatchObject({ sectionKey: "a", factIds: ["f1"], opensLoops: ["L1"] });
    expect(out[1]).toMatchObject({ sectionKey: "b", factIds: ["f2"], closesLoops: ["L1"] });
  });

  it("equal section and beat counts bind each section to its own beat with no ambiguous note, even when beats share a key (TASK-145)", () => {
    const beats = [beat("a", ["f1"]), beat("a", ["f2"]), beat("b", ["f3"])];
    const result = bindSectionsToBeats([sec("s1", { sectionKey: "a" }), sec("s2", { sectionKey: "a" }), sec("s3")], beats);
    expect(result.note).toBeUndefined();
    expect(result.sections.map((s) => s.factIds)).toEqual([["f1"], ["f2"], ["f3"]]);
    expect(result.sections.map((s) => s.sectionKey)).toEqual(["a", "a", "b"]);
  });

  it("two beats sharing a key bind one section per run, without copying one beat into the other", () => {
    const beats = [beat("a", ["f1"]), beat("a", ["f2"]), beat("b", ["f3"])];
    const out = bindSectionsToBeats([sec("s1"), sec("s2")], beats).sections;
    expect(out[0]!.factIds).toEqual(["f1", "f2"]);
    expect(out[1]!.factIds).toEqual(["f3"]);
    expect(out[1]!.sectionKey).toBe("b");
  });

  it("with an ambiguous count, keeps the writer metadata, drops factIds outside the outline, and notes it", () => {
    const beats = [beat("a", ["f1"]), beat("b", ["f2"]), beat("c", ["f3"])];
    const result = bindSectionsToBeats([sec("s1", { factIds: ["f1", "ghost"] })], beats);
    expect(result.sections[0]!.factIds).toEqual(["f1"]);
    expect(result.note).toContain("beat-binding");
  });

  it("with an ambiguous count, fills empty writer fields from the beat without overwriting the writer", () => {
    const beats = [beat("a", ["f1"], ["L1"]), beat("b", ["f2"]), beat("c", ["f3"])];
    const out = bindSectionsToBeats([sec("s1", { sectionKey: undefined, factIds: [], opensLoops: [] })], beats).sections;
    expect(out[0]).toMatchObject({ sectionKey: "a", factIds: ["f1"], opensLoops: ["L1"] });
  });

  it("length fit cannot change beat metadata, and an id or count change is rejected", () => {
    const current = [sec("s1", { sectionKey: "a", factIds: ["f1"], opensLoops: ["L1"] })] as never[];
    const altered = [sec("s1", { sectionKey: "zzz", factIds: ["ghost"], opensLoops: [] })] as never[];
    const kept = keepScriptMetadata(altered as never, current as never);
    expect(kept).not.toBeNull();
    expect(kept![0]).toMatchObject({ sectionKey: "a", factIds: ["f1"], opensLoops: ["L1"] });
    // An id changed by the model is restored to the current id; only a count change reverts.
    expect(kept![0]!.id).toBe("s1");
    expect(keepScriptMetadata([...altered, ...altered] as never, current as never)).toBeNull();
  });
});
