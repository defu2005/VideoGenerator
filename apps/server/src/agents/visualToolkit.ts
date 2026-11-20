import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { z } from "zod";
import {
  VisualCandidateSchema, VisionCheckSchema, hashesMatch, normalizeWikimediaLicense, resolveBudget, visualFeaturesFor,
  normalizePexelsLicense, normalizePixabayLicense, normalizeUnsplashLicense,
  type Job, type LicenseMetadata, type VisualCandidate,
} from "@vg/shared";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { can } from "../auth/policy.js";
import { currentActor } from "../auth/requestContext.js";
import type { TrustedAgent } from "../supervision/identity.js";
import type { VisualService } from "../services/visualService.js";
import { hashImage } from "../services/imageHash.js";
import { ImageStore, MAX_IMAGE_BYTES, parseImage, readBoundedBody } from "../services/imageStore.js";
import { visualCopyrightMode, visualQuality } from "../services/visualPolicy.js";
import { resolveAssetPath } from "../storage/paths.js";
import { StyleService } from "../style/service.js";
import { KnowledgeService } from "../knowledge/service.js";
import { readContinuity } from "../continuity/store.js";
import { fetchResponseSafely, validatePublicHttpUrl, unknownWebLicense, type SafeFetchDependencies } from "../providers/images/webCrawl.js";
import type { AgentStageService } from "./stageService.js";
import { imageVerdictContext, readImageVerdict, visualSubjectKey, visualWorkspace, writeImageVerdict, writeVisualQuery } from "./visualCache.js";
import { queryHints, recordQueryOutcome } from "../learning/queryPatterns.js";

export const AgentVisualItemSchema = z.object({
  imageUrl: z.string().url().max(4000), sourcePageUrl: z.string().url().max(4000),
  title: z.string().trim().min(1).max(500), why: z.string().trim().min(1).max(2000),
  licenseNote: z.string().trim().max(1000).optional(),
  searchQuery: z.string().trim().min(1).max(300).optional(),
}).strict();
export const AgentVisualVerdictSchema = z.object({
  verdict: z.enum(["pass", "reject"]), subjectMatch: z.boolean(),
  reason: z.string().trim().min(1).max(2000), model: z.string().trim().min(1).max(200),
}).strict();
type Hashes = { phash: string; phashCenter: string };
type Deps = { fetch?: SafeFetchDependencies; hash?: (path: string) => Promise<Hashes | null>; resize?: (path: string, maxSide: number) => Promise<Buffer> };

/** TASK-128a: external decisions, ordinary stored candidates; no app model/key is used here. */
export class AgentVisualToolkit {
  private readonly imageStore: ImageStore;
  constructor(private readonly repo: JobRepository, private readonly stages: AgentStageService,
    private readonly visuals: VisualService, private readonly config: AppConfig, private readonly deps: Deps = {}) {
    this.imageStore = new ImageStore(config.DATA_DIR, config.IMAGE_SEARCH_USER_AGENT);
  }
  private stage(job: Job) {
    if (job.stage !== "VISUAL_SEARCH") throw new AppError(422, "STAGE_TOOL_MISMATCH", "Bộ công cụ này chỉ nhận việc tìm ảnh.");
  }
  private open(job: Job, sceneId: string) {
    this.stage(job);
    const scene = this.visuals.agentOpenScenes(job.projectId).find((item) => item.sceneId === sceneId);
    if (!scene) throw new AppError(409, "VISUAL_SCENE_CLOSED", "Cảnh không thuộc phần việc còn mở của job này.");
    return scene;
  }
  private candidate(job: Job, candidateId: string) {
    this.stage(job);
    const candidate = this.visuals.agentCandidate(candidateId);
    if (!candidate || candidate.projectId !== job.projectId || candidate.discardedAt) throw new AppError(404, "VISUAL_CANDIDATE_NOT_FOUND", "Không thấy ảnh trong phần việc này.");
    this.open(job, candidate.sceneId);
    return candidate;
  }
  private bytes(candidate: VisualCandidate) {
    if (!candidate.localPath || !candidate.sha256) throw new AppError(422, "VISUAL_FILE_REQUIRED", "Ảnh chưa có tệp lưu trong app.");
    const path = resolveAssetPath(this.config.DATA_DIR, candidate.projectId, candidate.localPath);
    const bytes = readFileSync(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== candidate.sha256) throw new AppError(409, "VISUAL_HASH_CHANGED", "Tệp ảnh khác với hash đã lưu.");
    return { path, bytes, sha256 };
  }
  context(job: Job) {
    this.stage(job);
    const project = this.repo.getProject(job.projectId)!;
    const linked = project.profileId ? new StyleService(this.repo.sqlite).linkedPack(project.profileId) : null;
    // TASK-148d: queries that the agent's own pass verdicts marked accepted for this topic in this workspace (not the owner's choices). Exact normalised topic match only; the key is omitted when empty.
    const hints = queryHints(this.repo.sqlite, visualWorkspace(this.repo.sqlite, job.projectId), project.topic, project.profileId ?? "");
    return {
      ...(hints.length ? { queryHints: hints } : {}),
      projectId: job.projectId, stage: job.stage, aspectRatio: project.settings.aspectRatio,
      limits: { maxBytes: MAX_IMAGE_BYTES, minShortSide: 320, previewMaxSide: 768, maxItems: 12 },
      copyrightMode: visualCopyrightMode(this.repo.sqlite, project.profileId),
      stylePack: linked?.found ? { pack: linked.pack, tokens: linked.tokens } : null,
      styleNotes: { style: project.settings.visualStyle, tone: project.settings.tone },
      continuity: readContinuity(this.repo.sqlite, job.projectId) ?? null,
      sourceNotes: new KnowledgeService(this.repo.sqlite).list({ kind: "source_note" }).slice(0, 20)
        .map(({ entry }) => ({ id: entry.id, value: entry.value })),
      budgetHint: { mode: project.settings.budget?.mode ?? "BALANCED", usage: "Dùng model và công cụ riêng; báo usage khi hoàn tất." },
      openScenes: this.visuals.agentOpenScenes(job.projectId).map((scene) => {
        const detail = this.visuals.getSceneVisuals(job.projectId, scene.sceneId, true);
        const checkpoint = this.repo.sqlite.prepare("SELECT queries FROM visual_search_checkpoints WHERE project_id=? AND scene_id=?").get(job.projectId, scene.sceneId) as { queries: string } | undefined;
        let initialQueries: string[] = [];
        try { const parsed: unknown = JSON.parse(checkpoint?.queries ?? "[]"); if (Array.isArray(parsed)) initialQueries = parsed.filter((value): value is string => typeof value === "string"); } catch { /* Older damaged checkpoints do not hide the current scene. */ }
        return { sceneId: scene.sceneId, order: scene.order, narration: scene.narration,
          subject: scene.visualDescription || scene.visualQueries.primary,
          subjectKey: visualSubjectKey(scene.visualDescription || scene.visualQueries.primary), queries: scene.visualQueries,
          reason: scene.attentionReason ?? (scene.selectedCandidate ? "Ảnh đã chọn chưa qua cổng chất lượng" : "Chưa có ảnh"),
          queriesUsed: [...new Set([...initialQueries, ...detail.candidates.map((candidate) => candidate.query), ...(detail.visionMeta?.reSearchHistory ?? []).flatMap((round) => round.queries)].filter(Boolean))],
          consistencyFlags: detail.visionMeta?.consistencyFlags ?? [],
          rejectedCandidates: detail.candidates.filter((candidate) => candidate.visionCheck?.verdict === "reject" || (candidate.visionCheck?.fit ?? 10) < 7 || candidate.discardedAt)
            .map((candidate) => ({ candidateId: candidate.id, sourcePageUrl: candidate.sourcePageUrl, reason: candidate.visionCheck?.depicts ?? candidate.downloadError ?? "Đã loại", issues: candidate.visionCheck?.issues ?? [] })) };
      }),
    };
  }
  validateComplete(job: Job) {
    this.stage(job);
    return this.visuals.agentPostCheck(job.projectId);
  }
  private async downloadImage(url: string) {
    const { response } = await fetchResponseSafely(url, { ...this.deps.fetch, method: "GET" });
    if (!/^image\/(jpeg|png|webp|gif)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      throw new AppError(422, "VISUAL_IMAGE_TYPE", "Nguồn phải trả về ảnh JPEG, PNG, WebP hoặc GIF.");
    }
    if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      throw new AppError(422, "VISUAL_IMAGE_SIZE", "Ảnh vượt giới hạn 25 MB.");
    }
    return readBoundedBody(response, MAX_IMAGE_BYTES);
  }
  async submit(agent: TrustedAgent, jobId: string, leaseId: string, sceneId: string, rawItems: unknown) {
    const items = z.array(AgentVisualItemSchema).min(1).max(12).parse(rawItems);
    const job = this.stages.withLease(agent, jobId, leaseId, (job) => { this.open(job, sceneId); return job; });
    const results: Array<{ candidateId: string | null; duplicateOf?: string }> = [];
    for (const item of items) {
      this.stages.withLease(agent, jobId, leaseId, (job) => this.open(job, sceneId));
      const source = await validatePublicHttpUrl(item.sourcePageUrl, this.deps.fetch?.resolveHost);
      const bytes = await this.downloadImage(item.imageUrl);
      // Both storage and hash happen after the download, with a fresh fence before publishing a row.
      this.stages.withLease(agent, jobId, leaseId, (job) => this.open(job, sceneId));
      const stored = this.imageStore.storeBuffer(job.projectId, bytes);
      const hashed = await (this.deps.hash ?? hashImage)(resolveAssetPath(this.config.DATA_DIR, job.projectId, stored.localPath));
      if (!hashed) throw new AppError(422, "VISUAL_HASH_UNAVAILABLE", "Không tính được hash cảm quan; chưa nhận ảnh.");
      results.push(this.stages.withLease(agent, jobId, leaseId, (fresh) => {
        const scene = this.open(fresh, sceneId);
        // Candidate rows belong to a scene (as in the app search). Do not let an
        // unselected hit for another subject prevent the agent assigning it here.
        // Selected images remain globally distinct, and ImageStore dedupes file bytes.
        const rows = this.repo.sqlite.prepare(`SELECT id,sha256,phash,phash_center FROM visual_candidates
          WHERE project_id=? AND (scene_id=? OR id IN (SELECT candidate_id FROM visual_selections WHERE project_id=?))`)
          .all(job.projectId, sceneId, job.projectId) as Array<{ id: string; sha256: string | null; phash?: string; phash_center?: string }>;
        const duplicate = rows.find((row) => row.sha256 === stored.sha256 || hashesMatch(row.phash, hashed.phash, 6) || hashesMatch(row.phash_center, hashed.phashCenter, 6));
        if (duplicate) return { candidateId: null, duplicateOf: duplicate.id };
        const { license, verified } = agentLicense(source.hostname, item.licenseNote);
        const candidate = VisualCandidateSchema.parse({
          id: randomUUID(), projectId: job.projectId, sceneId, origin: "agent", provider: `agent:${agent.instance}`,
          providerItemId: stored.sha256, query: item.searchQuery ?? scene.visualQueries.primary, title: item.title,
          description: "", tags: [], previewUrl: item.imageUrl, imageUrl: item.imageUrl,
          sourceUrl: source.toString(), sourcePageUrl: source.toString(), sourceSite: source.hostname,
          width: stored.width, height: stored.height, aspectRatio: stored.width / stored.height, fileType: stored.fileType,
          watermark: "UNKNOWN", relevanceScore: 0, scoreBreakdown: {}, license, licenseVerified: verified,
          why: item.why, rank: 0, discardedAt: null, createdAt: stored.downloadedAt,
        });
        const saved = this.visuals.agentStoreCandidate(candidate, stored, hashed);
        writeVisualQuery(this.repo.sqlite, visualWorkspace(this.repo.sqlite, job.projectId), source.hostname, candidate.query, [candidate]);
        return { candidateId: saved.id };
      }));
    }
    return { items: results, candidateIds: results.flatMap((item) => item.candidateId ? [item.candidateId] : []) };
  }
  recordVerdict(agent: TrustedAgent, jobId: string, leaseId: string, candidateId: string, raw: unknown) {
    const input = AgentVisualVerdictSchema.parse(raw);
    if (input.verdict === "pass" && !input.subjectMatch) throw new AppError(422, "VISUAL_SUBJECT_MISMATCH", "Không được duyệt ảnh sai chủ thể.");
    return this.stages.withLease(agent, jobId, leaseId, (job) => {
      const candidate = this.candidate(job, candidateId), { sha256 } = this.bytes(candidate);
      const scene = this.open(job, candidate.sceneId);
      const check = VisionCheckSchema.parse({
        fit: input.verdict === "pass" ? 9 : 0, depicts: input.reason,
        issues: input.verdict === "pass" ? [] : [input.subjectMatch ? "low_quality" : "wrong_subject"],
        cropOk: input.verdict === "pass", checkedAt: new Date().toISOString(), model: input.model,
        checkedBy: { kind: "agent", instance: agent.instance, model: input.model }, sha256,
        verdict: input.verdict, subjectMatch: input.subjectMatch,
      });
      const saved = this.visuals.agentRecordVerdict(candidateId, check);
      if (candidate.phash) {
        const project = this.repo.getProject(job.projectId)!;
        const notes = this.repo.sqlite.prepare("SELECT visual_notes FROM scenes WHERE id=? AND project_id=?").get(candidate.sceneId, job.projectId) as { visual_notes: string };
        const features = visualFeaturesFor(resolveBudget(project), project.settings.visuals?.quality ?? visualQuality(this.repo.sqlite, project.profileId));
        const context = imageVerdictContext({ narration: scene.narration, visualDescription: scene.visualDescription || notes.visual_notes,
          aspectRatio: project.settings.aspectRatio, visionThreshold: features.visionThreshold });
        writeImageVerdict(this.repo.sqlite, visualWorkspace(this.repo.sqlite, job.projectId), candidate.phash,
          scene.visualDescription || scene.visualQueries.primary, check, new Date(), context);
        // TASK-148d: learn which query shapes this topic accepts (code only).
        recordQueryOutcome(this.repo.sqlite, { workspaceId: visualWorkspace(this.repo.sqlite, job.projectId), channel: project.profileId ?? "", topic: project.topic, query: candidate.query, accepted: input.verdict === "pass" });
      }
      return saved;
    });
  }
  async select(agent: TrustedAgent, jobId: string, leaseId: string, sceneId: string, candidateId: string) {
    const job = this.stages.withLease(agent, jobId, leaseId, (job) => { const candidate = this.candidate(job, candidateId); if (candidate.sceneId !== sceneId) throw new AppError(404, "VISUAL_CANDIDATE_NOT_FOUND", "Ảnh không thuộc cảnh này."); return job; });
    return this.visuals.agentSelectCandidate(job.projectId, sceneId, candidateId, () => this.stages.withLease(agent, jobId, leaseId, () => {}));
  }
  private readableCandidate(candidateId: string) {
    const candidate = this.visuals.agentCandidate(candidateId);
    const row = candidate ? this.repo.sqlite.prepare("SELECT workspace_id,profile_id FROM projects WHERE id=?").get(candidate.projectId) as { workspace_id: string | null; profile_id: string | null } | undefined : undefined;
    const actor = currentActor();
    if (!candidate || !row || !actor || (row.workspace_id === null && !actor.ownsUnassigned) || !can(actor, "project.read", { workspaceId: row.workspace_id, profileId: row.profile_id }).ok) throw new AppError(404, "VISUAL_CANDIDATE_NOT_FOUND", "Không thấy ảnh trong phạm vi được phép.");
    return candidate;
  }
  async lookupVerdict(input: { subjectKey: string; phash?: string; candidateId?: string; imageUrl?: string }) {
    let phash = input.phash;
    if (input.candidateId) {
      const candidate = this.readableCandidate(input.candidateId);
      const { path } = this.bytes(candidate);
      phash = candidate.phash ?? (await (this.deps.hash ?? hashImage)(path))?.phash;
    } else if (input.imageUrl) {
      const bytes = await this.downloadImage(input.imageUrl);
      parseImage(bytes);
      phash = (await hashImage(bytes))?.phash;
    }
    return phash ? readImageVerdict(this.repo.sqlite, currentActor()?.workspaceId ?? null, phash, input.subjectKey) : null;
  }
  async image(candidateId: string, maxSide = 768) {
    z.number().int().min(64).max(2048).parse(maxSide);
    const candidate = this.readableCandidate(candidateId);
    const { path, sha256 } = this.bytes(candidate);
    const data = await (this.deps.resize ?? resizeStoredImage)(path, maxSide);
    this.bytes(candidate); // A changed source file cannot silently produce a preview of different content.
    return { content: [{ type: "image" as const, mimeType: "image/png", data: data.toString("base64") }], sha256 };
  }
}

/** Only the existing stock-provider sites can turn an agent licence note into verified metadata. */
export function agentLicense(host: string, note = ""): { license: LicenseMetadata; verified: boolean } {
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  let license: LicenseMetadata | null = null;
  if (on("pexels.com") && /pexels\s+licen[cs]e/i.test(note)) license = normalizePexelsLicense("");
  else if (on("pixabay.com") && /pixabay.*licen[cs]e/i.test(note)) license = normalizePixabayLicense("");
  else if (on("unsplash.com") && /unsplash\s+licen[cs]e/i.test(note)) license = normalizeUnsplashLicense("");
  else if (["wikimedia.org", "flickr.com", "openverse.org", "nasa.gov", "metmuseum.org", "loc.gov", "si.edu", "europeana.eu"].some(on)) {
    const normalized = normalizeWikimediaLicense({ LicenseShortName: note });
    if (normalized.kind !== "UNKNOWN" && normalized.kind !== "ALL_RIGHTS_RESERVED") license = normalized;
  }
  if (license) return { license: { ...license, evidence: "user", attributionText: `${license.attributionText} ${note}`.trim() }, verified: true };
  // Explicit known copyright can be considered only under the user's commentary mode and all existing gates.
  const unknown = unknownWebLicense();
  return { license: /all rights reserved/i.test(note) ? { ...unknown, kind: "ALL_RIGHTS_RESERVED", name: note, evidence: "user" } : { ...unknown, name: note || unknown.name }, verified: false };
}

const execFileAsync = promisify(execFile);
async function resizeStoredImage(path: string, maxSide: number) {
  if (!ffmpegPath) throw new AppError(503, "VISUAL_PREVIEW_UNAVAILABLE", "Thiếu FFmpeg để xem ảnh.");
  const { stdout } = await execFileAsync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", path,
    "-vf", `scale=w='min(${maxSide},iw)':h='min(${maxSide},ih)':force_original_aspect_ratio=decrease`, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
  { timeout: 15_000, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
  return stdout as unknown as Buffer;
}
