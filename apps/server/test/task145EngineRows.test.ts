import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import { runStoryEngine, recentHookTactics } from "../src/stages/script/storyEngine.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

// TASK-145 rereview rows 5 and 10. Fixtures mirror storyEngineGates.test.ts (not edited there).

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
  const run = () => runStoryEngine({
    project,
    applicableResearch: GATE_RESEARCH,
    engineMode: "full",
    scriptGuidance: "",
    context,
    sqlite: harness.sqlite,
    registry,
    cache,
    config: harness.config,
    inputHash: "task145-rows-hash",
    cacheKeyExtra: "task145-rows-cache",
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

describe("TASK-145 row 5: rewrite loop stop condition on gain", () => {
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
    const result = await f.run();
    return { result, critic, rewrites };
  }

  it("gain 1 stops after one rewrite and keeps the rewritten draft", async () => {
    // Total = sum(score/5 * weight). structure +1 (+4) and ttsNatural -1 (-3) net +1 over the baseline 60.
    const { result, critic, rewrites } = await runWithCritic([{}, { structure: 4, ttsNatural: 2 }]);
    expect(rewrites).toBe(1);
    expect(critic).toBe(2);
    expect(result.fallback).toBe(false);
    if (!result.fallback) expect(result.draft.critique.total).toBe(61);
    // Positive control: an accepted round's rewritten narration does land in the script.
    expect(result.script.sections.some((s) => s.narration.includes("Đoạn đã sửa."))).toBe(true);
  });

  it("gain 2 stops after one rewrite and keeps the rewritten draft", async () => {
    // originality weight gives +2 total over the baseline.
    const { result, critic, rewrites } = await runWithCritic([{}, { originality: 4 }]);
    expect(rewrites).toBe(1);
    expect(critic).toBe(2);
    expect(result.fallback).toBe(false);
    if (!result.fallback) expect(result.draft.critique.total).toBe(62);
  });

  it("gain 0 (no improvement) reverts to the previous round and stops", async () => {
    const { result, critic, rewrites } = await runWithCritic([{}, {}]);
    expect(rewrites).toBe(1);
    expect(critic).toBe(2);
    expect(result.fallback).toBe(false);
    if (!result.fallback) expect(result.draft.critique.total).toBe(60);
    // Total alone cannot tell revert from accept (both give 60). The rewritten narration must not survive.
    expect(result.script.sections.some((s) => s.narration.includes("Đoạn đã sửa."))).toBe(false);
  });
});

describe("TASK-145 row 10: hook history reads chosenHookId ?? chosenId", () => {
  it("prefers chosenHookId when both keys are present, and falls back to chosenId", () => {
    const harness = createPipelineHarness({
      config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true, LLM_CACHE_ENABLED: false },
    });
    harnesses.push(harness);
    const profileId = "profile-task145-rows";
    harness.sqlite
      .prepare("INSERT INTO profiles (id, name, description, direction, language, default_brief, guidelines, created_at, updated_at) VALUES (?, ?, '', '', 'vi', '{}', '{}', ?, ?)")
      .run(profileId, "Task145 rows profile", new Date().toISOString(), new Date().toISOString());
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
    write(JSON.stringify({ candidates, chosenHookId: "h2", chosenId: "h1" }));
    expect(recentHookTactics(harness.sqlite, profileId)).toEqual(["cold_open"]);
    write(JSON.stringify({ candidates, chosenId: "h1" }));
    expect(recentHookTactics(harness.sqlite, profileId)).toEqual(["question"]);
  });
});
