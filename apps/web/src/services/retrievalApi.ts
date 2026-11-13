import type { RetrievalSettings } from "@vg/shared";
import { apiRequest } from "./apiClient";
export type KnowledgeStatus = {
    counts: Record<string, number>;
    total: number;
    embeddingCoverage: number;
    embeddingModel: string | null;
    lastIndexedAt: string | null;
    chunksOverCap: number;
    ftsAvailable: boolean;
    indexing: boolean;
};
export type KnowledgeHit = {
    chunkId: number;
    kind: string;
    title: string;
    text: string;
    projectId?: string;
    sourceId: string;
    sourceVersion: string;
    score: number;
    breakdown: {
        bm25: number | null;
        vector: number | null;
        boost: number;
    };
};
export type UsedChunk = {
    chunkId: number;
    title: string;
    text: string;
    kind: string;
    projectId?: string;
    excluded: boolean;
};
export type KnowledgeUse = {
    id: number;
    stage: string;
    task_id: string;
    chunks: UsedChunk[];
};
export type KnowledgeSettings = {
    settings: RetrievalSettings;
    providers: {
        id: string;
        label: string;
    }[];
};
const json = (method: string, body?: unknown) => ({ method, body: JSON.stringify(body) });
export const getKnowledgeStatus = (id: string) => apiRequest<KnowledgeStatus>('/retrieval/profiles/' + id + '/status');
export const rebuildKnowledge = (id: string) => apiRequest('/retrieval/profiles/' + id + '/rebuild', json('POST'));
export const searchKnowledge = (id: string, query: string) => apiRequest<{
    matches: KnowledgeHit[];
    mode: string;
}>('/retrieval/profiles/' + id + '/search', json('POST', { query }));
export const getKnowledgeSettings = () => apiRequest<KnowledgeSettings>('/retrieval/settings');
export const saveKnowledgeSettings = (settings: RetrievalSettings) => apiRequest<KnowledgeSettings>('/retrieval/settings', json('PUT', settings));
export const testEmbedding = () => apiRequest<{
    ok: boolean;
}>('/retrieval/settings/test', json('POST'));
export const getKnowledgeUses = (id: string) => apiRequest<{
    uses: KnowledgeUse[];
}>('/retrieval/projects/' + id + '/uses');
export const excludeKnowledge = (id: string, chunkId: number, excluded: boolean) => apiRequest('/retrieval/projects/' + id + '/exclusions', json('PUT', { chunkId, excluded }));
