import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ReviewAssistantOutputSchema,
  ReviewMessageSchema,
  ReviewProposalSchema,
  STAGE_ORDER,
  VideoMetadataDraftSchema,
  estimateTextTokens,
  normalizeMetadataDraft,
  type JobUsage,
  type PipelineStage,
  type Project,
  type ReviewEstimate,
  type ReviewMessage,
  type ReviewProposal,
  type ReviewThread,
  type VideoMetadataDraft,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import type { GuidelineService } from "../guidelines/service.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import { LlmCache } from "../providers/llm/cache.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";
import type { MetadataService } from "../services/metadataService.js";
import type { MusicService } from "../services/musicService.js";
import type { SceneService } from "../services/sceneService.js";
import type { TimelineService } from "../services/timelineService.js";
import type { VisualService } from "../services/visualService.js";
import { buildReviewContext } from "./contextBuilder.js";
import { HISTORY_WINDOW, buildReviewPrompt } from "./prompt.js";
import { validateReviewOutput } from "./validate.js";

type ThreadRow = {
  id: string;
  project_id: string;
  context_hash: string;
  created_at: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  proposals: string | null;
  usage: string | null;
  created_at: string;
};

type ApplicationRow = {
  message_id: string;
  proposal_index: number;
};

export class ReviewService {
  private readonly cache: LlmCache;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly repository: JobRepository,
    private readonly config: AppConfig,
    private readonly registry: LlmProviderRegistry,
    private readonly scenes: SceneService,
    private readonly visuals: VisualService,
    private readonly music: MusicService,
    private readonly timelines: TimelineService,
    private readonly guidelines: GuidelineService,
    private readonly metadata: MetadataService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cache = new LlmCache(sqlite, config.LLM_CACHE_ENABLED);
  }

  get(project: Project, estimateText?: string): {
    thread: ReviewThread | null;
    estimate?: ReviewEstimate;
    contextHash: string;
  } {
    const context = this.buildContext(project);
    const thread = this.loadThread(project.id);
    const estimate = this.estimateTokens(context.json, estimateText ?? "");
    return { thread, estimate, contextHash: context.contextHash };
  }

  estimate(project: Project, text: string): ReviewEstimate {
    const context = this.buildContext(project);
    return this.estimateTokens(context.json, text);
  }

  getContextDocument(project: Project) {
    return this.buildContext(project);
  }

  async send(project: Project, text: string, options: {
    attachImages?: boolean;
    signal?: AbortSignal;
    logger?: FastifyBaseLogger;
  } = {}): Promise<ReviewMessage> {
    // TODO(TASK-004G): attachImages is accepted but ignored until vision adapters exist.
    void options.attachImages;

    if (this.repository.getActiveJob(project.id)) {
      throw new AppError(409, "INVALID_PIPELINE_STATE", "Đang có tiến trình chạy, thử lại sau.");
    }

    const applied = this.listAppliedProposals(project.id);
    const context = this.buildContext(project, applied);
    let thread = this.ensureThread(project.id, context.contextHash);
    const history = this.loadMessages(thread.id);
    const { system, prompt } = buildReviewPrompt({
      project,
      context,
      history,
      appliedProposals: applied,
      userText: text,
    });

    const appRouting = getAppLlmSettings(this.sqlite);
    const route = this.registry.resolveTask("reviewChat", project, appRouting);
    let generated;
    try {
      generated = await generateRoutedStructured({
        registry: this.registry,
        route,
        task: "reviewChat",
        system,
        prompt,
        schema: ReviewAssistantOutputSchema,
        schemaName: "ReviewAssistant",
        schemaVersion: "1",
        maxOutputTokens: 4096,
        repairAttempts: 1,
        signal: options.signal ?? new AbortController().signal,
        cache: this.cache,
        cacheKeyExtra: context.contextHash,
        logger: options.logger,
      });
    } catch (error) {
      if (error instanceof LlmError) {
        throw new AppError(502, error.code, error.message, { retryable: error.retryable });
      }
      throw error;
    }

    const sceneIds = new Set(context.document.scenes.map((scene) => scene.id));
    const validated = validateReviewOutput(generated.value, {
      sceneIds,
      sceneCount: context.document.scenes.length,
    });

    const costUsd = estimateLlmCost(this.config, generated.provider, generated.model, generated.usage);
    const usagePayload = {
      inputTokens: generated.usage.inputTokens,
      outputTokens: generated.usage.outputTokens,
      costUsd,
      provider: generated.provider,
      model: generated.model,
      cached: generated.cached === true,
    };

    const now = this.now().toISOString();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();

    this.sqlite.transaction(() => {
      this.sqlite.prepare(
        `INSERT INTO review_messages (id, thread_id, project_id, role, content, proposals, usage, created_at)
         VALUES (?, ?, ?, 'user', ?, NULL, NULL, ?)`,
      ).run(userMessageId, thread.id, project.id, text, now);
      this.sqlite.prepare(
        `INSERT INTO review_messages (id, thread_id, project_id, role, content, proposals, usage, created_at)
         VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)`,
      ).run(
        assistantMessageId,
        thread.id,
        project.id,
        validated.reply,
        JSON.stringify(validated.proposals),
        JSON.stringify(usagePayload),
        now,
      );
      this.recordUsageJob(project.id, {
        llmCalls: generated.usage.llmCalls,
        inputTokens: generated.usage.inputTokens,
        outputTokens: generated.usage.outputTokens,
        costUsd,
        provider: generated.provider,
        model: generated.model,
        ...(generated.usage.tokensUnknown ? { tokensUnknown: true } : {}),
        features: { reviewChat: generated.usage.llmCalls },
        calls: generated.usage.calls,
      });
    })();

    return this.toMessage(
      this.sqlite.prepare("SELECT * FROM review_messages WHERE id = ?").get(assistantMessageId) as MessageRow,
      [],
    );
  }

  async applyProposal(
    project: Project,
    messageId: string,
    index: number,
  ): Promise<{ result: unknown; staleStages: PipelineStage[] }> {
    const message = this.sqlite.prepare(
      "SELECT * FROM review_messages WHERE id = ? AND project_id = ?",
    ).get(messageId, project.id) as MessageRow | undefined;
    if (!message || message.role !== "assistant") {
      throw new AppError(404, "REVIEW_MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn đề xuất.");
    }
    const proposals = parseProposals(message.proposals);
    const proposal = proposals[index];
    if (!proposal) throw new AppError(404, "REVIEW_PROPOSAL_NOT_FOUND", "Không tìm thấy đề xuất.");

    const existing = this.sqlite.prepare(
      "SELECT 1 AS ok FROM review_proposal_applications WHERE message_id = ? AND proposal_index = ?",
    ).get(messageId, index) as { ok: number } | undefined;
    if (existing) {
      throw new AppError(409, "ALREADY_APPLIED", "Đề xuất này đã được áp dụng.");
    }

    if (this.repository.getActiveJob(project.id)) {
      throw new AppError(409, "INVALID_PIPELINE_STATE", "Đang có tiến trình chạy, thử lại sau.");
    }

    const before = this.snapshotStageStates(project.id);
    const result = await this.dispatch(project, proposal);
    const staleStages = this.diffStaleStages(project.id, before);

    this.sqlite.prepare(
      `INSERT INTO review_proposal_applications (id, message_id, project_id, proposal_index, result, applied_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      messageId,
      project.id,
      index,
      JSON.stringify({ type: proposal.type, staleStages }),
      this.now().toISOString(),
    );

    return { result, staleStages };
  }

  /** Apply a raw proposal (MCP) without a stored assistant message. */
  async applyRawProposal(
    project: Project,
    proposalInput: unknown,
  ): Promise<{ result: unknown; staleStages: PipelineStage[] }> {
    const proposal = ReviewProposalSchema.parse(proposalInput);
    const context = this.buildContext(project);
    const validated = validateReviewOutput(
      { reply: "ok", proposals: [proposal] },
      {
        sceneIds: new Set(context.document.scenes.map((scene) => scene.id)),
        sceneCount: context.document.scenes.length,
      },
    );
    if (validated.proposals.length === 0) {
      throw new AppError(400, "INVALID_PROPOSAL", validated.droppedNotes.join("; ") || "Đề xuất không hợp lệ.");
    }
    if (this.repository.getActiveJob(project.id)) {
      throw new AppError(409, "INVALID_PIPELINE_STATE", "Đang có tiến trình chạy, thử lại sau.");
    }
    const before = this.snapshotStageStates(project.id);
    const result = await this.dispatch(project, validated.proposals[0]!);
    return { result, staleStages: this.diffStaleStages(project.id, before) };
  }

  reset(project: Project): void {
    const threads = this.sqlite.prepare(
      "SELECT id FROM review_threads WHERE project_id = ?",
    ).all(project.id) as Array<{ id: string }>;
    this.sqlite.transaction(() => {
      for (const thread of threads) {
        this.sqlite.prepare("DELETE FROM review_messages WHERE thread_id = ?").run(thread.id);
        this.sqlite.prepare("DELETE FROM review_threads WHERE id = ?").run(thread.id);
      }
      this.sqlite.prepare("DELETE FROM review_proposal_applications WHERE project_id = ?").run(project.id);
    })();
  }

  private async dispatch(project: Project, proposal: ReviewProposal): Promise<unknown> {
    switch (proposal.type) {
      case "EDIT_NARRATION":
        return this.scenes.patch(project.id, proposal.sceneId, { narration: proposal.text }, { staleFrom: "VISUAL_REVIEW" });
      case "EDIT_DURATION":
        return this.scenes.patch(
          project.id,
          proposal.sceneId,
          { durationOverrideSec: proposal.durationSec },
          { staleFrom: "MUSIC_REVIEW" },
        );
      case "EDIT_VISUAL_QUERY": {
        this.visuals.patchSceneVisualQuery(project.id, proposal.sceneId, {
          visualQueries: { primary: proposal.query, alternatives: [] },
        });
        const searched = await this.visuals.searchScene(project.id, proposal.sceneId, proposal.query);
        markStaleFrom(this.repository, project.id, "VISUAL_SEARCH");
        return searched;
      }
      case "SET_MOTION":
        return this.visuals.setSelectionMotion(project.id, proposal.sceneId, proposal.slot, proposal.motion);
      case "MUSIC_MIX": {
        const result = this.music.updateSettings(project, {
          ...(proposal.volume === undefined ? {} : { volume: proposal.volume }),
          ...(proposal.duckingDb === undefined ? {} : { duckingDb: proposal.duckingDb }),
          ...(proposal.fadeInSec === undefined ? {} : { fadeInSec: proposal.fadeInSec }),
          ...(proposal.fadeOutSec === undefined ? {} : { fadeOutSec: proposal.fadeOutSec }),
        });
        markStaleFrom(this.repository, project.id, "MUSIC_REVIEW");
        return result;
      }
      case "MUSIC_QUERY": {
        this.music.updateSettings(project, { query: proposal.query });
        const searched = await this.music.search(project, { force: true });
        markStaleFrom(this.repository, project.id, "MUSIC_REVIEW");
        return searched;
      }
      case "REORDER_SCENES":
        return this.scenes.reorder(project.id, proposal.sceneIds, { staleFrom: "MUSIC_REVIEW" });
      case "EDIT_METADATA": {
        const current = this.metadata.get(project);
        if (!current.metadata) {
          throw new AppError(404, "METADATA_NOT_FOUND", "Chưa có metadata để sửa. Hãy tạo trước.");
        }
        const base = current.metadata.edited ?? current.metadata.draft;
        const next: VideoMetadataDraft = normalizeMetadataDraft({
          titles: proposal.title ? [proposal.title, ...base.titles.filter((title) => title !== proposal.title)].slice(0, 3) : base.titles,
          description: proposal.description ?? base.description,
          tags: proposal.tags ?? base.tags,
          hashtags: base.hashtags,
          thumbnailText: base.thumbnailText,
        });
        VideoMetadataDraftSchema.parse(next);
        return this.metadata.saveEdits(project, next);
      }
      case "NOTE":
        throw new AppError(400, "NOTE_NOT_APPLIABLE", "Đề xuất NOTE chỉ là lời khuyên, không áp dụng được.");
      default: {
        const _exhaustive: never = proposal;
        throw new AppError(400, "UNKNOWN_PROPOSAL", `Loại đề xuất không hỗ trợ: ${String((_exhaustive as ReviewProposal).type)}`);
      }
    }
  }

  private buildContext(project: Project, appliedProposals?: ReviewProposal[]) {
    return buildReviewContext({
      project,
      scenes: this.scenes,
      visuals: this.visuals,
      music: this.music,
      timelines: this.timelines,
      guidelines: this.guidelines,
      appliedProposals,
    });
  }

  private estimateTokens(contextJson: string, userText: string): ReviewEstimate {
    const inputTokens = estimateTextTokens(`${contextJson}\n${userText}`, true);
    const outputTokens = 800;
    return { inputTokens, outputTokens };
  }

  private ensureThread(projectId: string, contextHash: string): ThreadRow {
    const existing = this.sqlite.prepare(
      "SELECT * FROM review_threads WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(projectId) as ThreadRow | undefined;
    if (existing) {
      if (existing.context_hash !== contextHash) {
        this.sqlite.prepare("UPDATE review_threads SET context_hash = ? WHERE id = ?")
          .run(contextHash, existing.id);
        return { ...existing, context_hash: contextHash };
      }
      return existing;
    }
    const row: ThreadRow = {
      id: randomUUID(),
      project_id: projectId,
      context_hash: contextHash,
      created_at: this.now().toISOString(),
    };
    this.sqlite.prepare(
      "INSERT INTO review_threads (id, project_id, context_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run(row.id, row.project_id, row.context_hash, row.created_at);
    return row;
  }

  private loadThread(projectId: string): ReviewThread | null {
    const row = this.sqlite.prepare(
      "SELECT * FROM review_threads WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(projectId) as ThreadRow | undefined;
    if (!row) return null;
    const messages = this.loadMessages(row.id);
    return {
      id: row.id,
      projectId: row.project_id,
      contextHash: row.context_hash,
      createdAt: row.created_at,
      messages,
    };
  }

  private loadMessages(threadId: string): ReviewMessage[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM review_messages WHERE thread_id = ? ORDER BY created_at ASC",
    ).all(threadId) as MessageRow[];
    const applications = rows.length === 0
      ? []
      : this.sqlite.prepare(
        `SELECT message_id, proposal_index FROM review_proposal_applications
         WHERE message_id IN (${rows.map(() => "?").join(",")})`,
      ).all(...rows.map((row) => row.id)) as ApplicationRow[];
    const byMessage = new Map<string, number[]>();
    for (const application of applications) {
      const list = byMessage.get(application.message_id) ?? [];
      list.push(application.proposal_index);
      byMessage.set(application.message_id, list);
    }
    return rows.map((row) => this.toMessage(row, byMessage.get(row.id) ?? []));
  }

  private listAppliedProposals(projectId: string): ReviewProposal[] {
    const rows = this.sqlite.prepare(
      `SELECT m.proposals AS proposals, a.proposal_index AS proposal_index
       FROM review_proposal_applications a
       JOIN review_messages m ON m.id = a.message_id
       WHERE a.project_id = ?
       ORDER BY a.applied_at ASC`,
    ).all(projectId) as Array<{ proposals: string | null; proposal_index: number }>;
    const out: ReviewProposal[] = [];
    for (const row of rows) {
      const proposals = parseProposals(row.proposals);
      const proposal = proposals[row.proposal_index];
      if (proposal) out.push(proposal);
    }
    return out;
  }

  private toMessage(row: MessageRow, appliedIndexes: number[]): ReviewMessage {
    return ReviewMessageSchema.parse({
      id: row.id,
      threadId: row.thread_id,
      role: row.role,
      content: row.content,
      proposals: row.proposals ? parseProposals(row.proposals) : null,
      appliedIndexes,
      usage: row.usage ? JSON.parse(row.usage) : null,
      createdAt: row.created_at,
    });
  }

  private recordUsageJob(projectId: string, usage: JobUsage): void {
    const now = this.now().toISOString();
    const id = randomUUID();
    this.sqlite.prepare(
      `INSERT INTO jobs (
         id, project_id, stage, scope, status, progress, message, attempt, max_attempts,
         error, usage, created_at, started_at, finished_at, run_after, previous_state
       ) VALUES (?, ?, 'FINAL_APPROVAL', 'reviewChat', 'SUCCEEDED', 100, 'Review chat', 1, 1,
         NULL, ?, ?, ?, ?, ?, 'WAITING_USER')`,
    ).run(id, projectId, JSON.stringify(usage), now, now, now, now);
  }

  private snapshotStageStates(projectId: string): Map<PipelineStage, string> {
    const map = new Map<PipelineStage, string>();
    for (const stage of STAGE_ORDER) {
      map.set(stage, this.repository.getStage(projectId, stage).state);
    }
    return map;
  }

  private diffStaleStages(projectId: string, before: Map<PipelineStage, string>): PipelineStage[] {
    return STAGE_ORDER.filter((stage) => {
      const previous = before.get(stage);
      const current = this.repository.getStage(projectId, stage).state;
      return previous !== "STALE" && current === "STALE";
    });
  }
}

function parseProposals(raw: string | null): ReviewProposal[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const result = ReviewProposalSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export { HISTORY_WINDOW };
