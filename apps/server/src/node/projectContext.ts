import type Database from "better-sqlite3";
import { z } from "zod";
import {
  GuidelineSettingsSchema, KnowledgeEntrySchema, LlmSettingsSchema, ProfileDefaultBriefSchema, ProfileLlmSettingsSchema,
  ProfileSchema, SaveGuidelinePacksInputSchema, StyleTokensPatchSchema, TtsAppSettingsSchema,
} from "@vg/shared";
import { defaultWorkspaceId } from "../auth/workspaces.js";
import { AppError } from "../lib/errors.js";

const profileSchema = z.object({
  id: z.string(), workspace_id: z.string().nullable(), name: z.string(), description: z.string(), direction: z.string(),
  language: z.string(), market: z.string().nullable(), default_brief: z.string(), voice: z.string().nullable(),
  guidelines: z.string(), llm: z.string().nullable(), learned_notes: z.string(), learned_hints: z.string().nullable(),
  title_ab_test: z.number(), style_pack_id: z.string().nullable(), color: z.string(), created_at: z.string(), updated_at: z.string(),
}).strict();
const styleSchema = z.object({ workspace_id: z.string().nullable(), id: z.string(), version: z.number().int(), name: z.string(), origin: z.string(), seed: z.string().nullable(), tokens: z.string(), created_at: z.string() }).strict();
const settingsSchema = z.object({ key: z.enum(["llmRouting", "guidelinePacks", "tts"]), value: z.string(), updated_at: z.string() }).strict();
const knowledgeSchema = z.object({ workspace_id: z.string().nullable(), id: z.string(), key: z.string(), kind: z.string(), json: z.string().nullable(), revision: z.number().int().nonnegative(), updated_at: z.string() }).strict();
export const ProjectContextSchema = z.object({
  workspaceId: z.string().nullable(), profiles: z.array(profileSchema).max(1), styles: z.array(styleSchema), settings: z.array(settingsSchema),
  knowledge: z.array(knowledgeSchema),
  excludedChunkIds: z.array(z.number().int().positive()),
}).strict();
export type ProjectContext = z.infer<typeof ProjectContextSchema>;

/** Explicit read surfaces: profileService, StylePackService, guidelines/settings, LLM routing and TTS registry.
 * Genre packs and prompt templates are versioned source in @vg/shared, not workspace database rows.
 * RAG is fetched over the run-scoped context RPC; provider credentials are never part of this pack.
 */
export const PROJECT_CONTEXT_READS = {
  profiles: "pack", style_packs: "pack", app_settings: "allowlisted-pack", knowledge_entries: "pack", knowledge_revisions: "pack-current-only",
  retrieval_chunks: "context-rpc", retrieval_exclusions: "project-registry",
} as const;

function normalizeProfile(raw: unknown) {
  const row = profileSchema.parse(raw);
  row.default_brief = JSON.stringify(ProfileDefaultBriefSchema.parse(JSON.parse(row.default_brief)));
  row.guidelines = JSON.stringify(GuidelineSettingsSchema.parse(JSON.parse(row.guidelines)));
  if (row.voice) row.voice = JSON.stringify(ProfileSchema.shape.voice.parse(JSON.parse(row.voice)));
  if (row.llm) row.llm = JSON.stringify(ProfileLlmSettingsSchema.parse(JSON.parse(row.llm)));
  if (row.learned_hints) row.learned_hints = JSON.stringify(z.object({ topicAngles: z.array(z.string()).optional(), avoid: z.array(z.string()).optional() }).parse(JSON.parse(row.learned_hints)));
  return row;
}

function normalizeSetting(row: z.infer<typeof settingsSchema>) {
  const value = JSON.parse(row.value);
  if (row.key === "llmRouting") return { ...row, value: JSON.stringify(LlmSettingsSchema.parse(value)) };
  if (row.key === "guidelinePacks") return { ...row, value: JSON.stringify(SaveGuidelinePacksInputSchema.parse(value)) };
  const tts = TtsAppSettingsSchema.parse(value);
  // Executable locations/templates belong to the node's own installation.
  return { ...row, value: JSON.stringify({ ...tts, piperBinary: "", piperModelsDir: "", vieneuTemplate: "" }) };
}

export function exportProjectContext(db: Database.Database, projectId: string): ProjectContext {
  const project = db.prepare("SELECT workspace_id,profile_id FROM projects WHERE id=?").get(projectId) as { workspace_id: string | null; profile_id: string | null };
  const workspaceId = project.workspace_id ?? defaultWorkspaceId(db);
  const fields = Object.keys(profileSchema.shape).map((name) => `"${name}"`).join(",");
  const raw = project.profile_id ? db.prepare(`SELECT ${fields} FROM profiles WHERE id=? AND workspace_id IS ?`).get(project.profile_id, workspaceId) : undefined;
  if (project.profile_id && !raw) throw new AppError(409, "SNAPSHOT_PROFILE_SCOPE", "Hồ sơ không thuộc workspace của dự án.");
  const profiles = raw ? [normalizeProfile(raw)] : [];
  const styles = profiles[0]?.style_pack_id
    ? (db.prepare("SELECT * FROM style_packs WHERE id=? AND workspace_id IS ? ORDER BY version").all(profiles[0].style_pack_id, workspaceId)).map((row) => {
      const style = styleSchema.parse(row);
      style.tokens = JSON.stringify(StyleTokensPatchSchema.parse(JSON.parse(style.tokens)));
      return style;
    }) : [];
  const settings = (db.prepare("SELECT key,value,updated_at FROM app_settings WHERE key IN ('llmRouting','guidelinePacks','tts') ORDER BY key").all())
    .map((row) => normalizeSetting(settingsSchema.parse(row)));
  // Ship current accepted overrides; the built-in knowledge snapshot is already versioned with the node.
  // Do not export proposal/history rows, authors or before-values.
  const knowledge = db.prepare("SELECT * FROM knowledge_entries WHERE workspace_id IS ? AND revision>0 ORDER BY key,id").all(workspaceId).map((raw) => {
    const row = knowledgeSchema.parse(raw);
    if (row.json) row.json = JSON.stringify(KnowledgeEntrySchema.parse(JSON.parse(row.json)));
    return row;
  });
  const excludedChunkIds = (db.prepare("SELECT chunk_id FROM retrieval_exclusions WHERE project_id=? ORDER BY chunk_id").all(projectId) as Array<{ chunk_id: number }>).map(({ chunk_id }) => chunk_id);
  return ProjectContextSchema.parse({ workspaceId, profiles, styles, settings, knowledge, excludedChunkIds });
}

/** Only the allowlisted columns are accepted, even if an untrusted snapshot supplies arbitrary SQL-like keys. */
export function importProjectContext(db: Database.Database, input: ProjectContext, project: Record<string, unknown>): void {
  const context = ProjectContextSchema.parse(input);
  if (context.workspaceId !== (project.workspace_id ?? context.workspaceId)) throw new AppError(400, "SNAPSHOT_CONTEXT_SCOPE", "Workspace của context không khớp dự án.");
  if ((project.profile_id ?? null) !== (context.profiles[0]?.id ?? null)) throw new AppError(400, "SNAPSHOT_CONTEXT_SCOPE", "Hồ sơ của context không khớp dự án.");
  const insert = (table: string, row: Record<string, unknown>) => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((key) => row[key]));
  };
  // An isolated runner needs the workspace identity for existing context readers. No
  // organization metadata, users, memberships or authentication data leave control.
  if (context.workspaceId) insert("organization", { id: context.workspaceId, name: "Project runner", slug: "project-runner", created_at: 0 });
  for (const raw of context.profiles) {
    const row = normalizeProfile(raw);
    if ((row.workspace_id ?? defaultWorkspaceId(db)) !== context.workspaceId) throw new AppError(400, "SNAPSHOT_CONTEXT_SCOPE", "Hồ sơ thuộc workspace khác.");
    insert("profiles", row);
  }
  for (const row of context.styles) {
    if (row.workspace_id !== context.workspaceId || row.id !== context.profiles[0]?.style_pack_id) throw new AppError(400, "SNAPSHOT_CONTEXT_SCOPE", "Style thuộc hồ sơ khác.");
    insert("style_packs", { ...row, tokens: JSON.stringify(StyleTokensPatchSchema.parse(JSON.parse(row.tokens))) });
  }
  for (const row of context.settings) insert("app_settings", normalizeSetting(row));
  for (const row of context.knowledge) {
    if (row.workspace_id !== context.workspaceId) throw new AppError(400, "SNAPSHOT_CONTEXT_SCOPE", "Tri thức thuộc workspace khác.");
    const json = row.json && JSON.stringify(KnowledgeEntrySchema.parse(JSON.parse(row.json)));
    if (json && JSON.parse(json).id !== row.key) throw new AppError(400, "SNAPSHOT_CONTEXT_SCOPE", "Khoá tri thức không khớp nội dung.");
    insert("knowledge_entries", { ...row, json });
    insert("knowledge_revisions", { id: `snapshot:${row.id}:${row.revision}`, entry_id: row.id, revision: row.revision, before: null, after: json, patch: "[]", origin: "snapshot", actor: "system", reason: "Read-only project context", created_at: row.updated_at });
  }
  // Exclusions retain their FK identities without shipping the excluded channel text.
  // Retrieval itself stays on control through the context RPC.
  for (const id of context.excludedChunkIds) insert("retrieval_chunks", {
    id, profile_id: null, project_id: null, kind: "memory", source_id: `snapshot-excluded:${id}`,
    source_version: "snapshot", content_hash: `snapshot-excluded:${id}`, title: "", text: "", meta: "{}",
    created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z",
  });
}
