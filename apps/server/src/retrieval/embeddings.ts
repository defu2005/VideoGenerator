import { estimateLlmCost } from "../providers/llm/pricing.js";
import type { AppConfig } from "../lib/config.js";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { safeKnowledgeText, knowledgeTerms } from "@vg/shared";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { LlmError } from "../providers/llm/types.js";
import { retrievalSettings } from "./settings.js";
const prices = new WeakMap<Database.Database, Pick<AppConfig, "LLM_PRICES_JSON">>();
const registries = new WeakMap<Database.Database, LlmProviderRegistry>();
export function setEmbeddingRegistry(db: Database.Database, registry: LlmProviderRegistry, config?: Pick<AppConfig, "LLM_PRICES_JSON">) { registries.set(db, registry); if (config)
    prices.set(db, config); }
export function embeddingProviders(db: Database.Database) {
    const registry = registries.get(db);
    return registry?.list().filter(p => registry.get(p.id)?.capabilities?.embeddings).map(p => ({ id: p.id, label: p.label })) ?? [];
}
export function mockVector(text: string): number[] {
    const v = Array<number>(64).fill(0);
    for (const word of knowledgeTerms(text)) {
        let h = 2166136261;
        for (const c of word)
            h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        v[(h >>> 0) % 64]! += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map(n => n / norm);
}
export function cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || !a.length)
        return 0;
    const norm = Math.hypot(...a) * Math.hypot(...b);
    return norm ? a.reduce((s, n, i) => s + n * b[i]!, 0) / norm : 0;
}
export function vectorBlob(vector: number[]): Buffer { return Buffer.from(new Float32Array(vector).buffer); }
export function readVector(blob: Buffer): number[] { const copy = Uint8Array.from(blob); return Array.from(new Float32Array(copy.buffer)); }
export function embeddingModel(db: Database.Database): string | null {
    const s = retrievalSettings(db);
    return s.embeddingProvider && s.embeddingModel ? s.embeddingProvider + ":" + s.embeddingModel : null;
}
export async function embedTexts(db: Database.Database, texts: string[], signal: AbortSignal = AbortSignal.timeout(30000)): Promise<number[][] | null> {
    texts = texts.map(safeKnowledgeText);
    const s = retrievalSettings(db), registry = registries.get(db);
    if (!s.embeddingProvider || !s.embeddingModel || !registry)
        return null;
    const provider = registry.get(s.embeddingProvider), model = s.embeddingModel;
    if (!provider?.capabilities?.embeddings || !provider.embed)
        return null;
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 32) {
        try {
            await registry.quota?.refreshIfStale(provider.id, model);
            if (registry.quota?.isUnavailable(provider.id, model))
                return null;
            const r = await provider.embed({ model, texts: texts.slice(offset, offset + 32) }, signal);
            const inputTokens = r.usage?.inputTokens ?? Math.ceil(texts.slice(offset, offset + 32).join("").length / 4);
            registry.quota?.recordCall({ provider: provider.id, model, inputTokens, outputTokens: 0 });
            const now = new Date().toISOString();
            let costUsd = 0;
            try {
                costUsd = estimateLlmCost(prices.get(db) ?? {}, provider.id, model, { inputTokens, outputTokens: 0 });
            }
            catch { }
            const usage = { llmCalls: 1, inputTokens, outputTokens: 0, costUsd, calls: [{ task: "retrievalEmbed", provider: provider.id, model, inputTokens, outputTokens: 0, cached: false, fallback: false, ok: true, costUsd }] };
            db.prepare("INSERT INTO jobs(id,project_id,stage,scope,status,progress,attempt,max_attempts,usage,created_at,started_at,finished_at,run_after,previous_state) VALUES(?,NULL,'RESEARCH','retrievalEmbed','SUCCEEDED',100,1,1,?,?,?,?,?,'DONE')").run(randomUUID(), JSON.stringify(usage), now, now, now, now);
            vectors.push(...r.vectors);
        }
        catch (error) {
            if (error instanceof LlmError && (error.status === 429 || error.code.includes("QUOTA") || error.code === "LLM_RATE_LIMIT"))
                registry.quota?.onQuotaFailure({ provider: provider.id, model, error });
            return null;
        }
    }
    return vectors;
}
