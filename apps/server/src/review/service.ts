import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  ReviewAssistantOutputSchema,
  ReviewMessageSchema,
  ReviewProposalSchema,
  STAGE_ORDER,
  VideoMetadataDraftSchema,
  applyTimelineProposal,
  estimateTextTokens,
  normalizeMetadataDraft,
  proposalEditsTimeline,
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
import type { LlmImageAttachment } from "../providers/llm/types.js";
import { LlmError } from "../providers/llm/types.js";
import type { MetadataService } from "../services/metadataService.js";
import type { MusicService } from "../services/musicService.js";
import type { SceneService } from "../services/sceneService.js";
import type { TimelineService } from "../services/timelineService.js";
import type { VisualService } from "../services/visualService.js";
import { projectDir, resolveAssetPath } from "../storage/paths.js";
import { visionSourceProblem } from "../services/visionSource.js";
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
    const images = options.attachImages ? this.selectedSceneImages(project.id) : [];
    if (images.length && !route.provider.capabilities?.vision) {
      throw new AppError(
        422,
        "VISION_PROVIDER_REQUIRED",
        "Đính kèm ảnh cần route vision. Vào Cài đặt → Mô hình AI hoặc tắt đính kèm ảnh.",
      );
    }
    let generated;
    try {
      generated = await generateRoutedStructured({
        registry: this.registry,
        route,
        task: "reviewChat",
          knowledgeProject: project,
        knowledgeQuery: text,
        system,
        prompt,
        schema: ReviewAssistantOutputSchema,
        schemaName: "ReviewAssistant",
        schemaVersion: "1",
        maxOutputTokens: 4096,
        repairAttempts: 1,
        signal: options.signal ?? new AbortController().signal,
        cache: this.cache,
        cacheKeyExtra: `${context.contextHash}|imgs:${images.map((image) => image.label).join(",")}`,
        logger: options.logger,
        ...(images.length ? {
          images,
          visionCacheDir: join(projectDir(this.config.DATA_DIR, project.id), "vision-cache"),
        } : {}),
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
      graphicIds: new Set(context.document.timeline.graphics.map((graphic) => graphic.id)),
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
    const result = await this.dispatch(project, proposal, "chat");
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
    source: "assistant" | "mcp" = "mcp",
  ): Promise<{ result: unknown; staleStages: PipelineStage[] }> {
    const proposal = ReviewProposalSchema.parse(proposalInput);
    const context = this.buildContext(project);
    const validated = validateReviewOutput(
      { reply: "ok", proposals: [proposal] },
      {
        sceneIds: new Set(context.document.scenes.map((scene) => scene.id)),
        sceneCount: context.document.scenes.length,
        graphicIds: new Set(context.document.timeline.graphics.map((graphic) => graphic.id)),
      },
    );
    if (validated.proposals.length === 0) {
      throw new AppError(400, "INVALID_PROPOSAL", validated.droppedNotes.join("; ") || "Đề xuất không hợp lệ.");
    }
    if (this.repository.getActiveJob(project.id)) {
      throw new AppError(409, "INVALID_PIPELINE_STATE", "Đang có tiến trình chạy, thử lại sau.");
    }
    const before = this.snapshotStageStates(project.id);
    const result = await this.dispatch(project, validated.proposals[0]!, source);
    return { result, staleStages: this.diffStaleStages(project.id, before) };
  }

  async undoTimeline(projectId: string): Promise<{ result: unknown; staleStages: PipelineStage[] }> {
    if (this.repository.getActiveJob(projectId)) {
      throw new AppError(409, "INVALID_PIPELINE_STATE", "Đang có tiến trình chạy, thử lại sau.");
    }
    const before = this.snapshotStageStates(projectId);
    const result = this.timelines.undo(projectId);
    if (!result) throw new AppError(404, "NOTHING_TO_UNDO", "Không còn bản để hoàn tác.");
    markStaleFrom(this.repository, projectId, "TIMELINE");
    return { result, staleStages: this.diffStaleStages(projectId, before) };
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

  private splitSceneRow(projectId: string, sceneId: string, bornId: string, atWordIndex: number): void {
    const row = this.sqlite.prepare("SELECT * FROM scenes WHERE id = ? AND project_id = ?").get(sceneId, projectId) as Record<string, unknown> | undefined;
    if (!row) return;
    const words = String(row.narration ?? "").split(/\s+/).filter(Boolean);
    const cut = Math.min(Math.max(1, atWordIndex), Math.max(1, words.length - 1));
    const left = words.slice(0, cut).join(" ") || String(row.narration ?? "");
    const right = words.slice(cut).join(" ") || left;
    const now = new Date().toISOString();
    const order = Number(row.order);
    this.sqlite.prepare("UPDATE scenes SET \"order\" = \"order\" + 1, updated_at = ? WHERE project_id = ? AND \"order\" > ?")
      .run(now, projectId, order);
    this.sqlite.prepare("UPDATE scenes SET narration = ?, updated_at = ? WHERE id = ?").run(left, now, sceneId);
    this.sqlite.prepare(
      `INSERT INTO scenes (
        id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_description, no_visual,
        visual_queries, music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note,
        origin, edited, input_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run(
      bornId,
      projectId,
      order + 1,
      row.kind,
      row.section_id,
      `${row.label} (2)`,
      right,
      row.visual_notes,
      row.visual_description,
      row.no_visual ? 1 : 0,
      typeof row.visual_queries === "string" ? row.visual_queries : JSON.stringify(row.visual_queries ?? { primary: "", alternatives: [] }),
      row.music_mood,
      row.energy,
      Number(row.est_duration_sec) / 2,
      null,
      Number(row.start_sec) + Number(row.est_duration_sec) / 2,
      row.transition_note,
      row.origin,
      row.input_hash,
      now,
      now,
    );
  }

  private async dispatch(project: Project, proposal: ReviewProposal, source: "chat" | "assistant" | "mcp"): Promise<unknown> {
    if (proposalEditsTimeline(proposal)) {
      const current = this.timelines.get(project.id).timeline;
      if (!current) throw new AppError(404, "TIMELINE_MISSING", "Chưa có timeline.");
      const applied = applyTimelineProposal(current, proposal);
      if ("error" in applied) {
        throw new AppError(
          applied.error.startsWith("Timeline đã thay đổi") ? 409 : 400,
          applied.error.startsWith("Timeline đã thay đổi") ? "TIMELINE_CHANGED" : "INVALID_PROPOSAL",
          applied.error,
        );
      }
      const saved = this.timelines.writeEdited(project.id, applied.timeline, source, proposal.type);
      if (proposal.type === "DELETE_SCENE") {
        this.sqlite.prepare("DELETE FROM scenes WHERE id = ? AND project_id = ?").run(proposal.sceneId, project.id);
      }
      if (proposal.type === "REGENERATE_SCENE_VOICE") {
        this.sqlite.prepare("DELETE FROM voice_tracks WHERE scene_id = ? AND project_id = ?").run(proposal.sceneId, project.id);
      }
      if (proposal.type === "SPLIT_SCENE" && applied.bornSceneId) {
        this.splitSceneRow(project.id, proposal.sceneId, applied.bornSceneId, proposal.atWordIndex);
      }
      markStaleFrom(this.repository, project.id, proposal.type === "REGENERATE_SCENE_VOICE" ? "VOICE" : "TIMELINE");
      return saved;
    }
    switch (proposal.type) {
      case "EDIT_NARRATION": {
        const saved = this.scenes.patch(project.id, proposal.sceneId, { narration: proposal.text }, { staleFrom: "VOICE" });
        const voice = this.repository.getStage(project.id, "VOICE");
        if (voice.state === "DONE") {
          this.repository.updateStage(project.id, "VOICE", {
            state: "STALE",
            progress: 0,
            message: null,
            jobId: null,
            error: null,
          });
        }
        return saved;
      }
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
      case "SET_TRANSITION":
      case "SET_EMPHASIS":
      case "REMOVE_EMPHASIS":
      case "ADD_GRAPHIC":
      case "EDIT_GRAPHIC":
      case "REMOVE_GRAPHIC":
      case "SET_SUBTITLE_STYLE":
      case "DELETE_SCENE":
      case "SPLIT_SCENE":
      case "REGENERATE_SCENE_VOICE":
        throw new AppError(500, "INTERNAL", proposal.type);
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

  private selectedSceneImages(projectId: string): LlmImageAttachment[] {
    const visuals = this.visuals.getProjectVisuals(projectId);
    const images: LlmImageAttachment[] = [];
    const maxImages = 10;
    for (const scene of visuals.scenes) {
      if (images.length >= maxImages) break;
      const candidate = scene.selectedCandidate;
      if (!candidate?.localPath) continue;
      let path: string;
      try {
        path = resolveAssetPath(this.config.DATA_DIR, projectId, candidate.localPath);
      } catch {
        continue;
      }
      if (!existsSync(path)) continue;
      if (visionSourceProblem(readFileSync(path))) continue;
      images.push({ path, label: scene.sceneId });
    }
    return images;
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
