import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  LOGIN_HINT_VI,
  StandingOrderInputSchema,
  localDateString,
  redactOperatorText,
  resolveTelegramEngine,
  type OperatorRunKind,
  type OperatorSettings,
  type StandingOrderInput,
} from "@vg/shared";
import type { AssistantService } from "../assistant/service.js";
import { ASSISTANT_TOOLS, getToolCatalogForPrompt } from "../assistant/tools.js";
import { getNotificationSettings } from "../settings/notifications.js";
import { escapeHtml, splitTelegramMessage, type TelegramClient } from "../notifications/telegram.js";
import { readQuotaStatus } from "../providers/llm/quota.js";
import { buildCursorArgs, cursorLaunch, detectCursorCli } from "./cli.js";
import { isCronDue } from "./cron.js";
import { operatorDuties, seededStandingOrders } from "./extensions.js";
import { setOperatorToolHooks } from "./hooks.js";
import { historicalSuccess, routeQuery, type HistoryEvent, type RouteCandidate } from "./routing.js";
import { runCursorProcess, type SpawnFn, defaultSpawn } from "./runtime.js";
import { getOperatorSettings, saveOperatorSettings } from "./settings.js";
import {
  OPERATOR_SKILLS,
  parseSkillMarkdown,
  renderSkillMarkdown,
  shouldProposeSkill,
  validateSkillMarkdown,
  type OperatorSkill,
} from "./skills.js";
import { operatorDir, readNote, skillBodiesForRouting, writeOperatorWorkspace } from "./workspace.js";

const SYSTEM_OPERATOR = "Hệ thống operator";
const TICK_PROMPT = "Kiểm tra trạng thái và thực hiện các lệnh thường trực.";
const TICK_KEY = "operator.tickLastFired";
const ZONE = "Asia/Ho_Chi_Minh";

type Origin = "user" | "schedule" | "wake";

type Job = {
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
    now?: () => Date;
    logger?: Logger;
  }) {
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? { info: () => undefined, error: () => undefined };
    setOperatorToolHooks({
      saveStandingOrder: (input) => this.saveStandingOrder({ ...input, enabled: true }),
      findSkills: (query) => this.findSkills(query),
      findTools: (query) => this.findTools(query),
    });
    this.deps.assistant.setPendingListener((id, status) => this.onPendingResolved(id, status));
    try {
      this.syncWorkspace();
    } catch (error) {
      this.logger.error({ err: error }, "operator workspace sync failed");
    }
  }

  setSpawn(spawnImpl: SpawnFn): void {
    this.spawnImpl = spawnImpl;
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
    const parsed = StandingOrderInputSchema.parse(input);
    const now = this.now().toISOString();
    const id = input.id ?? randomUUID();
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

  submit(input: {
    conversationId?: string;
    channel?: "web" | "telegram";
    prompt: string;
    kind?: OperatorRunKind;
    origin?: Origin;
    onProgress?: Job["onProgress"];
    onDone?: Job["onDone"];
  }): OperatorSubmitResult {
    const settings = this.getSettings();
    const conversationId = input.conversationId ?? this.latestConversation(input.channel ?? "web");
    const prompt = redactOperatorText(input.prompt);
    if (settings.killed) {
      return {
        runId: "",
        conversationId,
        position: 0,
        status: "refused",
        message: "Operator đang tắt.",
      };
    }
    const dayKey = localDateString(this.now(), ZONE);
    if (this.runsOnDay(dayKey) >= settings.maxRunsPerDay) {
      const runId = randomUUID();
      this.insertRun({
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
        message: `Đã hết số lượt operator trong ngày (${settings.maxRunsPerDay}).`,
      };
    }
    const runId = randomUUID();
    this.insertRun({
      runId,
      conversationId,
      kind: input.kind ?? "chat",
      origin: input.origin ?? "user",
      prompt,
      status: "queued",
      dayKey,
      outcome: null,
    });
    this.insertMessage(conversationId, runId, "user", prompt);
    const busy = this.active !== null || this.pumping;
    const job: Job = {
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

  tick(now = this.now()): { started: string[] } {
    if (this.getSettings().killed) return { started: [] };
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

  findSkills(query: string): unknown {
    const routed = routeQuery(query, this.skillCandidates());
    this.logRouting(query, routed, null);
    return {
      parts: routed.map((part) => ({
        query: part.query,
        hits: part.hits.map((hit) => ({
          name: hit.name,
          description: hit.description,
          score: hit.score,
          breakdown: hit.breakdown,
          short: hit.shortBody,
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
    const detected = detectCursorCli();
    const launch = cursorLaunch({ detected, cursorPath: settings.cursorPath });
    const dayKey = localDateString(this.now(), ZONE);
    const month = dayKey.slice(0, 7);
    const runs = (this.deps.sqlite.prepare(
      "SELECT * FROM operator_runs ORDER BY created_at DESC LIMIT 30",
    ).all() as Array<Record<string, unknown>>).map((row) => this.publicRun(row));
    const audit = this.deps.sqlite.prepare(
      "SELECT * FROM operator_tool_audit ORDER BY created_at DESC LIMIT 40",
    ).all();
    const conversationId = this.latestConversation("web");
    return {
      killed: settings.killed,
      cli: {
        found: Boolean(launch),
        version: launch?.version ?? detected?.version ?? null,
        loggedIn: null,
        model: settings.modelByKind.chat || null,
        manualModels: settings.manualModels,
      },
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
        cap: settings.maxRunsPerDay,
      },
      conversationId,
    };
  }

  resumeCommand(conversationId: string): string {
    const settings = this.getSettings();
    const detected = detectCursorCli();
    const launch = cursorLaunch({ detected, cursorPath: settings.cursorPath });
    const row = this.deps.sqlite.prepare(
      "SELECT cursor_chat_id FROM operator_conversations WHERE id = ?",
    ).get(conversationId) as { cursor_chat_id: string | null } | undefined;
    const resume = row?.cursor_chat_id ? ` --resume ${row.cursor_chat_id}` : "";
    if (!launch) return "Chưa thấy cursor-agent.";
    if (launch.indexArg) return `"${launch.command}" "${launch.indexArg}"${resume}`;
    return `${launch.command}${resume}`;
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
    const destDir = join(root, "skills", "user");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, `${parsed.name}.md`), markdown, "utf8");
    this.syncWorkspace();
    return { ok: true, errors: [] };
  }

  async handleTelegram(input: { chatId: string; text: string }): Promise<boolean> {
    const client = this.telegramFactory?.() ?? null;
    if (!client) return false;
    const command = input.text.split(/\s+/)[0]?.toLowerCase() ?? "";
    const base = command.split("@")[0] ?? command;
    const rest = input.text.slice(command.length).trim();
    if (base === "/pause" || base === "/help" || base === "/start") return false;
    const settings = this.getSettings();
    const engine = resolveTelegramEngine(settings);

    if (base === "/tl") {
      await this.replyAssistant(client, input.chatId, rest || input.text);
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

  private async notifySummary(text: string): Promise<void> {
    const client = this.telegramFactory?.();
    if (!client) return;
    const settings = getNotificationSettings(this.deps.sqlite);
    if (!settings.telegram.enabled || !settings.telegram.chatId) return;
    const summary = redactOperatorText(text).slice(0, 3500);
    await client.sendMessage(settings.telegram.chatId, escapeHtml(summary || "Operator đã chạy xong."));
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
    if (settings.killed) {
      await this.finish(job, { status: "refused", text: "Operator đang tắt.", outcome: "rejected" });
      return;
    }
    this.touchRun(job.runId, { status: "running", started_at: this.now().toISOString() });
    try {
      this.syncWorkspace();
    } catch (error) {
      this.logger.error({ err: error }, "operator workspace sync failed");
    }
    const detected = detectCursorCli();
    const launch = cursorLaunch({ detected, cursorPath: settings.cursorPath });
    if (!launch) {
      await this.finish(job, {
        status: "failed",
        text: "Chưa tìm thấy Cursor CLI. Đặt đường dẫn trong cài đặt operator.",
        outcome: "failed",
      });
      return;
    }
    const chat = this.deps.sqlite.prepare(
      "SELECT cursor_chat_id FROM operator_conversations WHERE id = ?",
    ).get(job.conversationId) as { cursor_chat_id: string | null } | undefined;
    const kind = modelKind(job.kind);
    const model = settings.modelByKind[kind];
    const suggestion = this.suggestion(job.prompt, job.runId);
    const message = suggestion ? `${job.prompt}\n\nGợi ý nội bộ: ${suggestion}` : job.prompt;
    const args = buildCursorArgs({
      indexArg: launch.indexArg,
      workspace: this.workspacePath(),
      message,
      chatId: chat?.cursor_chat_id,
      model,
    });
    const startedAt = this.now().toISOString();
    const chips: string[] = [];
    const result = await runCursorProcess({
      command: launch.command,
      args,
      cwd: this.workspacePath(),
      timeoutMs: settings.runTimeoutMs,
      spawnImpl: this.spawnImpl,
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
    });
    if (result.chatId) {
      this.deps.sqlite.prepare(
        "UPDATE operator_conversations SET cursor_chat_id = ?, updated_at = ? WHERE id = ?",
      ).run(result.chatId, this.now().toISOString(), job.conversationId);
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
    if (result.loggedOut) {
      text = LOGIN_HINT_VI;
      outcome = "failed";
      status = "failed";
    } else if (result.timedOut && this.stopRequested) {
      text = text || "Đã dừng.";
      outcome = "rejected";
      status = "killed";
    } else if (result.timedOut || (result.exitCode !== 0 && result.exitCode !== null)) {
      text = text || "Lượt chạy không thành công.";
      outcome = "failed";
      status = "failed";
    }
    const pendingIds = this.pendingSince(startedAt);
    await this.finish(job, { status, text, outcome, pendingIds, chips });
    try {
      if (outcome === "failed" || outcome === "rejected") this.appendLesson(job.prompt, text);
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
    return [...generated, ...user];
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
    if (!existsSync(dir)) return [];
    const skills: OperatorSkill[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const parsed = parseSkillMarkdown(readFileSync(join(dir, name), "utf8"));
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

  private pendingSince(since: string): string[] {
    const conversationId = this.deps.assistant.ensureCallerConversation(SYSTEM_OPERATOR);
    const rows = this.deps.sqlite.prepare(
      `SELECT id FROM assistant_pending_actions
       WHERE conversation_id = ? AND created_at >= ? AND status = 'pending'`,
    ).all(conversationId, since) as Array<{ id: string }>;
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
         VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, NULL)`,
      ).run(order.id, order.title, order.prompt, order.cron, order.moduleId, now, now);
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
  }): void {
    const now = this.now().toISOString();
    this.deps.sqlite.prepare(
      `INSERT INTO operator_runs
       (id, conversation_id, kind, status, prompt, result, partial_text, tool_chips, model, error, outcome, origin, day_key, pending_action_ids, started_at, finished_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, '', '[]', NULL, NULL, ?, ?, ?, '[]', NULL, NULL, ?)`,
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
    );
  }

  private insertMessage(conversationId: string, runId: string, role: string, text: string): void {
    this.deps.sqlite.prepare(
      `INSERT INTO operator_messages (id, conversation_id, run_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), conversationId, runId, role, JSON.stringify({ text }), this.now().toISOString());
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
