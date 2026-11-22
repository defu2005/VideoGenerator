import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { LlmCache } from "../src/providers/llm/cache.js";
import { runStoryEngine } from "../src/stages/script/storyEngine.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

// TASK-146 outline mode (commit C, engine level): park after the outline and hooks, then resume from narration.

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

const WRITER_MARK = "Preserve beat metadata";
const OUTLINE_MARK = "master story architect";

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
  const counts = { outline: 0, writer: 0 };
  provider.generate = (async (req: any, ...rest: unknown[]) => {
    const sys = String(req.system ?? "");
    if (sys.includes(OUTLINE_MARK)) counts.outline += 1;
    if (sys.includes(WRITER_MARK)) counts.writer += 1;
    return original(req, ...rest);
  }) as typeof provider.generate;
  const run = (options: Partial<Parameters<typeof runStoryEngine>[0]> = {}) => runStoryEngine({
    project,
    applicableResearch: GATE_RESEARCH,
    engineMode: "full",
    scriptGuidance: "",
    context,
    sqlite: harness.sqlite,
    registry,
    cache,
    config: harness.config,
    inputHash: "outline-park-hash",
    cacheKeyExtra: "outline-park-cache",
    ...options,
  });
  return { harness, counts, run };
}

describe("TASK-146 outline mode: runStoryEngine parks and resumes", () => {
  it("parks after the outline and hooks: no writer call, and the outline is returned for approval", async () => {
    const f = engineFixture();
    const result = await f.run({ parkAfterOutline: true });
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    expect(result.parked).toBe(true);
    expect(f.counts.outline).toBe(1);
    expect(f.counts.writer).toBe(0);
    if (!result.parked) return;
    expect(result.outline.beats.length).toBeGreaterThan(0);
    expect(Array.isArray(result.hookCandidates)).toBe(true);
  });

  it("resumes from an approved outline: no new outline call, the writer runs, and the result is a full script", async () => {
    const f = engineFixture();
    const parked = await f.run({ parkAfterOutline: true });
    if (parked.fallback || !parked.parked) throw new Error("expected the engine to park");
    f.counts.outline = 0;
    f.counts.writer = 0;
    const resumed = await f.run({ resumeOutline: { outline: parked.outline, hookCandidates: parked.hookCandidates } });
    expect(resumed.fallback).toBe(false);
    if (resumed.fallback) return;
    expect(resumed.parked).toBe(false);
    expect(f.counts.outline).toBe(0);
    expect(f.counts.writer).toBeGreaterThan(0);
    if (resumed.parked) return;
    expect(resumed.draft.outline.beats).toHaveLength(parked.outline.beats.length);
  });

  it("rejects an approved outline that no longer validates instead of silently regenerating it", async () => {
    const f = engineFixture();
    await expect(f.run({
      resumeOutline: { outline: { beats: [] } as never, hookCandidates: [] },
    })).rejects.toThrow("Approved outline is no longer valid");
  });

  it("does not park when parkAfterOutline is not set: the default path still returns a full script", async () => {
    const f = engineFixture();
    const result = await f.run();
    expect(result.fallback).toBe(false);
    if (result.fallback) return;
    expect(result.parked).toBe(false);
    expect(f.counts.writer).toBeGreaterThan(0);
  });

  it("rejects an approved outline that is well-formed but fails the semantic check (unknown sectionKey)", async () => {
    const f = engineFixture();
    const parked = await f.run({ parkAfterOutline: true });
    if (parked.fallback || !parked.parked) throw new Error("expected the engine to park");
    const tampered = JSON.parse(JSON.stringify(parked.outline)) as typeof parked.outline;
    tampered.beats[0]!.sectionKey = "NOT_A_REAL_SECTION";
    await expect(f.run({
      resumeOutline: { outline: tampered, hookCandidates: parked.hookCandidates },
    })).rejects.toThrow("Approved outline is no longer valid");
  });
});
