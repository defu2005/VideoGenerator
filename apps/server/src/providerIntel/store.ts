import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { redactExportText } from "@vg/shared";

export type IntelRow = {
  id: string;
  kind: string;
  key: string;
  body: unknown;
  version: number;
  createdAt: string;
  supersededAt: string | null;
};

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export class IntelStore {
  constructor(private readonly sqlite: Database.Database, private readonly now: () => Date) {}

  append(kind: string, key: string, body: unknown): IntelRow {
    const safe = JSON.parse(redactExportText(JSON.stringify(body))) as unknown;
    const current = this.current(kind, key);
    const version = (current?.version ?? 0) + 1;
    const at = this.now().toISOString();
    if (current) {
      this.sqlite.prepare("UPDATE provider_intel_records SET superseded_at = ? WHERE id = ?").run(at, current.id);
    }
    const id = randomUUID();
    this.sqlite.prepare(
      `INSERT INTO provider_intel_records (id, kind, key, json, version, created_at, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).run(id, kind, key, JSON.stringify(safe), version, at);
    return { id, kind, key, body: safe, version, createdAt: at, supersededAt: null };
  }

  current(kind: string, key: string): IntelRow | null {
    const row = this.sqlite.prepare(
      "SELECT * FROM provider_intel_records WHERE kind = ? AND key = ? AND superseded_at IS NULL",
    ).get(kind, key) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }

  history(kind: string, key: string): IntelRow[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM provider_intel_records WHERE kind = ? AND key = ? ORDER BY version ASC",
    ).all(kind, key) as Array<Record<string, unknown>>;
    return rows.map((row) => this.map(row));
  }

  list(kind: string): IntelRow[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM provider_intel_records WHERE kind = ? AND superseded_at IS NULL ORDER BY key ASC",
    ).all(kind) as Array<Record<string, unknown>>;
    return rows.map((row) => this.map(row));
  }

  private map(row: Record<string, unknown>): IntelRow {
    return {
      id: String(row.id),
      kind: String(row.kind),
      key: String(row.key),
      body: parseBody(String(row.json ?? "null")),
      version: Number(row.version),
      createdAt: String(row.created_at),
      supersededAt: row.superseded_at == null ? null : String(row.superseded_at),
    };
  }
}
