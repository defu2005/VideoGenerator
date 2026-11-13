import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { activeGuidelines, guidelinePromptBlock, type Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { GuidelineService } from "../src/guidelines/service.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ScriptExecutor } from "../src/stages/script/scriptExecutor.js";
import { sceneQueryPrompt } from "../src/stages/scenes/sceneQueryPrompt.js";
import { scriptPrompt } from "../src/stages/script/prompt.js";
import { buildAltQueryPrompt } from "../src/stages/visuals/altQueryPrompt.js";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";
import type { StageContext } from "../src/pipeline/stageExecutor.js";

const root = mkdtempSync(join(tmpdir(), "vg-guidelines-test-"));
const apps: ReturnType<typeof buildApp>[] = [];
const harnesses: ReturnType<typeof createPipelineHarness>[] = [];

function testConfig(): AppConfig {
  const dataDir = join(root, randomUUID());
  return parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    LLM_DEFAULT_PROVIDER: "mock",
    LLM_ENABLE_MOCK: "true",
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const harness of harnesses.splice(0)) harness.close();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function createProject(app: ReturnType<typeof buildApp>, settings: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic: "A careful story", settings },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

describe("guideline routes", () => {
  it("saves packs and profiles, lists findings, dismisses one, and rechecks", async () => {
    const app = buildApp({ testActor,  config: testConfig() });
    apps.push(app);
    const packs = await app.inject({ method: "GET", url: "/api/guidelines/packs" });
    expect(packs.statusCode).toBe(200);
    expect(packs.json().builtIn.length).toBeGreaterThan(3);
    expect(packs.json().disclaimer).toContain("không thay thế chính sách");

    const rejected = await app.inject({
      method: "PUT",
      url: "/api/guidelines/packs",
      payload: { packs: [{ ...packs.json().builtIn[0], id: "project" }] },
    });
    expect(rejected.statusCode).toBe(400);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/guidelines/packs",
      payload: { packs: [{ ...packs.json().builtIn.find((pack: { id: string }) => pack.id === "drama"), id: "drama_copy", basedOn: "drama" }] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().custom.map((pack: { id: string }) => pack.id)).toEqual(["drama_copy"]);

    const profiles = await app.inject({
      method: "PUT",
      url: "/api/guidelines/profiles",
      payload: {
        profiles: [{ id: "kenh", name: "Kênh kể chuyện", guidelines: { platformPack: "youtube", channelPacks: ["storytelling"], customRules: ["Giọng chậm"] } }],
        defaultProfileId: "kenh",
      },
    });
    expect(profiles.statusCode).toBe(200);
    const created = await createProject(app);
    expect(created.settings.guidelines).toMatchObject({ platformPack: "youtube", customRules: ["Giọng chậm"] });

    const project = await createProject(app, {
      platform: "youtube_shorts",
      aspectRatio: "16:9",
      userSet: ["platform", "aspectRatio"],
      guidelines: { platformPack: "auto", channelPacks: [], customRules: [], strictness: "FILTER" },
    });
    const script = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/script`,
      payload: {
        title: "Short",
        hook: "Xin chào các bạn, hôm nay chúng ta nói rất dài trước khi vào chuyện chính.",
        sections: [{ id: "opening", heading: "Mở", narration: "Một câu có từ đéo ở giữa câu.", visualQueries: { primary: "city", alternatives: [] }, visualNotes: "", musicMood: "", energy: "medium", estDurationSec: 1 }],
        outro: "Hết.",
        music: { mood: "", energy: "medium", keywords: [] },
      },
    });
    expect(script.statusCode).toBe(200);
    const checked = await app.inject({ method: "POST", url: `/api/projects/${project.id}/guidelines/check` });
    expect(checked.statusCode).toBe(200);
    const findings = checked.json().findings as Array<{ id: string; ruleId: string; source: string; status: string }>;
    expect(findings.some((finding) => finding.ruleId === "youtube_shorts.profanity" && finding.source === "CODE")).toBe(true);
    const dismissed = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/guidelines/findings/${findings[0].id}/dismiss`,
      payload: { reason: "cố ý" },
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json().findings.find((finding: { id: string }) => finding.id === findings[0].id)).toMatchObject({ status: "DISMISSED", dismissedBy: "cố ý" });
  });
});

describe("guideline prompts and script checks", () => {
  it("puts script rules in the script prompt and only visual rules in visual prompts", () => {
    const project = {
      topic: "Cats",
      description: "",
      settings: {
        language: "vi",
        targetDurationSec: 120,
        aspectRatio: "16:9",
        platform: "youtube",
        style: "storytelling",
        tone: "neutral",
        audience: "general",
        budget: { mode: "BALANCED" },
        guidelines: { platformPack: "auto", channelPacks: ["storytelling"], customRules: [] },
      },
    } as Project;
    const active = activeGuidelines(project);
    const script = scriptPrompt(project, undefined, 150, guidelinePromptBlock(active, ["script", "subtitles"])).prompt;
    expect(script).toContain("(rule: storytelling.arc)");
    const visuals = sceneQueryPrompt(
      [{ index: 0, scene: { label: "Mở", narration: "Lời", visualNotes: "", visualQueries: { primary: "cat", alternatives: [] } } as never }],
      guidelinePromptBlock(active, ["visuals"]),
    );
    expect(visuals).toContain("(rule: storytelling.visual_match)");
    expect(visuals).not.toContain("storytelling.arc");
    const alt = buildAltQueryPrompt([{
      sceneId: "11111111-1111-4111-8111-111111111111",
      visualNotes: "",
      narration: "Lời",
      queries: { primary: "cat", alternatives: [] },
    }], guidelinePromptBlock(active, ["visuals"])).prompt;
    expect(alt).toContain("(rule: storytelling.visual_match)");
    expect(alt).not.toContain("storytelling.arc");
  });

  it("stores guideline findings, caches a rerun, limits check-and-fix, and skips the call in ECO", async () => {
    const quality = scriptHarness("QUALITY");
    const registry = new LlmProviderRegistry(quality.config);
    const mock = registry.get("mock")!;
    const original = mock.generate.bind(mock);
    let checks = 0;
    const generate = vi.spyOn(mock, "generate").mockImplementation(async (request, signal) => {
      if (request.schemaName === "GuidelineCheck") {
        checks += 1;
        const findings = checks === 1 ? [{
          ruleId: "youtube.no_misleading",
          severity: "MUST",
          sceneId: "opening",
          quote: "sample",
          problem: "A claim is not sourced.",
          suggestion: "Say what is still uncertain.",
        }] : [{
          ruleId: "youtube.violence",
          severity: "SHOULD",
          sceneId: "opening",
          quote: "",
          problem: "The revised line is still graphic.",
          suggestion: "Soften the description.",
        }];
        return { text: JSON.stringify({ findings }), usage: { inputTokens: 10, outputTokens: 20 }, model: request.model, provider: "mock", finishReason: "stop" as const };
      }
      const prompt = request.messages[0]?.content ?? "";
      if (request.schemaName === "ScriptReview" && prompt.includes("Fix these content-guideline")) {
        const sourceScript = prompt.match(/^Script:\s*(\{.*\})\s*$/m)?.[1];
        const revisedScript = JSON.parse(sourceScript!) as { sections: Array<{ narration: string }> };
        revisedScript.sections[0].narration = `${revisedScript.sections[0].narration} Updated.`;
        return { text: JSON.stringify({ revisedScript, notes: ["Softened the unsourced claim."], score: 8 }), usage: { inputTokens: 10, outputTokens: 20 }, model: request.model, provider: "mock", finishReason: "stop" as const };
      }
      return original(request, signal);
    });
    const executor = new ScriptExecutor(quality.sqlite, registry, quality.config);
    await executor.run(scriptContext(quality));
    const stored = quality.sqlite.prepare("SELECT rule_id, source, status FROM guideline_findings WHERE project_id = ?").all(quality.projectId) as Array<{ rule_id: string; source: string; status: string }>;
    expect(stored.some((row) => row.rule_id === "youtube.violence" && row.source === "LLM" && row.status === "OPEN")).toBe(true);
    expect(stored.some((row) => row.rule_id === "youtube.no_misleading" && row.source === "LLM" && row.status === "OPEN")).toBe(false);
    const names = generate.mock.calls.map((call) => call[0].schemaName);
    expect(names.filter((name) => name === "GuidelineCheck")).toHaveLength(2);
    expect(names.filter((name) => name === "ScriptReview")).toHaveLength(3);
    const callsAfterFirst = generate.mock.calls.length;
    await executor.run(scriptContext(quality));
    expect(generate.mock.calls.length).toBe(callsAfterFirst);

    const eco = scriptHarness("ECO");
    const ecoRegistry = new LlmProviderRegistry(eco.config);
    const ecoMock = ecoRegistry.get("mock")!;
    const ecoGenerate = vi.spyOn(ecoMock, "generate");
    await new ScriptExecutor(eco.sqlite, ecoRegistry, eco.config).run(scriptContext(eco));
    expect(ecoGenerate.mock.calls.some((call) => call[0].schemaName === "GuidelineCheck")).toBe(false);
  });

  it("AUTO continues past an open MUST finding without pausing at the gate", async () => {
    const harness = createPipelineHarness({
      mode: "AUTO",
      // TASK-020: content autoBlock returns null (MUST is logged elsewhere in the real app).
      autoBlock: () => null,
    });
    harnesses.push(harness);
    new GuidelineService(harness.sqlite).replaceFindings(harness.projectId, "SCRIPT", "CODE", [{
      ruleId: "youtube.no_misleading",
      severity: "MUST",
      sceneId: "scene-1",
      text: "Cần nguồn",
      quote: null,
      suggestion: null,
    }]);
    expect(new GuidelineService(harness.sqlite).openMustCount(harness.projectId)).toBe(1);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    const state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.state).toBe("DONE");
    expect(state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.message).toBe("Auto-approved (AUTO mode)");
    expect(state.currentStage).toBe("FINAL_APPROVAL");
  });

  it("ASSISTED still pauses at VISUAL_REVIEW even with an open MUST finding", async () => {
    const harness = createPipelineHarness({ mode: "ASSISTED" });
    harnesses.push(harness);
    new GuidelineService(harness.sqlite).replaceFindings(harness.projectId, "SCRIPT", "CODE", [{
      ruleId: "youtube.no_misleading",
      severity: "MUST",
      sceneId: "scene-1",
      text: "Cần nguồn",
      quote: null,
      suggestion: null,
    }]);
    harness.orchestrator.runAll(harness.projectId);
    await drainUntilGate(harness);
    const state = harness.orchestrator.getPipeline(harness.projectId);
    expect(state.currentStage).toBe("VISUAL_REVIEW");
    expect(state.stages.find((stage) => stage.stage === "VISUAL_REVIEW")?.state).toBe("WAITING_USER");
  });
});

function scriptHarness(mode: "QUALITY" | "ECO") {
  const harness = createPipelineHarness({
    config: { LLM_DEFAULT_PROVIDER: "mock", LLM_ENABLE_MOCK: true },
  });
  harnesses.push(harness);
  const current = harness.repository.getProject(harness.projectId)!;
  harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(JSON.stringify({
    ...current.settings,
    language: "en",
    targetDurationSec: 120,
    aspectRatio: "16:9",
    platform: "youtube",
    style: "documentary",
    tone: "neutral",
    audience: "general",
    wordsPerMinute: 150,
    sceneDurationSec: 7,
    visualStyle: "mixed",
    subtitles: { enabled: true, maxCharsPerLine: 42 },
    music: { enabled: true, volume: 0.15 },
    userSet: ["researchMode"],
    researchMode: "off",
    stageExecutors: {},
    autoRender: false,
    budget: { mode },
    guidelines: { platformPack: "auto", channelPacks: [], customRules: [], strictness: "FILTER" },
  }), harness.projectId);
  return harness;
}

function scriptContext(harness: ReturnType<typeof createPipelineHarness>): StageContext {
  const job = harness.repository.createJob({
    projectId: harness.projectId,
    stage: "SCRIPT",
    maxAttempts: 1,
    previousState: "PENDING",
  });
  return {
    project: harness.repository.getProject(harness.projectId)!,
    job,
    signal: new AbortController().signal,
    reportProgress() {},
    recordUsage() {},
    logger: Fastify({ logger: false }).log,
  };
}
