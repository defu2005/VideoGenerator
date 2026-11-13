import { searchKnowledge } from "../retrieval/search.js";
import { indexKnowledge } from "../retrieval/indexer.js";
import { enqueueIndex } from "../retrieval/service.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { knowledgeTerms, containsProtectedProject, PROTECTED_PROJECT_ID, redactExportText } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../lib/errors.js";

export const ProfileContextArgs = z.object({
  profileId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(300),
  kinds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(8).default(5),
}).strict();

type MemoryRow = { id: string; text: string; version: number; created_at: string; updated_at: string };

function requireProfile(db: Database.Database, profileId: string) {
  const profile = db.prepare("SELECT learned_notes, guidelines, updated_at FROM profiles WHERE id = ?").get(profileId) as
    { learned_notes: string; guidelines: string; updated_at: string } | undefined;
  if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Không tìm thấy hồ sơ.");
  return profile;
}

function memoryRows(db: Database.Database, profileId: string): MemoryRow[] {
  return db.prepare(
    "SELECT id, text, version, created_at, updated_at FROM profile_memories WHERE profile_id = ? ORDER BY updated_at DESC, id LIMIT 100",
  ).all(profileId) as MemoryRow[];
}

export function listProfileMemories(db: Database.Database, profileId: string) {
  requireProfile(db, profileId);
  return memoryRows(db, profileId).map((row) => ({ ...row, source: "user" as const }));
}

export function saveProfileMemory(db: Database.Database, profileId: string, text: string, id?: string) {
  const safe = redactExportText(text).trim();
  if (containsProtectedProject(text) || !safe) throw new AppError(400, "INVALID_MEMORY", "Không thể lưu nội dung ghi nhớ.");
  return db.transaction(() => {
    requireProfile(db, profileId);
    const now = new Date().toISOString();
    if (id) {
      const updated = db.prepare(
        "UPDATE profile_memories SET text = ?, version = version + 1, updated_at = ? WHERE profile_id = ? AND id = ?",
      ).run(safe, now, profileId, id);
      if (!updated.changes) throw new AppError(404, "MEMORY_NOT_FOUND", "Không tìm thấy ghi nhớ trong hồ sơ.");
      enqueueIndex(db,{scope:"source",kind:"memory",sourceId:id});
    void indexKnowledge(db,{scope:"source",kind:"memory",sourceId:id},undefined,false);
      return { id };
    }
    if (memoryRows(db, profileId).length >= 100) throw new AppError(409, "MEMORY_LIMIT", "Hồ sơ đã có 100 ghi nhớ.");
    const memoryId = randomUUID();
    db.prepare("INSERT INTO profile_memories (id, profile_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(memoryId, profileId, safe, now, now);
    enqueueIndex(db,{scope:"source",kind:"memory",sourceId:memoryId});
    void indexKnowledge(db,{scope:"source",kind:"memory",sourceId:memoryId},undefined,false);
    return { id: memoryId };
  }).immediate();
}

export function deleteProfileMemory(db: Database.Database, profileId: string, id: string): void {
  if (!db.prepare("DELETE FROM profile_memories WHERE profile_id = ? AND id = ?").run(profileId, id).changes) {
    throw new AppError(404, "MEMORY_NOT_FOUND", "Không tìm thấy ghi nhớ trong hồ sơ.");
  }
  enqueueIndex(db,{scope:"source",kind:"memory",sourceId:id});
    void indexKnowledge(db,{scope:"source",kind:"memory",sourceId:id},undefined,false);
}

export function searchProfileContext(db:Database.Database,input:z.output<typeof ProfileContextArgs>){
  requireProfile(db,input.profileId);
  if(input.projectId && (input.projectId===PROTECTED_PROJECT_ID || !db.prepare("SELECT 1 FROM projects WHERE id=? AND profile_id=? AND archived_at IS NULL").get(input.projectId,input.profileId)))throw new AppError(404,"PROJECT_NOT_FOUND","Không tìm thấy dự án trong hồ sơ.");
  // Lazy bootstrap for callers embedding the service without server startup.
  if(!db.prepare("SELECT 1 FROM retrieval_chunks WHERE profile_id=? LIMIT 1").get(input.profileId))void indexKnowledge(db,{scope:"profile",profileId:input.profileId},undefined,false);
  // Preserve TASK-052 read-after-write semantics while embedding stays asynchronous.
  for(const row of db.prepare("SELECT scope FROM jobs WHERE scope LIKE 'retrieval_index:%' AND status='QUEUED'").all() as {scope:string}[]){
    const payload=JSON.parse(row.scope.slice("retrieval_index:".length));
    if(payload.scope!=="source")continue;
    const owned=payload.kind==="memory" ? !!db.prepare("SELECT 1 FROM profile_memories WHERE id=? AND profile_id=?").get(payload.sourceId,input.profileId) : !!db.prepare("SELECT 1 FROM projects WHERE id=? AND profile_id=?").get(payload.sourceId,input.profileId);
    if(owned)void indexKnowledge(db,payload,undefined,false);
  }
  const result=searchKnowledge(db,{...input,limit:50,mode:"text",tokenBudget:12000});
  const terms=new Set(knowledgeTerms(input.query));
  result.matches.sort((a,b)=>new Set(knowledgeTerms(b.title+" "+b.text).filter(t=>terms.has(t))).size-new Set(knowledgeTerms(a.title+" "+a.text).filter(t=>terms.has(t))).size);
  result.matches=result.matches.slice(0,input.limit);
  return {profileId:input.profileId,contentType:"untrusted_context_data",matches:result.matches.map(m=>({kind:m.kind,sourceId:m.sourceId,version:/^\d+$/.test(m.sourceVersion)?Number(m.sourceVersion):m.sourceVersion,excerpt:m.text.slice(0,650)}))};
}
