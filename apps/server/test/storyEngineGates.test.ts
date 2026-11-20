import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import { ScriptService } from "../src/services/scriptService.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { runStoryEngine, recentHookTactics } from "../src/stages/script/storyEngine.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

// TASK-145 review gates: outline repair/fallback, rewrite stop rule, writer binding, hook history.

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const GATE_RESEARCH = {
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

const REWRITE_SECTION = {
  id: "context", sectionKey: "body", heading: "H", narration: "Đoạn.", visualQueries: { primary: "v", alternatives: [] },
  visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
};

function engineFixture() {
  const harness = createPipelineHarness({
    config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false },
  });
  harnesses.push(harness);
  const project = harness.repository.getProject(harness.projectId)!;
  const registry = new LlmProviderRegistry(harness.config);
  const cache = new LlmCache(harness.sqlite, false);
  const job = harness.repository.createJob({ projectId: harness.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING" });
  const context: StageContext = {
    project,
    job,
    signal: new AbortController().signal,
    reportProgress() {},
    recordUsage() {},
    logger: Fastify({ logger: false }).log,
  };
  const provider = registry.get("mock")!;
  const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
  const run = (engineMode: "full" | "lite") => runStoryEngine({
    project,
    applicableResearch: GATE_RESEARCH,
    engineMode,
    scriptGuidance: "",
    context,
    sqlite: harness.sqlite,
    registry,
    cache,
    config: harness.config,
    inputHash: "gate-hash",
    cacheKeyExtra: "gate-cache",
  });
  return { harness, provider, original, run };
}

const okReply = (value: unknown, req: { model: string }) => ({
  text: JSON.stringify(value),
  provider: "mock",
  model: req.model,
  usage: { inputTokens: 1, outputTokens: 1 },
  finishReason: "stop",
}) as never;

describe("storyEngine outline repair and fallback (TASK-145 row 7)", () => {
  it("control: a valid first outline needs no repair", async () => {
    const f = engineFixture();
    let outlineCalls = 0;
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      if (String(req.system ?? "").includes("master story architect")) outlineCalls += 1;
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(result.fallback).toBe(false);
    expect(outlineCalls).toBe(1);
  });

  it("outline invalid once: exactly one repair call, then the repaired outline is used", async () => {
    const f = engineFixture();
    let outlineCalls = 0;
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      if (String(req.system ?? "").includes("master story architect")) {
        outlineCalls += 1;
        const res = await f.original(req, ...rest);
        if (outlineCalls === 1) {
          const parsed = JSON.parse(res.text);
          parsed.hooks[1].tactic = parsed.hooks[0].tactic; // duplicate tactic: validation error
          return { ...res, text: JSON.stringify(parsed) };
        }
        return res;
      }
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(outlineCalls).toBe(2);
    expect(result.fallback).toBe(false);
  });

  it("outline invalid twice: one repair, then fallback with both outline calls recorded", async () => {
    const f = engineFixture();
    let outlineCalls = 0;
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      if (String(req.system ?? "").includes("master story architect")) {
        outlineCalls += 1;
        const res = await f.original(req, ...rest);
        const parsed = JSON.parse(res.text);
        parsed.hooks[1].tactic = parsed.hooks[0].tactic;
        return { ...res, text: JSON.stringify(parsed) };
      }
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(outlineCalls).toBe(2);
    expect(result.fallback).toBe(true);
    // Both outline calls were paid for, so both must be recorded as usage on the fallback result.
    expect(result.callUsages.filter((c) => c.task === "storyOutline")).toHaveLength(2);
  });
});

describe("storyEngine outline repair retry cap (TASK-145 row 7)", () => {
  it("a schema-invalid repair reply is not retried: exactly 2 outline calls, then fallback", async () => {
    const f = engineFixture();
    let outlineCalls = 0;
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      if (String(req.system ?? "").includes("master story architect")) {
        outlineCalls += 1;
        if (outlineCalls === 1) {
          // Schema-valid but semantically invalid (duplicate tactic) so the semantic repair runs.
          const res = await f.original(req, ...rest);
          const parsed = JSON.parse(res.text);
          parsed.hooks[1].tactic = parsed.hooks[0].tactic;
          return { ...res, text: JSON.stringify(parsed) };
        }
        return { text: "{}", provider: "mock", model: req.model, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" } as never;
      }
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(result.fallback).toBe(true);
    expect(outlineCalls).toBe(2);
  });
});

describe("storyEngine rewrite stop rule (TASK-145)", () => {
  const BASE = { structure: 3, hook: 3, accuracy: 3, ttsNatural: 3, visualizable: 3, originality: 3 };

  async function runWithCritic(criticScores: Array<Partial<typeof BASE>>) {
    const f = engineFixture();
    let critic = 0;
    let rewrites = 0;
    const issues = [{ sectionId: "context", criterion: "structure", problem: "p", fix: "f" }];
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      const sys = String(req.system ?? "");
      if (sys.includes("independent narrative critic")) {
        const scores = { ...BASE, ...criticScores[Math.min(critic, criticScores.length - 1)] };
        critic += 1;
        return okReply({ scores, hookPaidOff: true, unclosedLoops: [], sectionIssues: issues }, req);
      }
      if (sys.includes("You rewrite ONLY")) {
        rewrites += 1;
        return okReply({ sections: [{ ...REWRITE_SECTION, narration: "Đoạn đã sửa." }] }, req);
      }
      if (sys.includes("timing editor for video narration")) {
        return okReply(JSON.parse(req.messages[0].content).currentScript, req);
      }
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    return { result, critic, rewrites };
  }

  it("gain of 2 (< 3) keeps the round and stops: one rewrite, two critic evaluations", async () => {
    // originality weight 10 -> +2 total over a baseline of 60.
    const { result, critic, rewrites } = await runWithCritic([{}, { originality: 4 }]);
    expect(rewrites).toBe(1);
    expect(critic).toBe(2);
    expect(result.fallback).toBe(false);
    if (!result.fallback) expect(result.draft.critique.total).toBe(62);
  });

  it("gain of 3 continues to round 2; a non-improving round reverts to round 1", async () => {
    // visualizable weight 15 -> +3 total. Round 2 falls back to baseline (gain -3), so it is reverted.
    const { result, critic, rewrites } = await runWithCritic([{}, { visualizable: 4 }, {}]);
    expect(rewrites).toBe(2);
    expect(critic).toBe(3);
    expect(result.fallback).toBe(false);
    if (!result.fallback) expect(result.draft.critique.total).toBe(63);
  });
});

describe("storyEngine writer metadata binding (TASK-145 P2)", () => {
  it("writer factIds and loops never reach the final script; the outline beat wins", async () => {
    const f = engineFixture();
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      const res = await f.original(req, ...rest);
      let parsed: any;
      try { parsed = JSON.parse(res.text); } catch { return res; }
      if (parsed && typeof parsed === "object" && "title" in parsed && Array.isArray(parsed.sections)) {
        for (const s of parsed.sections) { s.factIds = ["ghost"]; s.opensLoops = ["ghost-loop"]; s.closesLoops = []; }
        return { ...res, text: JSON.stringify(parsed) };
      }
      return res;
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    for (const section of result.script.sections) {
      expect(section.factIds ?? []).not.toContain("ghost");
      expect(section.opensLoops ?? []).not.toContain("ghost-loop");
    }
    // Positive check: the approved beats are bound by order, so each section carries its beat's factIds.
    const beats = result.draft.outline.beats;
    expect(result.script.sections).toHaveLength(beats.length);
    result.script.sections.forEach((section, i) => {
      expect(section.factIds ?? []).toEqual(beats[i]!.factIds);
    });
  });
});

describe("recentHookTactics (TASK-145)", () => {
  it("reads chosenHookId, falls back to legacy chosenId, and ignores malformed rows", () => {
    const harness = createPipelineHarness({
      config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false },
    });
    harnesses.push(harness);
    // The fixture project has no profile; insert one (profile_id is a foreign key) and attach the project to it.
    const profileId = "profile-gate-test";
    harness.sqlite
      .prepare("INSERT INTO profiles (id, name, description, direction, language, default_brief, guidelines, created_at, updated_at) VALUES (?, ?, '', '', 'vi', '{}', '{}', ?, ?)")
      .run(profileId, "Gate test profile", new Date().toISOString(), new Date().toISOString());
    harness.sqlite.prepare("UPDATE projects SET profile_id = ? WHERE id = ?").run(profileId, harness.projectId);
    const candidates = [
      { id: "h1", tactic: "question", text: "A", promise: "p" },
      { id: "h2", tactic: "cold_open", text: "B", promise: "p" },
    ];
    const write = (hookCandidates: string) => {
      harness.sqlite.prepare("DELETE FROM script_drafts WHERE project_id = ?").run(harness.projectId);
      harness.sqlite
        .prepare("INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at) VALUES (?, NULL, ?, NULL, '[]', 'full', 'h', ?)")
        .run(harness.projectId, hookCandidates, new Date().toISOString());
    };
    write(JSON.stringify({ candidates, chosenHookId: "h2" }));
    expect(recentHookTactics(harness.sqlite, profileId)).toEqual(["cold_open"]);
    write(JSON.stringify({ candidates, chosenId: "h1" }));
    expect(recentHookTactics(harness.sqlite, profileId)).toEqual(["question"]);
    write("{not json");
    expect(recentHookTactics(harness.sqlite, profileId)).toEqual([]);
  });
});

describe("switchHook paid call accounting (TASK-145)", () => {
  it("records the paid hook rewrite as FAILED when the script changes during the call", async () => {
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
      title: "Switch",
      hook: "Old Hook",
      sections: [{
        id: "sec-1", sectionKey: "hook", heading: "Mở đầu", narration: "Câu mở đầu ban đầu. Câu thứ hai.",
        visualQueries: { primary: "v", alternatives: [] }, visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
      }],
      outro: "Hẹn gặp lại.",
      music: { mood: "calm", energy: "medium", keywords: [] },
    });
    harness.sqlite
      .prepare("INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        harness.projectId,
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
    const provider = registry.get("mock")!;
    const original = provider.generate.bind(provider) as (req: any, ...rest: unknown[]) => Promise<any>;
    provider.generate = (async (req: any, ...rest: unknown[]) => {
      const res = await original(req, ...rest);
      if (String(req.system ?? "").includes("video script editor")) {
        // Simulate a concurrent script edit while the paid rewrite is in flight.
        harness.sqlite.prepare("UPDATE scripts SET version = version + 1 WHERE project_id = ?").run(harness.projectId);
      }
      return res;
    }) as typeof provider.generate;

    await expect(service.switchHook(harness.projectId, "h2")).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });

    const rows = harness.sqlite
      .prepare("SELECT status, usage FROM jobs WHERE scope = 'switchHook'")
      .all() as Array<{ status: string; usage: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("FAILED");
    expect(JSON.parse(rows[0]!.usage).llmCalls).toBe(1);
  });
});

describe("rescore keeps a stored blocking fact (TASK-145)", () => {
  it("a passing rescore does not clear blocking_facts already set to 1", async () => {
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
      title: "Blocking",
      hook: "Hook?",
      sections: [{
        id: "sec-1", sectionKey: "hook", heading: "One", narration: "First sentence. Second sentence.",
        visualQueries: { primary: "v", alternatives: [] }, visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
      }],
      outro: "End.",
      music: { mood: "calm", energy: "medium", keywords: [] },
    });
    harness.sqlite.prepare("UPDATE scripts SET blocking_facts = 1 WHERE project_id = ?").run(harness.projectId);
    const provider = registry.get("mock")!;
    provider.generate = (async (req: any) => ({
      text: JSON.stringify({
        total: 100,
        scores: { structure: 5, hook: 5, accuracy: 5, ttsNatural: 5, visualizable: 5, originality: 5 },
        hookPaidOff: true, unclosedLoops: [], sectionIssues: [],
      }),
      provider: "mock", model: req.model, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop",
    })) as typeof provider.generate;

    await service.rescoreCritique(harness.projectId);

    expect(harness.sqlite.prepare("SELECT blocking_facts FROM scripts WHERE project_id = ?").get(harness.projectId)).toMatchObject({ blocking_facts: 1 });
  });
});

describe("rescore prompt and draft read (TASK-145 rows 13-14)", () => {
  async function setupRescore() {
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
      title: "Rescore prompt",
      hook: "Hook?",
      sections: [{
        id: "sec-1", sectionKey: "hook", heading: "One", narration: "Vụ nổ Big Bang xảy ra cách đây rất lâu.",
        visualQueries: { primary: "v", alternatives: [] }, visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
      }],
      outro: "End.",
      music: { mood: "calm", energy: "medium", keywords: [] },
    });
    harness.sqlite
      .prepare("INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, 'r', 'mock', 'mock', 0, ?, ?)")
      .run(harness.projectId, new Date().toISOString(), JSON.stringify({
        summary: "Tóm tắt.",
        keyFacts: [
          { fact: "Vụ nổ Big Bang xảy ra khoảng 13.8 tỷ năm trước.", confidence: "high", sourceHint: "NASA" },
          { fact: "Vũ trụ giãn nở liên tục.", confidence: "high", sourceHint: null },
          { fact: "Bức xạ nền vi sóng vũ trụ còn sót lại từ thời kỳ đầu.", confidence: "high", sourceHint: null },
          { fact: "Ánh sáng từ các thiên hà xa được quan sát bằng kính viễn vọng.", confidence: "medium", sourceHint: null },
          { fact: "Vật chất tối chiếm phần lớn khối lượng vũ trụ.", confidence: "medium", sourceHint: null },
        ],
        timeline: [], angles: ["Khởi đầu vũ trụ"], cautions: [],
        outline: [
          { section: "Mở đầu", purpose: "Giới thiệu", points: [] },
          { section: "Giải thích", purpose: "Giải thích", points: [] },
          { section: "Kết", purpose: "Kết luận", points: [] },
        ],
      }));
    // Draft row with a null outline (the case review row 14 asks about).
    harness.sqlite
      .prepare("INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at) VALUES (?, NULL, NULL, NULL, '[]', 'full', 'h', ?)")
      .run(harness.projectId, new Date().toISOString());
    const provider = registry.get("mock")!;
    const prompts: Array<{ system: string; user: string }> = [];
    provider.generate = (async (req: any) => {
      prompts.push({ system: String(req.system ?? ""), user: String(req.messages?.[0]?.content ?? "") });
      return {
        text: JSON.stringify({
          total: 100,
          scores: { structure: 5, hook: 5, accuracy: 5, ttsNatural: 5, visualizable: 5, originality: 5 },
          hookPaidOff: true, unclosedLoops: [], sectionIssues: [],
        }),
        provider: "mock", model: req.model, usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop",
      } as never;
    }) as typeof provider.generate;
    return { harness, service, prompts };
  }

  it("row 13: the rescore prompt sends research facts and the 6-dimension rubric, not the summary alone", async () => {
    const { harness, service, prompts } = await setupRescore();
    await service.rescoreCritique(harness.projectId);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.user).toContain("researchFacts");
    expect(prompts[0]!.user).toContain("Vụ nổ Big Bang xảy ra khoảng 13.8 tỷ năm trước.");
    for (const id of ["f1", "f2", "f3", "f4", "f5"]) {
      expect(prompts[0]!.user).toContain(`"id": "${id}"`);
    }
    expect(prompts[0]!.system).toContain("6 narrative criteria");
    expect(prompts[0]!.system).not.toContain("7 narrative");
    for (const dimension of ["structure", "hook", "accuracy", "ttsNatural", "visualizable", "originality"]) {
      expect(prompts[0]!.system).toContain(dimension);
    }
  });

  it("row 14: after a rescore with a null outline, GET returns the draft with the new critique", async () => {
    const { harness, service } = await setupRescore();
    await service.rescoreCritique(harness.projectId);
    const data = service.get(harness.projectId);
    expect(data.draft).toBeTruthy();
    expect(data.draft?.critique?.total).toBe(100);
    expect(data.draft?.critiqueStale).toBe(false);
  });
});
