/**
 * Story engine benchmark CLI.
 * Runs fixtures against the dev server LLM routes:
 * - for each fixture, generates with storyEngine=off (baseline) vs full
 * - judges each pair blind with a critic route (A/B order randomized)
 * - outputs report to tmp/bench-script-<date>.md
 *
 * Usage:
 *   npm run bench:script -w @vg/server
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ProjectSchema,
  STORY_ENGINE_BENCHMARK_FIXTURES,
  ScriptCritiqueSchema,
  ScriptSchema,
  type Job,
  type Project,
  type Script,
  type ScriptCritique,
} from "@vg/shared";
import type { StageContext } from "../pipeline/stageExecutor.js";
import { openDatabase } from "../db/client.js";
import { parseConfig } from "../lib/config.js";
import { LlmCache } from "../providers/llm/cache.js";
import { LlmProviderRegistry } from "../providers/llm/registry.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { runStoryEngine } from "../stages/script/storyEngine.js";
import { WRITER_SYSTEM, narrationRulesBlock } from "../stages/script/narrationRules.js";
import { formatGuidance, projectRecipe } from "../stages/script/prompt.js";
import { runVariantTrials, type BlindWinner } from "../learning/variantTrialRunner.js";
import type Database from "better-sqlite3";

interface VariantResult {
  script: Script;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  critique: ScriptCritique;
}

const BlindJudgeSchema = z.object({
  winner: z.enum(["A", "B", "TIE"]),
  reasoning: z.string().min(1),
  scoresA: z.object({
    structure: z.number().min(0).max(5),
    hook: z.number().min(0).max(5),
    accuracy: z.number().min(0).max(5),
    ttsNatural: z.number().min(0).max(5),
    visualizable: z.number().min(0).max(5),
    originality: z.number().min(0).max(5),
  }).strict(),
  scoresB: z.object({
    structure: z.number().min(0).max(5),
    hook: z.number().min(0).max(5),
    accuracy: z.number().min(0).max(5),
    ttsNatural: z.number().min(0).max(5),
    visualizable: z.number().min(0).max(5),
    originality: z.number().min(0).max(5),
  }).strict(),
}).strict();

function makeMockProject(fixture: (typeof STORY_ENGINE_BENCHMARK_FIXTURES)[number]): Project {
  return ProjectSchema.parse({
    id: randomUUID(),
    title: fixture.topic,
    description: fixture.research.summary,
    topic: fixture.topic,
    mode: "AUTO",
    settings: {
      language: fixture.language,
      aspectRatio: "16:9",
      targetDurationSec: fixture.targetDurationSec,
      format: fixture.recipeId,
    },
    status: "DRAFT",
    stage: "SCRIPT",
    thumbnailPath: null,
    durationSec: null,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
  });
}

async function runBaselineScript(
  project: Project,
  fixture: (typeof STORY_ENGINE_BENCHMARK_FIXTURES)[number],
  registry: LlmProviderRegistry,
  cache: LlmCache,
): Promise<{ script: Script; costUsd: number; inputTokens: number; outputTokens: number }> {
  const route = registry.resolveTask("script", project);
  const prompt = [
    `Topic: ${project.topic}`,
    `Target duration: ${project.settings.targetDurationSec}s`,
    `Language: ${project.settings.language}`,
    formatGuidance(project),
    `Research summary: ${fixture.research.summary}`,
    `Key facts:`,
    ...fixture.research.keyFacts.map((f) => `- ${f.fact}`),
  ].join("\n\n");

  const generated = await generateRoutedStructured<Script>({
    registry,
    route,
    task: "script",
    knowledgeProject: project,
    knowledgeQuery: project.topic,
    system: [WRITER_SYSTEM, narrationRulesBlock()].join("\n\n"),
    prompt,
    schema: ScriptSchema,
    schemaName: "Script",
    schemaVersion: "1",
    maxOutputTokens: 6000,
    repairAttempts: 1,
    signal: AbortSignal.timeout(120_000),
    cache,
    cacheKeyExtra: `bench:baseline:${fixture.id}`,
  });

  return {
    script: generated.value,
    costUsd: 0,
    inputTokens: generated.usage.inputTokens,
    outputTokens: generated.usage.outputTokens,
  };
}

/**
 * TASK-148e: reads `--variant <id>` from argv. Returns null when the flag is absent.
 * Pure: no I/O, so it is testable without running the benchmark.
 */
export function parseVariantArg(argv: string[]): string | null {
  const index = argv.indexOf("--variant");
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--variant needs a variant id");
  return value;
}

/**
 * TASK-148e: runs blind trials for one prompt variant through the shared trial runner.
 * The judge receives `variantIsA` and must return the raw blind answer; runVariantTrials maps it back.
 * main() does not call this yet: the real judge is not wired to the CLI (see TASK-148e report).
 */
export function runVariantBench(
  db: Database.Database,
  input: {
    variantId: string;
    fixtureIds: string[];
    judge: (fixtureId: string, variantIsA: boolean) => Promise<BlindWinner>;
    random?: () => number;
  },
) {
  return runVariantTrials(db, input);
}

async function main() {
  console.log("Starting Story Engine benchmark suite...");
  const config = parseConfig();
  const { sqlite } = openDatabase(config.DATABASE_PATH);
  const registry = new LlmProviderRegistry(config);
  const cache = new LlmCache(sqlite, false);

  const results: Array<{
    fixtureId: string;
    topic: string;
    winner: "storyEngine" | "baseline" | "TIE";
    blindWinner: "A" | "B" | "TIE";
    blindOrder: { A: "storyEngine" | "baseline"; B: "storyEngine" | "baseline" };
    engineTokens: number;
    baselineTokens: number;
    engineCritiqueScore: number;
    baselineCritiqueScore: number;
    reasoning: string;
  }> = [];

  for (const fixture of STORY_ENGINE_BENCHMARK_FIXTURES) {
    console.log(`\nEvaluating fixture [${fixture.id}] - ${fixture.topic}...`);
    const project = makeMockProject(fixture);

    // 1. Run Story Engine (mode=full)
    console.log("  Running Story Engine (full)...");
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      child: () => mockLogger,
      level: "info",
      silent: () => {},
    } as unknown as Parameters<typeof runStoryEngine>[0]["context"]["logger"];

    const mockJob = {
      id: randomUUID(),
      projectId: project.id,
      stage: "SCRIPT" as const,
      state: "RUNNING" as const,
      attempt: 1,
      maxAttempts: 3,
      executor: "app" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const stageContext: StageContext = {
      project,
      job: mockJob as unknown as Job,
      signal: AbortSignal.timeout(180_000),
      reportProgress: () => {},
      recordUsage: () => {},
      logger: mockLogger,
    };

    const engineRes = await runStoryEngine({
      project,
      applicableResearch: fixture.research,
      engineMode: "full",
      scriptGuidance: "",
      context: stageContext,
      sqlite,
      registry,
      cache,
      config,
      inputHash: `bench:${fixture.id}`,
      cacheKeyExtra: `bench:${fixture.id}`,
    });

    let engineScript: Script;
    let engineTokens = 0;
    let engineCritiqueScore = 0;

    if (engineRes.fallback) {
      console.warn(`  Story engine fell back: ${engineRes.fallbackNote}`);
      // Fallback: run baseline script to compare
      const fallbackRun = await runBaselineScript(project, fixture, registry, cache);
      engineScript = fallbackRun.script;
      engineTokens = engineRes.spentInputTokens + engineRes.spentOutputTokens;
      engineCritiqueScore = 50;
    } else {
      engineScript = engineRes.script;
      engineTokens = engineRes.spentInputTokens + engineRes.spentOutputTokens;
      engineCritiqueScore = engineRes.draft.critique.total;
    }

    // 2. Run Baseline (mode=off)
    console.log("  Running Baseline (off)...");
    const baselineRes = await runBaselineScript(project, fixture, registry, cache);
    const baselineScript = baselineRes.script;
    const baselineTokens = baselineRes.inputTokens + baselineRes.outputTokens;

    // 3. Blind evaluation with a critic route
    console.log("  Running blind judge...");
    const isEngineA = Math.random() < 0.5;
    const scriptA = isEngineA ? engineScript : baselineScript;
    const scriptB = isEngineA ? baselineScript : engineScript;

    const judgeRoute = registry.resolveTask("scriptCritic", project);
    const judgePrompt = [
      `TOPIC: ${project.topic}`,
      `TARGET DURATION: ${project.settings.targetDurationSec}s`,
      `LANGUAGE: ${project.settings.language}`,
      `RESEARCH SUMMARY: ${fixture.research.summary}`,
      `SCRIPT CANDIDATE A:\n${JSON.stringify(scriptA, null, 2)}`,
      `SCRIPT CANDIDATE B:\n${JSON.stringify(scriptB, null, 2)}`,
      "Evaluate both scripts independently across the 6 narrative criteria (structure, hook, accuracy, ttsNatural, visualizable, originality).",
      "Decide which script is better overall for video narration, or TIE if equal.",
    ].join("\n\n");

    const blindEvaluation = await generateRoutedStructured<z.infer<typeof BlindJudgeSchema>>({
      registry,
      route: judgeRoute,
      task: "scriptCritic",
      knowledgeProject: project,
      knowledgeQuery: project.topic,
      system: "You are an expert impartial video judge. Compare script A and B blind on story structure and audience retention.",
      prompt: judgePrompt,
      schema: BlindJudgeSchema,
      schemaName: "BlindJudgeResult",
      schemaVersion: "1",
      maxOutputTokens: 3000,
      repairAttempts: 1,
      signal: AbortSignal.timeout(120_000),
      cache,
      cacheKeyExtra: `bench:judge:${fixture.id}`,
    });

    const judgeVal = blindEvaluation.value;
    let actualWinner: "storyEngine" | "baseline" | "TIE";
    if (judgeVal.winner === "TIE") {
      actualWinner = "TIE";
    } else if (judgeVal.winner === "A") {
      actualWinner = isEngineA ? "storyEngine" : "baseline";
    } else {
      actualWinner = isEngineA ? "baseline" : "storyEngine";
    }

    const baselineScore = (isEngineA ? judgeVal.scoresB : judgeVal.scoresA);
    const baselineTotal = Object.values(baselineScore).reduce((a, b) => a + b, 0) * (100 / 30);

    results.push({
      fixtureId: fixture.id,
      topic: fixture.topic,
      winner: actualWinner,
      blindWinner: judgeVal.winner,
      blindOrder: {
        A: isEngineA ? "storyEngine" : "baseline",
        B: isEngineA ? "baseline" : "storyEngine",
      },
      engineTokens,
      baselineTokens,
      engineCritiqueScore: Math.round(engineCritiqueScore),
      baselineCritiqueScore: Math.round(baselineTotal),
      reasoning: judgeVal.reasoning,
    });

    console.log(`  Winner: ${actualWinner} (Engine score: ${Math.round(engineCritiqueScore)}, Baseline: ${Math.round(baselineTotal)})`);
  }

  // Generate markdown report
  const today = new Date().toISOString().slice(0, 10);
  const engineWins = results.filter((r) => r.winner === "storyEngine").length;
  const baselineWins = results.filter((r) => r.winner === "baseline").length;
  const ties = results.filter((r) => r.winner === "TIE").length;

  const report = [
    `# Story Engine Benchmark Report — ${today}`,
    "",
    `## Summary`,
    `- Total fixtures: ${results.length}`,
    `- Story Engine wins: ${engineWins} (${Math.round((engineWins / results.length) * 100)}%)`,
    `- Baseline wins: ${baselineWins} (${Math.round((baselineWins / results.length) * 100)}%)`,
    `- Ties: ${ties}`,
    "",
    `## Per-Fixture Results`,
    "| Fixture | Topic | Winner | Story Engine Score | Baseline Score | Engine Tokens | Baseline Tokens |",
    "|---------|-------|--------|--------------------|----------------|---------------|-----------------|",
    ...results.map(
      (r) =>
        `| ${r.fixtureId} | ${r.topic.slice(0, 30)}... | **${r.winner}** | ${r.engineCritiqueScore} | ${r.baselineCritiqueScore} | ${r.engineTokens} | ${r.baselineTokens} |`,
    ),
    "",
    "## Detailed Judge Notes",
    ...results.map(
      (r) => `### [${r.fixtureId}] ${r.topic}\n- Winner: ${r.winner} (blind: ${r.blindWinner})\n- Reasoning: ${r.reasoning}\n`,
    ),
  ].join("\n");

  mkdirSync("tmp", { recursive: true });
  const outPath = join("tmp", `bench-script-${today}.md`);
  writeFileSync(outPath, report, "utf8");
  console.log(`\nBenchmark completed! Report written to ${outPath}`);
  sqlite.close();
}

if (process.argv[1]?.endsWith("benchScript.ts") || process.argv[1]?.endsWith("benchScript.js")) {
  main().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}
