import type Database from "better-sqlite3";
import { knowledgeTerms, PROTECTED_PROJECT_ID, safeKnowledgeText, type KnowledgeKind } from "@vg/shared";
import { initializeFts } from "./ftsIndex.js";
import { cosine, embeddingModel, readVector } from "./embeddings.js";
import { retrievalSettings } from "./settings.js";
export type ChunkRow = {
    id: number;
    profile_id: string | null;
    project_id: string | null;
    kind: KnowledgeKind;
    source_id: string;
    source_version: string;
    title: string;
    text: string;
    meta: string;
    embedding: Buffer | null;
    embedding_model: string | null;
    updated_at: string;
    created_at: string;
    content_hash: string;
};
export type KnowledgeMatch = {
    chunkId: number;
    kind: KnowledgeKind;
    title: string;
    text: string;
    sourceId: string;
    sourceVersion: string;
    projectId?: string;
    score: number;
    breakdown: {
        bm25: number | null;
        vector: number | null;
        boost: number;
    };
};
export type SearchInput = {
    profileId?: string | null;
    projectId?: string;
    query: string;
    kinds?: string[];
    limit: number;
    tokenBudget: number;
    excludeChunkIds?: number[];
    mode: "text" | "hybrid";
    queryVector?: number[];
};
const STOP = new Set(["va", "la", "cua", "cho", "nhung", "cac", "mot", "the", "a", "an", "of", "to", "and", "in"]);
export function searchKnowledge(db: Database.Database, input: SearchInput): {
    matches: KnowledgeMatch[];
    mode: "text" | "hybrid";
} {
    const empty = { matches: [], mode: "text" as const };
    if (input.projectId === PROTECTED_PROJECT_ID || (!input.profileId && !input.projectId))
        return empty;
    if (input.projectId && input.profileId && !db.prepare("SELECT 1 FROM projects WHERE id=? AND profile_id=?").get(input.projectId, input.profileId))
        return empty;
    const off = input.profileId ? retrievalSettings(db).profiles[input.profileId]?.kindsOff ?? [] : [];
    const rows = db.prepare(`SELECT c.* FROM retrieval_chunks c WHERE (c.project_id IS NULL OR c.project_id<>@protected) AND
    ((@profile IS NOT NULL AND c.profile_id=@profile) OR (@profile IS NULL AND c.profile_id IS NULL AND c.project_id=@project))
    AND NOT EXISTS(SELECT 1 FROM retrieval_exclusions e WHERE e.project_id=@project AND e.chunk_id=c.id)`)
        .all({ profile: input.profileId ?? null, project: input.projectId ?? null, protected: PROTECTED_PROJECT_ID }) as ChunkRow[];
    const scope = rows.filter(r => !off.includes(r.kind) && (!input.kinds || input.kinds.includes(r.kind)) && !input.excludeChunkIds?.includes(r.id));
    if (!scope.length)
        return empty;
    const ids = new Set(scope.map(r => r.id));
    const terms = [...new Set(knowledgeTerms(input.query).filter(t => !STOP.has(t)))].slice(0, 24);
    let text: {
        id: number;
        rank: number;
    }[] = [];
    if (terms.length && initializeFts(db)) {
        text = (db.prepare(`SELECT c.id,bm25(retrieval_fts) rank FROM retrieval_fts JOIN retrieval_chunks c ON c.id=retrieval_fts.rowid WHERE retrieval_fts MATCH ? AND c.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) ORDER BY rank LIMIT 50`).all(terms.map(t => '"' + t + '"').join(" OR "), JSON.stringify([...ids])) as {
            id: number;
            rank: number;
        }[]).filter(r => ids.has(r.id)).slice(0, 50);
    }
    else {
        text = scope.map(r => ({ id: r.id, rank: -new Set(knowledgeTerms(r.title + " " + r.text).filter(t => terms.includes(t))).size })).filter(r => r.rank < 0).sort((a, b) => a.rank - b.rank).slice(0, 50);
    }
    const model = embeddingModel(db);
    const vectors = input.mode === "hybrid" && input.queryVector && model ? scope.filter(r => r.embedding && r.embedding_model === model).map(r => ({ id: r.id, score: cosine(input.queryVector!, readVector(r.embedding!)) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 50) : [];
    const mode = vectors.length ? "hybrid" as const : "text" as const;
    const views = scope.filter(r => r.kind === "result").map(r => Number(JSON.parse(r.meta).views ?? 0)).sort((a, b) => a - b);
    const median = views[Math.floor(views.length / 2)] ?? 0;
    const ranked = scope.flatMap(r => {
        const ti = text.findIndex(t => t.id === r.id), vi = vectors.findIndex(v => v.id === r.id);
        if (ti < 0 && vi < 0)
            return [];
        let boost = ["memory", "guideline"].includes(r.kind) ? 1.1 : 1;
        if (r.kind === "result" && Number(JSON.parse(r.meta).views) > median)
            boost *= 1.1;
        if (Date.parse(r.updated_at) < Date.now() - 18 * 30.4375 * 86400000)
            boost *= 0.9;
        return [{ row: r, score: ((ti < 0 ? 0 : 1 / (61 + ti)) + (vi < 0 ? 0 : 1 / (61 + vi))) * boost, breakdown: { bm25: ti < 0 ? null : text[ti]!.rank, vector: vi < 0 ? null : vectors[vi]!.score, boost } }];
    }).sort((a, b) => b.score - a.score || a.row.id - b.row.id);
    let tokens = 0;
    const counts = new Map<string, number>();
    const matches: KnowledgeMatch[] = [];
    for (const { row: r, score, breakdown } of ranked) {
        if (matches.length >= input.limit)
            break;
        if (r.project_id && (counts.get(r.project_id) ?? 0) >= 2)
            continue;
        const safe = safeKnowledgeText(r.text);
        if (!safe)
            continue;
        if (matches.some(m => overlap(m.text, safe) > 0.8))
            continue;
        const cost = Math.ceil((safe.length + r.title.length + 60) / 4);
        if (tokens + cost > input.tokenBudget)
            continue;
        tokens += cost;
        if (r.project_id)
            counts.set(r.project_id, (counts.get(r.project_id) ?? 0) + 1);
        matches.push({ chunkId: r.id, kind: r.kind, title: safeKnowledgeText(r.title), text: safe, sourceId: r.source_id, sourceVersion: r.source_version, ...(r.project_id ? { projectId: r.project_id } : {}), score, breakdown });
    }
    return { matches, mode };
}
function overlap(a: string, b: string) { const shingles = (s: string) => { const t = knowledgeTerms(s); return new Set(t.map((_, i) => t.slice(i, i + 3).join(" "))); }; const x = shingles(a), y = shingles(b); return [...x].filter(s => y.has(s)).length / Math.max(1, Math.min(x.size, y.size)); }
