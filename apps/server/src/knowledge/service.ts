import { createHash, randomUUID } from "node:crypto";
import { stampWorkspace } from "../auth/requestContext.js";
import {
  diffJson, KNOWLEDGE_SNAPSHOT, KnowledgeEntrySchema, knowledgeApplies, knowledgeConsumers,
  knowledgeRisk, knowledgeTime, parseKnowledgeImport, PROTECTED_PROJECT_ID, quoteInPage, snapshotKnowledge,
  type KnowledgeEntry, type KnowledgeFilter, type KnowledgeRisk,
} from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";

type Json = KnowledgeEntry["value"];
type Layer = "snapshot" | "accepted" | "user";
type RevisionRow = { revision: number; before: string | null; after: string | null; patch: string; created_at: string; actor: string; origin: string; reason: string };
type ProposalRow = {
  id: string; entry_id: string; kind: string; proposed: string; patch: string; origin: string;
  risk: KnowledgeRisk; status: string; created_at: string; decided_at: string | null; decided_by: string | null;
  base_revision: number;
};
const missing = new Set<string>();
const parse = (json: string | null | undefined) => json ? KnowledgeEntrySchema.parse(JSON.parse(json)) : null;
const patchFor = (before: KnowledgeEntry | null, after: KnowledgeEntry | null) => diffJson(before as Json, after as Json);
const omitCheckDate = (entry: KnowledgeEntry) => ({
  ...entry, evidence: entry.evidence.map(({ checkedAt: _checkedAt, ...source }) => source),
});

export class KnowledgeService {
  constructor(
    private readonly db: Database.Database,
    private readonly now = () => new Date(),
    private readonly userEntries: () => readonly KnowledgeEntry[] = () => [],
  ) {}

  get(id: string, at = this.now()) {
    const day = at.toISOString().slice(0, 10);
    const candidates: Array<{ entry: KnowledgeEntry | null; layer: Layer; revision: number }> = [
      ...this.userEntries().filter((entry) => entry.id === id).map((entry) => ({ entry, layer: "user" as const, revision: 0 })),
      ...this.rows(id).map((row) => ({ entry: parse(row.after), layer: "accepted" as const, revision: row.revision })),
      { entry: snapshotKnowledge(id) ?? null, layer: "snapshot", revision: 0 },
    ];
    for (const candidate of candidates) {
      const { entry } = candidate;
      if (entry?.validFrom && entry.validFrom > day) continue;
      if (!entry || !knowledgeApplies(entry, at)) return undefined;
      return { ...candidate, entry, ...knowledgeTime(entry, at) };
    }
  }

  list(filter: KnowledgeFilter = {}) {
    const rows = this.db.prepare("SELECT id FROM knowledge_entries").all() as Array<{ id: string }>;
    const ids = new Set([...KNOWLEDGE_SNAPSHOT, ...rows, ...this.userEntries()].map(({ id }) => id));
    const at = this.now();
    const active = [...ids].flatMap((id) => this.get(id, at) ?? []);
    return active.filter(({ entry, freshness }) =>
      (!filter.kind || filter.kind === entry.kind)
      && (!filter.platform || entry.scope.platforms.some((value) => value === "*" || value === filter.platform))
      && (!filter.market || entry.scope.markets.some((value) => value === "*" || value === filter.market))
      && (!filter.freshness || filter.freshness === freshness));
  }

  value<T>(id: string, fallback: T): T {
    const hit = this.get(id);
    if (hit) return hit.entry.value as T;
    if (!missing.has(id)) {
      missing.add(id);
      console.warn(`Knowledge unavailable: ${id}`);
    }
    return fallback;
  }

  inspect(id: string) {
    return { current: this.get(id) ?? null, consumers: knowledgeConsumers(id), history: this.history(id) };
  }

  revisedEntries() {
    return this.db.prepare("SELECT id, revision FROM knowledge_entries ORDER BY updated_at DESC, id").all() as
      Array<{ id: string; revision: number }>;
  }

  history(id: string) {
    return this.rows(id).map((row) => ({
      revision: row.revision, before: parse(row.before), after: parse(row.after), patch: JSON.parse(row.patch) as unknown,
      createdAt: row.created_at, actor: row.actor, origin: row.origin, reason: row.reason,
    }));
  }

  proposals() {
    return (this.db.prepare("SELECT * FROM knowledge_proposals WHERE status = 'pending' ORDER BY created_at DESC, rowid DESC").all() as ProposalRow[])
      .map((row) => ({
        id: row.id, entryId: row.entry_id, kind: row.kind, proposed: parse(row.proposed)!,
        patch: JSON.parse(row.patch) as unknown, risk: row.risk, origin: row.origin, createdAt: row.created_at,
        consumers: knowledgeConsumers(row.entry_id),
      }));
  }

  propose(entry: KnowledgeEntry, reason: string, origin = "proposal") {
    return this.db.transaction(() => {
      const proposed = KnowledgeEntrySchema.parse(entry);
      const before = this.latest(proposed.id);
      if (before.entry && before.entry.kind !== proposed.kind) {
        throw new AppError(409, "KNOWLEDGE_KIND_CONFLICT", "Không đổi loại của một mục tri thức đã có.");
      }
      const patch = patchFor(before.entry, proposed);
      const risk = knowledgeRisk(before.entry, proposed, patch);
      const id = randomUUID();
      const at = this.now().toISOString();
      this.db.prepare("UPDATE knowledge_proposals SET status='superseded', decided_at=?, decided_by='system' WHERE entry_id=? AND status='pending'").run(at, proposed.id);
      this.db.prepare(`INSERT INTO knowledge_proposals
        (id, entry_id, kind, proposed, patch, origin, evidence, risk, status, created_at, base_revision, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
        .run(id, proposed.id, proposed.kind, JSON.stringify(proposed), JSON.stringify(patch),
          origin, JSON.stringify(proposed.evidence), risk, at, before.revision, reason);
      if (this.shouldAutoApply(proposed, risk)) {
        const revision = this.apply(proposed.id, proposed.kind, proposed, before, origin, "system", reason);
        this.finish(id, "accepted", "system");
        return { id, risk, status: "accepted" as const, revision };
      }
      return { id, risk, status: "pending" as const };
    }).immediate();
  }

  import(entries: unknown[], label: string) {
    const results = entries.map((raw, index) => {
      const result = parseKnowledgeImport(raw);
      if (!result.success) return { index, status: "invalid" as const, errors: result.error.issues.map(({ path, message }) => `${path.join(".")}: ${message}`) };
      const entry = result.data;
      return this.db.transaction(() => {
        const before = this.latest(entry.id);
        if (before.entry && before.entry.kind !== entry.kind) {
          return { index, entryId: entry.id, status: "invalid" as const, errors: ["ID đã dùng cho loại tri thức khác."] };
        }
        if (before.entry && !diffJson(omitCheckDate(before.entry) as Json, omitCheckDate(entry) as Json).length) {
          const old = before.entry;
          const refreshed = { ...old, evidence: old.evidence.map((e, i) => ({
            ...e, checkedAt: e.checkedAt > entry.evidence[i].checkedAt ? e.checkedAt : entry.evidence[i].checkedAt,
          })) };
          const revision = patchFor(old, refreshed).length
            ? this.apply(entry.id, entry.kind, refreshed, before, "import", "system", "đã kiểm tra lại, không đổi")
            : before.revision;
          // The evidence-only refresh must not invalidate an already pending substantive proposal.
          this.db.prepare("UPDATE knowledge_proposals SET base_revision=? WHERE entry_id=? AND status='pending' AND base_revision=?")
            .run(revision, entry.id, before.revision);
          return { index, entryId: entry.id, status: "refreshed" as const, revision };
        }
        return { index, entryId: entry.id, ...this.propose(entry, label, "import") };
      }).immediate();
    });
    return { results };
  }

  decide(id: string, decision: "accepted" | "rejected", reason?: string) {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM knowledge_proposals WHERE id=? AND status='pending'").get(id) as (ProposalRow & { reason: string }) | undefined;
      if (!row) throw new AppError(409, "KNOWLEDGE_PROPOSAL_CLOSED", "Đề xuất không còn chờ duyệt.");
      let revision: number | undefined;
      if (decision === "accepted") {
        const before = this.latest(row.entry_id);
        if (before.revision !== row.base_revision) throw new AppError(409, "KNOWLEDGE_PROPOSAL_STALE", "Tri thức đã đổi. Hãy tạo lại đề xuất.");
        const proposed = parse(row.proposed)!;
        const entry = before.entry ? { ...proposed, evidence: proposed.evidence.map((source) => {
          const dates = before.entry!.evidence.filter((old) => old.url === source.url && old.quote === source.quote && old.type === source.type);
          const checkedAt = dates.reduce((date, old) => date > old.checkedAt ? date : old.checkedAt, source.checkedAt);
          return { ...source, checkedAt };
        }) } : proposed;
        revision = this.apply(row.entry_id, row.kind, entry, before, row.origin, "user", reason ?? row.reason);
      }
      this.finish(id, decision, "user");
      return { id, status: decision, revision };
    }).immediate();
  }

  rollback(id: string, revision: number, reason?: string) {
    return this.db.transaction(() => {
      const current = this.latest(id);
      const historical = revision === 0 ? snapshotKnowledge(id) ?? null
        : this.rows(id).find((row) => row.revision === revision);
      if (current.revision === 0 || historical === undefined) throw new AppError(404, "KNOWLEDGE_REVISION_NOT_FOUND", "Không tìm thấy phiên bản tri thức.");
      const entry = revision === 0 ? historical as KnowledgeEntry | null : parse((historical as RevisionRow).after);
      const kind = current.entry?.kind ?? entry?.kind ?? (this.db.prepare("SELECT kind FROM knowledge_entries WHERE id=?").get(id) as { kind: string }).kind;
      const next = this.apply(id, kind, entry, current, "rollback", "user", reason ?? `Khôi phục phiên bản ${revision}`);
      this.db.prepare("UPDATE knowledge_proposals SET status='superseded', decided_at=?, decided_by='user' WHERE entry_id=? AND status='pending'")
        .run(this.now().toISOString(), id);
      return { id, revision: next };
    }).immediate();
  }

  recordProjectReads(projectId: string, reads: Record<string, string>): void {
    if (projectId === PROTECTED_PROJECT_ID || !Object.keys(reads).length) return;
    const db = this.db;
    db.transaction(() => {
      const row = db.prepare("SELECT settings FROM projects WHERE id=?").get(projectId) as { settings: string } | undefined;
      if (!row) return;
      const settings = JSON.parse(row.settings);
      const key = `knowledge.reads.${projectId}`;
      const previous = db.prepare("SELECT value FROM app_settings WHERE key=?").get(key) as { value: string } | undefined;
      const versions = { ...(previous ? JSON.parse(previous.value) : {}), ...reads };
      const knowledgeRev = createHash("sha256").update(JSON.stringify(Object.entries(versions).sort())).digest("hex").slice(0, 12);
      if (settings.knowledgeRev === knowledgeRev) return;
      db.prepare("UPDATE projects SET settings=? WHERE id=?").run(JSON.stringify({ ...settings, knowledgeRev }), projectId);
      db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
        .run(key, JSON.stringify(versions), this.now().toISOString());
    }).immediate();
  }

  private shouldAutoApply(entry: KnowledgeEntry, risk: KnowledgeRisk): boolean {
    if (risk === "high") return false;
    if (risk === "medium") {
      const row = this.db.prepare("SELECT value FROM app_settings WHERE key='knowledge.autoApplyMedium'").get() as { value: string } | undefined;
      return row?.value === "true";
    }
    const official = entry.evidence.filter((source) => source.type === "official");
    return entry.confidence === "high" && official.length > 0 && official.every(({ url, quote }) => {
      if (!quote) return false;
      const page = this.db.prepare("SELECT body_text FROM provider_intel_pages WHERE url=? AND status='ok' ORDER BY last_fetched_at DESC LIMIT 1")
        .get(url) as { body_text: string } | undefined;
      return page !== undefined && quoteInPage(page.body_text, quote);
    });
  }

  private rows(id: string): RevisionRow[] {
    return this.db.prepare("SELECT * FROM knowledge_revisions WHERE entry_id=? ORDER BY revision DESC").all(id) as RevisionRow[];
  }

  private latest(id: string) {
    const row = this.db.prepare("SELECT json, revision FROM knowledge_entries WHERE id=?").get(id) as { json: string | null; revision: number } | undefined;
    return row ? { entry: parse(row.json), revision: row.revision }
      : { entry: snapshotKnowledge(id) ?? null, revision: 0 };
  }

  private apply(
    id: string, kind: string, entry: KnowledgeEntry | null, before: ReturnType<KnowledgeService["latest"]>,
    origin: string, actor: string, reason: string,
  ): number {
    const at = this.now().toISOString();
    const revision = before.revision + 1;
    const json = entry && JSON.stringify(entry);
    this.db.prepare(`INSERT INTO knowledge_entries (id, kind, json, revision, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, json=excluded.json, revision=excluded.revision, updated_at=excluded.updated_at`)
      .run(id, kind, json, revision, at);
    stampWorkspace(this.db, "knowledge_entries", id);
    this.db.prepare(`INSERT INTO knowledge_revisions (id,entry_id,revision,before,after,patch,origin,actor,reason,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, revision, before.entry && JSON.stringify(before.entry),
      json, JSON.stringify(patchFor(before.entry, entry)), origin, actor, reason, at);
    return revision;
  }

  private finish(id: string, status: string, actor: string) {
    this.db.prepare("UPDATE knowledge_proposals SET status=?, decided_at=?, decided_by=? WHERE id=?")
      .run(status, this.now().toISOString(), actor, id);
  }
}
