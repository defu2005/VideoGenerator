import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  AssistantConversationSchema,
  AssistantMessageContentSchema,
  AssistantMessageSchema,
  AssistantPendingActionSchema,
  AssistantSettingsSchema,
  AssistantSettingsUpdateSchema,
  type AssistantChannel,
  type AssistantConversation,
  type AssistantMessage,
  type AssistantPendingAction,
  type AssistantSendResponse,
  type AssistantSettings,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppDatabase } from "../db/client.js";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import type { AutomationService } from "../services/automationService.js";
import type { ProfileService } from "../services/profileService.js";
import type { ProjectService } from "../services/projectService.js";
import type { TopicService } from "../services/topicService.js";
import type { UsageService } from "../services/usageService.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { PublishService } from "../publishing/publishService.js";
import type { SceneService } from "../services/sceneService.js";
import type { AnalyticsSyncService } from "../analytics/syncService.js";
import type { FinanceService } from "../finance/financeService.js";
import type { LearningService } from "../learning/learningService.js";
import type { ClipService } from "../services/clipService.js";
import type { CommentInboxService } from "../comments/inboxService.js";
import { getAssistantSettings, saveAssistantSettings } from "../settings/assistant.js";
import { runAssistantLoop } from "./loop.js";
import { getToolRisk, runTool, summarizeTool, type AssistantToolContext } from "./tools.js";

const PENDING_TTL_MS = 30 * 60 * 1000;
const busyConversations = new Set<string>();

type ConversationRow = {
  id: string;
  channel: AssistantChannel;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
};

type PendingRow = {
  id: string;
  conversation_id: string;
  tool: string;
  args: string;
  summary: string;
  status: AssistantPendingAction["status"];
  result: string | null;
  created_at: string;
  expires_at: string;
};

export class AssistantService {
  constructor(
    private readonly db: AppDatabase,
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly registry: LlmProviderRegistry,
    private readonly profiles: ProfileService,
    private readonly projects: ProjectService,
    private readonly topics: TopicService,
    private readonly automation: AutomationService,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly publish: PublishService,
    private readonly usage: UsageService,
    private readonly scenes: SceneService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.analytics = undefined;
  }

  private analytics: AnalyticsSyncService | undefined;
  private finance: FinanceService | undefined;
  private learning: LearningService | undefined;
  private clips: ClipService | undefined;
  private comments: CommentInboxService | undefined;
  private trends: import("../trends/trendService.js").TrendService | undefined;
  private translations: import("../translations/translationService.js").TranslationService | undefined;

  setAnalytics(service: AnalyticsSyncService): void {
    this.analytics = service;
  }

  setFinance(service: FinanceService): void {
    this.finance = service;
  }

  setLearning(service: LearningService): void {
    this.learning = service;
  }

  setClips(service: ClipService): void {
    this.clips = service;
  }

  setComments(service: CommentInboxService): void {
    this.comments = service;
  }

  setTrends(service: import("../trends/trendService.js").TrendService): void {
    this.trends = service;
  }

  setTranslations(service: import("../translations/translationService.js").TranslationService): void {
    this.translations = service;
  }

  getSettings(): AssistantSettings {
    return getAssistantSettings(this.sqlite);
  }

  saveSettings(update: unknown): AssistantSettings {
    const parsed = AssistantSettingsUpdateSchema.parse(update);
    const current = getAssistantSettings(this.sqlite);
    return saveAssistantSettings(this.sqlite, AssistantSettingsSchema.parse({ ...current, ...parsed }));
  }

  listConversations(channel?: AssistantChannel): AssistantConversation[] {
    const rows = channel
      ? this.sqlite.prepare(
        "SELECT * FROM assistant_conversations WHERE channel = ? ORDER BY updated_at DESC LIMIT 100",
      ).all(channel) as ConversationRow[]
      : this.sqlite.prepare(
        "SELECT * FROM assistant_conversations ORDER BY updated_at DESC LIMIT 100",
      ).all() as ConversationRow[];
    return rows.map((row) => this.toConversation(row));
  }

  createConversation(input: { title?: string; channel?: AssistantChannel }): AssistantConversation {
    const now = this.now().toISOString();
    const id = randomUUID();
    const channel = input.channel ?? "web";
    const title = input.title?.trim() || (channel === "telegram" ? "Telegram" : "Cuộc trò chuyện mới");
    this.sqlite.prepare(
      "INSERT INTO assistant_conversations (id, channel, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, channel, title, now, now);
    return AssistantConversationSchema.parse({
      id,
      channel,
      title,
      createdAt: now,
      updatedAt: now,
    });
  }

  getConversation(id: string): AssistantConversation | undefined {
    const row = this.sqlite.prepare("SELECT * FROM assistant_conversations WHERE id = ?").get(id) as ConversationRow | undefined;
    return row ? this.toConversation(row) : undefined;
  }

  requireConversation(id: string): AssistantConversation {
    const conversation = this.getConversation(id);
    if (!conversation) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Không tìm thấy cuộc trò chuyện");
    return conversation;
  }

  /** Latest telegram conversation or create one. */
  getOrCreateTelegramConversation(): AssistantConversation {
    const row = this.sqlite.prepare(
      "SELECT * FROM assistant_conversations WHERE channel = 'telegram' ORDER BY updated_at DESC LIMIT 1",
    ).get() as ConversationRow | undefined;
    if (row) return this.toConversation(row);
    return this.createConversation({ channel: "telegram", title: "Telegram" });
  }

  startNewTelegramConversation(): AssistantConversation {
    return this.createConversation({ channel: "telegram", title: "Telegram" });
  }

  listMessages(conversationId: string): { items: AssistantMessage[]; pendingActions: AssistantPendingAction[] } {
    this.requireConversation(conversationId);
    this.expirePendingActions(conversationId);
    const rows = this.sqlite.prepare(
      "SELECT * FROM assistant_messages WHERE conversation_id = ? ORDER BY created_at ASC",
    ).all(conversationId) as MessageRow[];
    const pending = this.listPendingForConversation(conversationId);
    return {
      items: rows.map((row) => this.toMessage(row)),
      pendingActions: pending,
    };
  }

  async sendMessage(
    conversationId: string,
    text: string,
    options: { signal?: AbortSignal; logger?: FastifyBaseLogger } = {},
  ): Promise<AssistantSendResponse> {
    this.requireConversation(conversationId);
    if (busyConversations.has(conversationId)) {
      throw new AppError(409, "ASSISTANT_BUSY", "Đang xử lý tin nhắn khác, thử lại sau.");
    }
    busyConversations.add(conversationId);
    try {
      return await this.sendMessageInner(conversationId, text, options);
    } finally {
      busyConversations.delete(conversationId);
    }
  }

  private async sendMessageInner(
    conversationId: string,
    text: string,
    options: { signal?: AbortSignal; logger?: FastifyBaseLogger },
  ): Promise<AssistantSendResponse> {
    const nowIso = this.now().toISOString();
    const userMessageId = randomUUID();
    const userContent = AssistantMessageContentSchema.parse({ text });
    this.sqlite.prepare(
      "INSERT INTO assistant_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
    ).run(userMessageId, conversationId, JSON.stringify(userContent), nowIso);

    const history = this.listMessages(conversationId).items;
    const profileSummaries = await this.loadProfileSummaries();
    const toolCtx = this.buildToolContext(options.signal);
    const newMessages: AssistantMessage[] = [
      this.toMessage({
        id: userMessageId,
        conversation_id: conversationId,
        role: "user",
        content: JSON.stringify(userContent),
        created_at: nowIso,
      }),
    ];
    const toolMessages: AssistantMessage[] = [];

    const loopResult = await runAssistantLoop({
      sqlite: this.sqlite,
      config: this.config,
      registry: this.registry,
      toolCtx,
      history,
      userText: text,
      profileSummaries,
      signal: options.signal,
      logger: options.logger,
      createPending: ({ tool, args, summary }) => this.insertPendingAction(conversationId, tool, args, summary),
      runPendingNow: async ({ tool, args }) => {
        try {
          const result = await runTool(tool, args, toolCtx);
          const risk = getToolRisk(tool) ?? "confirm";
          return {
            result,
            activity: { tool, summary: summarizeTool(tool, args), risk, ok: true },
          };
        } catch (error) {
          const message = error instanceof AppError ? error.message : (error instanceof Error ? error.message : String(error));
          const risk = getToolRisk(tool) ?? "confirm";
          throw new AppError(500, "TOOL_FAILED", message);
        }
      },
      onPersistToolMessage: ({ tool, resultPreview, activity }) => {
        const id = randomUUID();
        const created = this.now().toISOString();
        const content = AssistantMessageContentSchema.parse({
          text: `[${tool}] ${resultPreview.slice(0, 500)}`,
          toolActivity: [activity],
        });
        this.sqlite.prepare(
          "INSERT INTO assistant_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'tool', ?, ?)",
        ).run(id, conversationId, JSON.stringify(content), created);
        toolMessages.push(this.toMessage({
          id,
          conversation_id: conversationId,
          role: "tool",
          content: JSON.stringify(content),
          created_at: created,
        }));
      },
    });

    const assistantId = randomUUID();
    const assistantCreated = this.now().toISOString();
    const assistantContent = AssistantMessageContentSchema.parse({
      text: loopResult.replyText || (loopResult.pendingActions.length
        ? "Các thao tác sau cần bạn xác nhận:"
        : ""),
      clarify: loopResult.clarify,
      toolActivity: loopResult.toolActivity.length ? loopResult.toolActivity : undefined,
      pendingActionIds: loopResult.pendingActions.length
        ? loopResult.pendingActions.map((a) => a.id)
        : undefined,
      usage: loopResult.messageUsage,
    });
    this.sqlite.prepare(
      "INSERT INTO assistant_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
    ).run(assistantId, conversationId, JSON.stringify(assistantContent), assistantCreated);
    this.sqlite.prepare(
      "UPDATE assistant_conversations SET updated_at = ? WHERE id = ?",
    ).run(assistantCreated, conversationId);

    newMessages.push(...toolMessages);
    newMessages.push(this.toMessage({
      id: assistantId,
      conversation_id: conversationId,
      role: "assistant",
      content: JSON.stringify(assistantContent),
      created_at: assistantCreated,
    }));

    return {
      messages: newMessages,
      pendingActions: loopResult.pendingActions,
    };
  }

  async confirmAction(actionId: string): Promise<AssistantPendingAction> {
    return this.resolveAction(actionId, "confirm");
  }

  async rejectAction(actionId: string): Promise<AssistantPendingAction> {
    return this.resolveAction(actionId, "reject");
  }

  /** Create a pending approve_gate for Telegram waiting_approval buttons. */
  createPendingApproveGate(input: {
    projectId: string;
    gate: string;
    projectTitle?: string;
  }): AssistantPendingAction {
    const conversation = this.getOrCreateTelegramConversation();
    const summary = `Duyệt cổng ${input.gate}${input.projectTitle ? ` — ${input.projectTitle}` : ""}`.slice(0, 500);
    return this.insertPendingAction(conversation.id, "approve_gate", {
      projectId: input.projectId,
      gate: input.gate,
    }, summary);
  }

  async confirmAll(conversationId: string): Promise<AssistantPendingAction[]> {
    this.requireConversation(conversationId);
    this.expirePendingActions(conversationId);
    const pending = this.listPendingForConversation(conversationId).filter((a) => a.status === "pending");
    const results: AssistantPendingAction[] = [];
    for (const action of pending) {
      try {
        results.push(await this.resolveAction(action.id, "confirm"));
      } catch (error) {
        if (error instanceof AppError && error.code === "ACTION_ALREADY_HANDLED") continue;
        throw error;
      }
    }
    return results;
  }

  private pendingListener?: (id: string, status: "confirmed" | "rejected" | "failed") => void;

  setPendingListener(listener: (id: string, status: "confirmed" | "rejected" | "failed") => void): void {
    this.pendingListener = listener;
  }

  ensureCallerConversation(title: string): string {
    const row = this.sqlite.prepare(
      "SELECT id FROM assistant_conversations WHERE title = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(title) as { id: string } | undefined;
    if (row) return row.id;
    return this.createConversation({ channel: "web", title }).id;
  }

  createCallerPending(title: string, tool: string, args: unknown, summary: string): AssistantPendingAction {
    const conversationId = this.ensureCallerConversation(title);
    return this.insertPendingAction(conversationId, tool, args, summary);
  }

  toolContext(): AssistantToolContext {
    return this.buildToolContext();
  }

  private async resolveAction(
    actionId: string,
    mode: "confirm" | "reject",
  ): Promise<AssistantPendingAction> {
    const row = this.sqlite.prepare("SELECT * FROM assistant_pending_actions WHERE id = ?").get(actionId) as PendingRow | undefined;
    if (!row) throw new AppError(404, "ACTION_NOT_FOUND", "Không tìm thấy thao tác chờ");

    const nowIso = this.now().toISOString();
    if (row.expires_at <= nowIso && row.status === "pending") {
      this.sqlite.prepare("UPDATE assistant_pending_actions SET status = 'expired' WHERE id = ? AND status = 'pending'").run(actionId);
      throw new AppError(409, "ACTION_EXPIRED", "Thao tác đã hết hạn");
    }
    if (row.status === "expired") {
      throw new AppError(409, "ACTION_EXPIRED", "Thao tác đã hết hạn");
    }
    // Double confirm / already handled → no-op (return current row).
    if (row.status !== "pending") {
      return this.toPending(row);
    }

    if (mode === "reject") {
      const updated = this.sqlite.prepare(
        "UPDATE assistant_pending_actions SET status = 'rejected' WHERE id = ? AND status = 'pending'",
      ).run(actionId);
      if (updated.changes === 0) {
        return this.requirePendingAction(actionId);
      }
      this.pendingListener?.(actionId, "rejected");
      return this.requirePendingAction(actionId);
    }

    const claimed = this.sqlite.prepare(
      "UPDATE assistant_pending_actions SET status = 'confirmed' WHERE id = ? AND status = 'pending' AND expires_at > ?",
    ).run(actionId, nowIso);
    if (claimed.changes === 0) {
      const current = this.requirePendingAction(actionId);
      if (current.status === "confirmed") return current;
      if (current.status === "expired") {
        throw new AppError(409, "ACTION_EXPIRED", "Thao tác đã hết hạn");
      }
      return current;
    }

    const args = JSON.parse(row.args) as unknown;
    try {
      const result = await runTool(row.tool, args, this.buildToolContext());
      this.sqlite.prepare(
        "UPDATE assistant_pending_actions SET result = ? WHERE id = ?",
      ).run(JSON.stringify(result), actionId);
      this.pendingListener?.(actionId, "confirmed");
      return this.requirePendingAction(actionId);
    } catch (error) {
      const message = error instanceof AppError ? error.message : (error instanceof Error ? error.message : String(error));
      this.sqlite.prepare(
        "UPDATE assistant_pending_actions SET status = 'failed', result = ? WHERE id = ?",
      ).run(JSON.stringify({ error: message }), actionId);
      this.pendingListener?.(actionId, "failed");
      throw new AppError(500, "ACTION_FAILED", message);
    }
  }

  private insertPendingAction(
    conversationId: string,
    tool: string,
    args: unknown,
    summary: string,
  ): AssistantPendingAction {
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + PENDING_TTL_MS).toISOString();
    this.sqlite.prepare(
      `INSERT INTO assistant_pending_actions
       (id, conversation_id, tool, args, summary, status, result, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    ).run(id, conversationId, tool, JSON.stringify(args), summary, createdAt, expiresAt);
    return AssistantPendingActionSchema.parse({
      id,
      conversationId,
      tool,
      args,
      summary,
      status: "pending",
      result: null,
      createdAt,
      expiresAt,
    });
  }

  private expirePendingActions(conversationId: string): void {
    const nowIso = this.now().toISOString();
    this.sqlite.prepare(
      `UPDATE assistant_pending_actions SET status = 'expired'
       WHERE conversation_id = ? AND status = 'pending' AND expires_at <= ?`,
    ).run(conversationId, nowIso);
  }

  private listPendingForConversation(conversationId: string): AssistantPendingAction[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM assistant_pending_actions WHERE conversation_id = ? AND status = 'pending' ORDER BY created_at ASC",
    ).all(conversationId) as PendingRow[];
    return rows.map((row) => this.toPending(row));
  }

  private requirePendingAction(id: string): AssistantPendingAction {
    const row = this.sqlite.prepare("SELECT * FROM assistant_pending_actions WHERE id = ?").get(id) as PendingRow | undefined;
    if (!row) throw new AppError(404, "ACTION_NOT_FOUND", "Không tìm thấy thao tác");
    return this.toPending(row);
  }

  private buildToolContext(signal?: AbortSignal): AssistantToolContext {
    return {
      db: this.db,
      sqlite: this.sqlite,
      config: this.config,
      profiles: this.profiles,
      projects: this.projects,
      topics: this.topics,
      automation: this.automation,
      orchestrator: this.orchestrator,
      publish: this.publish,
      usage: this.usage,
      registry: this.registry,
      scenes: this.scenes,
      analytics: this.analytics,
      finance: this.finance,
      learning: this.learning,
      clips: this.clips,
      comments: this.comments,
      trends: this.trends,
      translations: this.translations,
      signal,
    };
  }

  private async loadProfileSummaries(): Promise<Array<{ id: string; name: string; platforms: string[] }>> {
    const { items } = await this.profiles.listProfiles({ includeArchived: false });
    return items.map((item) => ({
      id: item.id,
      name: item.name,
      platforms: [...new Set((item.accounts ?? []).map((a) => a.platform))],
    }));
  }

  private toConversation(row: ConversationRow): AssistantConversation {
    return AssistantConversationSchema.parse({
      id: row.id,
      channel: row.channel,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toMessage(row: MessageRow): AssistantMessage {
    const contentRaw = typeof row.content === "string" ? JSON.parse(row.content) as unknown : row.content;
    return AssistantMessageSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: AssistantMessageContentSchema.parse(contentRaw),
      createdAt: row.created_at,
    });
  }

  private toPending(row: PendingRow): AssistantPendingAction {
    return AssistantPendingActionSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      tool: row.tool,
      args: JSON.parse(row.args) as unknown,
      summary: row.summary,
      status: row.status,
      result: row.result ? JSON.parse(row.result) as unknown : null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
  }
}
