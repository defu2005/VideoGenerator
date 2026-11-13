import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { KnowledgeExclusionSchema, KnowledgeSearchSchema, PROTECTED_PROJECT_ID, safeKnowledgeText } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { enqueueIndex, knowledgeStatus } from "../retrieval/service.js";
import { retrievalSettings, saveRetrievalSettings } from "../retrieval/settings.js";
import { embeddingProviders, embedTexts } from "../retrieval/embeddings.js";
import { searchKnowledge } from "../retrieval/search.js";
const params = z.object({ id: z.string().uuid() });
export function registerRetrievalRoutes(app: FastifyInstance, db: Database.Database) {
    const profile = (raw: unknown) => { const { id } = params.parse(raw); if (!db.prepare("SELECT 1 FROM profiles WHERE id=?").get(id))
        throw new AppError(404, "PROFILE_NOT_FOUND", "Không tìm thấy hồ sơ."); return id; };
    const project = (raw: unknown) => { const { id } = params.parse(raw); const row = db.prepare("SELECT profile_id FROM projects WHERE id=? AND id<>?").get(id, PROTECTED_PROJECT_ID) as {
        profile_id: string | null;
    } | undefined; if (!row)
        throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án."); return { id, ...row }; };
    app.get("/api/retrieval/profiles/:id/status", async (req) => knowledgeStatus(db, profile(req.params)));
    app.post("/api/retrieval/profiles/:id/rebuild", async (req) => { enqueueIndex(db, { scope: "profile", profileId: profile(req.params) }); return { queued: true }; });
    app.post("/api/retrieval/profiles/:id/search", async (req) => { const profileId = profile(req.params), body = KnowledgeSearchSchema.parse(req.body); const vector = body.mode === "hybrid" ? (await embedTexts(db, [body.query]))?.[0] : undefined; return searchKnowledge(db, { ...body, profileId, limit: 8, tokenBudget: 3000, queryVector: vector }); });
    app.get("/api/retrieval/projects/:id/uses", async (req) => { const p = project(req.params); return { uses: (db.prepare("SELECT * FROM retrieval_uses WHERE project_id=? ORDER BY id DESC").all(p.id) as any[]).map(u => ({ ...u, chunkIds: JSON.parse(u.chunk_ids), scores: JSON.parse(u.scores), chunks: (JSON.parse(u.chunk_ids) as number[]).flatMap(id => { const c = db.prepare("SELECT id,title,text,kind,project_id,profile_id FROM retrieval_chunks WHERE id=? AND (project_id IS NULL OR project_id<>?)").get(id, PROTECTED_PROJECT_ID) as any; if (!c || (p.profile_id ? c.profile_id !== p.profile_id : c.project_id !== p.id))
                return []; return [{ chunkId: c.id, title: safeKnowledgeText(c.title), text: safeKnowledgeText(c.text), kind: c.kind, projectId: c.project_id, excluded: !!db.prepare("SELECT 1 FROM retrieval_exclusions WHERE project_id=? AND chunk_id=?").get(p.id, id) }]; }) })) }; });
    app.put("/api/retrieval/projects/:id/exclusions", async (req) => { const p = project(req.params), body = KnowledgeExclusionSchema.parse(req.body); const c = db.prepare("SELECT profile_id,project_id FROM retrieval_chunks WHERE id=? AND (project_id IS NULL OR project_id<>?)").get(body.chunkId, PROTECTED_PROJECT_ID) as any; if (!c || (p.profile_id ? c.profile_id !== p.profile_id : c.project_id !== p.id))
        throw new AppError(404, "CHUNK_NOT_FOUND", "Không tìm thấy đoạn trong hồ sơ."); if (body.excluded)
        db.prepare("INSERT OR IGNORE INTO retrieval_exclusions(project_id,chunk_id,created_at) VALUES(?,?,?)").run(p.id, body.chunkId, new Date().toISOString());
    else
        db.prepare("DELETE FROM retrieval_exclusions WHERE project_id=? AND chunk_id=?").run(p.id, body.chunkId); return { ok: true }; });
    app.get("/api/retrieval/settings", async () => ({ settings: retrievalSettings(db), providers: embeddingProviders(db) }));
    app.put("/api/retrieval/settings", async (req) => { const old = retrievalSettings(db), settings = saveRetrievalSettings(db, req.body); if (JSON.stringify(settings) !== JSON.stringify(old))
        enqueueIndex(db, { scope: "all" }); return { settings, providers: embeddingProviders(db) }; });
    app.post("/api/retrieval/settings/test", async () => ({ ok: !!await embedTexts(db, ["Tri thức giúp kênh tạo video hữu ích."]) }));
}
