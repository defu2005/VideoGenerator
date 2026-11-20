import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import { runStoryEngine } from "../src/stages/script/storyEngine.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

// TASK-145 integration gates (rows 8, 9): writer binding and length-fit metadata, run through runStoryEngine.

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
    inputHash: "integration-hash",
    cacheKeyExtra: "integration-cache",
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

const WRITER_MARK = "Preserve beat metadata";
const OUTLINE_MARK = "master story architect";
const LENGTH_FIT_MARK = "timing editor for video narration";

describe("beat binding through runStoryEngine (TASK-145 row 8)", () => {
  it("writer sections with a wrong sectionKey, foreign factIds and loops are rebound to the outline beats by order", async () => {
    const f = engineFixture();
    let beatCount = 0;
    let writerCalls = 0;
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      const sys = String(req.system ?? "");
      if (sys.includes(WRITER_MARK)) {
        writerCalls += 1;
        const res = await f.original(req, ...rest);
        const parsed = JSON.parse(res.text);
        const sec0 = parsed.sections[0];
        // One section per beat, all carrying a wrong key, an id outside the outline, and foreign loops.
        const sections = Array.from({ length: beatCount }, (_, i) => ({
          ...sec0, id: `w${i + 1}`, sectionKey: "WRONG", factIds: ["f99"], opensLoops: ["LOOP_WRONG"], closesLoops: ["LOOP_WRONG"],
        }));
        return { ...res, text: JSON.stringify({ ...parsed, sections }) };
      }
      if (sys.includes(OUTLINE_MARK)) {
        const res = await f.original(req, ...rest);
        beatCount = JSON.parse(res.text).outline.beats.length;
        return res;
      }
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(writerCalls).toBeGreaterThan(0);
    expect(beatCount).toBeGreaterThan(0);
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    const beats = result.draft.outline.beats;
    expect(result.script.sections).toHaveLength(beats.length);
    expect(result.script.sections.map((s) => s.sectionKey)).toEqual(beats.map((b) => b.sectionKey));
    result.script.sections.forEach((sec, i) => {
      expect(sec.factIds ?? []).toEqual(beats[i]!.factIds ?? []);
      expect(sec.opensLoops ?? []).toEqual(beats[i]!.opensLoops ?? []);
      expect(sec.closesLoops ?? []).toEqual(beats[i]!.closesLoops ?? []);
    });
  });

  it("writer count matching neither beats nor key runs keeps its metadata but drops factIds outside the outline", async () => {
    const f = engineFixture();
    let beatCount = 0;
    let writerCalls = 0;
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      const sys = String(req.system ?? "");
      if (sys.includes(WRITER_MARK)) {
        writerCalls += 1;
        const res = await f.original(req, ...rest);
        const parsed = JSON.parse(res.text);
        const sec0 = parsed.sections[0];
        // beats + 1 sections: runs never exceed beats, so this is always the ambiguous branch.
        const sections = Array.from({ length: beatCount + 1 }, (_, i) => ({ ...sec0, id: `w${i + 1}`, factIds: ["f99"] }));
        return { ...res, text: JSON.stringify({ ...parsed, sections }) };
      }
      if (sys.includes(OUTLINE_MARK)) {
        const res = await f.original(req, ...rest);
        beatCount = JSON.parse(res.text).outline.beats.length;
        return res;
      }
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(writerCalls).toBeGreaterThan(0);
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    expect(result.script.sections).toHaveLength(beatCount + 1);
    for (const sec of result.script.sections) {
      expect(sec.factIds ?? []).not.toContain("f99");
    }
  });
});

const HOLD_REWRITE_SECTION = {
  id: "context", sectionKey: "body", heading: "H", narration: "Đoạn.", visualQueries: { primary: "v", alternatives: [] },
  visualNotes: "", musicMood: "calm", energy: "medium", estDurationSec: 15,
};

function critiqueWith(scores: Record<string, number>) {
  return async (f: ReturnType<typeof engineFixture>) => {
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      const sys = String(req.system ?? "");
      if (sys.includes("independent narrative critic")) {
        return okReply({
          scores, hookPaidOff: true, unclosedLoops: [],
          sectionIssues: [{ sectionId: "context", criterion: "structure", problem: "p", fix: "f" }],
        }, req);
      }
      if (sys.includes("You rewrite ONLY")) return okReply({ sections: [{ ...HOLD_REWRITE_SECTION }] }, req);
      if (sys.includes("timing editor for video narration")) return okReply(JSON.parse(req.messages[0].content).currentScript, req);
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
  };
}

describe("hold outcome through runStoryEngine (TASK-145 row 18)", () => {
  it("total 55 with accuracy 2 is held: quality 5.5 and one blocking fact", async () => {
    const f = engineFixture();
    // Weights 20/20/20/15/15/10; points/5 * weight: 60+60+40+45+30+40 = 275 -> total 55.
    await critiqueWith({ structure: 3, hook: 3, accuracy: 2, ttsNatural: 3, visualizable: 2, originality: 4 })(f);
    const result = await f.run("full");
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    expect(result.draft.critique.total).toBe(55);
    expect(result.qualityScore).toBe(5.5);
    expect(result.blockingFacts).toBe(1);
  });

  it("control: total 55 with accuracy 3 is held on quality only, with no blocking fact", async () => {
    const f = engineFixture();
    // 60+60+60+30+45+20 = 275 -> total 55, accuracy kept at 3 so only the total can hold it.
    await critiqueWith({ structure: 3, hook: 3, accuracy: 3, ttsNatural: 2, visualizable: 3, originality: 2 })(f);
    const result = await f.run("full");
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    expect(result.draft.critique.total).toBe(55);
    expect(result.qualityScore).toBe(5.5);
    expect(result.blockingFacts).toBe(0);
  });
});

describe("length fit cannot change beat metadata or section count (TASK-145 row 9)", () => {
  it("length fit that changes id, sectionKey and factIds keeps the current script's values", async () => {
    const f = engineFixture();
    let writerIds: string[] = [];
    let before: { id: string; sectionKey: string; factIds: string[] } | undefined;
    let fitCalls = 0;
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      const sys = String(req.system ?? "");
      if (sys.includes(WRITER_MARK)) {
        const res = await f.original(req, ...rest);
        writerIds = JSON.parse(res.text).sections.map((s: { id?: string }, i: number) => s.id?.trim() || `sec-${i + 1}`);
        return res;
      }
      if (sys.includes(LENGTH_FIT_MARK)) {
        fitCalls += 1;
        const current = JSON.parse(req.messages[0].content).currentScript;
        before = { id: current.sections[0].id, sectionKey: current.sections[0].sectionKey, factIds: current.sections[0].factIds ?? [] };
        const changed = {
          ...current,
          sections: current.sections.map((s: Record<string, unknown>, i: number) =>
            i === 0 ? { ...s, id: "CHANGED", sectionKey: "CHANGED", factIds: ["f99"], narration: `${s.narration} (fit)` } : s),
        };
        return okReply(changed, req);
      }
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(fitCalls).toBeGreaterThan(0);
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    expect(before).toBeDefined();
    const first = result.script.sections[0]!;
    // Guard against a vacuous pass: the fitted text must have landed, and no revert may have happened.
    expect(first.narration).toContain("(fit)");
    expect(result.reviewNotes.join("\n")).not.toContain("[length-fit] Reverted");
    expect(first.id).toBe(before!.id);
    expect(first.sectionKey).toBe(before!.sectionKey);
    expect(first.factIds ?? []).toEqual(before!.factIds);
    expect(result.script.sections.map((s) => s.id)).toEqual(writerIds);
    expect(result.script.sections.map((s) => s.id)).not.toContain("CHANGED");
  });

  it("length fit that drops a section is reverted and the note says so", async () => {
    const f = engineFixture();
    let fitCalls = 0;
    let inputCount = 0;
    f.provider.generate = (async (req: any, ...rest: unknown[]) => {
      const sys = String(req.system ?? "");
      if (sys.includes(LENGTH_FIT_MARK)) {
        fitCalls += 1;
        const current = JSON.parse(req.messages[0].content).currentScript;
        inputCount = current.sections.length;
        return okReply({ ...current, sections: current.sections.slice(0, -1) }, req);
      }
      return f.original(req, ...rest);
    }) as typeof f.provider.generate;
    const result = await f.run("full");
    expect(fitCalls).toBeGreaterThan(0);
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    expect(result.script.sections.length).toBe(inputCount);
    expect(result.reviewNotes).toContain("[length-fit] Reverted length fit because section ids or count changed");
  });
});
