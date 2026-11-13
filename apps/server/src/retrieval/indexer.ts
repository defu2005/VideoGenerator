import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { activeGuidelines, builtInGuidelinePack, chunkKnowledge, commentText, containsProtectedProject, PROTECTED_PROJECT_ID, resultSentence, safeKnowledgeText, resolveBudget, type KnowledgeKind, type ProjectSettings } from "@vg/shared";
import { getGuidelinePacks } from "../guidelines/settings.js";
import { KnowledgeService } from "../knowledge/service.js";
import { resolveMarket } from "../knowledge/markets.js";
import { deleteFts, initializeFts, insertFts, rebuildFts } from "./ftsIndex.js";
import { embeddingModel, embedTexts, vectorBlob } from "./embeddings.js";
import { retrievalSettings } from "./settings.js";
import type { ChunkRow } from "./search.js";
export type IndexPayload = {
    scope: "source";
    kind: KnowledgeKind;
    sourceId: string;
} | {
    scope: "profile";
    profileId: string;
} | {
    scope: "all";
};
type Source = {
    kind: KnowledgeKind;
    id: string;
    version: string;
    profileId: string | null;
    projectId: string | null;
    title: string;
    texts: string[];
    meta?: Record<string, unknown>;
};
const parse = (s: string | null | undefined): any => { try {
    return JSON.parse(s ?? "null");
}
catch {
    return null;
} };
function sources(db: Database.Database): Source[] {
    const out: Source[] = [];
    const profiles = db.prepare("SELECT * FROM profiles").all() as any[];
    for (const p of profiles) {
        const base = { profileId: p.id, projectId: null, version: p.updated_at };
        for (const m of db.prepare("SELECT * FROM profile_memories WHERE profile_id=?").all(p.id) as any[])
            out.push({ ...base, kind: "memory", id: m.id, version: String(m.version), title: "Ghi nhớ", texts: [m.text] });
        const hints = parse(p.learned_hints);
        const insight = db.prepare("SELECT json,created_at FROM profile_insights WHERE profile_id=? ORDER BY created_at DESC LIMIT 1").get(p.id) as any;
        out.push({ ...base, kind: "lesson", id: p.id, title: "Bài học", texts: [p.learned_notes, ...(hints?.topicAngles ?? []), ...(hints?.avoid ?? []), insight ? JSON.stringify(parse(insight.json)) : ""].filter(Boolean).flatMap(t => t.split(/\n\s*\n/)) });
        out.push({ ...base, kind: "guideline", id: p.id, title: "Quy tắc hồ sơ", texts: parse(p.guidelines)?.customRules ?? [] });
    }
    const projects = db.prepare("SELECT * FROM projects WHERE id<>?").all(PROTECTED_PROJECT_ID) as any[];
    const settings = retrievalSettings(db);
    const knowledge = new KnowledgeService(db);
    const packs = getGuidelinePacks(db);
    for (const p of projects) {
        const base = { profileId: p.profile_id, projectId: p.id, version: p.updated_at };
        const script = db.prepare("SELECT * FROM scripts WHERE project_id=?").get(p.id) as any;
        if (script) {
            const d = parse(script.data);
            out.push({ ...base, kind: "script", id: p.id, version: String(script.version), title: "Kịch bản: " + (d?.title ?? p.title), texts: [d?.hook, ...(d?.sections ?? []).map((s: any) => [s.heading, s.narration].filter(Boolean).join(": ")), d?.outro].filter(Boolean), meta: { projectTitle: p.title } });
        }
        const research = db.prepare("SELECT * FROM research_notes WHERE project_id=?").get(p.id) as any;
        if (research) {
            const d = parse(research.data);
            const urls = (JSON.stringify(d).match(/https?:[^\s"<>]+/g) ?? []);
            out.push({ ...base, kind: "research", id: p.id, version: research.created_at, title: "Nghiên cứu: " + p.title, texts: [d?.summary, ...(d?.keyFacts ?? []).map((f: any) => [f.fact, f.sourceHint].filter(Boolean).join(" — ")), ...(d?.sources ?? []).map((s: any) => JSON.stringify(s))].filter(Boolean), meta: { projectTitle: p.title, sourceUrls: urls } });
        }
        const rules = activeGuidelines({ settings: parse(p.settings) as ProjectSettings }, packs,
            (id) => builtInGuidelinePack(id, (key) => knowledge.get(key)?.entry.value),
            (code) => resolveMarket(db, code)?.pack ?? null);
        for (const pack of rules.packs)
            out.push({ ...base, projectId: pack.id === "project" || !p.profile_id ? p.id : null, kind: "guideline", id: (pack.id === "project" ? p.id : (p.profile_id ?? p.id) + ":" + pack.id), version: pack.reviewedAt ?? p.updated_at, title: pack.name, texts: pack.rules.map(r => r.text) });
    }
    for (const pub of db.prepare("SELECT u.*,p.profile_id,p.title,a.platform FROM publications u JOIN projects p ON p.id=u.project_id JOIN platform_accounts a ON a.id=u.account_id WHERE p.id<>?").all(PROTECTED_PROJECT_ID) as any[]) {
        const m = db.prepare("SELECT * FROM publication_metrics_snapshots WHERE publication_id=? ORDER BY fetched_at DESC LIMIT 1").get(pub.id) as any;
        const metrics = m ?? parse(pub.latest_metrics) ?? {};
        const base = { profileId: pub.profile_id, projectId: pub.project_id, version: m?.fetched_at ?? pub.updated_at };
        out.push({ ...base, kind: "result", id: pub.id, title: "Kết quả: " + pub.title, texts: [pub.title + " — " + pub.platform + " — " + (pub.published_at ?? pub.updated_at) + " — " + resultSentence(metrics.views, metrics.avg_view_pct ?? metrics.avgViewPct)], meta: { projectTitle: pub.title, publishedAt: pub.published_at, platform: pub.platform, views: metrics.views, avgViewPct: metrics.avg_view_pct ?? metrics.avgViewPct } });
        if (settings.indexComments) {
            const comments = db.prepare("SELECT text,status,classification,like_count FROM comments WHERE publication_id=? AND status NOT IN ('spam','hidden') ORDER BY like_count DESC LIMIT 10").all(pub.id) as any[];
            out.push({ ...base, kind: "comment", id: pub.id, title: "Bình luận: " + pub.title, texts: [commentText(comments)], meta: { projectTitle: pub.title } });
        }
    }
    for (const t of db.prepare("SELECT * FROM profile_topics WHERE project_id IS NULL OR project_id<>?").all(PROTECTED_PROJECT_ID) as any[])
        out.push({ kind: "topic", id: t.id, version: t.updated_at, profileId: t.profile_id, projectId: t.project_id, title: "Chủ đề: " + t.topic, texts: [t.topic + "\n" + (t.notes ?? "")] });
    for (const report of db.prepare("SELECT * FROM skill_reports WHERE verdict IS NOT NULL AND lesson IS NOT NULL AND lesson <> ''").all() as any[]) {
        const metrics = parse(report.metrics) ?? [];
        out.push({
            kind: "skill_report",
            id: report.id,
            version: report.updated_at,
            profileId: report.profile_id,
            projectId: null,
            title: "Báo cáo skill: " + report.skill,
            texts: [[report.skill, report.hypothesis, report.verdict, report.lesson, JSON.stringify(metrics)].filter(Boolean).join("\n")],
        });
    }
    return out;
}
export async function indexKnowledge(db: Database.Database, payload: IndexPayload, signal?: AbortSignal, embeddings = true) {
    initializeFts(db);
    const all = sources(db).filter(s => payload.scope === "all" || (payload.scope === "profile" ? s.profileId === payload.profileId : s.kind === payload.kind && s.id === payload.sourceId));
    const keep = new Set<number>();
    let writes = 0;
    db.transaction(() => {
        for (const source of all) {
            if (source.projectId === PROTECTED_PROJECT_ID || containsProtectedProject(source.title))
                continue;
            let sceneIndex = 0;
            for (const raw of source.texts) {
                if (containsProtectedProject(raw))
                    continue;
                for (const text of chunkKnowledge(raw)) {
                    const hash = createHash("sha256").update(text.normalize("NFC").replace(/\s+/g, " ").trim()).digest("hex");
                    const old = db.prepare("SELECT * FROM retrieval_chunks WHERE kind=? AND source_id=? AND content_hash=?").get(source.kind, source.id, hash) as ChunkRow | undefined;
                    if (old) {
                        keep.add(old.id);
                        continue;
                    }
                    const now = new Date().toISOString();
                    const title = (chunkKnowledge(source.title)[0] ?? source.kind).slice(0, 200);
                    const r = db.prepare("INSERT INTO retrieval_chunks(profile_id,project_id,kind,source_id,source_version,content_hash,title,text,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(source.profileId, source.projectId, source.kind, source.id, source.version, hash, title, text, JSON.stringify({ ...source.meta, projectTitle: safeKnowledgeText(String(source.meta?.projectTitle??"")), sourceUrls: (source.meta?.sourceUrls as string[]|undefined)?.map(safeKnowledgeText), sceneIndex: sceneIndex++ }), now, now);
                    const id = Number(r.lastInsertRowid);
                    keep.add(id);
                    insertFts(db, { id, title, text });
                    writes++;
                }
            }
        }
        const old = db.prepare("SELECT * FROM retrieval_chunks").all() as ChunkRow[];
        for (const r of old) {
            const inScope = payload.scope === "all" || (payload.scope === "profile" ? r.profile_id === payload.profileId : r.kind === payload.kind && r.source_id === payload.sourceId);
            if (inScope && !keep.has(r.id)) {
                deleteFts(db, r);
                db.prepare("DELETE FROM retrieval_chunks WHERE id=?").run(r.id);
                writes++;
            }
        }
        for (const p of db.prepare("SELECT profile_id,count(*) n FROM retrieval_chunks WHERE profile_id IS NOT NULL GROUP BY profile_id HAVING count(*)>20000").all() as {
            profile_id: string;
            n: number;
        }[]) {
            const excess = p.n - 20000;
            const oldest = db.prepare("SELECT * FROM retrieval_chunks WHERE profile_id=? ORDER BY CASE WHEN kind IN ('script','research','comment') THEN 0 ELSE 1 END,created_at,id LIMIT ?").all(p.profile_id, excess) as ChunkRow[];
            for (const r of oldest) {
                deleteFts(db, r);
                db.prepare("DELETE FROM retrieval_chunks WHERE id=?").run(r.id);
            }
            db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run("retrieval.dropped." + p.profile_id, String(excess), new Date().toISOString());
        }
    })();
    if (payload.scope !== "source" && initializeFts(db))
        rebuildFts(db);
    const model = embeddingModel(db);
    if (model && embeddings) {
        const pending = (db.prepare("SELECT * FROM retrieval_chunks WHERE embedding IS NULL OR embedding_model<>?").all(model) as ChunkRow[]).filter(r => { if (!keep.has(r.id))
            return false; if (!r.project_id)
            return true; const p = db.prepare("SELECT settings FROM projects WHERE id=?").get(r.project_id) as {
            settings: string;
        } | undefined; return p ? resolveBudget(parse(p.settings)?.budget ?? { mode: "BALANCED" }).knowledgeEmbeddings : false; });
        for (let i = 0; i < pending.length; i += 32) {
            const batch = pending.slice(i, i + 32);
            const vectors = await embedTexts(db, batch.map(r => r.text), signal);
            if (!vectors)
                break;
            for (let j = 0; j < batch.length; j++)
                db.prepare("UPDATE retrieval_chunks SET embedding=?,embedding_model=? WHERE id=?").run(vectorBlob(vectors[j]!), model, batch[j]!.id);
        }
    }
    return { writes, chunks: keep.size };
}
