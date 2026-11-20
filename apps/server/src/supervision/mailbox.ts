import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { AssistantToolContext, AssistantToolDef } from "../assistant/tools.js";
import { currentActor, currentWorkspaceId } from "../auth/requestContext.js";
import { AppError } from "../lib/errors.js";
import { currentDuty } from "./duty.js";
import { fixedKeyAgent, type TrustedAgent } from "./identity.js";
import { holderRank } from "./leases.js";
import { routeToSubscribers } from "./subscriptions.js";
import { publishAgentEvent } from "../events/agentBus.js";

/** Chain of command reuses leases.ts holderRank: user 40, hermes on duty 30, hermes 20, other agents 10. */
export const MAILBOX_BODY_MAX = 8192;
export const MAILBOX_RATE_PER_MIN = 60;
export const MAILBOX_TTL_HOURS = 24;
export const QUESTION_DUTY_MIN = 15;
export const QUESTION_USER_MIN = 60;

export type MailKind = "directive" | "report" | "question" | "answer" | "handoff";
export type MailRow = {
  id: string; workspaceId: string; threadId: string; fromInstance: string; toKind: string; toValue: string; kind: string;
  missionId: string | null; projectId: string | null; body: string; attachments: string[]; createdAt: string; deliveredAt: string | null;
  ackedAt: string | null; ackedBy: string | null; expiresAt: string; escalatedDutyAt: string | null; escalatedUserAt: string | null;
};

type Raw = {
  id: string; workspace_id: string; thread_id: string; from_instance: string; to_kind: string; to_value: string; kind: string;
  mission_id: string | null; project_id: string | null; body: string; attachments: string; created_at: string; delivered_at: string | null;
  acked_at: string | null; acked_by: string | null; expires_at: string; escalated_duty_at: string | null; escalated_user_at: string | null;
};

function toRow(r: Raw): MailRow {
  return {
    id: r.id, workspaceId: r.workspace_id, threadId: r.thread_id, fromInstance: r.from_instance, toKind: r.to_kind, toValue: r.to_value,
    kind: r.kind, missionId: r.mission_id, projectId: r.project_id, body: r.body, attachments: JSON.parse(r.attachments) as string[],
    createdAt: r.created_at, deliveredAt: r.delivered_at, ackedAt: r.acked_at, ackedBy: r.acked_by, expiresAt: r.expires_at,
    escalatedDutyAt: r.escalated_duty_at, escalatedUserAt: r.escalated_user_at,
  };
}

function dutyHolder(sqlite: Database.Database, now = new Date()): string | null {
  return currentDuty(sqlite, now)?.instance ?? null;
}

/** Rank of an instance (`kind/name`) through the existing holderRank; `user` is the top rank. */
export function rankOf(sqlite: Database.Database, instance: string, now = new Date()): number {
  const kind = instance === "user" ? "user" : (instance.split("/")[0] ?? "other");
  return holderRank(kind, instance === dutyHolder(sqlite, now));
}

/** Rank the recipient must be at or above to receive a directive; unresolvable targets rank highest, so the message stays a question. */
function recipientRank(sqlite: Database.Database, workspaceId: string, target: { toKind: string; toValue: string }, now: Date): number {
  if (target.toKind === "instance") return rankOf(sqlite, target.toValue, now);
  if (target.toKind === "duty") {
    const holder = dutyHolder(sqlite, now);
    return holder ? rankOf(sqlite, holder, now) : Number.POSITIVE_INFINITY;
  }
  const holders = (sqlite.prepare("SELECT DISTINCT instance FROM agent_assignments WHERE workspace_id = ? AND role = ? AND active = 1")
    .all(workspaceId, target.toValue) as Array<{ instance: string }>).map((row) => row.instance);
  if (!holders.length) return Number.POSITIVE_INFINITY;
  return Math.max(...holders.map((instance) => rankOf(sqlite, instance, now)));
}

/** Roles of an agent instance from its active assignments. */
export function rolesOf(sqlite: Database.Database, workspaceId: string, instance: string): string[] {
  return (sqlite.prepare("SELECT DISTINCT role FROM agent_assignments WHERE workspace_id = ? AND instance = ? AND active = 1")
    .all(workspaceId, instance) as Array<{ role: string }>).map((r) => r.role);
}

/** A row is addressed to an agent if it names the instance, one of its roles, or the duty holder. An escalated question also reaches the duty holder. */
function addressedTo(sqlite: Database.Database, workspaceId: string, instance: string, row: Pick<MailRow, "toKind" | "toValue" | "escalatedDutyAt">, now: Date): boolean {
  if (row.escalatedDutyAt && dutyHolder(sqlite, now) === instance) return true;
  if (row.toKind === "instance") return row.toValue === instance;
  if (row.toKind === "role") return rolesOf(sqlite, workspaceId, instance).includes(row.toValue);
  if (row.toKind === "duty") return dutyHolder(sqlite, now) === instance;
  return false;
}

function parseTo(to: string): { toKind: "instance" | "role" | "duty"; toValue: string } {
  if (to === "duty") return { toKind: "duty", toValue: "duty" };
  if (to.startsWith("role:") && to.length > 5) return { toKind: "role", toValue: to.slice(5) };
  if (/^[a-z]+\/[A-Za-z0-9._-]+$/.test(to)) return { toKind: "instance", toValue: to };
  throw new AppError(422, "MAILBOX_BAD_RECIPIENT", "Người nhận phải là instance (kind/name), role:<tên> hoặc duty.");
}

export type SendInput = {
  workspaceId: string; from: string; to: string; kind: MailKind; body: string; threadId?: string | null;
  missionId?: string | null; projectId?: string | null; attachments?: string[];
};

export function sendMessage(sqlite: Database.Database, input: SendInput, now = new Date()): MailRow {
  if (Buffer.byteLength(input.body, "utf8") > MAILBOX_BODY_MAX) throw new AppError(422, "MAILBOX_BODY_TOO_LARGE", "Nội dung tối đa 8 KB.");
  const since = new Date(now.getTime() - 60_000).toISOString();
  const sent = sqlite.prepare("SELECT COUNT(*) AS n FROM agent_messages WHERE workspace_id = ? AND from_instance = ? AND created_at >= ?")
    .get(input.workspaceId, input.from, since) as { n: number };
  if (sent.n >= MAILBOX_RATE_PER_MIN) throw new AppError(429, "MAILBOX_RATE_LIMITED", "Đã gửi 60 tin trong một phút, hãy chờ.");
  const target = parseTo(input.to);
  // A directive from a lower rank to a higher one becomes a question (chain of command).
  let kind: MailKind = input.kind;
  if (kind === "directive" && rankOf(sqlite, input.from, now) < recipientRank(sqlite, input.workspaceId, target, now)) kind = "question";
  const row = {
    id: randomUUID(), workspace_id: input.workspaceId, thread_id: input.threadId ?? randomUUID(), from_instance: input.from,
    to_kind: target.toKind, to_value: target.toValue, kind, mission_id: input.missionId ?? null, project_id: input.projectId ?? null,
    body: input.body, attachments: JSON.stringify(input.attachments ?? []), created_at: now.toISOString(), delivered_at: null,
    acked_at: null, acked_by: null, expires_at: new Date(now.getTime() + MAILBOX_TTL_HOURS * 3_600_000).toISOString(),
    escalated_duty_at: null, escalated_user_at: null,
  };
  const stored = toRow(row as unknown as Raw);
  // One transaction: the message and its push deliveries land together or not at all, so a retry cannot duplicate the message.
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO agent_messages (id, workspace_id, thread_id, from_instance, to_kind, to_value, kind, mission_id, project_id, body,
      attachments, created_at, delivered_at, acked_at, acked_by, expires_at, escalated_duty_at, escalated_user_at)
      VALUES (@id, @workspace_id, @thread_id, @from_instance, @to_kind, @to_value, @kind, @mission_id, @project_id, @body, @attachments,
      @created_at, @delivered_at, @acked_at, @acked_by, @expires_at, @escalated_duty_at, @escalated_user_at)`).run(row);
    // Push to webhook subscribers (129a step 2): ids only; the body stays behind agent_inbox / agent_thread.
    routeToSubscribers(sqlite, {
      id: row.id, workspaceId: input.workspaceId, threadId: row.thread_id, fromInstance: input.from, kind,
      projectId: row.project_id, missionId: row.mission_id, createdAt: row.created_at,
    }, (instance) => addressedTo(sqlite, input.workspaceId, instance, stored, now), now);
  })();
  // Live event for the Fleet page (129a step 3). Summary names the sender and kind only, never the body.
  publishAgentEvent({ type: "agent.message", summary: `Tin mới từ ${input.from} (${kind})`, projectId: stored.projectId ?? undefined }, { workspaceId: input.workspaceId });
  return stored;
}

/** Unacked rows addressed to the caller, oldest first. Ids and kinds only are pushed; the body is read here. */
export function inbox(sqlite: Database.Database, workspaceId: string, instance: string, opts: { sinceId?: string; limit?: number; now?: Date; newest?: boolean } = {}): MailRow[] {
  const now = opts.now ?? new Date();
  const rows = sqlite.prepare("SELECT * FROM agent_messages WHERE workspace_id = ? AND acked_at IS NULL AND expires_at > ? ORDER BY created_at, id").all(workspaceId, now.toISOString()) as Raw[];
  // TASK-150 B: a duty holder's own report to `duty` is not mail for itself. Direct self-messages (toKind instance) stay.
  const mine = rows.map(toRow)
    .filter((row) => !(row.toKind === "duty" && row.fromInstance === instance))
    .filter((row) => addressedTo(sqlite, workspaceId, instance, row, now));
  // newest: the peek wants fresh mail even when old unacked rows fill the page.
  if (opts.newest) return mine.slice(-(opts.limit ?? 50));
  const start = opts.sinceId ? mine.findIndex((row) => row.id === opts.sinceId) + 1 : 0;
  return mine.slice(start).slice(0, opts.limit ?? 50);
}

export function ack(sqlite: Database.Database, workspaceId: string, instance: string, id: string, now = new Date()): MailRow {
  const raw = sqlite.prepare("SELECT * FROM agent_messages WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as Raw | undefined;
  if (!raw || raw.expires_at <= now.toISOString()) throw new AppError(404, "MAILBOX_NOT_FOUND", "Không có tin này.");
  const row = toRow(raw);
  if (!addressedTo(sqlite, workspaceId, instance, row, now)) throw new AppError(403, "MAILBOX_NOT_RECIPIENT", "Tin này không gửi cho bạn.");
  if (row.ackedAt) {
    if (row.ackedBy === instance) return row;
    throw new AppError(409, "MAILBOX_ALREADY_ACKED", "Tin này đã có người nhận xử lý.");
  }
  // Conditional update: first ack wins even across processes.
  const result = sqlite.prepare("UPDATE agent_messages SET acked_at = ?, acked_by = ?, delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND acked_at IS NULL")
    .run(now.toISOString(), instance, now.toISOString(), id);
  if (result.changes === 0) {
    const current = sqlite.prepare("SELECT * FROM agent_messages WHERE id = ?").get(id) as Raw;
    if (current.acked_by === instance) return toRow(current);
    throw new AppError(409, "MAILBOX_ALREADY_ACKED", "Tin này đã có người nhận xử lý.");
  }
  return toRow({ ...raw, acked_at: now.toISOString(), acked_by: instance, delivered_at: raw.delivered_at ?? now.toISOString() });
}

/** Thread the caller may see: it sent a row in the thread, or the row is addressed to it. */
export function thread(sqlite: Database.Database, workspaceId: string, instance: string, threadId: string, now = new Date()): MailRow[] {
  const rows = sqlite.prepare("SELECT * FROM agent_messages WHERE workspace_id = ? AND thread_id = ? ORDER BY created_at, id").all(workspaceId, threadId) as Raw[];
  return rows.map(toRow).filter((row) => row.fromInstance === instance || addressedTo(sqlite, workspaceId, instance, row, now));
}

/** Unacked questions past 15 min go to the duty agent; past 60 min to the user. Each escalation fires once. */
export function sweepQuestions(
  sqlite: Database.Database, workspaceId: string, notifyUser: (text: string) => void, now = new Date(),
  options: { telegramReady?: () => boolean } = {},
): { toDuty: number; toUser: number } {
  const rows = (sqlite.prepare("SELECT * FROM agent_messages WHERE workspace_id = ? AND kind = 'question' AND acked_at IS NULL").all(workspaceId) as Raw[]).map(toRow);
  let toDuty = 0, toUser = 0;
  // TASK-129c burst rule: Telegram off → send nothing and leave escalated_user_at unset; two or more due in one sweep → one summary, all stamped.
  const dueUser = rows.filter((row) => (now.getTime() - new Date(row.createdAt).getTime()) / 60_000 >= QUESTION_USER_MIN && !row.escalatedUserAt);
  const telegramOn = options.telegramReady ? options.telegramReady() : true;
  if (dueUser.length && telegramOn) {
    const stamp = now.toISOString();
    const lines = dueUser.map((row) => `${row.fromInstance} → ${row.toValue}`);
    const text = dueUser.length === 1
      ? `Câu hỏi giữa agent chưa có người trả lời sau 60 phút: ${lines[0]}.`
      : `${dueUser.length} câu hỏi giữa agent chưa có người trả lời sau 60 phút: ${lines.slice(0, 5).join("; ")}${dueUser.length > 5 ? "; …" : ""}.`;
    // Only the stamps are transactional; notify and publish run after commit so a listener never sees an uncommitted escalation.
    sqlite.transaction(() => {
      for (const row of dueUser) sqlite.prepare("UPDATE agent_messages SET escalated_user_at = ? WHERE id = ?").run(stamp, row.id);
    })();
    notifyUser(text);
    for (const row of dueUser) publishAgentEvent({ type: "agent.question_escalated", summary: text, projectId: row.projectId ?? undefined }, { workspaceId });
    toUser += dueUser.length;
  }
  // Each row's stamp and push land together, so a crash cannot leave an escalation marked but never pushed.
  for (const row of rows) sqlite.transaction(() => {
    const ageMin = (now.getTime() - new Date(row.createdAt).getTime()) / 60_000;
    if (ageMin >= QUESTION_USER_MIN && !row.escalatedUserAt && telegramOn) {
      // Handled above as one batch.
    } else if (ageMin >= QUESTION_DUTY_MIN && !row.escalatedDutyAt) {
      sqlite.prepare("UPDATE agent_messages SET escalated_duty_at = ? WHERE id = ?").run(now.toISOString(), row.id);
      const summary = `Câu hỏi ${row.fromInstance} → ${row.toValue} chưa có trả lời sau 15 phút; chuyển cho agent trực.`;
      // Push only to the duty holder, as one delivery per escalation; the body stays in agent_inbox.
      // Same duty resolution as addressedTo, so the push and the inbox agree on who the duty holder is.
      const holder = dutyHolder(sqlite, now);
      if (holder) {
        routeToSubscribers(sqlite, {
          id: row.id, workspaceId, threadId: row.threadId, fromInstance: row.fromInstance, kind: "question",
          projectId: row.projectId, missionId: row.missionId, createdAt: row.createdAt, type: "agent.question_escalated",
        }, (instance) => instance === holder, now);
      }
      publishAgentEvent({ type: "agent.question_escalated", summary, projectId: row.projectId ?? undefined }, { workspaceId });
      toDuty += 1;
    }
  })();
  return { toDuty, toUser };
}

/** Sweep every workspace that has unacked questions. The worker calls this on a throttled tick. */
export function sweepAllQuestions(sqlite: Database.Database, notifyUser: (text: string) => void, now = new Date(), options: { telegramReady?: () => boolean } = {}): number {
  const workspaces = sqlite.prepare("SELECT DISTINCT workspace_id AS id FROM agent_messages WHERE kind = 'question' AND acked_at IS NULL").all() as Array<{ id: string }>;
  let escalated = 0;
  for (const ws of workspaces) {
    const result = sweepQuestions(sqlite, ws.id, notifyUser, now, options);
    escalated += result.toDuty + result.toUser;
  }
  return escalated;
}

/** The user's post into a thread, as a directive from the top rank. */
export function postAsUser(sqlite: Database.Database, workspaceId: string, input: Omit<SendInput, "from" | "kind" | "workspaceId"> & { kind?: MailKind }, now = new Date()): MailRow {
  return sendMessage(sqlite, { ...input, workspaceId, from: "user", kind: input.kind ?? "directive" }, now);
}

export const THREAD_LIST_MAX = 50;
export const THREAD_READ_MAX = 200;

export type ThreadSummary = { threadId: string; messages: number; lastAt: string; lastFrom: string; lastKind: string; projectId: string | null };

/** Every thread in the workspace, newest first. Summaries only: no bodies in the list. For the user's Fleet page. */
export function threadList(sqlite: Database.Database, workspaceId: string, limit = THREAD_LIST_MAX): ThreadSummary[] {
  const groups = sqlite.prepare("SELECT thread_id AS threadId, COUNT(*) AS messages, MAX(created_at) AS lastAt FROM agent_messages WHERE workspace_id = ? GROUP BY thread_id ORDER BY lastAt DESC LIMIT ?")
    .all(workspaceId, limit) as Array<{ threadId: string; messages: number; lastAt: string }>;
  return groups.map((g) => {
    const last = sqlite.prepare("SELECT from_instance, kind, project_id FROM agent_messages WHERE workspace_id = ? AND thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(workspaceId, g.threadId) as { from_instance: string; kind: string; project_id: string | null };
    return { threadId: g.threadId, messages: g.messages, lastAt: g.lastAt, lastFrom: last.from_instance, lastKind: last.kind, projectId: last.project_id };
  });
}

/** Newest THREAD_READ_MAX rows of a thread in this workspace, oldest first. The user sees every row. Unknown thread → 404 (never another workspace's rows). */
export function threadForUser(sqlite: Database.Database, workspaceId: string, threadId: string): MailRow[] {
  const rows = sqlite.prepare("SELECT * FROM agent_messages WHERE workspace_id = ? AND thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(workspaceId, threadId, THREAD_READ_MAX) as Raw[];
  if (!rows.length) throw new AppError(404, "MAILBOX_THREAD_NOT_FOUND", "Không có chuỗi tin này.");
  return rows.reverse().map(toRow);
}

/** The user posts into an existing thread of this workspace (or starts a new one when threadId is omitted). Always a directive unless the chain of command downgrades it. */
export function userPostToThread(sqlite: Database.Database, workspaceId: string, input: { threadId?: string; to: string; body: string; projectId?: string | null }, now = new Date()): MailRow {
  if (input.threadId && !sqlite.prepare("SELECT 1 FROM agent_messages WHERE workspace_id = ? AND thread_id = ? LIMIT 1").get(workspaceId, input.threadId)) {
    throw new AppError(404, "MAILBOX_THREAD_NOT_FOUND", "Không có chuỗi tin này.");
  }
  return postAsUser(sqlite, workspaceId, { ...input, kind: "directive" }, now);
}

function workspace(sqlite: Database.Database): string {
  const id = currentWorkspaceId(sqlite);
  if (!id) throw new AppError(403, "MAILBOX_NO_WORKSPACE", "Khóa agent chưa gắn workspace.");
  return id;
}

/** Only a machine key with a fixed instance name may use the mailbox; a keyless call never shares an identity. */
function mailboxAgent(ctx: AssistantToolContext): TrustedAgent {
  const actor = currentActor();
  return fixedKeyAgent(ctx.sqlite, actor?.kind === "apikey" ? actor.keyId : null);
}

const sendArgs = z.object({
  to: z.string().min(1).max(120), kind: z.enum(["directive", "report", "question", "answer", "handoff"]),
  body: z.string().min(1).max(MAILBOX_BODY_MAX), threadId: z.string().max(80).optional(),
  missionId: z.string().max(80).optional(), projectId: z.string().max(80).optional(),
  attachments: z.array(z.string().min(1).max(80)).max(10).optional(),
}).strict();
const inboxArgs = z.object({ sinceId: z.string().max(80).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict();
const ackArgs = z.object({ id: z.string().min(1).max(80) }).strict();
const threadArgs = z.object({ threadId: z.string().min(1).max(80) }).strict();

/** The mailbox is open to every trusted agent (no duty guard); identity comes from the machine key via the registry. */
export function mailboxToolDefs(): AssistantToolDef[] {
  return [
    { name: "agent_send", description: "Gửi tin cho agent: đến instance, role:<tên> hoặc duty.", risk: "safe", argsSchema: sendArgs,
      summarize: () => "Gửi tin giữa agent", execute: async (raw, ctx) => { const a = sendArgs.parse(raw); return sendMessage(ctx.sqlite, { ...a, workspaceId: workspace(ctx.sqlite), from: mailboxAgent(ctx).instance }); } },
    { name: "agent_inbox", description: "Tin chưa xác nhận gửi cho mình.", risk: "read", argsSchema: inboxArgs,
      summarize: () => "Đọc hộp thư agent", execute: async (raw, ctx) => { const a = inboxArgs.parse(raw); return inbox(ctx.sqlite, workspace(ctx.sqlite), mailboxAgent(ctx).instance, a); } },
    { name: "agent_ack", description: "Xác nhận đã nhận tin gửi cho mình.", risk: "safe", argsSchema: ackArgs,
      summarize: () => "Xác nhận tin agent", execute: async (raw, ctx) => ack(ctx.sqlite, workspace(ctx.sqlite), mailboxAgent(ctx).instance, ackArgs.parse(raw).id) },
    { name: "agent_thread", description: "Đọc một chuỗi tin mình tham gia.", risk: "read", argsSchema: threadArgs,
      summarize: () => "Đọc chuỗi tin agent", execute: async (raw, ctx) => thread(ctx.sqlite, workspace(ctx.sqlite), mailboxAgent(ctx).instance, threadArgs.parse(raw).threadId) },
  ];
}
