import { randomUUID } from "node:crypto";
import { enqueueIndex } from "../retrieval/service.js";
import {
  computeScriptCritique,
  CRITIC_RUBRIC_SYSTEM_PROMPT,
  HookAssessmentSchema,
  HookCandidateSchema,
  researchFactsWithIds,
  ResearchNotesSchema,
  StoredResearchNotesSchema,
  ScriptCritiqueSchema,
  ScriptDataSchema,
  ScriptDraftPayloadSchema,
  ScriptSchema,
  StoryOutlineSchema,
  storyModeForProject,
  type HookAssessment,
  type HookCandidate,
  type JobUsage,
  type Project,
  type ResearchNotes,
  type Script,
  type ScriptCritique,
  type ScriptData,
  type ScriptDraftPayload,
  type ScriptScores,
  type StoryOutline,
} from "@vg/shared";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import { rememberTreatment } from "../formats/treatmentStore.js";
import { AppError } from "../lib/errors.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import {
  computeSectionDurations,
  researchInputHash,
  scriptContentHash,
  scriptInputHash,
} from "../stages/script/scriptUtils.js";
import { narrationRulesBlock } from "../stages/script/narrationRules.js";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import { LlmError } from "../providers/llm/types.js";

/** TASK-146: the outline is parked for approval or approved and still resuming. Hook and rescore writes must wait. */
function isOutlinePending(phase: string | null | undefined): boolean {
  return phase === "outline_ready" || phase === "outline_approved";
}

/** TASK-146: the only outline fields a user may edit while it is parked. */
export type OutlineEdit = {
  centralQuestion?: string;
  beats?: { id: string; concreteMoment: string }[];
};

function isolateFirstSentence(originalNarration: string, candidateRevisedSentence: string): string {
  const match = originalNarration.match(/^([\s\S]*?[.!?])(\s+[\s\S]*)$/);
  if (!match) {
    return candidateRevisedSentence.trim();
  }
  const remainingText = match[2]!;
  const firstSentenceMatch = candidateRevisedSentence.trim().match(/^([\s\S]*?[.!?])/);
  let cleanFirstSentence = firstSentenceMatch ? firstSentenceMatch[1]!.trim() : candidateRevisedSentence.trim();
  if (!/[.!?]$/.test(cleanFirstSentence)) {
    cleanFirstSentence += ".";
  }
  return `${cleanFirstSentence}${remainingText}`;
}

type ScriptRow = {
  data: string;
  origin: "AGENT" | "USER";
  edited: number;
  input_hash: string;
  version: number;
  provider: string | null;
  model: string | null;
  review_notes: string | null;
  updated_at: string;
  merged_call: number;
};
type ResearchRow = {
  input_hash: string;
  provider: string;
  model: string;
  cached: number;
  created_at: string;
  data: string;
};

export class ScriptService {
  private readonly cache: LlmCache;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly repository: JobRepository,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly config: AppConfig,
    private readonly registry?: LlmProviderRegistry,
    cache?: LlmCache,
  ) {
    this.cache = cache ?? new LlmCache(sqlite, config.LLM_CACHE_ENABLED);
  }

  private recordJob(input: {
    projectId: string;
    scope: "rescoreCritique" | "switchHook";
    status: "SUCCEEDED" | "FAILED";
    message: string;
    provider?: string;
    model?: string;
    usage?: { inputTokens: number; outputTokens: number; calls?: any[] } | null;
    llmCalls?: number;
    error?: unknown;
  }): void {
    const now = new Date().toISOString();
    const id = randomUUID();
    const llmCalls = input.llmCalls ?? (input.usage ? 1 : 0);
    const inputTokens = input.usage?.inputTokens ?? 0;
    const outputTokens = input.usage?.outputTokens ?? 0;
    const provider = input.provider ?? "mock";
    const model = input.model ?? "mock";
    const costUsd = estimateLlmCost(this.config, provider, model, { inputTokens, outputTokens });
    const jobUsage: JobUsage = {
      llmCalls,
      inputTokens,
      outputTokens,
      costUsd,
      provider,
      model,
      calls: input.usage?.calls,
      features: { [input.scope]: llmCalls },
    };
    const errorMessage = input.error ? (input.error instanceof Error ? input.error.message : String(input.error)) : null;

    this.sqlite.prepare(
      `INSERT INTO jobs (
         id, project_id, stage, scope, status, progress, message, attempt, max_attempts,
         error, usage, created_at, started_at, finished_at, run_after, previous_state
       ) VALUES (?, ?, 'SCRIPT', ?, ?, 100, ?, 1, 1,
         ?, ?, ?, ?, ?, ?, 'WAITING_USER')`,
    ).run(
      id,
      input.projectId,
      input.scope,
      input.status,
      input.message,
      errorMessage ? JSON.stringify({ message: errorMessage }) : null,
      JSON.stringify(jobUsage),
      now,
      now,
      now,
      now,
    );
  }

  get(projectId: string): ScriptData {
    const project = this.repository.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const scriptRow = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?").get(projectId) as ScriptRow | undefined;
    const researchRow = this.sqlite.prepare("SELECT * FROM research_notes WHERE project_id = ?").get(projectId) as ResearchRow | undefined;
    const researchInput = researchRow ? JSON.parse(researchRow.data) as ResearchNotes : undefined;
    const script = scriptRow ? {
      data: ScriptSchema.parse(JSON.parse(scriptRow.data) as unknown),
      origin: scriptRow.origin,
      edited: Boolean(scriptRow.edited),
      version: scriptRow.version,
      provider: scriptRow.provider,
      model: scriptRow.model,
      reviewNotes: scriptRow.review_notes === null ? null : JSON.parse(scriptRow.review_notes) as string[],
      updatedAt: scriptRow.updated_at,
    } : null;
    const research = researchRow ? {
      data: researchInput,
      provider: researchRow.provider,
      model: researchRow.model,
      cached: Boolean(researchRow.cached),
      createdAt: researchRow.created_at,
    } : null;
    const researchMode = storyModeForProject(project);
    const currentResearchHash = researchMode !== "off" ? researchRow?.input_hash : undefined;
    const currentInputHash = researchMode === "merged" && scriptRow?.merged_call
      && researchRow?.input_hash === researchInputHash(project)
      ? researchRow.input_hash
      : scriptInputHash(project, currentResearchHash);
    const stage = this.repository.getStage(projectId, "SCRIPT");

    const draftRow = this.sqlite.prepare("SELECT * FROM script_drafts WHERE project_id = ?").get(projectId) as {
      project_id: string;
      outline: string | null;
      hook_candidates: string | null;
      critique: string | null;
      critique_history: string | null;
      engine_mode: string;
      input_hash: string;
      updated_at: string;
      phase: string | null;
    } | undefined;

    let draft: ScriptDraftPayload | null = null;
    if (draftRow) {
      let hookCandidates: HookCandidate[] = [];
      let chosenHookId: string | undefined = undefined;
      let hookAssessments: HookAssessment[] | undefined = undefined;
      if (draftRow.hook_candidates) {
        try {
          const parsedHooks = JSON.parse(draftRow.hook_candidates);
          if (Array.isArray(parsedHooks)) {
            hookCandidates = z.array(HookCandidateSchema).parse(parsedHooks);
          } else if (parsedHooks && typeof parsedHooks === "object") {
            hookCandidates = z.array(HookCandidateSchema).parse(parsedHooks.candidates ?? []);
            chosenHookId = typeof parsedHooks.chosenHookId === "string" ? parsedHooks.chosenHookId : undefined;
            if (Array.isArray(parsedHooks.hookAssessments)) {
              hookAssessments = z.array(HookAssessmentSchema).parse(parsedHooks.hookAssessments);
            }
          }
        } catch {
          // ignore malformed hook_candidates
        }
      }

      let critique: ScriptCritique | null = null;
      if (draftRow.critique) {
        try {
          critique = ScriptCritiqueSchema.parse(JSON.parse(draftRow.critique));
        } catch {
          critique = null;
        }
      }

      let critiqueHistory: Array<{ round: number; total: number; scores: ScriptScores }> | undefined = undefined;
      if (draftRow.critique_history) {
        try {
          critiqueHistory = JSON.parse(draftRow.critique_history);
        } catch {
          critiqueHistory = undefined;
        }
      }

      let critiqueStale = false;
      if (critique && scriptRow) {
        try {
          const currentScriptObj = JSON.parse(scriptRow.data);
          critiqueStale = draftRow.input_hash !== scriptContentHash(currentScriptObj);
        } catch {
          critiqueStale = false;
        }
      }

      let parsedOutline: StoryOutline | null = null;
      if (draftRow.outline) {
        try {
          parsedOutline = StoryOutlineSchema.parse(JSON.parse(draftRow.outline));
        } catch {
          parsedOutline = null;
        }
      }

      try {
        draft = ScriptDraftPayloadSchema.parse({
          outline: parsedOutline,
          hookCandidates,
          chosenHookId,
          hookAssessments,
          critique,
          critiqueHistory,
          critiqueStale,
          engineMode: draftRow.engine_mode as "off" | "lite" | "full",
          inputHash: draftRow.input_hash,
          updatedAt: draftRow.updated_at,
          phase: draftRow.phase === "outline_ready" || draftRow.phase === "outline_approved" || draftRow.phase === "done" ? draftRow.phase : null,
        });
      } catch {
        draft = null;
      }
    }

    return ScriptDataSchema.parse({
      script,
      research,
      origin: script?.origin ?? null,
      version: script?.version ?? 0,
      stale: script !== null && (scriptRow?.input_hash !== currentInputHash || stage.state === "STALE"),
      draft,
    });
  }

  save(projectId: string, input: unknown): ScriptData {
    const script = ScriptSchema.parse(input);
    return this.repository.atomic(() => {
      const project = this.repository.getProject(projectId);
      if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
      if (this.repository.getActiveJob(projectId)) {
        throw new AppError(409, "INVALID_PIPELINE_STATE", "A job is already active for this project.");
      }

      const normalized = computeSectionDurations(script, this.config.SPEECH_WORDS_PER_MINUTE);
      const existing = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?").get(projectId) as ScriptRow | undefined;
      const changed = !existing || scriptContentHash(ScriptSchema.parse(JSON.parse(existing.data) as unknown)) !== scriptContentHash(normalized);
      const version = (existing?.version ?? 0) + (changed ? 1 : 0);
      const origin = existing?.origin ?? "USER";
      const edited = origin === "AGENT" ? true : Boolean(existing?.edited);
      const research = this.sqlite.prepare("SELECT input_hash FROM research_notes WHERE project_id = ?")
        .get(projectId) as { input_hash: string } | undefined;
      const researchMode = storyModeForProject(project);
      const currentResearchHash = researchMode !== "off" ? research?.input_hash : undefined;
      const inputHash = scriptInputHash(project, currentResearchHash);
      const updatedAt = new Date().toISOString();
      this.sqlite.prepare(
        "INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call, review_notes, quality_score, blocking_facts, revise_round) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, false, NULL, NULL, 0, 0) ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, origin = excluded.origin, edited = excluded.edited, input_hash = excluded.input_hash, version = excluded.version, provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at, merged_call = false, review_notes = NULL, quality_score = NULL, blocking_facts = 0, revise_round = 0",
      ).run(
        projectId,
        JSON.stringify(normalized),
        origin,
        edited ? 1 : 0,
        inputHash,
        version,
        existing?.provider ?? null,
        existing?.model ?? null,
        updatedAt,
      );
      enqueueIndex(this.sqlite,{scope:"source",kind:"script",sourceId:projectId});
      rememberTreatment(this.sqlite, project, normalized);

      const scriptStage = this.repository.getStage(projectId, "SCRIPT");
      if (scriptStage.state !== "DONE") {
        this.orchestrator.completeByUser(projectId, "SCRIPT", { skip: ["RESEARCH"] });
      } else if (changed) {
        markStaleFrom(this.repository, projectId, "SCRIPT");
      }
      return this.get(projectId);
    });
  }

  saveResearch(projectId: string, input: unknown): ScriptData {
    const research = StoredResearchNotesSchema.parse(input);
    return this.repository.atomic(() => {
      const project = this.repository.getProject(projectId);
      if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
      if (this.repository.getActiveJob(projectId)) {
        throw new AppError(409, "INVALID_PIPELINE_STATE", "A job is already active for this project.");
      }

      const previous = this.sqlite.prepare("SELECT data FROM research_notes WHERE project_id = ?")
        .get(projectId) as { data: string } | undefined;
      const changed = !previous || JSON.stringify(StoredResearchNotesSchema.parse(JSON.parse(previous.data) as unknown)) !== JSON.stringify(research);
      this.sqlite.prepare(
        "INSERT INTO research_notes (project_id, input_hash, provider, model, cached, created_at, data) VALUES (?, ?, 'user', 'user', false, ?, ?) ON CONFLICT(project_id) DO UPDATE SET input_hash = excluded.input_hash, provider = excluded.provider, model = excluded.model, cached = false, created_at = excluded.created_at, data = excluded.data",
      ).run(
        projectId,
        researchInputHash(project),
        new Date().toISOString(),
        JSON.stringify(research),
      );
      enqueueIndex(this.sqlite,{scope:"source",kind:"research",sourceId:projectId});
      this.orchestrator.completeByUser(projectId, "RESEARCH", { invalidate: changed });
      return this.get(projectId);
    });
  }

  /** TASK-146: the user edits a parked outline's central question and beat concrete moments. Only the outline JSON and updated_at change. */
  editOutline(projectId: string, edit: OutlineEdit): ScriptData {
    return this.repository.atomic(() => {
      const project = this.repository.getProject(projectId);
      if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
      if (this.repository.getActiveJob(projectId)) {
        throw new AppError(409, "INVALID_PIPELINE_STATE", "A job is already active for this project.");
      }
      const draftRow = this.sqlite.prepare("SELECT outline, phase FROM script_drafts WHERE project_id = ?")
        .get(projectId) as { outline: string | null; phase: string | null } | undefined;
      const stage = this.repository.getStage(projectId, "SCRIPT");
      if (stage.state !== "WAITING_USER" || draftRow?.phase !== "outline_ready" || !draftRow.outline) {
        throw new AppError(409, "INVALID_PIPELINE_STATE", "The outline is not waiting for approval.");
      }
      const outline = StoryOutlineSchema.parse(JSON.parse(draftRow.outline));
      const patched: StoryOutline = { ...outline };
      if (edit.centralQuestion !== undefined) patched.centralQuestion = edit.centralQuestion;
      if (edit.beats) {
        for (const beat of edit.beats) {
          if (!outline.beats.some((b) => b.id === beat.id)) {
            throw new AppError(404, "BEAT_NOT_FOUND", `Beat "${beat.id}" not found`);
          }
        }
        const replacements = new Map(edit.beats.map((b) => [b.id, b.concreteMoment]));
        patched.beats = outline.beats.map((b) => (replacements.has(b.id) ? { ...b, concreteMoment: replacements.get(b.id)! } : b));
      }
      const checked = StoryOutlineSchema.parse(patched);
      const changes = this.sqlite.prepare("UPDATE script_drafts SET outline = ?, updated_at = ? WHERE project_id = ? AND phase = 'outline_ready'")
        .run(JSON.stringify(checked), new Date().toISOString(), projectId).changes;
      if (changes !== 1) {
        throw new AppError(409, "INVALID_PIPELINE_STATE", "The outline is not waiting for approval.");
      }
      return this.get(projectId);
    });
  }

  async switchHook(projectId: string, hookId: string): Promise<ScriptData> {
    const project = this.repository.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    if (this.repository.getActiveJob(projectId)) {
      throw new AppError(409, "INVALID_PIPELINE_STATE", "A job is already active for this project.");
    }
    const scriptRow = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?").get(projectId) as ScriptRow | undefined;
    if (!scriptRow) throw new AppError(404, "SCRIPT_NOT_FOUND", "Script not found");
    const draftRow = this.sqlite.prepare("SELECT * FROM script_drafts WHERE project_id = ?").get(projectId) as {
      project_id: string;
      outline: string | null;
      hook_candidates: string | null;
      critique: string | null;
      critique_history: string | null;
      engine_mode: string;
      input_hash: string;
      updated_at: string;
      phase: string | null;
    } | undefined;
    if (!draftRow || !draftRow.hook_candidates) throw new AppError(404, "DRAFT_NOT_FOUND", "Draft not found");
    // TASK-146: while an outline awaits approval (or is approved and not yet finished), a hook switch would rewrite the draft hash and break the resume.
    if (isOutlinePending(draftRow.phase)) throw new AppError(409, "OUTLINE_PENDING", "The outline is awaiting approval; hooks cannot be switched yet");

    let candidates: HookCandidate[] = [];
    let existingAssessments: HookAssessment[] | undefined = undefined;
    try {
      const parsed = JSON.parse(draftRow.hook_candidates);
      if (Array.isArray(parsed)) {
        candidates = z.array(HookCandidateSchema).parse(parsed);
      } else if (parsed && typeof parsed === "object") {
        candidates = z.array(HookCandidateSchema).parse(parsed.candidates ?? []);
        existingAssessments = parsed.hookAssessments;
      }
    } catch {
      throw new AppError(404, "DRAFT_NOT_FOUND", "Draft hook candidates malformed");
    }

    const candidate = candidates.find((c) => c.id === hookId);
    if (!candidate) throw new AppError(404, "HOOK_NOT_FOUND", `Hook candidate "${hookId}" not found`);

    const currentScript = ScriptSchema.parse(JSON.parse(scriptRow.data));
    const firstSection = currentScript.sections[0];
    if (!firstSection) throw new AppError(400, "INVALID_SCRIPT", "Script has no sections");

    const originalVersion = scriptRow.version ?? 0;
    const originalHash = scriptContentHash(currentScript);

    let newHook = candidate.text;
    // The paid switch call; recorded only when the commit lands, or as FAILED when a concurrent edit discards it.
    let paidCall = null as { provider: string; model: string; usage: { inputTokens: number; outputTokens: number; calls?: any[] } } | null;
    let newSection1Narration = firstSection.narration;

    if (this.registry) {
      const appRouting = getAppLlmSettings(this.sqlite);
      const route = this.registry.resolveTask("scriptRewrite", project, appRouting);
      const HookSwitchSchema = z.object({
        hook: z.string().min(1),
        revisedSectionNarration: z.string().min(1),
      }).strict();

      try {
        const rewritten = await generateRoutedStructured<z.infer<typeof HookSwitchSchema>>({
          registry: this.registry,
          route,
          task: "scriptRewrite",
          knowledgeProject: project,
          knowledgeQuery: project.topic,
          system: [
            "You are a video script editor. The creator selected an alternate hook for this video.",
            "Update the hook to the chosen text, and rewrite the opening sentence of Section 1 so it smoothly connects from this new hook.",
            "Keep all facts and section structure intact.",
            narrationRulesBlock(),
          ].join("\n\n"),
          prompt: JSON.stringify({
            chosenHook: candidate.text,
            firstSectionHeading: firstSection.heading,
            firstSectionNarration: firstSection.narration,
            topic: project.topic,
            language: project.settings.language,
          }, null, 2),
          schema: HookSwitchSchema,
          schemaName: "HookSwitchRewrite",
          schemaVersion: "1",
          maxOutputTokens: 1000,
          repairAttempts: 1,
          signal: AbortSignal.timeout(60_000),
          cache: this.cache,
          cacheKeyExtra: `switchHook:${hookId}:${originalHash}`,
        });

        // Enforce strict first sentence boundary: all remaining sentences stay byte-identical!
        newSection1Narration = isolateFirstSentence(firstSection.narration, rewritten.value.revisedSectionNarration);

        paidCall = { provider: rewritten.provider, model: rewritten.model, usage: rewritten.usage };
      } catch (error) {
        if (error instanceof LlmError && error.usage) {
          this.recordJob({
            projectId,
            scope: "switchHook",
            status: "FAILED",
            message: "Switch hook call failed",
            provider: route.provider.id,
            model: route.model,
            usage: error.usage,
            error,
          });
        }
        // Fallback: candidate text, keep narration unchanged
        newHook = candidate.text;
      }
    }

    const updatedSections = currentScript.sections.map((sec, idx) => {
      if (idx === 0) {
        return {
          ...sec,
          narration: newSection1Narration,
        };
      }
      return sec; // All other sections strictly preserved byte-for-byte!
    });

    const nextScript: Script = {
      ...currentScript,
      hook: newHook,
      sections: updatedSections,
    };
    const normalized = computeSectionDurations(nextScript, this.config.SPEECH_WORDS_PER_MINUTE);

    try {
    return this.repository.atomic(() => {
      const latest = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?").get(projectId) as ScriptRow | undefined;
      if (!latest || latest.version !== originalVersion || scriptContentHash(JSON.parse(latest.data)) !== originalHash) {
        throw new AppError(409, "CONCURRENT_MODIFICATION", "Script was modified concurrently during hook switch");
      }
      // Approval can land during the paid call above, so the phase is checked again inside the transaction.
      const latestDraft = this.sqlite.prepare("SELECT phase FROM script_drafts WHERE project_id = ?").get(projectId) as { phase: string | null } | undefined;
      if (isOutlinePending(latestDraft?.phase)) throw new AppError(409, "OUTLINE_PENDING", "The outline is awaiting approval; hooks cannot be switched yet");

      const version = originalVersion + 1;
      const research = this.sqlite.prepare("SELECT input_hash FROM research_notes WHERE project_id = ?").get(projectId) as { input_hash: string } | undefined;
      const researchMode = storyModeForProject(project);
      const currentResearchHash = researchMode !== "off" ? research?.input_hash : undefined;
      const inputHash = scriptInputHash(project, currentResearchHash);
      const now = new Date().toISOString();
      const contentHash = scriptContentHash(normalized);

      this.sqlite.prepare(
        "UPDATE scripts SET data = ?, origin = 'AGENT', edited = 0, input_hash = ?, version = ?, updated_at = ? WHERE project_id = ?",
      ).run(
        JSON.stringify(normalized),
        inputHash,
        version,
        now,
        projectId,
      );

      this.sqlite.prepare(
        "UPDATE script_drafts SET hook_candidates = ?, input_hash = ?, updated_at = ? WHERE project_id = ?",
      ).run(
        JSON.stringify({
          candidates,
          chosenHookId: hookId,
          hookAssessments: existingAssessments,
        }),
        contentHash,
        now,
        projectId,
      );

      enqueueIndex(this.sqlite, { scope: "source", kind: "script", sourceId: projectId });
      rememberTreatment(this.sqlite, project, normalized);

      const scriptStage = this.repository.getStage(projectId, "SCRIPT");
      if (scriptStage.state === "DONE") {
        markStaleFrom(this.repository, projectId, "SCRIPT");
      }
      if (paidCall) {
        this.recordJob({ projectId, scope: "switchHook", status: "SUCCEEDED", message: "Switch hook completed", provider: paidCall.provider, model: paidCall.model, usage: paidCall.usage });
      }
      return this.get(projectId);
    });
    } catch (error) {
      // The LLM call was paid for even when the commit is discarded; keep its usage visible.
      if (paidCall && error instanceof AppError && (error.code === "CONCURRENT_MODIFICATION" || error.code === "OUTLINE_PENDING")) {
        const message = error.code === "OUTLINE_PENDING"
          ? "Switch hook discarded: outline awaiting approval"
          : "Switch hook discarded: script changed during the call";
        this.recordJob({ projectId, scope: "switchHook", status: "FAILED", message, provider: paidCall.provider, model: paidCall.model, usage: paidCall.usage, error });
      }
      throw error;
    }
  }

  async rescoreCritique(projectId: string, expectedVersion?: number): Promise<ScriptData> {
    const project = this.repository.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    if (this.repository.getActiveJob(projectId)) {
      throw new AppError(409, "INVALID_PIPELINE_STATE", "A job is already active for this project.");
    }
    const scriptRow = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?").get(projectId) as ScriptRow | undefined;
    if (!scriptRow) throw new AppError(404, "SCRIPT_NOT_FOUND", "Script not found");

    const currentScript = ScriptSchema.parse(JSON.parse(scriptRow.data));
    const originalVersion = scriptRow.version ?? 0;
    const originalHash = scriptContentHash(currentScript);

    if (expectedVersion !== undefined && originalVersion !== expectedVersion) {
      throw new AppError(409, "CONCURRENT_MODIFICATION", "Script version mismatch");
    }

    if (!this.registry) {
      throw new AppError(503, "PROVIDER_UNAVAILABLE", "No LLM provider registry configured");
    }

    const draftRow = this.sqlite.prepare("SELECT * FROM script_drafts WHERE project_id = ?").get(projectId) as {
      project_id: string;
      outline: string | null;
      hook_candidates: string | null;
      critique: string | null;
      critique_history: string | null;
      engine_mode: string;
      input_hash: string;
      updated_at: string;
      phase: string | null;
    } | undefined;
    if (isOutlinePending(draftRow?.phase)) throw new AppError(409, "OUTLINE_PENDING", "The outline is awaiting approval; rescoring must wait");

    const researchRow = this.sqlite.prepare("SELECT data FROM research_notes WHERE project_id = ?").get(projectId) as { data: string } | undefined;
    const research = researchRow ? JSON.parse(researchRow.data) as ResearchNotes : undefined;

    const appRouting = getAppLlmSettings(this.sqlite);
    const criticRoute = this.registry.resolveTask("scriptCritic", project, appRouting);

    const critiqueSystem = [
      CRITIC_RUBRIC_SYSTEM_PROMPT,
      "Evaluate the provided video script rigorously against the 6-dimension rubric.",
      "Identify the 2-4 weakest sections and provide specific revision instructions.",
      narrationRulesBlock(),
    ].join("\n\n");

    const outline = draftRow?.outline ? JSON.parse(draftRow.outline) : undefined;
    const critiquePrompt = JSON.stringify({
      topic: project.topic,
      targetDurationSec: project.settings.targetDurationSec,
      format: project.settings.format,
      language: project.settings.language,
      outline,
      researchSummary: research?.summary,
      researchFacts: research ? researchFactsWithIds(research) : [],
      script: currentScript,
    }, null, 2);

    let evaluated: Awaited<ReturnType<typeof generateRoutedStructured<ScriptCritique>>>;
    try {
      evaluated = await generateRoutedStructured<ScriptCritique>({
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
        cacheKeyExtra: `rescore:${originalHash}`,
      });
    } catch (error) {
      if (error instanceof LlmError && error.usage) {
        this.recordJob({
          projectId,
          scope: "rescoreCritique",
          status: "FAILED",
          message: "Rescore critique failed",
          provider: criticRoute.provider.id,
          model: criticRoute.model,
          usage: error.usage,
          error,
        });
      }
      throw error;
    }

    // Always compute weighted total in code; never trust model's raw total!
    const critique = computeScriptCritique(evaluated.value);
    const qualityScore = Math.round((critique.total / 10) * 10) / 10;
    // Preserve existing blocking facts and flag if accuracy < 3
    const currentBlocking = (scriptRow as { blocking_facts?: number }).blocking_facts ?? 0;
    const blockingFacts = Math.max(currentBlocking, critique.scores.accuracy < 3 ? 1 : 0);

    let priorHistory: Array<{ round: number; total: number; scores: ScriptScores }> = [];
    if (draftRow?.critique_history) {
      try {
        priorHistory = JSON.parse(draftRow.critique_history);
      } catch {
        priorHistory = [];
      }
    }
    const updatedHistory = [
      ...priorHistory,
      { round: priorHistory.length + 1, total: critique.total, scores: critique.scores },
    ];

    const now = new Date().toISOString();
    try {
      return this.repository.atomic(() => {
      const latest = this.sqlite.prepare("SELECT * FROM scripts WHERE project_id = ?").get(projectId) as ScriptRow | undefined;
      if (!latest || latest.version !== originalVersion || scriptContentHash(JSON.parse(latest.data)) !== originalHash) {
        throw new AppError(409, "CONCURRENT_MODIFICATION", "Script was modified concurrently during rescore");
      }
      // Approval can land during the critic call above, so the phase is checked again inside the transaction.
      const latestDraft = this.sqlite.prepare("SELECT phase FROM script_drafts WHERE project_id = ?").get(projectId) as { phase: string | null } | undefined;
      if (isOutlinePending(latestDraft?.phase)) throw new AppError(409, "OUTLINE_PENDING", "The outline is awaiting approval; rescoring must wait");

      this.sqlite.prepare(
        "UPDATE scripts SET quality_score = ?, blocking_facts = ? WHERE project_id = ?",
      ).run(qualityScore, blockingFacts, projectId);

      const contentHash = scriptContentHash(currentScript);

      if (draftRow) {
        this.sqlite.prepare(
          "UPDATE script_drafts SET critique = ?, critique_history = ?, input_hash = ?, updated_at = ? WHERE project_id = ?",
        ).run(
          JSON.stringify(critique),
          JSON.stringify(updatedHistory),
          contentHash,
          now,
          projectId,
        );
      } else {
        this.sqlite.prepare(
          `INSERT INTO script_drafts (project_id, outline, hook_candidates, critique, critique_history, engine_mode, input_hash, updated_at)
           VALUES (?, NULL, ?, ?, ?, 'off', ?, ?)`,
        ).run(
          projectId,
          JSON.stringify({ candidates: [], chosenHookId: undefined }),
          JSON.stringify(critique),
          JSON.stringify(updatedHistory),
          contentHash,
          now,
        );
      }

      this.recordJob({
        projectId,
        scope: "rescoreCritique",
        status: "SUCCEEDED",
        message: "Rescore critique completed",
        provider: evaluated.provider,
        model: evaluated.model,
        usage: evaluated.usage,
      });

      return this.get(projectId);
      });
    } catch (error) {
      // The LLM call was paid for even when the commit is discarded; keep its usage visible.
      if (error instanceof AppError && (error.code === "CONCURRENT_MODIFICATION" || error.code === "OUTLINE_PENDING")) {
        this.recordJob({
          projectId,
          scope: "rescoreCritique",
          status: "FAILED",
          message: error.code === "OUTLINE_PENDING"
            ? "Rescore discarded: outline awaiting approval"
            : "Rescore discarded: script changed concurrently",
          provider: evaluated.provider,
          model: evaluated.model,
          usage: evaluated.usage,
          error,
        });
      }
      throw error;
    }
  }
}
