import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { stampWorkspace } from "../auth/requestContext.js";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type Database from "better-sqlite3";
import {
  AUTONOMY_PRESETS,
  StandingOrderInputSchema,
  containsProtectedProject,
  localDateString,
  redactOperatorText,
  resolveTelegramEngine,
  type OperatorRunKind,
  type OperatorRuntimeChannel,
  type OperatorSettings,
  type StandingOrderInput,
} from "@vg/shared";
import type { AssistantService } from "../assistant/service.js";
import { ASSISTANT_TOOLS, getToolCatalogForPrompt } from "../assistant/tools.js";
import { AppError } from "../lib/errors.js";
import { getNotificationSettings } from "../settings/notifications.js";
import { escapeHtml, splitTelegramMessage, type TelegramClient } from "../notifications/telegram.js";
import { readQuotaStatus } from "../providers/llm/quota.js";
import { resolveCursorRuntime } from "./cursorRuntime.js";
import { createModelRuntime } from "./modelRuntime.js";
import { checkpointObservations } from "./checkpoints.js";
import { activateSkillVersion, listSkillVersions, listSkillVersionViews, saveSkillDraft } from "./skillVersions.js";
import { listToolProposals } from "./toolProposals.js";
import type { EventScope } from "./events.js";
import { getAutomationPaused } from "../services/automationSettings.js";
import { readAutonomyBudget } from "./autonomyBudget.js";
import { autonomySettings, saveAutonomySettings } from "./autonomy.js";
import { buildDigest, consumeRaiseCode, saveGoal, savePreference } from "./autopilot.js";
import type { AgentRuntime } from "./agentRuntime.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { CRON_CATCHUP_MS, isCronDue, latestMissedCron } from "./cron.js";
import { operatorDuties, seededStandingOrders } from "./extensions.js";
import { setOperatorToolHooks, type OperatorSupervisorHooks } from "./hooks.js";
import { getOperatorPause, pauseByUser } from "../supervision/pause.js";
import { formatHermesStatus } from "../supervision/snapshot.js";
import { releaseLeasesOfRun } from "../supervision/leases.js";
import { INTERNAL_OPERATOR } from "../supervision/identity.js";
import { historicalSuccess, routeQuery, type HistoryEvent, type RouteCandidate } from "./routing.js";
import { type SpawnFn, defaultSpawn } from "./runtime.js";
import { getOperatorSettings, saveOperatorSettings } from "./settings.js";
import {
  OPERATOR_SKILLS,
  parseSkillMarkdown,
  renderSkillMarkdown,
  shouldProposeSkill,
  validateSkillMarkdown,
  type OperatorSkill,
} from "./skills.js";
import { checkDueSkillReports } from "../reports/checkSkillReports.js";
import { loadRepoSkills, type RepoSkill } from "./repoSkills.js";
import { operatorDir, readNote, repoRoot, skillBodiesForRouting, writeOperatorWorkspace } from "./workspace.js";

const SYSTEM_OPERATOR = "Hệ thống operator";
const TICK_PROMPT = "Kiểm tra trạng thái và thực hiện các lệnh thường trực.";
const TICK_KEY = "operator.tickLastFired";
const ZONE = "Asia/Ho_Chi_Minh";
const INTERRUPTED_RUN_VI = "Lượt chạy bị dừng vì server khởi động lại.";

/** The in-memory queue and active job do not survive a restart. */
export function failInterruptedOperatorRuns(sqlite: Database.Database, now: Date): number {
  const select = sqlite.prepare(
    "SELECT id, conversation_id FROM operator_runs WHERE status IN ('queued', 'running')",
  );
  const finishedAt = now.toISOString();
  const update = sqlite.prepare(
    `UPDATE operator_runs
     SET status = 'failed', outcome = 'failed', result = ?, partial_text = ?, finished_at = ?
     WHERE id = ?`,
  );
  const insert = sqlite.prepare(
    `INSERT INTO operator_messages (id, conversation_id, run_id, role, content, created_at)
     VALUES (?, ?, ?, 'assistant', ?, ?)`,
  );
  const body = JSON.stringify({ text: INTERRUPTED_RUN_VI });
  releaseLeasesOfRun(sqlite, INTERNAL_OPERATOR.instance);
  return sqlite.transaction(() => {
    const rows = select.all() as Array<{ id: string; conversation_id: string }>;
    for (const row of rows) {
      update.run(INTERRUPTED_RUN_VI, INTERRUPTED_RUN_VI, finishedAt, row.id);
      insert.run(randomUUID(), row.conversation_id, row.id, body, finishedAt);
    }
    return rows.length;
  }).immediate();
}

type Origin = "user" | "schedule" | "wake";

type Job = {
  runtime: AgentRuntime;
  workflowId?: string;
  invocationToken?: string;
  eventScope?: EventScope;
  runId: string;
  conversationId: string;
  prompt: string;
  kind: OperatorRunKind;
  origin: Origin;
  onProgress?: (chips: string[], partial: string) => void;
  onDone?: (result: { text: string; pendingIds: string[] }) => void | Promise<void>;
};

export type OperatorSubmitResult = {
  runId: string;
  conversationId: string;
  position: number;
  status: "queued" | "running" | "refused";
  message: string;
};

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export class OperatorService {
  progressIntervalMs = 10_000;
  private spawnImpl: SpawnFn = defaultSpawn;
  private telegramFactory: (() => TelegramClient | null) | null = null;
  private pumping = false;
  private active: Job | null = null;
  private waiting: Job[] = [];
  private stopRequested = false;
  private readonly now: () => Date;
  private readonly logger: Logger;

  constructor(private readonly deps: {
    sqlite: Database.Database;
    dataDir: string;
    apiUrl: string;
    assistant: AssistantService;
    llmProviders: LlmProviderRegistry;
    now?: () => Date;
    logger?: Logger;
  }) {
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? { info: () => undefined, error: () => undefined };
    setOperatorToolHooks({
      supervisor: this.supervisorHooks(),
      saveStandingOrder: (input) => this.saveStandingOrder({ ...input, enabled: true }),
      findSkills: (query) => this.findSkills(query),
      findTools: (query) => this.findTools(query),
      notifyToolProposal: (name) => {
        void this.notifySummary(`Đề xuất công cụ mới: ${name}. Xem tại Agent operator.`)
          .catch((error) => this.logger.error({ err: error }, "operator proposal notification failed"));
      },
    });
    this.deps.assistant.setPendingListener((id, status) => this.onPendingResolved(id, status));
    try {
      this.syncWorkspace();
    } catch (error) {
      this.logger.error({ err: error }, "operator workspace sync failed");
    }
    this.resetSessionsAfterMove();
    failInterruptedOperatorRuns(this.deps.sqlite, this.now());
  }

  setSpawn(spawnImpl: SpawnFn): void {
    this.spawnImpl = spawnImpl;
  }

  resolveMcpInvocation(token: string): { runId: string; workflowId: string; eventScope?: EventScope } {
    const job = this.active;
    if (!job?.invocationToken || job.invocationToken !== token || !job.workflowId || this.stopRequested) {
      throw new AppError(403, "OPERATOR_INVOCATION_INVALID", "Phiên gọi công cụ của operator không còn hiệu lực.");
    }
    return { runId: job.runId, workflowId: job.workflowId, eventScope: job.eventScope };
  }

  private resolveRuntime(id: string, cursorPath: string): AgentRuntime {
    if (id !== "cursor") return createModelRuntime(id, this.deps.llmProviders, this.deps.assistant, SYSTEM_OPERATOR);
    const runtime = resolveCursorRuntime(cursorPath, this.spawnImpl);
    if (!runtime) throw new Error("Chưa tìm thấy Cursor CLI. Đặt đường dẫn trong cài đặt operator.");
    return runtime;
  }

  setTelegramClient(factory: () => TelegramClient | null): void {
    this.telegramFactory = factory;
  }

  getSettings(): OperatorSettings {
    return getOperatorSettings(this.deps.sqlite);
  }

  saveSettings(update: unknown): OperatorSettings {
    const saved = saveOperatorSettings(this.deps.sqlite, update as never);
    try {
      this.syncWorkspace();
    } catch (error) {
      this.logger.error({ err: error }, "operator workspace sync failed");
    }
    return saved;
  }

  syncWorkspace(): void {
    this.syncSeeds();
    const settings = this.getSettings();
    const profiles = this.deps.sqlite.prepare(
      "SELECT name, automation FROM profiles WHERE archived_at IS NULL ORDER BY name LIMIT 40",
    ).all() as Array<{ name: string; automation: string | null }>;
    const waiting = this.deps.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM project_stages WHERE state = 'WAITING_USER'",
    ).get() as { n: number };
    let quotaLine = "Dùng get_llm_quota_status để xem đủ.";
    try {
      const status = readQuotaStatus(this.deps.sqlite, this.now(), 0);
      quotaLine = `chính sách ${status.quotaPolicy}, ${status.rows.length} quy tắc.`;
    } catch {
      quotaLine = "chưa đọc được. Dùng get_llm_quota_status để xem đủ.";
    }
    const orders = this.listOrders();
    writeOperatorWorkspace({
      dataDir: this.deps.dataDir,
      apiUrl: this.deps.apiUrl,
      tools: getToolCatalogForPrompt().map((tool) => ({
        name: tool.name,
        description: tool.description,
        risk: tool.risk,
      })),
      duties: operatorDuties,
      extraSkills: this.userSkills(),
      repoSkills: this.repoSkillBundle().skills,
      snapshot: {
        profiles: profiles.map((row) => ({
          name: row.name,
          automation: automationEnabled(row.automation),
        })),
        waitingGates: waiting.n,
        quotaLine,
        orderCount: orders.length,
      },
      snapshotMaxChars: settings.snapshotMaxChars,
      standingOrdersMarkdown: renderOrdersMarkdown(orders),
    });
  }

  workspacePath(): string {
    return operatorDir(this.deps.dataDir);
  }

  /** The old folder sat inside the git repo, so the CLI never loaded its MCP config. */
  private resetSessionsAfterMove(): void {
    const current = this.workspacePath();
    const legacy = join(this.deps.dataDir, "operator");
    if (resolve(current) === resolve(legacy)) return;
    const marker = join(current, "notes", ".session-reset");
    if (existsSync(marker)) return;
    this.deps.sqlite.prepare("UPDATE operator_conversations SET cursor_chat_id = NULL").run();
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "Đã bỏ phiên CLI cũ sau khi chuyển thư mục operator ra ngoài repo.\n", "utf8");
  }

  listOrders(): Array<{
    id: string;
    title: string;
    prompt: string;
    cron: string | null;
    enabled: boolean;
    seeded: boolean;
    moduleId: string | null;
    lastFiredAt: string | null;
  }> {
    const rows = this.deps.sqlite.prepare(
      "SELECT * FROM standing_orders ORDER BY created_at ASC",
    ).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      prompt: String(row.prompt),
      cron: row.cron == null ? null : String(row.cron),
      enabled: Number(row.enabled) === 1,
      seeded: Number(row.seeded) === 1,
      moduleId: row.module_id == null ? null : String(row.module_id),
      lastFiredAt: row.last_fired_at == null ? null : String(row.last_fired_at),
    }));
  }

  saveStandingOrder(input: StandingOrderInput & { id?: string }): { id: string; title: string } {
    const { id: inputId, ...orderInput } = input;
    const parsed = StandingOrderInputSchema.parse(orderInput);
    const now = this.now().toISOString();
    const id = inputId ?? randomUUID();
    const existing = this.deps.sqlite.prepare("SELECT id, seeded FROM standing_orders WHERE id = ?").get(id) as
      | { id: string; seeded: number }
      | undefined;
    if (existing) {
      this.deps.sqlite.prepare(
        `UPDATE standing_orders
         SET title = ?, prompt = ?, cron = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      ).run(parsed.title, parsed.prompt, parsed.cron ?? null, parsed.enabled === false ? 0 : 1, now, id);
    } else {
      this.deps.sqlite.prepare(
        `INSERT INTO standing_orders
         (id, title, prompt, cron, enabled, seeded, module_id, created_at, updated_at, last_fired_at)
         VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL)`,
      ).run(id, parsed.title, parsed.prompt, parsed.cron ?? null, parsed.enabled === false ? 0 : 1, now, now);
        stampWorkspace(this.deps.sqlite, "standing_orders", id);
    }
    this.syncWorkspace();
    return { id, title: parsed.title };
  }

  setOrderEnabled(id: string, enabled: boolean): void {
    const now = this.now().toISOString();
    const updated = this.deps.sqlite.prepare(
      "UPDATE standing_orders SET enabled = ?, updated_at = ? WHERE id = ?",
    ).run(enabled ? 1 : 0, now, id);
    if (updated.changes === 0) return;
    this.syncWorkspace();
  }

  deleteOrder(id: string): void {
    this.deps.sqlite.prepare("DELETE FROM standing_orders WHERE id = ?").run(id);
    this.syncWorkspace();
  }

  createConversation(channel: "web" | "telegram", title = "Operator"): { id: string } {
    const now = this.now().toISOString();
    const id = randomUUID();
    this.deps.sqlite.prepare(
      `INSERT INTO operator_conversations (id, channel, title, cursor_chat_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ).run(id, channel, title, now, now);
      stampWorkspace(this.deps.sqlite, "operator_conversations", id);
    return { id };
  }

  latestConversation(channel: "web" | "telegram"): string {
    const row = this.deps.sqlite.prepare(
      "SELECT id FROM operator_conversations WHERE channel = ? ORDER BY updated_at DESC LIMIT 1",
    ).get(channel) as { id: string } | undefined;
    return row?.id ?? this.createConversation(channel).id;
  }

  newSession(conversationId: string): void {
    const now = this.now().toISOString();
    this.deps.sqlite.prepare(
      "UPDATE operator_conversations SET cursor_chat_id = NULL, updated_at = ? WHERE id = ?",
    ).run(now, conversationId);
  }

  listMessages(conversationId: string): Array<{ id: string; role: string; text: string; createdAt: string; runId: string | null }> {
    const rows = this.deps.sqlite.prepare(
      "SELECT * FROM operator_messages WHERE conversation_id = ? ORDER BY created_at ASC",
    ).all(conversationId) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const content = JSON.parse(String(row.content)) as { text?: string };
      return {
        id: String(row.id),
        role: String(row.role),
        text: redactOperatorText(content.text ?? ""),
        createdAt: String(row.created_at),
        runId: row.run_id == null ? null : String(row.run_id),
      };
    });
  }

  getRun(runId: string): Record<string, unknown> | undefined {
    const row = this.deps.sqlite.prepare("SELECT * FROM operator_runs WHERE id = ?").get(runId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.publicRun(row) : undefined;
  }

  resumeWorkflow(runId: string): OperatorSubmitResult {
    if (runId.startsWith("event-")) {
      throw new AppError(409, "OPERATOR_EVENT_NOT_RESUMABLE", "Lượt theo sự kiện chỉ đọc. Hãy giao yêu cầu mới nếu cần tiếp tục.");
    }
    const sqlite = this.deps.sqlite;
    const row = sqlite.prepare(
      "SELECT conversation_id, prompt, kind, status, pending_action_ids, workflow_id FROM operator_runs WHERE id = ?",
    ).get(runId) as { conversation_id: string; prompt: string; kind: OperatorRunKind; status: string;
      pending_action_ids: string; workflow_id: string | null } | undefined;
    if (!row?.workflow_id || !["failed", "killed", "done"].includes(row.status)
        || (row.status === "done" && !JSON.parse(row.pending_action_ids).length)) {
      throw new AppError(409, "OPERATOR_NOT_RESUMABLE", "Lượt này không có checkpoint để tiếp tục.");
    }
    const latest = sqlite.prepare("SELECT id FROM operator_runs WHERE workflow_id = ? ORDER BY rowid DESC LIMIT 1")
      .get(row.workflow_id) as { id: string } | undefined;
    if (latest?.id !== runId) {
      throw new AppError(409, "OPERATOR_ALREADY_RESUMED", "Hãy tiếp tục từ lượt mới nhất của công việc.");
    }
    checkpointObservations(sqlite, row.workflow_id);
    return this.submit({ conversationId: row.conversation_id, prompt: row.prompt, kind: row.kind, workflowId: row.workflow_id });
  }

  submit(input: {
    conversationId?: string;
    channel?: "web" | "telegram";
    prompt: string;
    kind?: OperatorRunKind;
    origin?: Origin;
    workflowId?: string;
    eventRun?: { runId: string; scope: EventScope };
    onProgress?: Job["onProgress"];
    onDone?: Job["onDone"];
  }): OperatorSubmitResult {
    const settings = this.getSettings();
    const conversationId = input.conversationId ?? this.latestConversation(input.channel ?? "web");
    const prompt = redactOperatorText(input.prompt);
    if (settings.killed || (input.eventRun && getAutomationPaused(this.deps.sqlite))) {
      return {
        runId: "",
        conversationId,
        position: 0,
        status: "refused",
        message: "Operator đang tắt.",
      };
    }
    const pause = (input.origin ?? "user") === "user" ? null : getOperatorPause(this.deps.sqlite, this.now());
    if (pause) {
      return {
        runId: "", conversationId, position: 0, status: "refused",
        message: `Operator đang tạm dừng (${pause.by}) đến ${pause.until}.`,
      };
    }
    const dayKey = localDateString(this.now(), ZONE);
    const profileId = input.eventRun?.scope.profileId;
    const cap = this.dailyRunCap(settings, profileId);
    if (this.runsOnDay(dayKey) >= cap || (profileId && this.profileRuns(profileId, dayKey) >= cap)) {
      const runId = input.eventRun ? "" : randomUUID();
      if (runId) this.insertRun({
        runId,
        conversationId,
        kind: input.kind ?? "chat",
        origin: input.origin ?? "user",
        prompt,
        status: "refused",
        dayKey,
        outcome: "rejected",
      });
      return {
        runId,
        conversationId,
        position: 0,
        status: "refused",
        message: `Đã hết số lượt operator trong ngày (${cap}).`,
      };
    }
    const origin = input.origin ?? "user";
    const conversation = this.deps.sqlite.prepare("SELECT channel FROM operator_conversations WHERE id = ?")
      .get(conversationId) as { channel: "web" | "telegram" } | undefined;
    const channel: OperatorRuntimeChannel = origin === "user" ? conversation?.channel ?? "web" : "schedule";
    let runtime: AgentRuntime;
    try {
      runtime = this.resolveRuntime(settings.runtimeByChannel[channel], settings.cursorPath);
    } catch (error) {
      return {
        runId: "", conversationId, position: 0, status: "refused",
        message: redactOperatorText(error instanceof Error ? error.message : String(error)),
      };
    }
    const runId = input.eventRun?.runId ?? randomUUID();
    const workflowId = input.workflowId ?? runId;
    this.insertRun({
      runId,
      conversationId,
      kind: input.kind ?? "chat",
      origin: input.origin ?? "user",
      prompt,
      status: "queued",
      dayKey,
      outcome: null,
      runtimeId: runtime.id,
      workflowId,
    });
    this.insertMessage(conversationId, runId, "user", prompt);
    if (profileId) this.noteProfileRun(profileId, dayKey);
    const busy = this.active !== null || this.pumping;
    const job: Job = {
      runtime,
      workflowId,
      eventScope: input.eventRun?.scope,
      runId,
      conversationId,
      prompt,
      kind: input.kind ?? "chat",
      origin: input.origin ?? "user",
      onProgress: input.onProgress,
      onDone: input.onDone,
    };
    this.waiting.push(job);
    const position = busy ? this.waiting.length : 0;
    void this.pump();
    return {
      runId,
      conversationId,
      position,
      status: position > 0 ? "queued" : "running",
      message: position > 0 ? `Đang chờ (vị trí ${position})` : "Đã nhận, đang làm",
    };
  }

  stopActive(): void {
    this.stopRequested = true;
  }

  async waitForIdle(): Promise<void> {
    while (this.pumping || this.waiting.length > 0 || this.active) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  wakeOperator(reason: string, prompt: string): OperatorSubmitResult {
    const conversationId = this.latestConversation("web");
    return this.submit({
      conversationId,
      prompt: `${reason}\n${prompt}`,
      kind: "wake",
      origin: "wake",
      onDone: (result) => {
        void this.notifySummary(result.text);
      },
    });
  }

  wakeForEvent(input: { runId: string; scope: EventScope; prompt: string }): OperatorSubmitResult {
    return this.submit({ prompt: input.prompt, kind: "wake", origin: "wake", eventRun: input });
  }

  async notifyEventTelegram(message: string): Promise<boolean> {
    return this.notifySummary(message);
  }

  tick(now = this.now()): { started: string[] } {
    if (this.getSettings().killed) return { started: [] };
    this.checkSkillReports(now);
    const started: string[] = [];
    const settings = this.getSettings();
    if (settings.tickCron && isCronDue(settings.tickCron, now, this.tickLastFired())) {
      const result = this.submit({
        prompt: TICK_PROMPT,
        kind: "tick",
        origin: "schedule",
        onDone: (done) => {
          void this.notifySummary(done.text);
        },
      });
      if (result.status !== "refused") {
        this.setTickLastFired(now.toISOString());
        started.push(result.runId);
      }
    }
    for (const order of this.listOrders()) {
      if (!order.enabled || !order.cron) continue;
      if (!isCronDue(order.cron, now, order.lastFiredAt)) continue;
      const result = this.submit({
        prompt: order.prompt,
        kind: "order",
        origin: "schedule",
        onDone: (done) => {
          void this.notifySummary(done.text);
        },
      });
      this.deps.sqlite.prepare(
        "UPDATE standing_orders SET last_fired_at = ? WHERE id = ?",
      ).run(now.toISOString(), order.id);
      if (result.status !== "refused") started.push(result.runId);
    }
    return { started };
  }

  recoverSchedules(lastHeartbeatAt: string, now = this.now()) {
    const skippedBefore = now.getTime() - Date.parse(lastHeartbeatAt) > CRON_CATCHUP_MS
      ? new Date(now.getTime() - CRON_CATCHUP_MS).toISOString() : null;
    const result = { started: 0, refused: 0, skippedBefore };
    const settings = this.getSettings();
    if (settings.killed || getAutomationPaused(this.deps.sqlite)) return { ...result, paused: true };
    const configured = (key: string) => (this.deps.sqlite.prepare("SELECT updated_at FROM app_settings WHERE key = ?")
      .get(key) as { updated_at: string } | undefined)?.updated_at;
    const submit = (prompt: string, kind: "tick" | "order") => {
      const response = this.submit({ prompt, kind, origin: "schedule", onDone: (done) => {
        void this.notifySummary(done.text);
      } });
      if (response.status === "refused") result.refused++;
      else result.started++;
    };
    const tick = settings.tickCron && latestMissedCron(settings.tickCron, now, lastHeartbeatAt, this.tickLastFired(),
      configured("operator"));
    if (tick) {
      const reserved = this.deps.sqlite.transaction(() => {
        const last = this.tickLastFired();
        if (last && last >= tick.toISOString()) return false;
        this.setTickLastFired(tick.toISOString());
        return true;
      }).immediate();
      if (reserved) submit(TICK_PROMPT, "tick");
    }
    const orders = this.deps.sqlite.prepare(`SELECT id, prompt, cron, last_fired_at, updated_at FROM standing_orders
      WHERE enabled = 1 AND cron IS NOT NULL ORDER BY created_at, id`).all() as {
      id: string; prompt: string; cron: string; last_fired_at: string | null; updated_at: string;
    }[];
    const mark = this.deps.sqlite.prepare(`UPDATE standing_orders SET last_fired_at = ?
      WHERE id = ? AND enabled = 1 AND (last_fired_at IS NULL OR last_fired_at < ?)`);
    for (const order of orders) {
      const occurrence = latestMissedCron(order.cron, now, lastHeartbeatAt, order.last_fired_at, order.updated_at);
      if (!occurrence) continue;
      const at = occurrence.toISOString();
      if (mark.run(at, order.id, at).changes) submit(order.prompt, "order");
    }
    return { ...result, paused: false };
  }

  findSkills(query: string): unknown {
    const versions = new Map(listSkillVersions(this.deps.sqlite, true).map((skill) => [skill.name, skill.version]));
    const routed = routeQuery(query, this.skillCandidates());
    this.logRouting(query, routed, null);
    return {
      parts: routed.map((part) => ({
        query: part.query,
        hits: part.hits.map((hit) => ({
          name: hit.name,
          version: versions.get(hit.name),
          description: hit.description,
          score: hit.score,
          breakdown: hit.breakdown,
          short: hit.shortBody,
          source: hit.id.startsWith("repo:") ? "repo" : OPERATOR_SKILLS.some((skill) => skill.name === hit.name) ? "builtin" : "user",
        })),
      })),
    };
  }

  findTools(query: string): unknown {
    const routed = routeQuery(query, this.toolCandidates());
    this.logRouting(query, routed, null);
    return {
      parts: routed.map((part) => ({
        query: part.query,
        hits: part.hits.map((hit) => ({
          name: hit.name,
          description: hit.description,
          score: hit.score,
          breakdown: hit.breakdown,
        })),
      })),
    };
  }

  overview(): Record<string, unknown> {
    const settings = this.getSettings();
    const cursor = resolveCursorRuntime(settings.cursorPath, this.spawnImpl);
    const runtimeOptions = [
      { id: "cursor", label: "Cursor CLI", available: Boolean(cursor), runtime: cursor,
        reason: cursor ? undefined : "Chưa tìm thấy Cursor CLI." },
      ...this.deps.llmProviders.list().map((provider) => {
        try {
          return { id: provider.id, label: provider.label, available: true,
            runtime: this.resolveRuntime(provider.id, settings.cursorPath), reason: undefined };
        } catch (error) {
          return { id: provider.id, label: provider.label, available: false, runtime: null,
            reason: redactOperatorText(error instanceof Error ? error.message : String(error)) };
        }
      }),
    ];
    const runtime = runtimeOptions.find((option) => option.id === settings.runtimeByChannel.web)?.runtime;
    const dayKey = localDateString(this.now(), ZONE);
    const month = dayKey.slice(0, 7);
    const runs = (this.deps.sqlite.prepare(
      "SELECT * FROM operator_runs ORDER BY created_at DESC, rowid DESC LIMIT 30",
    ).all() as Array<Record<string, unknown>>).map((row) => this.publicRun(row));
    const audit = this.deps.sqlite.prepare(
      "SELECT * FROM operator_tool_audit ORDER BY created_at DESC LIMIT 40",
    ).all();
    const conversationId = this.latestConversation("web");
    return {
      killed: settings.killed,
      cli: {
        found: Boolean(cursor),
        version: cursor?.version ?? null,
        loggedIn: null,
        model: settings.modelByKind.chat || null,
        manualModels: settings.manualModels,
      },
      runtime: runtime ? { id: runtime.id, capabilities: runtime.capabilities } : null,
      runtimeOptions: runtimeOptions.map(({ id, label, available, reason }) => ({ id, label, available, reason })),
      queue: this.waiting.map((job, index) => ({
        id: job.runId,
        prompt: job.prompt,
        position: index + 1,
        status: "queued",
      })),
      activeRunId: this.active?.runId ?? null,
      pending: this.listSystemPending(),
      orders: this.listOrders(),
      runs,
      audit,
      notes: this.listNotes(),
      settings,
      resumeCommand: this.resumeCommand(conversationId),
      workspacePath: this.workspacePath(),
      usage: {
        today: this.runsOnDay(dayKey),
        month: this.runsInMonth(month),
        cap: this.dailyRunCap(settings),
      },
      conversationId,
    };
  }

  resumeCommand(conversationId: string): string {
    const settings = this.getSettings();
    const runtime = resolveCursorRuntime(settings.cursorPath, this.spawnImpl);
    const row = this.deps.sqlite.prepare(
      "SELECT cursor_chat_id FROM operator_conversations WHERE id = ?",
    ).get(conversationId) as { cursor_chat_id: string | null } | undefined;
    return runtime?.resumeCommand?.(row?.cursor_chat_id) ?? "Chưa thấy cursor-agent.";
  }

  async openInCursor(): Promise<{ opened: boolean; path: string }> {
    const path = this.workspacePath();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (opened: boolean) => {
        if (settled) return;
        settled = true;
        resolve({ opened, path });
      };
      try {
        const child = spawn("cursor", [path], { detached: true, stdio: "ignore", windowsHide: true });
        child.on("error", () => finish(false));
        child.unref();
        setTimeout(() => finish(true), 80);
      } catch {
        finish(false);
      }
    });
  }

  listNotes(): Array<{ name: string; text: string }> {
    const dir = join(this.workspacePath(), "notes");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => ({ name, text: readNote(this.deps.dataDir, name) }));
  }

  promoteSkill(relativePath: string): { ok: boolean; errors: string[] } {
    const root = this.workspacePath();
    const normalized = relativePath.replaceAll("\\", "/");
    if (!normalized.startsWith("notes/skill-proposals/") || normalized.includes("..")) {
      return { ok: false, errors: ["Chỉ nạp bản nháp trong notes/skill-proposals."] };
    }
    const source = join(root, normalized);
    if (!existsSync(source)) return { ok: false, errors: ["Không thấy bản nháp."] };
    const markdown = readFileSync(source, "utf8");
    const errors = validateSkillMarkdown(markdown, new Set(Object.keys(ASSISTANT_TOOLS)));
    if (errors.length) return { ok: false, errors };
    const parsed = parseSkillMarkdown(markdown);
    if (!parsed) return { ok: false, errors: ["Frontmatter không hợp lệ."] };
    try {
      const draft = saveSkillDraft(this.deps.sqlite, markdown, { source: "user_review", runIds: [] }, this.skillRegistry());
      if (!draft) return { ok: false, errors: ["Chưa lưu được bản nháp."] };
      this.activateSkill(draft.name, draft.version);
      return { ok: true, errors: [] };
    } catch (error) {
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
  }

  skillVersions() {
    return listSkillVersionViews(this.deps.sqlite);
  }

  /** A user's edit becomes a new draft. It is scored and still needs approval before use. */
  saveSkillEdit(name: string, markdown: string): { name: string; version: number } {
    if (OPERATOR_SKILLS.some((skill) => skill.name === name)) {
      throw new AppError(409, "BUILT_IN_SKILL", "Skill tích hợp được quản lý cùng ứng dụng.");
    }
    if (parseSkillMarkdown(markdown)?.name !== name) {
      throw new AppError(400, "SKILL_NAME_MISMATCH", "Tên trong bản sửa phải giữ nguyên.");
    }
    const draft = saveSkillDraft(this.deps.sqlite, markdown, { source: "user_edit", runIds: [] }, this.skillRegistry());
    if (!draft) throw new AppError(429, "SKILL_DRAFT_LIMIT", "Đã đạt giới hạn bản nháp trong ngày.");
    return draft;
  }

  /** Keeps lessons, skills in use, drafts and pending tool proposals apart. */
  learningReport() {
    const versions = listSkillVersions(this.deps.sqlite);
    const lessons = readNote(this.deps.dataDir, "lessons.md").split(/\r?\n/).filter((line) => line.startsWith("- ")).slice(-20).reverse();
    const profileLessons = this.deps.sqlite.prepare(
      `SELECT id, name, learned_notes AS notes, updated_at AS updatedAt FROM profiles
       WHERE archived_at IS NULL AND learned_notes IS NOT NULL AND trim(learned_notes) <> '' ORDER BY updated_at DESC LIMIT 20`,
    ).all() as Array<{ id: string; name: string; notes: string; updatedAt: string }>;
    const pick = (status: string) => versions.filter((item) => item.status === status)
      .map(({ name, version, score, evidence }) => ({ name, version, score, source: evidence.source }));
    return {
      lessons: { operator: lessons, profiles: profileLessons.map((row) => ({ ...row, notes: row.notes.slice(0, 400) })) },
      skills: { active: pick("active"), drafts: pick("draft") },
      toolProposals: listToolProposals(this.deps.sqlite).map(({ id, name, kind, operation, createdAt }) => ({ id, name, kind, operation, createdAt })),
    };
  }

  activateSkill(name: string, version: number): void {
    if (OPERATOR_SKILLS.some((skill) => skill.name === name)) {
      throw new AppError(409, "BUILT_IN_SKILL", "Skill tích hợp được quản lý cùng ứng dụng.");
    }
    const markdown = activateSkillVersion(this.deps.sqlite, name, version, this.skillRegistry());
    const dir = join(this.workspacePath(), "skills", "user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), markdown, "utf8");
    this.syncWorkspace();
  }

  private skillRegistry() {
    return new Map(Object.values(ASSISTANT_TOOLS).map((tool) => [tool.name, tool.risk]));
  }

  async handleTelegram(input: { chatId: string; text: string }): Promise<boolean> {
    const client = this.telegramFactory?.() ?? null;
    if (!client) return false;
    const command = input.text.split(/\s+/)[0]?.toLowerCase() ?? "";
    const base = command.split("@")[0] ?? command;
    const rest = input.text.slice(command.length).trim();
    if (base === "/pause" || base === "/help" || base === "/start") return false;
    if (base === "/autonomy" || base === "/goal" || base === "/feedback" || base === "/digest") {
      await client.sendMessage(input.chatId, escapeHtml(this.ownerCommand(base, rest)));
      return true;
    }
    const settings = this.getSettings();
    const engine = resolveTelegramEngine(settings);

    if (base === "/tl") {
      await this.replyAssistant(client, input.chatId, rest || input.text);
      return true;
    }
    if (base === "/hermes") {
      await client.sendMessage(input.chatId, formatHermesStatus(this.deps.sqlite, this.now()));
      return true;
    }
    if (base === "/op" || base === "/status" || base === "/stop" || base === "/new" || base === "/orders" || !base.startsWith("/")) {
      if ((base === "/op" || !base.startsWith("/")) && settings.killed) {
        await client.sendMessage(input.chatId, "Operator đang tắt. Dùng /tl để hỏi trợ lý tích hợp.");
        return true;
      }
      if (engine === "assistant" && !base.startsWith("/")) {
        await this.replyAssistant(client, input.chatId, input.text);
        return true;
      }
      if (base === "/status") {
        await client.sendMessage(input.chatId, escapeHtml(this.statusText()));
        return true;
      }
      if (base === "/stop") {
        this.stopActive();
        pauseByUser(this.deps.sqlite, this.now());
        await client.sendMessage(input.chatId, "Đã yêu cầu dừng lượt đang chạy.");
        return true;
      }
      if (base === "/new") {
        const id = this.latestConversation("telegram");
        this.newSession(id);
        await client.sendMessage(input.chatId, "Đã mở phiên operator mới. Ghi chú trong notes/ vẫn giữ.");
        return true;
      }
      if (base === "/orders") {
        await this.sendOrders(client, input.chatId);
        return true;
      }
      const prompt = base === "/op" ? rest : input.text;
      if (!prompt) {
        await client.sendMessage(input.chatId, "Thiếu nội dung. Ví dụ: /op kiểm tra quota");
        return true;
      }
      const conversationId = this.latestConversation("telegram");
      let ackId: number | undefined;
      let lastEdit = 0;
      const submitted = this.submit({
        conversationId,
        channel: "telegram",
        prompt,
        kind: "chat",
        origin: "user",
        onProgress: (chips) => {
          if (!ackId || chips.length === 0) return;
          const nowMs = Date.now();
          if (nowMs - lastEdit < this.progressIntervalMs) return;
          lastEdit = nowMs;
          const text = chips.map((chip) => `đang gọi: ${chip}`).join("\n");
          void client.editMessageText(input.chatId, ackId, escapeHtml(text)).catch(() => undefined);
        },
        onDone: (done) => {
          const chunks = splitTelegramMessage(escapeHtml(done.text));
          void (async () => {
            for (const chunk of chunks) await client.sendMessage(input.chatId, chunk);
            if (done.pendingIds.length) {
              await client.sendMessage(input.chatId, "Có thao tác chờ duyệt.", {
                buttons: done.pendingIds.slice(0, 6).map((id) => [
                  { text: "Duyệt", data: `pa:${id}:y` },
                  { text: "Từ chối", data: `pa:${id}:n` },
                ]),
              });
            }
          })();
        },
      });
      ackId = await client.sendMessage(input.chatId, escapeHtml(submitted.message));
      return true;
    }
    if (engine === "assistant") return false;
    await client.sendMessage(input.chatId, "Lệnh không rõ. Gõ /help để xem danh sách.");
    return true;
  }

  private ownerCommand(base: string, rest: string): string {
    const sqlite = this.deps.sqlite;
    if (base === "/digest") return JSON.stringify(buildDigest(sqlite, () => this.now()));
    if (base === "/goal") {
      if (!rest) return "Thiếu nội dung mục tiêu.";
      const videos = Number(rest.match(/(\d+)\s*video/i)?.[1] ?? 1);
      const hour = rest.match(/lúc\s*(\d{1,2})h/i)?.[1];
      const saved = saveGoal(sqlite, {
        text: rest,
        source: "telegram",
        spec: { videosPerDay: videos, platforms: ["youtube"], formats: ["long"], publishTime: hour ? `${hour.padStart(2, "0")}:00` : "20:00", topicFocus: [rest] },
      });
      return saved.warning ? `${saved.warning} Đã lưu mục tiêu.` : "Đã lưu mục tiêu.";
    }
    if (base === "/feedback") {
      if (!rest) return "Thiếu nội dung góp ý.";
      const saved = savePreference(sqlite, { rule: rest, quote: rest, scope: ["tts", "script"] });
      if (saved.note) return saved.note;
      return saved.retired.length ? `Quy tắc mới thay ${saved.retired.join("; ")}.` : "Đã lưu quy tắc.";
    }
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts[0] === "off") {
      const profileId = parts[1];
      saveAutonomySettings(sqlite, { level: "assist", grants: AUTONOMY_PRESETS.assist }, profileId);
      return profileId ? "Đã hạ quyền hồ sơ về Trợ giúp." : "Đã hạ quyền toàn app về Trợ giúp.";
    }
    if (parts[0] === "on") {
      if (!consumeRaiseCode(sqlite, parts[1] ?? "", () => this.now())) return "Nâng quyền cần mã một lần trên giao diện web.";
      saveAutonomySettings(sqlite, { level: "supervised", grants: AUTONOMY_PRESETS.supervised }, parts[2]);
      return "Đã nâng quyền lên Có giám sát.";
    }
    const rows = sqlite.prepare("SELECT id, name FROM profiles WHERE archived_at IS NULL").all() as Array<{ id: string; name: string }>;
    const lines = ["Toàn app: " + autonomySettings(sqlite).level, ...rows.map((row) => `${row.name}: ${autonomySettings(sqlite, row.id).level}`)];
    return lines.join("\n");
  }

  private async replyAssistant(client: TelegramClient, chatId: string, text: string): Promise<void> {
    const conversation = this.deps.assistant.getOrCreateTelegramConversation();
    try {
      const result = await this.deps.assistant.sendMessage(conversation.id, text);
      const assistantMsgs = result.messages.filter((message) => message.role === "assistant");
      const last = assistantMsgs[assistantMsgs.length - 1];
      let reply = last?.content.text?.trim() || "Đã xử lý.";
      if (last?.content.clarify) reply = last.content.clarify.question;
      await client.sendMessage(chatId, escapeHtml(reply));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await client.sendMessage(chatId, `Lỗi trợ lý: ${escapeHtml(message)}`);
    }
  }

  private async sendOrders(client: TelegramClient, chatId: string): Promise<void> {
    const orders = this.listOrders();
    if (!orders.length) {
      await client.sendMessage(chatId, "Chưa có lệnh thường trực.");
      return;
    }
    const lines = orders.map((order) => `${order.enabled ? "bật" : "tắt"} — ${order.title}`);
    await client.sendMessage(chatId, escapeHtml(lines.join("\n")), {
      buttons: orders.slice(0, 8).map((order) => [{
        text: order.enabled ? `Tắt ${order.title}`.slice(0, 40) : `Bật ${order.title}`.slice(0, 40),
        data: `ord:${order.id}:${order.enabled ? "off" : "on"}`,
      }]),
    });
  }

  private statusText(): string {
    const usage = this.overview().usage as { today: number; cap: number };
    const active = this.active ? "đang chạy" : "không chạy";
    return `Operator: ${active}. Hàng đợi: ${this.waiting.length}. Hôm nay ${usage.today}/${usage.cap}.`;
  }

  private checkSkillReports(now: Date): void {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", hourCycle: "h23" }).format(now));
    if (hour < 7) return;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now);
    const key = "skillReports.lastCheckDate";
    const previous = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (previous && JSON.parse(previous.value) === day) return;
    const result = checkDueSkillReports(this.deps.sqlite, now);
    this.deps.sqlite.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run(key, JSON.stringify(day), now.toISOString());
    if (result.due > 0 || result.newSai > 0) {
      void this.notifySummary(`Báo cáo cần kiểm chứng: ${result.due}. Kết luận sai mới: ${result.newSai}.`);
    }
  }

  private supervisorHooks(): OperatorSupervisorHooks {
    return {
      listRuns: (limit) => (this.deps.sqlite.prepare("SELECT * FROM operator_runs ORDER BY created_at DESC, rowid DESC LIMIT ?")
        .all(Math.min(Math.max(limit, 1), 50)) as Array<Record<string, unknown>>).map((row) => this.publicRun(row)),
      getRun: (runId) => this.getRun(runId) ?? null,
      stopRun: (runId) => {
        if (this.active?.runId === runId) {
          this.stopActive();
          return { stopped: true, message: "Đã yêu cầu dừng lượt đang chạy." };
        }
        const index = this.waiting.findIndex((job) => job.runId === runId);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          this.deps.sqlite.prepare("UPDATE operator_runs SET status = 'killed', outcome = 'killed', finished_at = ? WHERE id = ?")
            .run(this.now().toISOString(), runId);
          return { stopped: true, message: "Đã bỏ lượt khỏi hàng đợi." };
        }
        return { stopped: false, message: "Lượt này không còn chạy." };
      },
      newSession: () => this.newSession(this.latestConversation("web")),
      enqueue: (input) => {
        const scope = [input.profileId ? `Kênh: ${input.profileId}` : "", input.projectId ? `Dự án: ${input.projectId}` : ""]
          .filter(Boolean).join(" · ");
        const prompt = `[Giao bởi ${input.assignedBy} · ưu tiên ${input.priority}] ${input.instruction}${scope ? `
${scope}` : ""}`;
        const result = this.submit({ prompt, kind: "chat", origin: "wake" });
        return { runId: result.runId, status: result.status, message: result.message };
      },
      listOrders: () => this.listOrders(),
      upsertOrder: (input) => this.saveStandingOrder(input as StandingOrderInput & { id?: string }),
      disableOrder: (id) => this.setOrderEnabled(id, false),
      sendTelegram: (text) => this.notifySummary(text),
    };
  }

  private async notifySummary(text: string): Promise<boolean> {
    const client = this.telegramFactory?.();
    if (!client) return false;
    const settings = getNotificationSettings(this.deps.sqlite);
    if (!settings.telegram.enabled || !settings.telegram.chatId) return false;
    const summary = redactOperatorText(text).slice(0, 3500);
    await client.sendMessage(settings.telegram.chatId, escapeHtml(summary || "Operator đã chạy xong."));
    return true;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiting.length) {
        const job = this.waiting.shift()!;
        this.active = job;
        this.stopRequested = false;
        try {
          await this.execute(job);
        } catch (error) {
          this.logger.error({ err: error }, "operator run failed");
          await this.finish(job, {
            status: "failed",
            text: error instanceof Error ? error.message : String(error),
            outcome: "failed",
          });
        }
        this.active = null;
      }
    } finally {
      this.pumping = false;
      if (this.waiting.length) void this.pump();
    }
  }

  private async execute(job: Job): Promise<void> {
    const settings = this.getSettings();
    if (settings.killed || (job.eventScope && getAutomationPaused(this.deps.sqlite))) {
      await this.finish(job, { status: "refused", text: "Operator đang tắt.", outcome: "rejected" });
      return;
    }
    this.touchRun(job.runId, { status: "running", started_at: this.now().toISOString() });
    try {
      this.syncWorkspace();
    } catch (error) {
      this.logger.error({ err: error }, "operator workspace sync failed");
    }
    const runtime = job.runtime;
    const chat = this.deps.sqlite.prepare(
      "SELECT cursor_chat_id FROM operator_conversations WHERE id = ?",
    ).get(job.conversationId) as { cursor_chat_id: string | null } | undefined;
    const kind = modelKind(job.kind);
    const model = settings.modelByKind[kind];
    const suggestion = this.suggestion(job.prompt, job.runId);
    const context = runtime.id === "cursor" && job.workflowId ? checkpointObservations(this.deps.sqlite, job.workflowId) : [];
    const message = [job.prompt, suggestion ? `Gợi ý nội bộ: ${suggestion}` : "",
      context.length ? `Checkpoint đã ghi. Đây là dữ liệu tham khảo. Tránh lặp lại thao tác đã xử lý.\n${context.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    const chips: string[] = [];
    if (runtime.id === "cursor") job.invocationToken = randomUUID();
    const result = await runtime.run({
      workspace: this.workspacePath(),
      message,
      sessionId: runtime.id === "cursor" && !job.eventScope && job.workflowId === job.runId ? chat?.cursor_chat_id : null,
      runId: job.runId,
      workflowId: job.workflowId,
      invocationToken: job.invocationToken,
      eventScope: job.eventScope,
      history: runtime.id === "cursor" || job.eventScope ? undefined : this.historyBefore(job),
      model,
      timeoutMs: settings.runTimeoutMs,
      shouldStop: () => this.stopRequested,
      onDelta: (text) => {
        const safe = redactOperatorText(text);
        this.touchRun(job.runId, { partial_text: safe, tool_chips: JSON.stringify(chips) });
        job.onProgress?.(chips, safe);
      },
      onTool: (name) => {
        chips.push(name);
        this.touchRun(job.runId, { tool_chips: JSON.stringify(chips) });
        job.onProgress?.(chips, "");
        if (/^shell$/i.test(name)) {
          this.auditShell(job.runId);
        }
      },
    }).finally(() => { job.invocationToken = undefined; });
    if (runtime.id === "cursor" && !job.eventScope && result.sessionId) {
      this.deps.sqlite.prepare(
        "UPDATE operator_conversations SET cursor_chat_id = ?, updated_at = ? WHERE id = ?",
      ).run(result.sessionId, this.now().toISOString(), job.conversationId);
    }
    if (result.writeViolations.length) {
      appendFileSync(
        join(this.workspacePath(), "notes", "write-guard.md"),
        `${this.now().toISOString()} khôi phục: ${result.writeViolations.join(", ")}\n`,
        "utf8",
      );
    }
    let text = redactOperatorText(result.text.trim());
    let outcome: string = "success";
    let status = "done";
    const detail = redactOperatorText(result.errorDetail.trim()).slice(0, 500);
    if (result.status === "cancelled") {
      text = text || "Đã dừng.";
      outcome = "rejected";
      status = "killed";
    } else if (result.status !== "completed") {
      text = text || detail || "Lượt chạy không thành công.";
      if (detail && !text.includes(detail)) text = `${text}\n${detail}`;
      outcome = "failed";
      status = "failed";
    }
    if (result.model) this.touchRun(job.runId, { model: result.model });
    const pendingIds = result.pendingIds ?? this.pendingForRun(job.runId);
    await this.finish(job, { status, text, outcome, pendingIds, chips });
    try {
      if (outcome === "failed" || outcome === "rejected") this.appendLesson(job.prompt, text);
      if (outcome === "failed" && detail) this.learnFromFailure(job.runId, detail, chips);
      if (outcome === "success") this.considerProposal(job.prompt, chips);
    } catch (error) {
      this.logger.error({ err: error }, "operator lesson failed");
    }
  }

  private async finish(job: Job, input: {
    status: string;
    text: string;
    outcome: string;
    pendingIds?: string[];
    chips?: string[];
  }): Promise<void> {
    const text = redactOperatorText(input.text);
    this.touchRun(job.runId, {
      status: input.status,
      result: text,
      partial_text: text,
      outcome: input.outcome,
      finished_at: this.now().toISOString(),
      pending_action_ids: JSON.stringify(input.pendingIds ?? []),
      ...(input.chips ? { tool_chips: JSON.stringify(input.chips) } : {}),
    });
    this.insertMessage(job.conversationId, job.runId, "assistant", text);
    this.deps.sqlite.prepare(
      "UPDATE operator_routing_log SET outcome = ? WHERE run_id = ?",
    ).run(input.outcome, job.runId);
    await job.onDone?.({ text, pendingIds: input.pendingIds ?? [] });
  }

  private suggestion(prompt: string, runId: string): string {
    const routed = routeQuery(prompt, this.skillCandidates(), 3);
    this.logRouting(prompt, routed, runId);
    const names = routed.flatMap((part) => part.hits.slice(0, 2).map((hit) => hit.name));
    if (!names.length) return "";
    return `Gọi find_skills rồi đọc các kỹ năng: ${[...new Set(names)].join(", ")}.`;
  }

  private skillCandidates(): RouteCandidate[] {
    const history = this.historyEvents();
    const now = this.now();
    const generated = skillBodiesForRouting().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      shortBody: skill.shortBody,
      triggers: skill.triggers,
      antiTriggers: skill.antiTriggers,
      area: skill.area,
      history: historicalSuccess(history, now, skill.id),
    }));
    const repo = this.repoSkillBundle().skills.map((skill) => ({
      id: `repo:${skill.name}`,
      name: skill.name,
      description: skill.description,
      body: skill.longNotes.join(" "),
      shortBody: skill.shortSteps.join(" "),
      triggers: skill.triggers,
      antiTriggers: skill.antiTriggers,
      area: skill.area,
      history: historicalSuccess(history, now, `repo:${skill.name}`),
    }));
    const user = this.userSkills().map((skill) => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      body: skill.longNotes.join(" "),
      shortBody: skill.shortSteps.join(" "),
      triggers: skill.triggers,
      antiTriggers: skill.antiTriggers,
      area: skill.area,
      history: historicalSuccess(history, now, skill.name),
    }));
    return [...generated, ...repo, ...user];
  }

  repoSkillSummaries(): Array<{ name: string; area: string; risk: string; tools: string[]; description: string }> {
    return this.repoSkillBundle().skills.map((skill) => ({
      name: skill.name,
      area: skill.area,
      risk: skill.risk,
      tools: skill.tools,
      description: skill.description,
    }));
  }

  repoSkillRejections(): Array<{ path: string; errors: string[] }> {
    return this.repoSkillBundle().rejected;
  }

  readRepoSkill(name: string): RepoSkill {
    const skill = this.repoSkillBundle().skills.find((item) => item.name === name);
    if (!skill) throw new AppError(404, "SKILL_NOT_FOUND", "Không có kỹ năng này");
    return skill;
  }

  private repoSkillBundle(): { skills: RepoSkill[]; rejected: Array<{ path: string; errors: string[] }> } {
    return loadRepoSkills({
      root: repoRoot(),
      toolNames: new Set(getToolCatalogForPrompt().map((tool) => tool.name)),
      builtinNames: new Set(OPERATOR_SKILLS.map((skill) => skill.name)),
      userNames: new Set(this.userSkills().map((skill) => skill.name)),
    });
  }

  private toolCandidates(): RouteCandidate[] {
    const history = this.historyEvents();
    const now = this.now();
    return getToolCatalogForPrompt().map((tool) => ({
      id: tool.name,
      name: tool.name,
      description: tool.description,
      body: tool.description,
      shortBody: tool.description,
      triggers: [tool.name.replaceAll("_", " ")],
      antiTriggers: [],
      area: "Quy trình",
      history: historicalSuccess(history, now, tool.name),
    }));
  }

  private userSkills(): OperatorSkill[] {
    const dir = join(this.workspacePath(), "skills", "user");
    const active = listSkillVersions(this.deps.sqlite, true);
    const registered = new Set(active.map((item) => item.name));
    const skills: OperatorSkill[] = [];
    const legacy = existsSync(dir) ? readdirSync(dir)
      .filter((name) => name.endsWith(".md") && !registered.has(name.slice(0, -3)))
      .map((name) => readFileSync(join(dir, name), "utf8")) : [];
    for (const markdown of [...active.map((item) => item.markdown), ...legacy]) {
      const parsed = parseSkillMarkdown(markdown);
      if (!parsed) continue;
      skills.push({
        area: "user",
        topic: parsed.name,
        name: parsed.name,
        description: parsed.description,
        triggers: parsed.triggers,
        antiTriggers: parsed.antiTriggers,
        tools: parsed.tools,
        risk: parsed.risk === "read" || parsed.risk === "safe" || parsed.risk === "confirm" ? parsed.risk : "confirm",
        shortSteps: parsed.shortBody.split("\n").map((line) => line.replace(/^- /, "")).filter(Boolean),
        longNotes: [parsed.body],
      });
    }
    return skills;
  }

  private historyEvents(): HistoryEvent[] {
    const rows = this.deps.sqlite.prepare(
      "SELECT picked, outcome, created_at FROM operator_routing_log WHERE outcome IS NOT NULL",
    ).all() as Array<{ picked: string; outcome: string; created_at: string }>;
    const events: HistoryEvent[] = [];
    for (const row of rows) {
      const picked = JSON.parse(row.picked) as unknown;
      const ids = Array.isArray(picked) ? picked.filter((item) => typeof item === "string") : [];
      for (const id of ids) events.push({ id, at: row.created_at, outcome: row.outcome });
    }
    return events;
  }

  private logRouting(query: string, routed: ReturnType<typeof routeQuery>, runId: string | null): void {
    const picked = routed.flatMap((part) => part.hits.map((hit) => hit.id));
    this.deps.sqlite.prepare(
      `INSERT INTO operator_routing_log (id, query, candidates, picked, run_id, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      randomUUID(),
      query,
      JSON.stringify(routed),
      JSON.stringify(picked),
      runId,
      this.now().toISOString(),
    );
  }

  private considerProposal(prompt: string, chips: string[]): void {
    const successes = this.deps.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM operator_runs WHERE prompt = ? AND outcome = 'success'",
    ).get(prompt) as { n: number };
    const routed = routeQuery(prompt, this.skillCandidates(), 1);
    const best = routed[0]?.hits[0]?.score ?? 0;
    if (!shouldProposeSkill({
      toolCount: chips.length,
      successCount: successes.n,
      bestSkillScore: best,
    })) return;
    const slug = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
    const dir = join(this.workspacePath(), "notes", "skill-proposals");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${slug}.md`);
    if (existsSync(path)) return;
    const tools = chips.filter((name) => ASSISTANT_TOOLS[name]).slice(0, 6);
    if (tools.length < 2) return;
    const draft: OperatorSkill = {
      area: "user",
      topic: slug,
      name: `draft-${slug}`,
      description: "Quy trình lặp lại đã thành công nhiều lần.",
      triggers: [prompt.slice(0, 80)],
      antiTriggers: ["xoá"],
      tools,
      risk: "confirm",
      shortSteps: ["Làm lại các bước đã thành công.", "Kiểm tra bằng công cụ đọc."],
      longNotes: ["Người dùng phải duyệt trước khi nạp vào danh sách kỹ năng."],
    };
    writeFileSync(path, renderSkillMarkdown(draft), "utf8");
  }

  private learnFromFailure(runId: string, detail: string, chips: string[]): void {
    const tool = chips.at(-1);
    if (!tool || !Object.hasOwn(ASSISTANT_TOOLS, tool) || containsProtectedProject(detail)) return;
    const key = createHash("sha256").update(JSON.stringify([tool, detail])).digest("hex").slice(0, 16);
    this.touchRun(runId, { error: `skill-learning:${key}` });
    const since = new Date(this.now().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.deps.sqlite.prepare(
      `SELECT id FROM operator_runs WHERE status = 'failed' AND error = ? AND created_at >= ?
       ORDER BY created_at ASC, id LIMIT 3`,
    ).all(`skill-learning:${key}`, since) as Array<{ id: string }>;
    if (rows.length < 3) return;
    const name = `recover-${key}`;
    const markdown = renderSkillMarkdown({
      name, area: "user", topic: name,
      description: `Kiểm tra trước khi thử lại ${tool} sau lỗi lặp lại.`,
      triggers: [tool, `lỗi ${tool}`], antiTriggers: ["bỏ qua duyệt"],
      tools: ["find_tools"], risk: "read",
      shortSteps: [
        `Tra quyền và tham số của ${tool} bằng find_tools.`,
        "Đọc checkpoint và báo người dùng nếu trạng thái chưa rõ.",
      ],
      longNotes: [
        "Năng lực cần có: tra cứu registry.",
        `Ví dụ: gọi find_tools với query "${tool}" trước khi đề xuất cách tiếp tục.`,
      ],
    });
    saveSkillDraft(this.deps.sqlite, markdown, { source: "repeated_failure", runIds: rows.map((row) => row.id) }, this.skillRegistry());
  }

  private appendLesson(prompt: string, text: string): void {
    const line = `- ${this.now().toISOString()} ${redactOperatorText(prompt).slice(0, 80)}: ${redactOperatorText(text).slice(0, 160)}\n`;
    appendFileSync(join(this.workspacePath(), "notes", "lessons.md"), line, "utf8");
  }

  private auditShell(runId: string): void {
    this.deps.sqlite.prepare(
      `INSERT INTO operator_tool_audit
       (id, source, tool, args, risk, decision, summary, pending_action_id, run_id, created_at)
       VALUES (?, 'operator', 'Shell', '{}', 'confirm', 'refused', ?, NULL, ?, ?)`,
    ).run(randomUUID(), "Lệnh shell bị từ chối.", runId, this.now().toISOString());
  }

  private pendingForRun(runId: string): string[] {
    const rows = this.deps.sqlite.prepare(
      `SELECT DISTINCT pending.id FROM operator_tool_audit AS audit
       JOIN assistant_pending_actions AS pending ON pending.id = audit.pending_action_id
       WHERE audit.run_id = ? AND pending.status = 'pending'`,
    ).all(runId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private listSystemPending(): Array<{ id: string; summary: string; status: string }> {
    const conversationId = this.deps.assistant.ensureCallerConversation(SYSTEM_OPERATOR);
    const rows = this.deps.sqlite.prepare(
      `SELECT id, summary, status FROM assistant_pending_actions
       WHERE conversation_id = ? AND status = 'pending' ORDER BY created_at ASC`,
    ).all(conversationId) as Array<{ id: string; summary: string; status: string }>;
    return rows;
  }

  private onPendingResolved(id: string, status: "confirmed" | "rejected" | "failed"): void {
    if (status === "confirmed") return;
    const rows = this.deps.sqlite.prepare(
      "SELECT id, prompt FROM operator_runs WHERE pending_action_ids LIKE ?",
    ).all(`%${id}%`) as Array<{ id: string; prompt: string }>;
    for (const row of rows) {
      this.deps.sqlite.prepare(
        "UPDATE operator_runs SET outcome = 'pending_rejected' WHERE id = ?",
      ).run(row.id);
      this.deps.sqlite.prepare(
        "UPDATE operator_routing_log SET outcome = 'pending_rejected' WHERE run_id = ?",
      ).run(row.id);
      this.appendLesson(row.prompt, "Người dùng từ chối thao tác chờ.");
    }
  }

  private dailyRunCap(settings: OperatorSettings, profileId?: string): number {
    const appCap = readAutonomyBudget(this.deps.sqlite).maxOperatorRunsPerDay;
    const profileCap = profileId ? readAutonomyBudget(this.deps.sqlite, profileId).maxOperatorRunsPerDay : undefined;
    const cap = profileCap ?? appCap;
    return cap == null ? settings.maxRunsPerDay : Math.min(cap, settings.maxRunsPerDay);
  }

  private profileRuns(profileId: string, dayKey: string): number {
    const row = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(`autonomy.operatorRuns.${profileId}.${dayKey}`) as { value: string } | undefined;
    const count = row ? Number(row.value) : 0;
    return Number.isFinite(count) ? count : 0;
  }

  private noteProfileRun(profileId: string, dayKey: string): void {
    const key = `autonomy.operatorRuns.${profileId}.${dayKey}`;
    const next = this.profileRuns(profileId, dayKey) + 1;
    this.deps.sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, String(next), this.now().toISOString());
  }

  private runsOnDay(dayKey: string): number {
    const row = this.deps.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM operator_runs WHERE day_key = ? AND status != 'refused'",
    ).get(dayKey) as { n: number };
    return row.n;
  }

  private runsInMonth(month: string): number {
    const row = this.deps.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM operator_runs WHERE day_key LIKE ? AND status != 'refused'",
    ).get(`${month}%`) as { n: number };
    return row.n;
  }

  private tickLastFired(): string | null {
    const row = this.deps.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(TICK_KEY) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private setTickLastFired(value: string): void {
    this.deps.sqlite.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(TICK_KEY, value, value);
  }

  private syncSeeds(): void {
    const now = this.now().toISOString();
    for (const order of seededStandingOrders) {
      const existing = this.deps.sqlite.prepare("SELECT id FROM standing_orders WHERE id = ?").get(order.id);
      if (existing) continue;
      this.deps.sqlite.prepare(
        `INSERT INTO standing_orders
         (id, title, prompt, cron, enabled, seeded, module_id, created_at, updated_at, last_fired_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
      ).run(order.id, order.title, order.prompt, order.cron, order.enabled ? 1 : 0, order.moduleId, now, now);
        stampWorkspace(this.deps.sqlite, "standing_orders", order.id);
    }
  }

  private insertRun(input: {
    runId: string;
    conversationId: string;
    kind: string;
    origin: string;
    prompt: string;
    status: string;
    dayKey: string;
    outcome: string | null;
    runtimeId?: string;
    workflowId?: string;
  }): void {
    const now = this.now().toISOString();
    this.deps.sqlite.prepare(
      `INSERT INTO operator_runs
       (id, conversation_id, kind, status, prompt, result, partial_text, tool_chips, model, error, outcome, origin, day_key, pending_action_ids, started_at, finished_at, created_at, runtime_id, workflow_id)
       VALUES (?, ?, ?, ?, ?, NULL, '', '[]', NULL, NULL, ?, ?, ?, '[]', NULL, NULL, ?, ?, ?)`,
    ).run(
      input.runId,
      input.conversationId,
      input.kind,
      input.status,
      input.prompt,
      input.outcome,
      input.origin,
      input.dayKey,
      now,
      input.runtimeId ?? null,
      input.workflowId ?? null,
    );
  }

  private insertMessage(conversationId: string, runId: string, role: string, text: string): void {
    this.deps.sqlite.prepare(
      `INSERT INTO operator_messages (id, conversation_id, run_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), conversationId, runId, role, JSON.stringify({ text }), this.now().toISOString());
  }

  private historyBefore(job: Job): string {
    const rows = this.deps.sqlite.prepare(
      `SELECT role, content FROM operator_messages
       WHERE conversation_id = ? AND rowid < (
         SELECT min(rowid) FROM operator_messages WHERE run_id = ? AND role = 'user'
       )
       ORDER BY rowid DESC LIMIT 12`,
    ).all(job.conversationId, job.runId) as Array<{ role: string; content: string }>;
    return rows.reverse().map(({ role, content }) => {
      const { text } = JSON.parse(content) as { text?: string };
      return `${role}: ${redactOperatorText(text ?? "").slice(0, 600)}`;
    }).join("\n");
  }

  private touchRun(runId: string, fields: Record<string, string>): void {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const sql = `UPDATE operator_runs SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`;
    this.deps.sqlite.prepare(sql).run(...keys.map((key) => fields[key]), runId);
  }

  private publicRun(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      kind: row.kind,
      status: row.status,
      prompt: redactOperatorText(String(row.prompt ?? "")),
      result: row.result == null ? null : redactOperatorText(String(row.result)),
      partialText: redactOperatorText(String(row.partial_text ?? "")),
      toolChips: JSON.parse(String(row.tool_chips ?? "[]")),
      model: row.model,
      runtimeId: row.runtime_id,
      workflowId: row.workflow_id,
      canResume: Boolean(!String(row.id).startsWith("event-") && row.workflow_id && (row.status === "failed" || row.status === "killed"
        || (row.status === "done" && JSON.parse(String(row.pending_action_ids ?? "[]")).length))),
      outcome: row.outcome,
      origin: row.origin,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
    };
  }
}

function modelKind(kind: OperatorRunKind): "chat" | "tick" | "research" | "eval" {
  if (kind === "research") return "research";
  if (kind === "eval") return "eval";
  if (kind === "chat") return "chat";
  return "tick";
}

function automationEnabled(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw) as { enabled?: boolean };
    return value.enabled === true;
  } catch {
    return false;
  }
}

function renderOrdersMarkdown(orders: Array<{ title: string; prompt: string; cron: string | null; enabled: boolean }>): string {
  const lines = ["# Lệnh thường trực", ""];
  if (!orders.length) lines.push("Chưa có lệnh.");
  for (const order of orders) {
    lines.push(`- ${order.title} (${order.enabled ? "bật" : "tắt"}${order.cron ? `, ${order.cron}` : ""}): ${order.prompt}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function operatorToolNames(): Set<string> {
  return new Set(Object.keys(ASSISTANT_TOOLS));
}
