import { randomUUID } from "node:crypto";
import {
  adaptAllowed, consumersForSubject, DEFAULT_CHANGE_LLM_BUDGET, highRiskKind, KnowledgeIdSchema,
  publishBlocked, resolveReactions, signalOf, signalThreshold, type EventSeverity, type HoldView,
  type ReactionId, type RuntimeSignal,
} from "@vg/shared";
import type { KnowledgeEntry } from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { KnowledgeService } from "./service.js";

type Subject = { type: "knowledge" | "platform" | "provider" | "account" | "video" | "metric" | "dependency"; id: string };
type Policy = Record<string, Partial<Record<EventSeverity, ReactionId[]>>>;

export type ChangeDraft = {
  category: string;
  detector: string;
  subject: Subject;
  summary: string;
  evidence: unknown;
  severity: EventSeverity;
  fingerprint: string;
  consumers?: string[];
  proposal?: KnowledgeEntry;
  adapt?: { configured: boolean; allowed: boolean; changesMust: boolean; overBudget: boolean; paidFallback: boolean; label: string };
  investigate?: boolean;
};

export type ChangeEventRow = {
  id: string;
  category: string;
  detector: string;
  subject: Subject;
  summary: string;
  evidence: unknown;
  severity: EventSeverity;
  fingerprint: string;
  consumers: string[];
  reaction: { levels: ReactionId[]; note?: string; proposalId?: string };
  status: string;
  seenCount: number;
  lastSeenAt: string;
  createdAt: string;
  resolvedAt: string | null;
};

export class ChangeInbox {
  constructor(private readonly db: Database.Database, private readonly now: () => Date = () => new Date()) {}
  database(): Database.Database { return this.db; }

  list(filter: { status?: string; severity?: string } = {}): ChangeEventRow[] {
    const rows = this.db.prepare("SELECT * FROM change_events ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map(mapEvent).filter((row) =>
      (!filter.status || row.status === filter.status) && (!filter.severity || row.severity === filter.severity));
  }

  record(input: ChangeDraft): ChangeEventRow {
    const open = this.db.prepare(
      "SELECT id FROM change_events WHERE fingerprint = ? AND status = 'open'",
    ).get(input.fingerprint) as { id: string } | undefined;
    const nowIso = this.now().toISOString();
    if (open) {
      this.db.prepare("UPDATE change_events SET seen_count = seen_count + 1, last_seen_at = ? WHERE id = ?").run(nowIso, open.id);
      return this.one(open.id);
    }
    const consumers = consumersForSubject(input.subject, input.consumers);
    let levels = resolveReactions({
      category: input.category,
      severity: input.severity,
      subjectType: input.subject.type,
      override: this.policy()[input.category]?.[input.severity],
    });
    if (input.investigate && !levels.includes("R5")) levels = [...levels, "R5"];
    const reaction: ChangeEventRow["reaction"] = { levels };
    if (levels.includes("R3")) {
      if (input.adapt && adaptAllowed(input.adapt)) reaction.note = input.adapt.label;
      else {
        levels = levels.map((level) => level === "R3" ? "R2" : level);
        reaction.levels = levels;
        reaction.note = "Không có phương án sẵn trong cấu hình";
      }
    }
    if (levels.includes("R2") && input.proposal) {
      try {
        const proposal = new KnowledgeService(this.db, this.now).propose(input.proposal, input.summary, "change");
        reaction.proposalId = proposal.id;
      } catch {
        reaction.note = [reaction.note, "Không tạo được đề xuất"].filter(Boolean).join(". ");
      }
    }
    if (levels.includes("R5")) reaction.note = [reaction.note, "Mở điều tra"].filter(Boolean).join(". ");
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO change_events
       (id, category, detector, subject, summary, evidence, severity, fingerprint, consumers, reaction, status, seen_count, last_seen_at, in_digest, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, ?, NULL)`,
    ).run(
      id, input.category, input.detector, JSON.stringify(input.subject), input.summary.slice(0, 500),
      JSON.stringify(input.evidence ?? {}), input.severity, input.fingerprint, JSON.stringify(consumers),
      JSON.stringify(reaction), nowIso, levels.includes("R1") ? 1 : 0, nowIso,
    );
    if (levels.includes("R4")) {
      const targets = consumers.length > 0 ? consumers : [""];
      const insert = this.db.prepare(
        `INSERT INTO change_holds (id, event_id, consumer, subject_type, subject_id, reason, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      );
      for (const consumer of targets) {
        insert.run(randomUUID(), id, consumer, input.subject.type, input.subject.id, input.summary.slice(0, 300), nowIso);
      }
    }
    return this.one(id);
  }

  observe(note: {
    provider: string; endpoint: string; status?: number; headers?: Record<string, string>;
    error?: string; schemaOk?: boolean; category?: string; subject?: Subject;
  }): { emitted: boolean } {
    const signal = signalOf(note);
    if (!signal) return { emitted: false };
    const consumers = signal.category === "E1" && !note.subject
      ? (note.provider.includes("youtube") ? ["YouTubePublisher.publish"] : note.provider.includes("tiktok") ? ["TikTokPublisher.publish"] : [])
      : undefined;
    const scoped = note.subject ? { ...signal, fingerprint: `${signal.fingerprint}:${note.subject.type}:${note.subject.id}` } : signal;
    return this.emitSignal(scoped, note.subject ?? { type: "provider", id: note.provider }, consumers);
  }

  observeCli(signal: RuntimeSignal | null, subject?: Subject): { emitted: boolean } {
    if (!signal) return { emitted: false };
    return this.emitSignal(signal, subject ?? { type: "dependency", id: signal.fingerprint });
  }

  report(input: { category: string; summary: string; url?: string }): ChangeEventRow {
    const tokens = `${input.summary} ${input.url ?? ""}`.split(/\s+/);
    const knowledgeId = tokens.find((token) => KnowledgeIdSchema.safeParse(token).success);
    return this.record({
      category: input.category,
      detector: "D7",
      subject: knowledgeId ? { type: "knowledge", id: knowledgeId } : { type: "platform", id: input.category },
      summary: input.summary,
      evidence: { url: input.url ?? null },
      severity: "warn",
      fingerprint: `d7:${input.category}:${input.summary.slice(0, 80)}`,
      investigate: Boolean(knowledgeId),
    });
  }

  sweepStale(entries: Array<{ id: string; kind: string; freshness: string }>): ChangeEventRow[] {
    const opened: ChangeEventRow[] = [];
    for (const entry of entries) {
      if (entry.freshness !== "due" && entry.freshness !== "stale") continue;
      if (entry.freshness === "stale" && highRiskKind(entry.kind)) {
        opened.push(this.record({
          category: "D6",
          detector: "D6",
          subject: { type: "knowledge", id: entry.id },
          summary: `${entry.id} đã cũ và thuộc nhóm rủi ro cao`,
          evidence: { kind: entry.kind, freshness: entry.freshness },
          severity: "high",
          fingerprint: `d6:stale:${entry.id}`,
        }));
      }
    }
    return opened;
  }

  recordDependency(name: string, summary: string, severity: EventSeverity): ChangeEventRow {
    return this.record({
      category: "D3",
      detector: "D6",
      subject: { type: "dependency", id: name },
      summary,
      evidence: { package: name },
      severity,
      fingerprint: `d6:npm:${name}:${severity}`,
    });
  }

  resolve(id: string): ChangeEventRow {
    const nowIso = this.now().toISOString();
    const updated = this.db.prepare(
      "UPDATE change_events SET status = 'resolved', resolved_at = ? WHERE id = ?",
    ).run(nowIso, id);
    if (updated.changes === 0) throw new AppError(404, "CHANGE_NOT_FOUND", "Không thấy thay đổi.");
    this.lift(id);
    return this.one(id);
  }

  continueEvent(id: string): ChangeEventRow {
    const updated = this.db.prepare("UPDATE change_events SET status = 'acknowledged' WHERE id = ?").run(id);
    if (updated.changes === 0) throw new AppError(404, "CHANGE_NOT_FOUND", "Không thấy thay đổi.");
    this.lift(id);
    return this.one(id);
  }

  activeHoldViews(): HoldView[] {
    const rows = this.db.prepare(
      "SELECT consumer, subject_type, subject_id, active FROM change_holds",
    ).all() as Array<{ consumer: string; subject_type: string; subject_id: string; active: number }>;
    return rows.map((row) => ({
      active: row.active === 1, consumer: row.consumer, subjectType: row.subject_type, subjectId: row.subject_id,
    }));
  }

  setting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  putSetting(key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value, this.now().toISOString());
  }

  llmBudget(eco: boolean): "hash" | "read" {
    const limit = Number(this.setting("change.llmBudget") ?? DEFAULT_CHANGE_LLM_BUDGET);
    const today = this.now().toISOString().slice(0, 10);
    const raw = this.setting("change.llmDay");
    const used = raw ? (JSON.parse(raw) as { day: string; count: number }) : { day: today, count: 0 };
    const count = used.day === today ? used.count : 0;
    if (eco || count >= (Number.isFinite(limit) ? limit : DEFAULT_CHANGE_LLM_BUDGET)) return "hash";
    return "read";
  }

  spendLlm(): void {
    const today = this.now().toISOString().slice(0, 10);
    const raw = this.setting("change.llmDay");
    const used = raw ? (JSON.parse(raw) as { day: string; count: number }) : { day: today, count: 0 };
    const count = used.day === today ? used.count : 0;
    this.putSetting("change.llmDay", JSON.stringify({ day: today, count: count + 1 }));
  }

  pruneSignalHits(): number {
    return this.db.prepare("DELETE FROM change_signal_hits WHERE seen_at < ?")
      .run(new Date(this.now().getTime() - 7 * 86_400_000).toISOString()).changes;
  }

  private emitSignal(signal: RuntimeSignal, subject: Subject, consumers?: string[]): { emitted: boolean } {
    const nowIso = this.now().toISOString();
    this.db.prepare("INSERT INTO change_signal_hits (id, fingerprint, seen_at) VALUES (?, ?, ?)").run(randomUUID(), signal.fingerprint, nowIso);
    const hourAgo = new Date(this.now().getTime() - 3_600_000).toISOString();
    const count = this.db.prepare(
      "SELECT COUNT(*) AS n FROM change_signal_hits WHERE fingerprint = ? AND seen_at >= ?",
    ).get(signal.fingerprint, hourAgo) as { n: number };
    const configured = Number(this.setting("change.signalThreshold") ?? 3);
    if (count.n < signalThreshold(signal, Number.isFinite(configured) ? configured : 3)) return { emitted: false };
    this.record({
      category: signal.category,
      detector: "D2",
      subject,
      summary: signal.summary,
      evidence: { kind: signal.kind },
      severity: signal.severity,
      fingerprint: signal.fingerprint,
      consumers,
    });
    return { emitted: true };
  }

  private lift(eventId: string): void {
    this.db.prepare("UPDATE change_holds SET active = 0 WHERE event_id = ?").run(eventId);
  }

  private policy(): Policy {
    const raw = this.setting("change.policy");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Policy;
    } catch {
      return {};
    }
  }

  private one(id: string): ChangeEventRow {
    const row = this.db.prepare("SELECT * FROM change_events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AppError(404, "CHANGE_NOT_FOUND", "Không thấy thay đổi.");
    return mapEvent(row);
  }
}

export function assertPublishAllowed(db: Database.Database, account: { id: string; platform: string }): void {
  const holds = new ChangeInbox(db).activeHoldViews();
  if (!publishBlocked(holds, account)) return;
  const reason = db.prepare(
    "SELECT reason FROM change_holds WHERE active = 1 AND ((subject_type = 'account' AND subject_id = ?) OR consumer = ?) LIMIT 1",
  ).get(account.id, account.platform === "youtube" ? "YouTubePublisher.publish" : "TikTokPublisher.publish") as { reason: string } | undefined;
  throw new AppError(409, "CHANGE_HOLD", reason?.reason ?? "Đang giữ đăng vì một thay đổi chưa xử lý.");
}

function mapEvent(row: Record<string, unknown>): ChangeEventRow {
  return {
    id: String(row.id),
    category: String(row.category),
    detector: String(row.detector),
    subject: JSON.parse(String(row.subject)) as Subject,
    summary: String(row.summary),
    evidence: JSON.parse(String(row.evidence)),
    severity: String(row.severity) as EventSeverity,
    fingerprint: String(row.fingerprint),
    consumers: JSON.parse(String(row.consumers)) as string[],
    reaction: JSON.parse(String(row.reaction)) as ChangeEventRow["reaction"],
    status: String(row.status),
    seenCount: Number(row.seen_count),
    lastSeenAt: String(row.last_seen_at),
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}
