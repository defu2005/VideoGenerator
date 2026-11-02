import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export type LlmCacheEntry = { responseText: string };

export class LlmCache {
  constructor(private readonly sqlite: Database.Database, private readonly enabled: boolean) {}

  get(key: string): LlmCacheEntry | undefined {
    if (!this.enabled) return undefined;
    return this.sqlite.prepare("SELECT response_text AS responseText FROM llm_cache WHERE key = ?")
      .get(key) as LlmCacheEntry | undefined;
  }

  put(key: string, provider: string, model: string, responseText: string): void {
    if (!this.enabled) return;
    this.sqlite.prepare(
      "INSERT INTO llm_cache (key, provider, model, response_text, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET response_text = excluded.response_text",
    ).run(key, provider, model, responseText, new Date().toISOString());
  }
}

export function createLlmCacheKey(input: {
  provider: string;
  model: string;
  system: string;
  prompt: string;
  schemaName: string;
  schemaVersion: string;
  cacheKeyExtra?: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.provider,
    input.model,
    input.system,
    input.prompt,
    input.schemaName,
    input.schemaVersion,
    input.cacheKeyExtra ?? "",
  ])).digest("hex");
}
