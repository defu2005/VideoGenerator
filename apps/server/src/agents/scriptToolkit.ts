import {
  CRITIC_RUBRIC_SYSTEM_PROMPT,
  PROTECTED_PROJECT_ID,
  ScriptCritiqueSchema,
  ScriptSchema,
  StoredResearchNotesSchema,
  computeScriptCritique,
  lintNarration,
  prioritizeNarrationLint,
  redactExportText,
  researchFactsWithIds,
  resolveBudget,
  scriptCritiqueNeedsHold,
  storyEngineForProject,
  storyModeForProject,
  type Job,
  type JobUsage,
  type Project,
  type ResearchNotes,
  type Script,
  type ScriptCritique,
  type StoredResearchNotes,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { AppConfig } from "../lib/config.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import type { LlmCache } from "../providers/llm/cache.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import { LlmError } from "../providers/llm/types.js";
import { narrationRulesBlock } from "../stages/script/narrationRules.js";
import { projectRecipe } from "../stages/script/prompt.js";
import { FactCheckResponseSchema, factCheckPrompt } from "../stages/script/factCheckPrompt.js";
import { computeSectionDurations, maxOutputTokensForDuration, scriptContentHash, scriptInputHash } from "../stages/script/scriptUtils.js";
import { blockingNote } from "../operator/qualityGates.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import type { TrustedAgent } from "../supervision/identity.js";
import type { AgentStageService } from "./stageService.js";

/** Errors that hand a script job to an agent under app_then_agent. A gate LLM failure is never a hold. */
export const SCRIPT_HANDOFF_ERRORS: readonly string[] = ["LLM_ALL_PROVIDERS_EXHAUSTED", "LLM_QUOTA_EXHAUSTED"];
/** Resubmits allowed after a hold. The submit that fails after this many resubmits returns the job to the app. */
export const SCRIPT_MAX_HOLD_RESUBMITS = 2;
const SCRIPT_MAX_FAILED_SUBMITS = SCRIPT_MAX_HOLD_RESUBMITS + 1;
const SCRIPT_MAX_REVIEW_NOTES = 8;

type GateUsage = {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  features: Record<string, number>;
};

type GateResult = {
  script: Script;
  critique: ScriptCritique;
  qualityScore: number;
  blockingFacts: number;
  reviewNotes: string[];
  hold: boolean;
  usage: GateUsage;
  provider: string;
  model: string;
  inputHash: string;
  research: StoredResearchNotes | undefined;
};

/** Redacts every string in a parsed value; keys and numbers are left alone. Stored and hashed text must be the same text. */
function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactExportText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)])) as T;
  }
  return value;
}

function emptyUsage(): GateUsage {
  return { llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, features: {} };
}

function toJobUsage(usage: GateUsage): Partial<JobUsage> {
  return {
    llmCalls: usage.llmCalls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    features: usage.features,
  };
}

/**
 * TASK-147d: the agent path for SCRIPT. The agent writes a draft through `script_submit_draft`; the app runs the same
 * gate the app path uses (narration lint, the 145 critic, fact check against research) before any row is written.
 *
 * Order per submit: cheap refusals inside the lease fence (lease, protected project, edited script, hold budget used
 * up), shape check, LLM gate outside any transaction, then a second fenced write. A held draft writes nothing except
 * the failed-submit count. The third failed submit returns the job to the app path.
 */
export class AgentScriptToolkit {
  constructor(
    private readonly repository: JobRepository,
    private readonly stages: AgentStageService,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly registry: LlmProviderRegistry,
    private readonly config: AppConfig,
    private readonly cache: LlmCache,
  ) {}

  private get sqlite() { return this.repository.sqlite; }

  private projectOf(job: Job): Project {
    if (job.projectId === PROTECTED_PROJECT_ID) throw new AppError(404, "STAGE_JOB_NOT_FOUND", "Không thấy việc trong phạm vi được phép.");
    const project = this.repository.getProject(job.projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  private researchOf(projectId: string): { input_hash: string; research: StoredResearchNotes | undefined } | undefined {
    const row = this.sqlite.prepare("SELECT input_hash, data FROM research_notes WHERE project_id = ?").get(projectId) as { input_hash: string; data: string } | undefined;
    if (!row) return undefined;
    const parsed = StoredResearchNotesSchema.safeParse(JSON.parse(row.data) as unknown);
    return { input_hash: row.input_hash, research: parsed.success ? parsed.data : undefined };
  }

  /** Same hash the app path writes into `scripts.input_hash` (non-merged). */
  private inputHashFor(project: Project): string {
    const row = this.researchOf(project.id);
    const applicable = storyModeForProject(project) === "off" ? undefined : row;
    return scriptInputHash(project, applicable?.input_hash);
  }

  private failedSubmits(jobId: string, leaseId: string): number {
    const row = this.sqlite.prepare("SELECT agent_hold_count, agent_hold_lease_id FROM jobs WHERE id = ?").get(jobId) as
      { agent_hold_count: number | null; agent_hold_lease_id: string | null } | undefined;
    return row?.agent_hold_lease_id === leaseId ? (row.agent_hold_count ?? 0) : 0;
  }

  context(job: Job) {
    const project = this.projectOf(job);
    const research = this.researchOf(project.id)?.research ?? null;
    return {
      projectId: project.id,
      topic: project.topic,
      targetDurationSec: project.settings.targetDurationSec,
      format: project.settings.format ?? null,
      language: project.settings.language,
      research,
      requirements: {
        gate: "Bản nháp phải qua: lint nhịp văn, chấm critic (tổng ≥ 60, accuracy ≥ 3), và không có fact blocking.",
        maxFailedSubmits: SCRIPT_MAX_FAILED_SUBMITS,
        onHold: "Cổng trả critique và cho phép nộp lại. Lần nộp thất bại thứ 3 trả việc về app.",
      },
    };
  }

  /** Runs lint, the critic and the fact check. Throws a retryable 503 on LLM failure; never returns a partial result. */
  private async runGate(project: Project, script: Script, jobId: string, research: StoredResearchNotes | undefined, usage: GateUsage): Promise<GateResult> {
    const wpm = this.config.SPEECH_WORDS_PER_MINUTE;
    const appRouting = getAppLlmSettings(this.sqlite);
    const account = (feature: string, result: { usage: { llmCalls: number; inputTokens: number; outputTokens: number }; provider: string; model: string }) => {
      usage.llmCalls += result.usage.llmCalls;
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.costUsd += estimateLlmCost(this.config, result.provider, result.model, result.usage) ?? 0;
      usage.features[feature] = (usage.features[feature] ?? 0) + result.usage.llmCalls;
    };
    const accountFailure = (feature: string, error: unknown) => {
      if (error instanceof LlmError && error.usage) {
        usage.llmCalls += error.usage.llmCalls;
        usage.inputTokens += error.usage.inputTokens;
        usage.outputTokens += error.usage.outputTokens;
        usage.features[feature] = (usage.features[feature] ?? 0) + error.usage.llmCalls;
      }
    };
    const retryable = (message: string) => new AppError(503, "SCRIPT_GATE_UNAVAILABLE", message, { retryable: true });

    // Code-only lint: leftovers become `[lint]` notes, never a hold.
    const lintLines = prioritizeNarrationLint(lintNarration(script, projectRecipe(project), project.settings.language))
      .slice(0, 3)
      .map((finding) => `[lint] ${finding.code} (${finding.sectionId}): ${finding.message}`);

    // Critic: the 145 critic request, built here because rescoreCritique is blocked while a job is active.
    const criticRoute = this.registry.resolveTask("scriptCritic", project, appRouting);
    const critiqueSystem = [
      CRITIC_RUBRIC_SYSTEM_PROMPT,
      "Evaluate the provided video script rigorously against the 6-dimension rubric.",
      "Identify the 2-4 weakest sections and provide specific revision instructions.",
      narrationRulesBlock(),
    ].join("\n\n");
    const critiquePrompt = JSON.stringify({
      topic: project.topic,
      targetDurationSec: project.settings.targetDurationSec,
      format: project.settings.format,
      language: project.settings.language,
      researchSummary: research?.summary,
      researchFacts: research ? researchFactsWithIds(research as ResearchNotes) : [],
      script,
    }, null, 2);
    let critique: ScriptCritique;
    try {
      const evaluated = await generateRoutedStructured({
        registry: this.registry,
        route: criticRoute,
        task: "scriptCritic",
        knowledgeProject: project,
        knowledgeQuery: project.topic,
        system: critiqueSystem,
        prompt: critiquePrompt,
        schema: ScriptCritiqueSchema,
        schemaName: "ScriptCritique",
        schemaVersion: "2",
        maxOutputTokens: 2500,
        repairAttempts: 1,
        signal: AbortSignal.timeout(60_000),
        cache: this.cache,
        cacheKeyExtra: `agent-critic:${scriptContentHash(script)}`,
      });
      account("critic", evaluated);
      critique = computeScriptCritique(evaluated.value);
    } catch (error) {
      accountFailure("critic", error);
      throw retryable(`Cổng critic lỗi (${(error as { code?: string })?.code ?? "LLM"}); thử lại.`);
    }

    // Fact check on every submit, against the research notes. revisedScript is ignored: the agent owns its draft.
    const budget = resolveBudget(project);
    const factRoute = this.registry.resolveTask("factCheck", project, appRouting);
    const factPrompt = factCheckPrompt(project.topic, research as ResearchNotes | undefined, script);
    let factLines: string[] = [];
    let blockingFacts = 0;
    try {
      const factChecked = await generateRoutedStructured({
        registry: this.registry,
        route: factRoute,
        task: "factCheck",
        knowledgeProject: project,
        ...factPrompt,
        schema: FactCheckResponseSchema,
        schemaName: "FactCheck",
        schemaVersion: "1",
        maxOutputTokens: Math.ceil(maxOutputTokensForDuration(project.settings.targetDurationSec, wpm) * budget.outputHeadroom),
        repairAttempts: Math.min(1, budget.repairAttempts) as 0 | 1,
        signal: AbortSignal.timeout(60_000),
        cache: this.cache,
        cacheKeyExtra: `agent-fact:${scriptContentHash(script)}`,
      });
      account("factCheck", factChecked);
      blockingFacts = factChecked.value.notes.filter((note) => note.severity === "blocking").length;
      factLines = factChecked.value.notes.map((note) => note.severity === "blocking" ? blockingNote(note.text) : note.text);
    } catch (error) {
      accountFailure("factCheck", error);
      throw retryable(`Cổng fact check lỗi (${(error as { code?: string })?.code ?? "LLM"}); thử lại.`);
    }

    const reviewNotes = [...factLines, ...lintLines].slice(0, SCRIPT_MAX_REVIEW_NOTES).map((line) => redactExportText(line));
    const qualityScore = Math.round((critique.total / 10) * 10) / 10;
    return {
      script,
      critique,
      qualityScore,
      blockingFacts,
      reviewNotes,
      hold: scriptCritiqueNeedsHold(critique, blockingFacts > 0),
      usage,
      provider: criticRoute.provider.id,
      model: criticRoute.model,
      inputHash: this.inputHashFor(project),
      research,
    };
  }

  /**
   * Lease-fenced submit. Refusals run before any LLM call. Held drafts write nothing but the failed-submit count.
   */
  async submit(agent: TrustedAgent, jobId: string, leaseId: string, input: unknown) {
    const pre = this.stages.withLease(agent, jobId, leaseId, (job) => {
      const project = this.projectOf(job);
      const edited = this.sqlite.prepare("SELECT edited FROM scripts WHERE project_id = ?").get(project.id) as { edited: number } | undefined;
      if (edited?.edited) throw new AppError(409, "SCRIPT_EDITED", "Kịch bản đã được người dùng sửa; không ghi đè bằng bản của agent.");
      return { project, failed: this.failedSubmits(jobId, leaseId) };
    });
    // Recovery path: a previous increment committed but the release did not. Return the job without a new gate call.
    if (pre.failed >= SCRIPT_MAX_FAILED_SUBMITS) return this.returnToApp(agent, jobId, leaseId, pre.failed);

    const shape = ScriptSchema.safeParse(input);
    if (!shape.success) {
      const problems = shape.error.issues.map((issue) => `${issue.path.join(".") || "script"}: ${issue.message}`);
      throw new AppError(422, "SCRIPT_AGENT_INVALID", `Kịch bản sai cấu trúc: ${problems.join("; ")}`, { problems });
    }
    // Redact first so the critic, the fact check and the stored row all see the same text.
    const script = computeSectionDurations(redactDeep(shape.data), this.config.SPEECH_WORDS_PER_MINUTE);
    const research = this.researchOf(pre.project.id)?.research;

    const usage = emptyUsage();
    let gate: GateResult;
    try {
      gate = await this.runGate(pre.project, script, jobId, research, usage);
    } catch (error) {
      // The calls were paid for even when the gate fails; keep their usage visible on the job.
      if (usage.llmCalls > 0) this.orchestrator.recordUsage(jobId, toJobUsage(usage));
      throw error;
    }
    // Recorded outside the fence: withLease is one immediate transaction, so a throw below would roll the usage back.
    this.orchestrator.recordUsage(jobId, toJobUsage(gate.usage));

    const outcome = this.stages.withLease(agent, jobId, leaseId, (job) => {
      const project = this.projectOf(job);
      if (this.inputHashFor(project) !== gate.inputHash) {
        throw new AppError(409, "SCRIPT_INPUT_CHANGED", "Đầu vào nghiên cứu đã đổi trong lúc chấm; cần nhận lại việc để có context mới.");
      }
      if (gate.hold) {
        const failed = this.failedSubmits(jobId, leaseId) + 1;
        this.sqlite.prepare("UPDATE jobs SET agent_hold_count = ?, agent_hold_lease_id = ? WHERE id = ?").run(failed, leaseId, jobId);
        return { status: "held" as const, failed, project, gate };
      }
      const edited = this.sqlite.prepare("SELECT edited FROM scripts WHERE project_id = ?").get(project.id) as { edited: number } | undefined;
      if (edited?.edited) throw new AppError(409, "SCRIPT_EDITED", "Kịch bản đã được người dùng sửa; không ghi đè bằng bản của agent.");
      const current = this.sqlite.prepare("SELECT data, version FROM scripts WHERE project_id = ?").get(project.id) as { data: string; version: number } | undefined;
      const serialized = JSON.stringify(gate.script);
      const version = current ? (current.data === serialized ? current.version : current.version + 1) : 1;
      const now = new Date().toISOString();
      this.sqlite.prepare(
        "INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call, review_notes, quality_score, blocking_facts) VALUES (?, ?, 'AGENT', false, ?, ?, ?, ?, ?, false, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, origin = 'AGENT', edited = false, input_hash = excluded.input_hash, version = excluded.version, provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at, merged_call = false, review_notes = excluded.review_notes, quality_score = excluded.quality_score, blocking_facts = excluded.blocking_facts, revise_round = 0",
      ).run(
        project.id,
        serialized,
        gate.inputHash,
        version,
        `agent:${leaseId}`,
        agent.model ?? "agent",
        now,
        gate.reviewNotes.length ? JSON.stringify(gate.reviewNotes) : null,
        gate.qualityScore,
        gate.blockingFacts,
      );
      const priorRow = this.sqlite.prepare("SELECT critique_history FROM script_drafts WHERE project_id = ?").get(project.id) as { critique_history: string | null } | undefined;
      let prior: unknown[] = [];
      try { prior = priorRow?.critique_history ? JSON.parse(priorRow.critique_history) as unknown[] : []; } catch { prior = []; }
      const history = [...prior, { round: prior.length + 1, total: gate.critique.total, scores: gate.critique.scores }];
      // The agent path has no outline or hook candidates; it replaces the app draft and records its author.
      this.sqlite.prepare(
        `INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at, author)
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET outline = NULL, hook_candidates = NULL, phase = NULL, critique = excluded.critique, critique_history = excluded.critique_history,
           engine_mode = excluded.engine_mode, input_hash = excluded.input_hash, updated_at = excluded.updated_at, author = excluded.author`,
      ).run(
        project.id,
        JSON.stringify(redactDeep(gate.critique)),
        JSON.stringify(redactDeep(history)),
        storyEngineForProject(project),
        gate.inputHash,
        now,
        `agent:${agent.instance}`,
      );
      // Pass only: a held or refused submit must not invalidate downstream stages. The SCRIPT stage itself is never flagged (dependentStages excludes its origin).
      markStaleFrom(this.repository, project.id, "SCRIPT");
      return { status: "passed" as const, project, gate, version };
    });

    if (outcome.status === "held") {
      if (outcome.failed >= SCRIPT_MAX_FAILED_SUBMITS) return this.returnToApp(agent, jobId, leaseId, outcome.failed);
      return {
        status: "held" as const,
        attempt: outcome.failed,
        remainingResubmits: SCRIPT_MAX_FAILED_SUBMITS - outcome.failed,
        critique: outcome.gate.critique,
        blockingFacts: outcome.gate.blockingFacts,
        reviewNotes: outcome.gate.reviewNotes,
        message: "Bản nháp chưa đạt cổng chất lượng. Sửa theo critique và nộp lại.",
      };
    }
    return {
      status: "passed" as const,
      projectId: outcome.project.id,
      version: outcome.version,
      qualityScore: outcome.gate.qualityScore,
      blockingFacts: outcome.gate.blockingFacts,
      reviewNotes: outcome.gate.reviewNotes,
      message: "Bản nháp đã đạt cổng. Gọi stage complete để hoàn tất.",
    };
  }

  /** Runs after the increment commits, so a release failure still leaves the count recoverable. */
  private returnToApp(agent: TrustedAgent, jobId: string, leaseId: string, failed: number) {
    this.stages.release(agent, jobId, leaseId, "cannot_do");
    return {
      status: "returned_to_app" as const,
      failed,
      message: `Đã nộp ${failed} bản nháp không đạt cổng. Việc được trả về app.`,
    };
  }

  /** Re-checks at complete: the row must come from this lease, match the current input, and pass the same hold rule. */
  validateComplete(job: Job): void {
    const project = this.projectOf(job);
    const lease = this.repository.getExecutionLease(job.id);
    const row = this.sqlite.prepare("SELECT input_hash, provider, blocking_facts FROM scripts WHERE project_id = ?")
      .get(project.id) as { input_hash: string; provider: string | null; blocking_facts: number } | undefined;
    const draft = this.sqlite.prepare("SELECT critique FROM script_drafts WHERE project_id = ?")
      .get(project.id) as { critique: string | null } | undefined;
    const problems: string[] = [];
    if (!row) problems.push("Chưa có kịch bản.");
    else if (!lease || row.provider !== `agent:${lease.leaseId}`) problems.push("Kịch bản không do lượt nhận việc này nộp.");
    else if (row.input_hash !== this.inputHashFor(project)) problems.push("Kịch bản không khớp đầu vào hiện tại.");
    else {
      const parsed = draft?.critique ? ScriptCritiqueSchema.safeParse(JSON.parse(draft.critique) as unknown) : null;
      if (!parsed?.success) problems.push("Thiếu critique của bản nháp.");
      else if (scriptCritiqueNeedsHold(computeScriptCritique(parsed.data), row.blocking_facts > 0)) problems.push("Kịch bản chưa đạt cổng chất lượng.");
    }
    if (problems.length) {
      throw new AppError(422, "SCRIPT_AGENT_INVALID", `Kịch bản chưa đạt cổng: ${problems.join(" ")}`, { problems });
    }
  }
}
