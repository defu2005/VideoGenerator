import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { redactExportText, VisionCheckSchema, type VisionCheck } from "@vg/shared";
import { z } from "zod";
import { defaultWorkspaceId } from "../auth/workspaces.js";
import { hashImage } from "../services/imageHash.js";
import { buildVisionCheckPrompt } from "../stages/visuals/visionPrompts.js";

const day = 86_400_000;
const phashPattern = /^[0-9a-f]{16}$/i;

export function visualWorkspace(db: Database.Database, projectId: string) {
  const row = db.prepare("SELECT workspace_id FROM projects WHERE id=?").get(projectId) as { workspace_id: string | null } | undefined;
  return row ? row.workspace_id ?? defaultWorkspaceId(db) : null;
}

const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export function visualSubjectKey(subject: string) {
  return normalize(subject).split("|").map((part) => part.trim()).filter(Boolean).join("|");
}

/** One contract shared by app and scouts. Prompt edits invalidate fit/crop judgements automatically. */
export const VISUAL_VERDICT_POLICY_VERSION = "vision-fit-v2";
export function imageVerdictContext(input: {
  narration: string; visualDescription: string; aspectRatio: string; visionThreshold: number;
  policyVersion?: string;
  /** TASK-146: beat fields, passed only where a verdict is read or written (never into the search hash). */
  visualIntent?: string; beatPurpose?: string;
}) {
  const prompt = buildVisionCheckPrompt({
    narration: input.narration.normalize("NFKC").trim().replace(/\s+/g, " "),
    visualDescription: normalize(input.visualDescription), aspectRatio: input.aspectRatio, images: [],
    ...(input.visualIntent ? { visualIntent: normalize(input.visualIntent) } : {}),
    ...(input.beatPurpose ? { beatPurpose: input.beatPurpose } : {}),
  });
  return createHash("sha256").update(JSON.stringify({ policy: input.policyVersion ?? VISUAL_VERDICT_POLICY_VERSION,
    visionThreshold: input.visionThreshold, schemaVersion: "2", ...prompt })).digest("hex");
}

const verdictKey = (subject: string, context?: string) => `v2:${JSON.stringify([visualSubjectKey(subject), context ?? null])}`;

export async function visualFingerprint(path: string) {
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) return null;
  const hashes = await hashImage(bytes);
  if (!hashes) return null;
  return { phash: hashes.phash, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function reusableImageCheck(db: Database.Database, workspace: string | null, fingerprint: { phash: string; sha256: string }, subject: string, context?: string) {
  // Generic/legacy verdicts are advice about a subject, never approval for a new scene's fit or crop.
  if (!context || !/^[a-f0-9]{64}$/.test(context)) return null;
  const cached = readImageVerdict(db, workspace, fingerprint.phash, subject, new Date(), context);
  // A perceptual match may have an added watermark. A pass needs identical bytes.
  if (!cached || (cached.verdict === "pass" && cached.visionCheck.sha256 !== fingerprint.sha256)) return null;
  return cached.visionCheck;
}

export function readImageVerdict(db: Database.Database, workspace: string | null, phash: string, subject: string, now = new Date(), context?: string) {
  const subjectKey = visualSubjectKey(subject);
  if (!workspace || !phashPattern.test(phash) || !subjectKey) return null;
  const keys = context ? [verdictKey(subject, context)] : [verdictKey(subject), subjectKey];
  for (const key of keys) {
    const row = db.prepare(`SELECT verdict,reason,model,checked_by AS checkedBy,created_at AS createdAt,vision_check AS visionCheck
    FROM image_verdicts WHERE workspace_id=? AND phash=? AND subject_key=? AND created_at>?`)
    .get(workspace, phash.toLowerCase(), key, new Date(now.getTime() - 90 * day).toISOString()) as
    { verdict: string; reason: string; model: string; checkedBy: string; createdAt: string; visionCheck: string } | undefined;
    if (!row) continue;
    try {
      const parsed = VisionCheckSchema.safeParse(JSON.parse(row.visionCheck));
      if (parsed.success) return { ...row, visionCheck: parsed.data };
    } catch { /* Damaged legacy rows are cache misses, not permission to reuse another context. */ }
  }
  return null;
}

export function writeImageVerdict(db: Database.Database, workspace: string | null, phash: string, subject: string, check: VisionCheck, now = new Date(), context?: string) {
  const subjectKey = visualSubjectKey(subject);
  if (!workspace || !phashPattern.test(phash) || !subjectKey || subjectKey.length > 1000 || redactExportText(subjectKey) !== subjectKey || /https?:\/\//i.test(subjectKey)) return;
  const safeCheck: VisionCheck = {
    ...check,
    depicts: redactExportText(check.depicts).replace(/https?:\/\/\S+/gi, "[URL]"),
    model: redactExportText(check.model).replace(/https?:\/\/\S+/gi, "[URL]"),
  };
  if (check.checkedBy) safeCheck.checkedBy = { ...check.checkedBy, model: safeCheck.model, instance: redactExportText(check.checkedBy.instance) };
  const verdict = safeCheck.verdict ?? (safeCheck.fit >= 7 && !safeCheck.issues.includes("wrong_subject") ? "pass" : "reject");
  const insert = db.prepare(`INSERT INTO image_verdicts (workspace_id,phash,subject_key,verdict,reason,checked_by,model,vision_check,created_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,phash,subject_key) DO UPDATE SET verdict=excluded.verdict,
      reason=excluded.reason,checked_by=excluded.checked_by,model=excluded.model,vision_check=excluded.vision_check,created_at=excluded.created_at`);
  const keys = [verdictKey(subject)];
  if (context && /^[a-f0-9]{64}$/.test(context)) keys.push(verdictKey(subject, context));
  db.transaction(() => {
    for (const key of keys) insert.run(workspace, phash.toLowerCase(), key, verdict, safeCheck.depicts, safeCheck.checkedBy?.instance ?? "app", safeCheck.model, JSON.stringify(safeCheck), now.toISOString());
  })();
}

const publicCacheUrl = z.string().max(4000).refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      && !/(?:signed|token|secret|password|api[_-]?key|signature|auth)[=/]/i.test(decodeURIComponent(url.pathname))
      && redactExportText(value) === value;
  } catch { return false; }
});
const SearchHitSchema = z.object({
  imageUrl: publicCacheUrl,
  sourcePageUrl: publicCacheUrl,
  title: z.string().max(500),
  sourceSite: z.string().max(253).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
type SearchHit = z.infer<typeof SearchHitSchema>;
const validSource = /^[a-z0-9][a-z0-9_.:\/-]{0,100}$/i;

export function readVisualQueries(db: Database.Database, workspace: string | null, query: string, source?: string, now = new Date()) {
  if (!workspace) return [];
  const rows = db.prepare(`SELECT source,results,created_at AS createdAt FROM search_query_cache
    WHERE workspace_id=? AND normalized_query=? AND created_at>? AND (? IS NULL OR source=?) ORDER BY created_at DESC, source LIMIT 20`)
    .all(workspace, normalize(query), new Date(now.getTime() - 7 * day).toISOString(), source ?? null, source ?? null) as Array<{ source: string; results: string; createdAt: string }>;
  return rows.flatMap((row) => {
    const parsed = SearchHitSchema.array().safeParse(JSON.parse(row.results));
    return parsed.success ? [{ ...row, results: parsed.data }] : [];
  });
}

export function writeVisualQuery(db: Database.Database, workspace: string | null, source: string, query: string, hits: readonly unknown[], now = new Date()) {
  const normalizedQuery = normalize(query);
  if (!workspace || !validSource.test(source) || !normalizedQuery || normalizedQuery.length > 1000 || redactExportText(query) !== query || /https?:\/\//i.test(query)) return;
  const results = hits.slice(0, 50).flatMap((hit) => {
    const result = SearchHitSchema.safeParse(hit);
    return result.success ? [{ ...result.data, title: redactExportText(result.data.title).replace(/https?:\/\/\S+/gi, "[URL]"),
      ...(result.data.sourceSite ? { sourceSite: new URL(result.data.sourcePageUrl).hostname } : {}) }] : [];
  });
  if (!results.length) return;
  const seen = new Map<string, SearchHit>();
  for (const result of [...results, ...(readVisualQueries(db, workspace, query, source, now)[0]?.results ?? [])]) {
    if (!seen.has(result.imageUrl)) seen.set(result.imageUrl, result);
  }
  db.prepare(`INSERT INTO search_query_cache (workspace_id,source,normalized_query,results,created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(workspace_id,source,normalized_query) DO UPDATE SET results=excluded.results,created_at=excluded.created_at`)
    .run(workspace, source, normalizedQuery, JSON.stringify([...seen.values()].slice(0, 50)), now.toISOString());
}
