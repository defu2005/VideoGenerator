import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { indexKnowledge, type IndexPayload } from "./indexer.js";
import { initializeFts } from "./ftsIndex.js";
import { embeddingModel } from "./embeddings.js";
export function enqueueIndex(db: Database.Database, payload: IndexPayload) {
    if (payload.scope === "source" && payload.sourceId === PROTECTED_PROJECT_ID)
        return;
    const scope = "retrieval_index:" + JSON.stringify(payload), now = new Date().toISOString();
    const recent = db.prepare("SELECT id,status,created_at FROM jobs WHERE scope=? AND (status IN ('QUEUED','RUNNING') OR created_at>?) ORDER BY created_at DESC LIMIT 1").get(scope, new Date(Date.now() - 30000).toISOString()) as {
        id: string;
        status: string;
        created_at: string;
    } | undefined;
    if (recent?.status === "QUEUED")
        return;
    const runAfter = recent ? new Date(Math.max(Date.now(), Date.parse(recent.created_at) + 30000)).toISOString() : now;
    db.prepare("INSERT INTO jobs(id,project_id,stage,scope,status,created_at,run_after) VALUES(?,NULL,'RESEARCH',?,'QUEUED',?,?)").run(randomUUID(), scope, now, runAfter);
}
export function initializeRetrieval(db: Database.Database, logger?: {
    warn(message: string): void;
}) {
    initializeFts(db, logger);
    db.prepare("UPDATE jobs SET status='QUEUED' WHERE scope LIKE 'retrieval_index:%' AND status='RUNNING'").run();
    if (!db.prepare("SELECT 1 FROM app_settings WHERE key='retrieval.initialized'").get()) {
        enqueueIndex(db, { scope: "all" });
        db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('retrieval.initialized','true',?)").run(new Date().toISOString());
    }
}
export async function runIndexJob(db: Database.Database, signal?: AbortSignal) {
    const row = db.prepare("SELECT id,scope FROM jobs WHERE scope LIKE 'retrieval_index:%' AND status='QUEUED' AND run_after<=? ORDER BY created_at LIMIT 1").get(new Date().toISOString()) as {
        id: string;
        scope: string;
    } | undefined;
    if (!row)
        return;
    db.prepare("UPDATE jobs SET status='RUNNING',started_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    try {
        await indexKnowledge(db, JSON.parse(row.scope.slice("retrieval_index:".length)), signal);
        db.prepare("UPDATE jobs SET status='SUCCEEDED',progress=100,finished_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    }
    catch {
        db.prepare("UPDATE jobs SET status='FAILED',message='Không thể lập chỉ mục',finished_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    }
}
export function knowledgeStatus(db: Database.Database, profileId: string) {
    const rows = db.prepare("SELECT kind,count(*) count FROM retrieval_chunks WHERE profile_id=? AND (project_id IS NULL OR project_id<>?) GROUP BY kind").all(profileId, PROTECTED_PROJECT_ID) as {
        kind: string;
        count: number;
    }[];
    const model = embeddingModel(db);
    const n = db.prepare("SELECT count(*) total,sum(CASE WHEN embedding IS NOT NULL AND embedding_model=? THEN 1 ELSE 0 END) embedded,max(updated_at) lastIndexedAt FROM retrieval_chunks WHERE profile_id=?").get(model, profileId) as {
        total: number;
        embedded: number;
        lastIndexedAt: string | null;
    };
    const dropped = db.prepare("SELECT value FROM app_settings WHERE key=?").get("retrieval.dropped." + profileId) as {
        value: string;
    } | undefined;
    return { counts: Object.fromEntries(rows.map(r => [r.kind, r.count])), total: n.total, embeddingCoverage: n.total ? 100 * n.embedded / n.total : 0, embeddingModel: model, lastIndexedAt: n.lastIndexedAt, chunksOverCap: Number(dropped?.value ?? 0), ftsAvailable: initializeFts(db), indexing: !n.total || !!db.prepare("SELECT 1 FROM jobs WHERE scope LIKE 'retrieval_index:%' AND status IN ('QUEUED','RUNNING') LIMIT 1").get() };
}
