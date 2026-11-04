import { createHash, randomUUID } from "node:crypto";
import {
  deriveSceneVisualStatus,
  ProjectVisualsSchema,
  ScriptSchema,
  SceneVisualsSchema,
  StoredVisualQueriesSchema,
  VisualCandidateSchema,
  VisualSelectionSchema,
  assignDistinct,
  dedupeCandidates,
  rankCandidates,
  type Project,
  type Scene,
  type VisualCandidate,
  type VisualSelection,
  type ScoreBreakdown,
  resolveBudget,
  type LlmCallUsage,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { ImageDownloadError, ImageStore, isVisualFileName, parseImage, type StoredImage } from "./imageStore.js";
import { projectDir } from "../storage/paths.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ImageProviderError } from "../providers/images/http.js";
import { TokenBucketRateLimiter } from "../providers/images/rateLimiter.js";
import type {
  ImageOrientation,
  ImageSearchProvider,
  NormalizedImageResult,
} from "../providers/images/types.js";
import { ImageProviderRegistry } from "../providers/images/registry.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import { StageError, type StageContext, type StageResult } from "../pipeline/stageExecutor.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { LlmCache } from "../providers/llm/cache.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { buildAltQueryPrompt, AltQueryResponseSchema } from "../stages/visuals/altQueryPrompt.js";
import { buildRerankPrompt, RerankResponseSchema } from "../stages/visuals/rerankPrompt.js";

type SceneRow = {
  id: string;
  project_id: string;
  order: number;
  narration: string;
  visual_notes: string;
  visual_description: string;
  no_visual: number;
  visual_queries: string;
};

type CacheRow = { response: string; created_at: string };

type SearchStats = {
  requests: number;
  requestsByProvider: Record<string, number>;
  cacheHits: number;
  failures: number;
  unavailableFailures: number;
};

type SceneSearchData = {
  scene: Scene;
  queries: string[];
  candidates: NormalizedImageResult[];
  searchHash: string;
  unchanged: boolean;
  protectedSelection: boolean;
};

const protectedSelectionStatuses = new Set(["APPROVED", "CUSTOM", "REPLACED"]);

export class VisualService {
  private readonly limiter: TokenBucketRateLimiter;
  private readonly registry: ImageProviderRegistry;
  private readonly imageStore: ImageStore;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly repository: JobRepository,
    private readonly config: AppConfig,
    private readonly logger?: FastifyBaseLogger,
    dependencies: {
      providers?: ImageSearchProvider[];
      limiter?: TokenBucketRateLimiter;
      imageStore?: ImageStore;
    } = {},
  ) {
    this.registry = new ImageProviderRegistry(config, dependencies.providers);
    this.limiter = dependencies.limiter ?? new TokenBucketRateLimiter({
      wikimedia: config.IMAGE_SEARCH_PER_MINUTE_WIKIMEDIA,
      openverse: config.IMAGE_SEARCH_PER_MINUTE_OPENVERSE,
      pexels: config.IMAGE_SEARCH_PER_MINUTE_PEXELS,
    });
    this.imageStore = dependencies.imageStore ?? new ImageStore(config.DATA_DIR, config.IMAGE_SEARCH_USER_AGENT, { minIntervalMs: config.IMAGE_DOWNLOAD_MIN_INTERVAL_MS });
  }

  getProjectVisuals(projectId: string) {
    this.requireProject(projectId);
    const searchState = this.repository.getStage(projectId, "VISUAL_SEARCH").state;
    const scenes = this.loadScenes(projectId).map((scene) => {
      const selection = this.getSelection(projectId, scene.id);
      const selectedCandidate = selection ? this.findCandidate(selection.candidateId) : null;
      const candidateCount = this.sqlite.prepare(
        "SELECT COUNT(*) AS count FROM visual_candidates WHERE project_id = ? AND scene_id = ? AND discarded_at IS NULL",
      ).get(projectId, scene.id) as { count: number };
      const candidates = selectedCandidate ? [selectedCandidate] : [];
      const status = deriveSceneVisualStatus(selection, candidates, scene.noVisual, searchState);
      return {
        sceneId: scene.id,
        order: scene.order,
        selection,
        selectedCandidate,
        candidateCount: candidateCount.count,
        needsUser: status === "NO_VISUAL" || status === "REVIEW_REQUIRED",
        lowRelevance: selectedCandidate?.scoreBreakdown.lowRelevance === true,
        status,
        noVisual: scene.noVisual,
        visualDescription: scene.visualDescription,
        visualQueries: scene.visualQueries,
        narration: scene.narration,
        startSec: scene.startSec,
        durationSec: scene.durationOverrideSec ?? scene.estDurationSec,
      };
    });
    const licenseCounts: Record<string, number> = {};
    for (const scene of scenes) {
      const kind = scene.selectedCandidate?.license.kind;
      if (kind) licenseCounts[kind] = (licenseCounts[kind] ?? 0) + 1;
    }
    return ProjectVisualsSchema.parse({
      scenes,
      summary: {
        withImage: scenes.filter((scene) => scene.selectedCandidate !== null).length,
        needsUser: scenes.filter((scene) => scene.needsUser).length,
        lowRelevance: scenes.filter((scene) => scene.lowRelevance).length,
        licenseCounts,
        statusCounts: Object.fromEntries(
          ["NO_VISUAL", "SEARCHING", "REVIEW_REQUIRED", "APPROVED", "READY_FOR_RENDER", "SKIPPED"]
            .map((status) => [status, scenes.filter((scene) => scene.status === status).length]),
        ),
      },
    });
  }

  getSceneVisuals(projectId: string, sceneId: string, includeDiscarded = false) {
    this.requireScene(projectId, sceneId);
    const selection = this.getSelection(projectId, sceneId);
    const rows = this.sqlite.prepare(
      `SELECT * FROM visual_candidates WHERE project_id = ? AND scene_id = ?${includeDiscarded ? "" : " AND discarded_at IS NULL"} ORDER BY rank, created_at`,
    ).all(projectId, sceneId) as Record<string, unknown>[];
    const candidates = rows.map((row) => this.candidateFromRow(row));
    return SceneVisualsSchema.parse({
      selection,
      candidates,
      status: deriveSceneVisualStatus(
        selection,
        candidates,
        Boolean((this.sqlite.prepare("SELECT no_visual FROM scenes WHERE id = ?").get(sceneId) as { no_visual: number }).no_visual),
        this.repository.getStage(projectId, "VISUAL_SEARCH").state,
      ),
      noVisual: Boolean((this.sqlite.prepare("SELECT no_visual FROM scenes WHERE id = ?").get(sceneId) as { no_visual: number }).no_visual),
    });
  }

  async searchScene(
    projectId: string,
    sceneId: string,
    query: string,
    providerIds?: string[],
    signal?: AbortSignal,
  ) {
    const project = this.requireProject(projectId);
    const scene = this.requireScene(projectId, sceneId);
    const providers = this.resolveProviders(providerIds);
    const stats = createSearchStats();
    const results = await this.searchAcrossProviders(query, providers, orientationFor(project.settings.aspectRatio), signal, stats);
    const current = this.getSceneVisuals(projectId, sceneId, true).candidates;
    const combined = dedupeCandidates([...current, ...results.map((result) => this.toCandidate(result, project, scene, query, ""))]);
    const ranked = this.rankVisuals(
      combined,
      query,
      scene.visualDescription || scene.visualNotes,
      project.settings.language,
      aspectNumber(project.settings.aspectRatio),
      providers.map((item) => item.id),
    )
      .slice(0, 24);
    this.repository.atomic(() => {
      for (const [rank, candidate] of ranked.entries()) this.saveCandidate({ ...candidate, rank });
      this.repository.emitVisualUpdated(projectId, sceneId, "searched");
    });
    return {
      ...this.getSceneVisuals(projectId, sceneId),
      usage: { providerRequests: stats.requests, cacheHits: stats.cacheHits },
    };
  }

  selectCandidate(projectId: string, sceneId: string, candidateId: string) {
    this.requireScene(projectId, sceneId);
    const candidate = this.findCandidate(candidateId);
    if (!candidate || candidate.projectId !== projectId || candidate.sceneId !== sceneId || candidate.discardedAt) {
      throw new AppError(404, "VISUAL_CANDIDATE_NOT_FOUND", "Visual candidate not found");
    }
    const now = new Date().toISOString();
    this.repository.atomic(() => {
      this.upsertSelection({
        id: randomUUID(),
        projectId,
        sceneId,
        slot: 0,
        candidateId,
        status: "REPLACED",
        selectedBy: "USER",
        motion: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      this.sqlite.prepare("UPDATE scenes SET no_visual = 0 WHERE id = ?").run(sceneId);
      this.markTimelineStale(projectId);
      this.repository.emitVisualUpdated(projectId, sceneId, "selected");
    });
    return this.getSceneVisuals(projectId, sceneId);
  }

  discardCandidate(projectId: string, sceneId: string, candidateId: string) {
    this.requireScene(projectId, sceneId);
    const candidate = this.findCandidate(candidateId);
    if (!candidate || candidate.projectId !== projectId || candidate.sceneId !== sceneId) {
      throw new AppError(404, "VISUAL_CANDIDATE_NOT_FOUND", "Visual candidate not found");
    }
    const now = new Date().toISOString();
    this.repository.atomic(() => {
      this.sqlite.prepare("UPDATE visual_candidates SET discarded_at = ? WHERE id = ?").run(now, candidateId);
      const selection = this.getSelection(projectId, sceneId);
      if (selection?.candidateId === candidateId) {
        const next = this.getSceneVisuals(projectId, sceneId).candidates
          .find((item) => item.id !== candidateId && item.discardedAt === null);
        if (next) {
          this.upsertSelection({
            ...selection,
            candidateId: next.id,
            status: "DISCOVERED",
            selectedBy: "AGENT",
            reviewedAt: null,
            updatedAt: now,
          });
        } else {
          this.sqlite.prepare("DELETE FROM visual_selections WHERE scene_id = ? AND slot = 0").run(sceneId);
        }
        this.sqlite.prepare("UPDATE scenes SET no_visual = 0 WHERE id = ?").run(sceneId);
        this.markTimelineStale(projectId);
      }
      this.repository.emitVisualUpdated(projectId, sceneId, "discarded");
    });
    return this.getSceneVisuals(projectId, sceneId, true);
  }

  rejectSceneVisual(projectId: string, sceneId: string) {
    this.requireScene(projectId, sceneId);
    const selection = this.getSelection(projectId, sceneId);
    if (!selection) throw new AppError(404, "VISUAL_SELECTION_NOT_FOUND", "This scene has no selected image.");
    const candidate = this.findCandidate(selection.candidateId);
    if (!candidate || candidate.projectId !== projectId || candidate.sceneId !== sceneId) {
      throw new AppError(404, "VISUAL_CANDIDATE_NOT_FOUND", "Selected visual candidate not found.");
    }
    const now = new Date().toISOString();
    this.repository.atomic(() => {
      this.sqlite.prepare("UPDATE visual_candidates SET discarded_at = ? WHERE id = ?").run(now, candidate.id);
      const next = this.findNextDistinctCandidate(projectId, sceneId, candidate.id);
      if (next) {
        this.upsertSelection({
          ...selection,
          candidateId: next.id,
          status: "REVIEW_REQUIRED",
          selectedBy: "AGENT",
          reviewedAt: null,
          updatedAt: now,
        });
      } else {
        this.sqlite.prepare("DELETE FROM visual_selections WHERE project_id = ? AND scene_id = ? AND slot = 0")
          .run(projectId, sceneId);
      }
      this.sqlite.prepare("UPDATE scenes SET no_visual = 0 WHERE project_id = ? AND id = ?").run(projectId, sceneId);
      this.markTimelineStale(projectId);
      this.repository.emitVisualUpdated(projectId, sceneId, next ? "rejected-replaced" : "rejected");
    });
    return this.getSceneVisuals(projectId, sceneId);
  }

  async approveScene(projectId: string, sceneId: string, signal?: AbortSignal) {
    this.requireScene(projectId, sceneId);
    const selection = this.getSelection(projectId, sceneId);
    if (!selection) throw new AppError(404, "VISUAL_SELECTION_NOT_FOUND", "This scene has no selected image.");
    const candidate = this.findCandidate(selection.candidateId);
    if (!candidate || candidate.projectId !== projectId || candidate.sceneId !== sceneId) {
      throw new AppError(404, "VISUAL_CANDIDATE_NOT_FOUND", "Selected visual candidate not found.");
    }
    return this.approveSelected(projectId, sceneId, selection, candidate, signal);
  }

  async approveAll(projectId: string, signal?: AbortSignal) {
    this.requireProject(projectId);
    const scenes = this.loadScenes(projectId);
    const eligible = scenes.flatMap((scene) => {
      const selection = this.getSelection(projectId, scene.id);
      if (!selection || !["DISCOVERED", "REVIEW_REQUIRED", "REPLACED"].includes(selection.status)) return [];
      return [{ sceneId: scene.id, selection }];
    });
    let approved = 0;
    const failed: { sceneId: string; reason: string; retryable: boolean }[] = [];
    for (const [index, item] of eligible.entries()) {
      if (signal?.aborted) throw signal.reason ?? new Error("Visual approval was aborted");
      try {
        await this.approveScene(projectId, item.sceneId, signal);
        approved += 1;
      } catch (error) {
        failed.push({
          sceneId: item.sceneId,
          reason: error instanceof Error ? error.message : String(error),
          retryable: isRetryableDownloadError(error),
        });
      }
      this.repository.emitVisualUpdated(projectId, item.sceneId, `approve-progress:${index + 1}/${eligible.length}`);
    }
    return { approved, failed };
  }

  async addCustomUrl(
    projectId: string,
    sceneId: string,
    input: { url: string; title?: string; author?: string; license?: string },
  ) {
    this.requireScene(projectId, sceneId);
    let stored: StoredImage;
    try {
      stored = await this.imageStore.download(projectId, input.url);
    } catch (error) {
      throw downloadError(error);
    }
    const license = makeLicense({
      kind: input.license ? "USER_PROVIDED" : "UNKNOWN",
      name: input.license ?? "",
      author: input.author ?? "",
      evidence: input.license || input.author ? "user" : "none",
    });
    return this.saveCustomSelection(projectId, sceneId, {
      origin: "CUSTOM_URL",
      url: input.url,
      title: input.title?.trim() || "User-provided image",
      license,
      stored,
    });
  }

  addUpload(projectId: string, sceneId: string, bytes: Buffer, fileName?: string, expectedMime?: string) {
    this.requireScene(projectId, sceneId);
    let stored: StoredImage;
    try {
      const parsed = parseImage(bytes);
      if (expectedMime && parsed.mimeType !== expectedMime.toLowerCase()) {
        throw new ImageDownloadError(`Uploaded bytes are ${parsed.mimeType}, not the declared ${expectedMime}.`);
      }
      stored = this.imageStore.storeBuffer(projectId, bytes);
    } catch (error) {
      throw downloadError(error);
    }
    return this.saveCustomSelection(projectId, sceneId, {
      origin: "UPLOAD",
      url: `https://upload.local.invalid/${stored.sha256}`,
      title: fileName?.trim().slice(0, 200) || "Uploaded image",
      license: makeLicense({ kind: "USER_PROVIDED", name: "User-provided", evidence: "user" }),
      stored,
    });
  }

  removeSceneVisual(projectId: string, sceneId: string) {
    this.requireScene(projectId, sceneId);
    this.repository.atomic(() => {
      this.sqlite.prepare("DELETE FROM visual_selections WHERE project_id = ? AND scene_id = ? AND slot = 0")
        .run(projectId, sceneId);
      this.sqlite.prepare("UPDATE scenes SET no_visual = 1 WHERE project_id = ? AND id = ?").run(projectId, sceneId);
      this.markTimelineStale(projectId);
      this.repository.emitVisualUpdated(projectId, sceneId, "removed");
    });
    return this.getSceneVisuals(projectId, sceneId);
  }

  patchSceneVisualQuery(
    projectId: string,
    sceneId: string,
    input: { visualQueries?: { primary: string; alternatives: string[] }; visualDescription?: string },
  ) {
    const scene = this.requireScene(projectId, sceneId);
    this.repository.atomic(() => {
      this.sqlite.prepare(
        "UPDATE scenes SET visual_queries = ?, visual_description = ?, edited = 1, updated_at = ? WHERE project_id = ? AND id = ?",
      ).run(
        JSON.stringify(input.visualQueries ?? scene.visualQueries),
        input.visualDescription ?? scene.visualDescription,
        new Date().toISOString(),
        projectId,
        sceneId,
      );
      this.repository.emitVisualUpdated(projectId, sceneId, "query-updated");
    });
    return this.getSceneVisuals(projectId, sceneId);
  }

  canApproveVisualReview(projectId: string): { allowed: true } | { allowed: false; message: string } {
    const visuals = this.getProjectVisuals(projectId);
    const needsAttention = visuals.scenes.filter((scene) => scene.status !== "READY_FOR_RENDER" && scene.status !== "SKIPPED").length;
    return needsAttention === 0
      ? { allowed: true }
      : { allowed: false, message: `${needsAttention} scene${needsAttention === 1 ? "" : "s"} need attention before visual review can be approved.` };
  }

  assertSceneExists(projectId: string, sceneId: string): void {
    this.requireScene(projectId, sceneId);
  }

  getVisualFilePath(projectId: string, fileName: string): { path: string; contentType: string } {
    this.requireProject(projectId);
    if (!isVisualFileName(fileName)) throw new AppError(404, "VISUAL_FILE_NOT_FOUND", "Visual file not found.");
    const filePath = join(projectDir(this.config.DATA_DIR, projectId), "visuals", fileName);
    if (!existsSync(filePath)) throw new AppError(404, "VISUAL_FILE_NOT_FOUND", "Visual file not found.");
    const extension = fileName.split(".").at(-1);
    return {
      path: filePath,
      contentType: extension === "jpg" ? "image/jpeg" : extension === "webp" ? "image/webp" : `image/${extension}`,
    };
  }

  private async approveSelected(
    projectId: string,
    sceneId: string,
    selection: VisualSelection,
    candidate: VisualCandidate,
    signal?: AbortSignal,
  ) {
    if (candidate.localPath && candidate.sha256 && candidate.actualWidth && candidate.actualHeight) {
      const now = new Date().toISOString();
      this.repository.atomic(() => {
        this.upsertSelection({ ...selection, status: "APPROVED", reviewedAt: now, updatedAt: now });
        this.markTimelineStale(projectId);
        this.repository.emitVisualUpdated(projectId, sceneId, "approved");
      });
      return this.getSceneVisuals(projectId, sceneId);
    }
    let stored: StoredImage;
    try {
      stored = await this.imageStore.download(projectId, downloadUrl(candidate), signal);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.sqlite.prepare("UPDATE visual_candidates SET download_error = ? WHERE id = ?").run(reason, candidate.id);
      this.repository.emitVisualUpdated(projectId, sceneId, "download-failed");
      throw new AppError(422, "IMAGE_DOWNLOAD_FAILED", reason, {
        retryable: error instanceof ImageDownloadError && error.retryable,
      });
    }
    const now = new Date().toISOString();
    this.repository.atomic(() => {
      this.updateCandidateDownload(candidate.id, stored);
      this.upsertSelection({
        ...selection,
        status: "APPROVED",
        reviewedAt: now,
        updatedAt: now,
      });
      this.markTimelineStale(projectId);
      this.repository.emitVisualUpdated(projectId, sceneId, "approved");
    });
    return this.getSceneVisuals(projectId, sceneId);
  }

  private saveCustomSelection(
    projectId: string,
    sceneId: string,
    input: { origin: "CUSTOM_URL" | "UPLOAD"; url: string; title: string; license: VisualCandidate["license"]; stored: StoredImage },
  ) {
    const scene = this.requireScene(projectId, sceneId);
    const now = input.stored.downloadedAt;
    const candidate = VisualCandidateSchema.parse({
      id: randomUUID(),
      projectId,
      sceneId,
      origin: input.origin,
      provider: "custom",
      providerItemId: `${input.origin.toLowerCase()}:${input.stored.sha256}`,
      query: scene.visualQueries.primary,
      title: input.title,
      description: "",
      tags: [],
      previewUrl: input.url,
      imageUrl: input.url,
      sourceUrl: input.url,
      sourceSite: input.origin === "UPLOAD" ? "User upload" : "User-provided URL",
      width: input.stored.width,
      height: input.stored.height,
      aspectRatio: input.stored.width / input.stored.height,
      fileType: input.stored.fileType,
      watermark: "UNKNOWN",
      relevanceScore: 1,
      scoreBreakdown: { keyword: 1, resolution: 1, aspect: 1, license: 1, watermark: 0, providerPosition: 1 },
      license: input.license,
      rank: 0,
      discardedAt: null,
      createdAt: now,
      localPath: input.stored.localPath,
      sha256: input.stored.sha256,
      bytes: input.stored.bytes,
      actualWidth: input.stored.width,
      actualHeight: input.stored.height,
      downloadedAt: now,
      downloadError: null,
    });
    this.repository.atomic(() => {
      this.saveCandidate(candidate);
      const saved = this.sqlite.prepare(
        "SELECT id FROM visual_candidates WHERE scene_id = ? AND provider = 'custom' AND provider_item_id = ?",
      ).get(sceneId, candidate.providerItemId) as { id: string };
      this.upsertSelection({
        id: randomUUID(),
        projectId,
        sceneId,
        slot: 0,
        candidateId: saved.id,
        status: "CUSTOM",
        selectedBy: "USER",
        motion: null,
        reviewedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      this.sqlite.prepare("UPDATE scenes SET no_visual = 0 WHERE project_id = ? AND id = ?").run(projectId, sceneId);
      this.markTimelineStale(projectId);
      this.repository.emitVisualUpdated(projectId, sceneId, "custom-selected");
    });
    return this.getSceneVisuals(projectId, sceneId);
  }

  private updateCandidateDownload(candidateId: string, stored: StoredImage): void {
    this.sqlite.prepare(
      "UPDATE visual_candidates SET local_path = ?, sha256 = ?, bytes = ?, actual_width = ?, actual_height = ?, file_type = ?, downloaded_at = ?, download_error = NULL WHERE id = ?",
    ).run(
      stored.localPath,
      stored.sha256,
      stored.bytes,
      stored.width,
      stored.height,
      stored.fileType,
      stored.downloadedAt,
      candidateId,
    );
  }

  private findNextDistinctCandidate(projectId: string, sceneId: string, rejectedId: string): VisualCandidate | null {
    const row = this.sqlite.prepare(
      `SELECT candidate.* FROM visual_candidates candidate
       WHERE candidate.project_id = ? AND candidate.scene_id = ? AND candidate.id != ? AND candidate.discarded_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM visual_selections selected
         JOIN visual_candidates used ON used.id = selected.candidate_id
         WHERE selected.project_id = candidate.project_id AND selected.scene_id != candidate.scene_id
         AND (used.source_url = candidate.source_url
           OR (used.provider = candidate.provider AND used.provider_item_id = candidate.provider_item_id))
       )
       ORDER BY candidate.rank, candidate.created_at LIMIT 1`,
    ).get(projectId, sceneId, rejectedId) as Record<string, unknown> | undefined;
    return row ? this.candidateFromRow(row) : null;
  }

  async executeStage(context: StageContext, llmProviders: LlmProviderRegistry): Promise<StageResult> {
    const project = context.project;
    const startedAt = Date.now();
    const scenes = this.loadScenes(project.id);
    const enabledProviders = this.registry.list();
    const featureSettings = resolveFeatures(project);
    const stats = createSearchStats();
    let llmCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const llmCallDetails: LlmCallUsage[] = [];
    const inputHashes: string[] = [];
    const sceneSearches: SceneSearchData[] = [];
    const sectionQueries = this.loadSectionQueries(project.id);

    for (const [index, scene] of scenes.entries()) {
      if (context.signal.aborted) throw context.signal.reason ?? new Error("Visual search was aborted");
      const searchHash = createHash("sha256").update(JSON.stringify([
        scene.visualQueries,
        scene.queryVariant,
        scene.visualDescription,
        scene.visualNotes,
        project.settings.language,
        project.settings.aspectRatio,
        sectionQueries.get(scene.sectionId ?? ""),
        enabledProviders.map((provider) => provider.id),
      ])).digest("hex");
      inputHashes.push(searchHash);
      const state = this.sqlite.prepare("SELECT search_hash FROM visual_search_state WHERE scene_id = ?")
        .get(scene.id) as { search_hash: string } | undefined;
      const existing = this.getSceneVisuals(project.id, scene.id, true).candidates;
      const unchanged = state?.search_hash === searchHash;
      const selection = this.getSelection(project.id, scene.id);
      const protectedSelection = Boolean(selection && (
        selection.selectedBy === "USER" || protectedSelectionStatuses.has(selection.status)
      ));
      if (unchanged) {
        sceneSearches.push({
          scene,
          queries: [scene.visualQueries.primary, ...scene.visualQueries.alternatives],
          candidates: existing.map((candidate) => fromStoredCandidate(candidate)),
          searchHash,
          unchanged: true,
          protectedSelection,
        });
      } else {
        const { queries, candidates } = await this.resolveQueries(
          scene,
          sectionQueries.get(scene.sectionId ?? ""),
          project.settings.aspectRatio,
          project.settings.language,
          enabledProviders,
          stats,
          context.signal,
        );
        sceneSearches.push({
          scene,
          queries,
          candidates,
          searchHash,
          unchanged: false,
          protectedSelection,
        });
      }
      context.reportProgress(Math.round(((index + 1) / Math.max(1, scenes.length)) * 55), `Searching visuals: scene ${index + 1}/${scenes.length}`);
    }

    if (stats.requests > 0 && stats.failures === stats.requests && stats.unavailableFailures === stats.failures) {
      throw new StageError("All image providers are unavailable", "IMAGE_SEARCH_UNAVAILABLE", true);
    }

    const assistScenes = featureSettings.altQueryAssist
      ? sceneSearches.filter((item) => !item.unchanged && this.relevantCount(
        item.candidates,
        item.scene.visualQueries.primary,
        item.scene.visualDescription || item.scene.visualNotes,
        project.settings.language,
        project.settings.aspectRatio,
        enabledProviders.map((provider) => provider.id),
      ) < 3)
      : [];
    if (assistScenes.length) {
      try {
        const llm = llmProviders.resolveTask("visualAltQueries", project, getAppLlmSettings(this.sqlite));
        const result = await generateRoutedStructured({
          registry: llmProviders,
          route: llm,
          task: "visualAltQueries",
          ...buildAltQueryPrompt(assistScenes.map((item) => ({
            sceneId: item.scene.id,
            visualNotes: project.settings.language === "en"
              ? item.scene.visualDescription || item.scene.visualNotes
              : "",
            narration: item.scene.narration,
            queries: item.scene.visualQueries,
          }))),
          schema: AltQueryResponseSchema,
          schemaName: "visual-alt-queries",
          schemaVersion: "1",
          maxOutputTokens: 1200,
          repairAttempts: 0,
          signal: context.signal,
          cache: new LlmCache(this.sqlite, this.config.LLM_CACHE_ENABLED),
          logger: context.logger,
        });
        llmCalls += result.usage.llmCalls;
        inputTokens += result.usage.inputTokens;
        outputTokens += result.usage.outputTokens;
        llmCallDetails.push(...result.usage.calls);
        for (const suggested of result.value.scenes) {
          const item = assistScenes.find((entry) => entry.scene.id === suggested.sceneId);
          if (!item) continue;
          for (const query of suggested.queries.map(stripQueryModifiers)) {
            if (this.relevantCount(
              item.candidates,
              item.scene.visualQueries.primary,
              item.scene.visualDescription || item.scene.visualNotes,
              project.settings.language,
              project.settings.aspectRatio,
              enabledProviders.map((provider) => provider.id),
            ) >= 8) break;
            item.candidates.push(...await this.searchAcrossProviders(
              query,
              enabledProviders.filter((provider) => provider.id !== "openverse"),
              orientationFor(project.settings.aspectRatio),
              context.signal,
              stats,
            ));
          }
        }
      } catch (error) {
        if (error instanceof LlmError && error.usage) {
          llmCalls += error.usage.llmCalls;
          inputTokens += error.usage.inputTokens;
          outputTokens += error.usage.outputTokens;
          llmCallDetails.push(...(error.usage.calls ?? []));
        }
        const code = error instanceof LlmError ? error.code : "LLM_UNAVAILABLE";
        context.logger.warn({ err: error, code }, "AI query assist skipped");
        context.reportProgress(56, `AI query assist skipped (${code})`);
      }
    }

    const rankedScenes = sceneSearches.map((item) => {
      const combined = dedupeCandidates(item.candidates);
      let ranked = this.rankVisuals(
        combined,
        item.scene.visualQueries.primary,
        item.scene.visualDescription || item.scene.visualNotes,
        project.settings.language,
        aspectNumber(project.settings.aspectRatio),
        enabledProviders.map((provider) => provider.id),
      ).slice(0, 24);
      item.candidates = ranked.map((candidate) => toNormalizedCandidate(candidate));
      return { item, ranked };
    });

    if (featureSettings.semanticImageRerank) {
      const rerankable = rankedScenes.filter((entry) => !entry.item.unchanged && entry.ranked.length);
      if (rerankable.length) {
        try {
          const llm = llmProviders.resolveTask("visualRerank", project, getAppLlmSettings(this.sqlite));
          const result = await generateRoutedStructured({
            registry: llmProviders,
            route: llm,
            task: "visualRerank",
            ...buildRerankPrompt(rerankable.map(({ item, ranked }) => ({
              sceneId: item.scene.id,
              narration: item.scene.narration,
              candidates: ranked.slice(0, 8).map((candidate, candidateIndex) => ({
                candidateIndex,
                title: candidate.title,
                description: candidate.description,
                tags: candidate.tags,
              })),
            }))),
            schema: RerankResponseSchema,
            schemaName: "visual-rerank",
            schemaVersion: "1",
            maxOutputTokens: 1200,
            repairAttempts: 0,
            signal: context.signal,
            cache: new LlmCache(this.sqlite, this.config.LLM_CACHE_ENABLED),
            logger: context.logger,
          });
          llmCalls += result.usage.llmCalls;
          inputTokens += result.usage.inputTokens;
          outputTokens += result.usage.outputTokens;
          llmCallDetails.push(...result.usage.calls);
          for (const rankedScene of rerankable) {
            const order = result.value.scenes.find((scene) => scene.sceneId === rankedScene.item.scene.id)?.order;
            if (!order) continue;
            const llmScore = new Map(order.map((candidateIndex, index) => [candidateIndex, (order.length - index) / order.length]));
            rankedScene.ranked = rankedScene.ranked.map((candidate, index) => {
              const score = index < 8
                ? 0.6 * candidate.relevanceScore + 0.4 * (llmScore.get(index) ?? 0)
                : candidate.relevanceScore;
              return {
                ...candidate,
                relevanceScore: score,
                scoreBreakdown: { ...candidate.scoreBreakdown, llmRank: llmScore.get(index) ?? 0, total: score },
              };
            }).sort((a, b) => Number(a.scoreBreakdown.lowRelevance) - Number(b.scoreBreakdown.lowRelevance)
              || b.relevanceScore - a.relevanceScore
              || a.provider.localeCompare(b.provider)
              || a.providerItemId.localeCompare(b.providerItemId))
              .slice(0, 24)
              .map((candidate, rank) => ({ ...candidate, rank }));
          }
        } catch (error) {
          if (error instanceof LlmError && error.usage) {
            llmCalls += error.usage.llmCalls;
            inputTokens += error.usage.inputTokens;
            outputTokens += error.usage.outputTokens;
            llmCallDetails.push(...(error.usage.calls ?? []));
          }
          context.logger.warn({ err: error }, "Semantic image rerank failed; keeping code ranking");
        }
      }
    }

    const selections = assignDistinct(rankedScenes.map(({ item, ranked }) => {
      const currentSelection = this.getSelection(project.id, item.scene.id);
      const selectedCandidate = currentSelection && (item.unchanged || item.protectedSelection)
        ? this.findCandidate(currentSelection.candidateId)
        : null;
      return {
        sceneId: item.scene.id,
        order: item.scene.order,
        candidates: ranked,
        ...(selectedCandidate ? { lockedCandidate: fromStoredCandidate(selectedCandidate) } : {}),
      };
    }));
    let candidateCount = 0;
    this.repository.atomic(() => {
      for (const { item, ranked } of rankedScenes) {
        if (!item.unchanged) {
          const currentSelection = this.getSelection(project.id, item.scene.id);
          const keepSelection = currentSelection && (
            currentSelection.selectedBy === "USER" || protectedSelectionStatuses.has(currentSelection.status)
          );
          this.sqlite.prepare(
            "DELETE FROM visual_candidates WHERE scene_id = ? AND (? IS NULL OR id != ?)",
          ).run(item.scene.id, keepSelection ? currentSelection.candidateId : null, keepSelection ? currentSelection.candidateId : null);
          if (!keepSelection) {
            this.sqlite.prepare("DELETE FROM visual_selections WHERE scene_id = ? AND slot = 0").run(item.scene.id);
          }
          ranked.forEach((candidate) => this.saveCandidate({
            ...candidate,
            id: randomUUID(),
            projectId: project.id,
            sceneId: item.scene.id,
            origin: "SEARCH",
            query: candidate.searchQuery ?? item.scene.visualQueries.primary,
            discardedAt: null,
            createdAt: new Date().toISOString(),
            searchHash: item.searchHash,
          }));
          this.sqlite.prepare(
            "INSERT INTO visual_search_state (scene_id, project_id, search_hash, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(scene_id) DO UPDATE SET search_hash = excluded.search_hash, updated_at = excluded.updated_at",
          ).run(item.scene.id, project.id, item.searchHash, new Date().toISOString());
        }
        candidateCount += ranked.length;
      }
      for (const assignment of selections) {
        const item = sceneSearches.find((entry) => entry.scene.id === assignment.sceneId);
        if (!item || !assignment.candidate) continue;
        const stored = this.getSceneVisuals(project.id, assignment.sceneId, true).candidates;
        const selected = stored.find((candidate) =>
          candidate.provider === assignment.candidate?.provider
          && candidate.providerItemId === assignment.candidate.providerItemId);
        if (!selected) continue;
        const { reusedAcrossScenes: _oldFlag, ...breakdown } = selected.scoreBreakdown;
        const nextBreakdown = assignment.reusedAcrossScenes
          ? { ...breakdown, reusedAcrossScenes: true }
          : breakdown;
        if (assignment.reusedAcrossScenes || _oldFlag !== undefined) {
          this.sqlite.prepare("UPDATE visual_candidates SET score_breakdown = ? WHERE id = ?")
            .run(JSON.stringify(nextBreakdown), selected.id);
        }
        if (item.unchanged || item.protectedSelection) continue;
        const now = new Date().toISOString();
        this.upsertSelection({
          id: randomUUID(),
          projectId: project.id,
          sceneId: assignment.sceneId,
          slot: 0,
          candidateId: selected.id,
          status: "DISCOVERED",
          selectedBy: "AGENT",
          motion: null,
          reviewedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    context.recordUsage({
      llmCalls,
      inputTokens,
      outputTokens,
      ...(llmCallDetails.length ? { calls: llmCallDetails } : {}),
      features: { imageProviderRequests: stats.requests, imageCacheHits: stats.cacheHits },
    });
    const cacheHits = stats.cacheHits;
    const projectVisuals = this.getProjectVisuals(project.id);
    const relevantSelections = projectVisuals.scenes.filter((scene) => scene.selectedCandidate
      && scene.selectedCandidate.scoreBreakdown.lowRelevance !== true).length;
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1_000);
    const requestSummary = enabledProviders.map((provider) =>
      `${provider.id === "wikimedia" ? "W" : provider.id === "openverse" ? "O" : provider.id === "pexels" ? "P" : provider.id} ${stats.requestsByProvider[provider.id] ?? 0}`,
    ).join(" / ");
    const message = `${scenes.length} scenes · ${relevantSelections} relevant · ${candidateCount} candidates · requests ${requestSummary} · cache ${cacheHits} · LLM calls ${llmCalls} · ${elapsedSeconds} s`;
    context.reportProgress(100, message);
    return {
      outputHash: createHash("sha256").update(inputHashes.join("")).digest("hex"),
      message,
    };
  }

  private async resolveQueries(
    scene: Scene,
    sectionPrimary: string | undefined,
    aspectRatio: Project["settings"]["aspectRatio"],
    language: Project["settings"]["language"],
    providers: ImageSearchProvider[],
    stats: SearchStats,
    signal: AbortSignal,
  ): Promise<{ queries: string[]; candidates: NormalizedImageResult[] }> {
    const queries: string[] = [];
    const results: NormalizedImageResult[] = [];
    const seenQueries = new Set<string>();
    const primary = stripQueryModifiers(scene.visualQueries.primary);
    const alternatives = scene.visualQueries.alternatives.map(stripQueryModifiers).filter(Boolean);
    const search = async (query: string, ladderStep: number): Promise<void> => {
      const cleanQuery = stripQueryModifiers(query);
      const key = normalizeQuery(cleanQuery);
      if (!key || seenQueries.has(key) || this.relevantCount(
        results,
        scene.visualQueries.primary,
        scene.visualDescription || scene.visualNotes,
        language,
        aspectRatio,
        providers.map((provider) => provider.id),
      ) >= 8) return;
      seenQueries.add(key);
      queries.push(cleanQuery);
      const queryProviders = ladderStep <= 2
        ? providers
        : providers.filter((provider) => provider.id !== "openverse");
      results.push(...await this.searchAcrossProviders(
        cleanQuery,
        queryProviders,
        orientationFor(aspectRatio),
        signal,
        stats,
      ));
    };
    await search(primary, 1);
    for (const query of alternatives) await search(query, 2);
    await search(simplifyQuery(primary), 3);
    for (const query of properNounQueries([primary, ...alternatives])) await search(query, 4);
    if (sectionPrimary) await search(stripQueryModifiers(sectionPrimary), 5);
    return { queries, candidates: dedupeCandidates(results) };
  }

  private relevantCount(
    candidates: NormalizedImageResult[],
    baseQuery: string,
    visualNotes: string,
    language: Project["settings"]["language"],
    aspectRatio: Project["settings"]["aspectRatio"],
    providerOrder: string[],
  ): number {
    return this.rankVisuals(
      dedupeCandidates(candidates),
      baseQuery,
      visualNotes,
      language,
      aspectNumber(aspectRatio),
      providerOrder,
    ).filter((candidate) => candidate.scoreBreakdown.keyword > 0).length;
  }

  private async searchAcrossProviders(
    query: string,
    providers: ImageSearchProvider[],
    orientation: ImageOrientation,
    signal: AbortSignal | undefined,
    stats: SearchStats,
  ): Promise<NormalizedImageResult[]> {
    const providerResults = await Promise.all(providers.map(async (provider) => {
      if (signal?.aborted) throw signal.reason ?? new Error("Visual search was aborted");
      const cacheKey = createHash("sha256").update(JSON.stringify([
        provider.id,
        normalizeQuery(query),
        10,
        orientation,
      ])).digest("hex");
      const cached = this.getCached(cacheKey);
      if (cached) {
        stats.cacheHits += 1;
        return cached;
      }
      stats.requests += 1;
      stats.requestsByProvider[provider.id] = (stats.requestsByProvider[provider.id] ?? 0) + 1;
      try {
        await this.limiter.acquire(provider.id, signal);
        const found = await provider.search({ query, perPage: 10, orientation, signal });
        const filtered = found.filter((item) =>
          item.width >= 1 && item.height >= 1 && Math.min(item.width, item.height) >= 320
          && (item.fileType.toLowerCase() === "svg"
            || ["jpg", "jpeg", "png", "webp", "gif"].includes(item.fileType.toLowerCase())));
        this.putCached(cacheKey, provider.id, query, filtered);
        return filtered;
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        stats.failures += 1;
        if (!(error instanceof ImageProviderError) || error.retryable || error.status === undefined || error.status >= 500) {
          stats.unavailableFailures += 1;
        }
        this.logger?.warn({ err: error, provider: provider.id, query }, "Image provider search failed");
        return [];
      }
    }));
    return providerResults.flatMap((found) =>
      found.map((item, index) => ({
        ...item,
        searchQuery: query,
        providerPosition: item.providerPosition ?? Math.max(0, 1 - index / 10),
      })));
  }

  private resolveProviders(ids?: string[]): ImageSearchProvider[] {
    const providers = ids
      ? ids.map((id) => {
        const provider = this.registry.get(id);
        if (!provider) throw new AppError(400, "INVALID_IMAGE_PROVIDER", `Image provider "${id}" is not enabled.`);
        return provider;
      })
      : this.registry.list();
    if (providers.length === 0) throw new AppError(503, "IMAGE_SEARCH_UNAVAILABLE", "No image search providers are enabled.");
    return providers;
  }

  private getCached(key: string): NormalizedImageResult[] | undefined {
    const row = this.sqlite.prepare("SELECT response, created_at FROM image_search_cache WHERE key = ?")
      .get(key) as CacheRow | undefined;
    if (!row) return undefined;
    const age = Date.now() - Date.parse(row.created_at);
    if (age > this.config.IMAGE_SEARCH_CACHE_TTL_HOURS * 3_600_000) {
      this.sqlite.prepare("DELETE FROM image_search_cache WHERE key = ?").run(key);
      return undefined;
    }
    return JSON.parse(row.response) as NormalizedImageResult[];
  }

  private putCached(key: string, provider: string, query: string, response: NormalizedImageResult[]): void {
    this.sqlite.prepare(
      "INSERT INTO image_search_cache (key, provider, query, response, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at",
    ).run(key, provider, query, JSON.stringify(response), new Date().toISOString());
  }

  private loadScenes(projectId: string): Scene[] {
    const rows = this.sqlite.prepare(
      "SELECT id, project_id, \"order\", kind, section_id, label, narration, visual_notes, visual_description, no_visual, visual_queries, music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited, input_hash, created_at, updated_at FROM scenes WHERE project_id = ? ORDER BY \"order\"",
    ).all(projectId) as (SceneRow & Record<string, unknown>)[];
    return rows.map((row) => {
      const queries = StoredVisualQueriesSchema.parse(JSON.parse(row.visual_queries) as unknown);
      return {
        id: row.id,
        projectId: row.project_id,
        order: row.order,
        kind: row.kind,
        sectionId: row.section_id as string | null,
        label: row.label as string,
        narration: row.narration,
        visualNotes: row.visual_notes,
        visualDescription: row.visual_description,
        noVisual: Boolean(row.no_visual),
        visualQueries: { primary: queries.primary, alternatives: queries.alternatives },
        queryVariant: queries.queryVariant,
        musicMood: row.music_mood as string,
        energy: row.energy,
        estDurationSec: row.est_duration_sec as number,
        durationOverrideSec: row.duration_override_sec as number | null,
        startSec: row.start_sec as number,
        transitionNote: row.transition_note as string,
        origin: row.origin,
        edited: Boolean(row.edited),
        inputHash: row.input_hash as string,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
      } as Scene;
    });
  }

  private loadSectionQueries(projectId: string): Map<string, string> {
    const row = this.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(projectId) as { data: string } | undefined;
    if (!row) return new Map();
    const script = ScriptSchema.parse(JSON.parse(row.data) as unknown);
    return new Map(script.sections.map((section) => [section.id, section.visualQueries.primary]));
  }

  private rankVisuals<T extends NormalizedImageResult | VisualCandidate>(
    candidates: T[],
    queryTerms: string,
    sceneTerms: string,
    language: Project["settings"]["language"],
    targetAspect: number,
    providerOrder: string[],
  ) {
    const rankable = candidates.map((candidate) => {
      const savedPosition = "scoreBreakdown" in candidate
        && typeof candidate.scoreBreakdown.providerPosition === "number"
        ? candidate.scoreBreakdown.providerPosition
        : undefined;
      return {
        ...candidate,
        aspectRatio: candidate.width / candidate.height,
        searchQuery: "query" in candidate ? candidate.query : candidate.searchQuery,
        providerPosition: ("providerPosition" in candidate ? candidate.providerPosition : undefined) ?? savedPosition ?? 0,
      };
    });
    return rankCandidates<T & { aspectRatio: number }>(
      rankable,
      {
        queryTerms,
        sceneTerms: language === "en" ? sceneTerms : "",
        targetAspect,
        providerOrder,
      },
    );
  }

  private toCandidate(
    result: NormalizedImageResult,
    project: Project,
    scene: Scene,
    query: string,
    searchHash: string,
  ): VisualCandidate {
    const { providerPosition = 0, searchQuery, ...candidateResult } = result;
    return VisualCandidateSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      sceneId: scene.id,
      origin: "SEARCH",
      ...candidateResult,
      query: searchQuery ?? query,
      aspectRatio: result.width / result.height,
      relevanceScore: 0,
      scoreBreakdown: { providerPosition },
      rank: 0,
      discardedAt: null,
      createdAt: new Date().toISOString(),
      searchHash,
    });
  }

  private saveCandidate(candidate: VisualCandidate): void {
    const existing = this.sqlite.prepare(
      "SELECT id FROM visual_candidates WHERE scene_id = ? AND provider = ? AND provider_item_id = ?",
    ).get(candidate.sceneId, candidate.provider, candidate.providerItemId) as { id: string } | undefined;
    const id = existing?.id ?? candidate.id;
    this.sqlite.prepare(
      `INSERT INTO visual_candidates (id, project_id, scene_id, origin, provider, provider_item_id, source_provider, query, title, description, tags, preview_url, image_url, source_url, source_site, width, height, aspect_ratio, file_type, watermark, relevance_score, score_breakdown, license, rank, discarded_at, created_at, search_hash, local_path, sha256, bytes, actual_width, actual_height, downloaded_at, download_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET query=excluded.query, title=excluded.title, description=excluded.description, tags=excluded.tags,
       preview_url=excluded.preview_url, image_url=excluded.image_url, source_url=excluded.source_url, source_site=excluded.source_site,
       width=excluded.width, height=excluded.height, aspect_ratio=excluded.aspect_ratio, file_type=excluded.file_type,
       watermark=excluded.watermark, relevance_score=excluded.relevance_score, score_breakdown=excluded.score_breakdown,
       license=excluded.license, rank=excluded.rank, search_hash=excluded.search_hash`,
    ).run(
      id, candidate.projectId, candidate.sceneId, candidate.origin, candidate.provider, candidate.providerItemId,
      candidate.sourceProvider ?? null, candidate.query, candidate.title, candidate.description, JSON.stringify(candidate.tags),
      candidate.previewUrl, candidate.imageUrl, candidate.sourceUrl, candidate.sourceSite, candidate.width, candidate.height,
      candidate.aspectRatio, candidate.fileType, candidate.watermark, candidate.relevanceScore,
      JSON.stringify(candidate.scoreBreakdown), JSON.stringify(candidate.license), candidate.rank, candidate.discardedAt,
      candidate.createdAt, candidate.searchHash ?? "",
      candidate.localPath ?? null, candidate.sha256 ?? null, candidate.bytes ?? null,
      candidate.actualWidth ?? null, candidate.actualHeight ?? null, candidate.downloadedAt ?? null,
      candidate.downloadError ?? null,
    );
  }

  private candidateFromRow(row: Record<string, unknown>): VisualCandidate {
    return VisualCandidateSchema.parse({
      id: row.id,
      projectId: row.project_id,
      sceneId: row.scene_id,
      origin: row.origin,
      provider: row.provider,
      providerItemId: row.provider_item_id,
      ...(row.source_provider ? { sourceProvider: row.source_provider } : {}),
      query: row.query,
      title: row.title,
      description: row.description,
      tags: parseJson(row.tags, []),
      previewUrl: row.preview_url,
      imageUrl: row.image_url,
      sourceUrl: row.source_url,
      sourceSite: row.source_site,
      width: row.width,
      height: row.height,
      aspectRatio: row.aspect_ratio,
      fileType: row.file_type,
      watermark: row.watermark,
      relevanceScore: row.relevance_score,
      scoreBreakdown: parseJson(row.score_breakdown, {}),
      license: parseJson(row.license, {}),
      rank: row.rank,
      discardedAt: row.discarded_at,
      createdAt: row.created_at,
      searchHash: row.search_hash,
      localPath: row.local_path ?? null,
      sha256: row.sha256 ?? null,
      bytes: row.bytes ?? null,
      actualWidth: row.actual_width ?? null,
      actualHeight: row.actual_height ?? null,
      downloadedAt: row.downloaded_at ?? null,
      downloadError: row.download_error ?? null,
    });
  }

  private findCandidate(candidateId: string): VisualCandidate | null {
    const row = this.sqlite.prepare("SELECT * FROM visual_candidates WHERE id = ?")
      .get(candidateId) as Record<string, unknown> | undefined;
    return row ? this.candidateFromRow(row) : null;
  }

  private getSelection(projectId: string, sceneId: string): VisualSelection | null {
    const row = this.sqlite.prepare(
      "SELECT * FROM visual_selections WHERE project_id = ? AND scene_id = ? AND slot = 0",
    ).get(projectId, sceneId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return VisualSelectionSchema.parse({
      id: row.id,
      projectId: row.project_id,
      sceneId: row.scene_id,
      slot: row.slot,
      candidateId: row.candidate_id,
      status: row.status,
      selectedBy: row.selected_by,
      motion: parseJson(row.motion, null),
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private upsertSelection(selection: VisualSelection): void {
    this.sqlite.prepare(
      `INSERT INTO visual_selections (id, project_id, scene_id, slot, candidate_id, status, selected_by, motion, reviewed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scene_id, slot) DO UPDATE SET candidate_id=excluded.candidate_id, status=excluded.status,
       selected_by=excluded.selected_by, motion=excluded.motion, reviewed_at=excluded.reviewed_at, updated_at=excluded.updated_at`,
    ).run(
      selection.id, selection.projectId, selection.sceneId, selection.slot, selection.candidateId,
      selection.status, selection.selectedBy, selection.motion ? JSON.stringify(selection.motion) : null,
      selection.reviewedAt, selection.createdAt, selection.updatedAt,
    );
  }

  private requireProject(projectId: string): Project {
    const project = this.repository.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  private requireScene(projectId: string, sceneId: string): Scene {
    this.requireProject(projectId);
    const scene = this.loadScenes(projectId).find((item) => item.id === sceneId);
    if (!scene) throw new AppError(404, "SCENE_NOT_FOUND", "Scene not found");
    return scene;
  }

  private markTimelineStale(projectId: string): void {
    const timeline = this.repository.getStage(projectId, "TIMELINE");
    if (timeline.state === "DONE") {
      this.repository.updateStage(projectId, "TIMELINE", {
        state: "STALE",
        progress: 0,
        message: null,
        jobId: null,
        error: null,
      });
    }
    markStaleFrom(this.repository, projectId, "TIMELINE");
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T | null) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error("Invalid JSON stored in visual search data", { cause: error });
  }
}

function aspectNumber(aspectRatio: Project["settings"]["aspectRatio"]): number {
  if (aspectRatio === "9:16") return 9 / 16;
  if (aspectRatio === "1:1") return 1;
  return 16 / 9;
}

function orientationFor(aspectRatio: Project["settings"]["aspectRatio"]): ImageOrientation {
  return aspectRatio === "9:16" ? "portrait" : aspectRatio === "1:1" ? "square" : "landscape";
}

function normalizeQuery(query: string): string {
  return query.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

function stripQueryModifiers(query: string): string {
  return query.replace(/\b(?:close[- ]?up|wide shot|archival photo|detail|portrait|illustration)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function simplifyQuery(query: string): string {
  const genericWords = new Set([
    "match", "game", "move", "final", "photo", "image", "close", "up", "exterior",
    "analysis", "press", "conference", "scene", "view", "shot",
  ]);
  const terms = stripQueryModifiers(query).split(/\s+/)
    .filter((term) => !/^\d+$/.test(term) && !genericWords.has(term.toLocaleLowerCase()));
  return terms.length >= 2 ? terms.join(" ") : "";
}

function properNounQueries(queries: string[]): string[] {
  const properNames = queries.flatMap((query) => {
    const tokens = stripQueryModifiers(query).match(/[\p{L}\p{N}]+/gu) ?? [];
    return tokens.filter((token) => token.length > 1
      && /^(?:\p{Lu}[\p{L}\p{N}]*|[\p{Ll}\p{N}]*\p{Lu}[\p{L}\p{N}]*)$/u.test(token)
      && /\p{Lu}/u.test(token));
  });
  const uniqueNames = [...new Map(properNames.map((name) => [normalizeQuery(name), name])).values()];
  const queriesToTry = uniqueNames.length > 1 ? [uniqueNames.slice(0, 3).join(" ")] : [];
  queriesToTry.push(...uniqueNames);
  return [...new Set(queriesToTry)];
}

function resolveFeatures(project: Project): { altQueryAssist: boolean; semanticImageRerank: boolean } {
  const features = resolveBudget(project);
  return { altQueryAssist: features.altQueryAssist, semanticImageRerank: features.semanticImageRerank };
}

function fromStoredCandidate(candidate: VisualCandidate): NormalizedImageResult {
  const providerPosition = candidate.scoreBreakdown.providerPosition;
  return {
    provider: candidate.provider,
    providerItemId: candidate.providerItemId,
    searchQuery: candidate.query,
    ...(typeof providerPosition === "number" ? { providerPosition } : {}),
    ...(candidate.sourceProvider ? { sourceProvider: candidate.sourceProvider } : {}),
    title: candidate.title,
    description: candidate.description,
    tags: candidate.tags,
    previewUrl: candidate.previewUrl,
    imageUrl: candidate.imageUrl,
    sourceUrl: candidate.sourceUrl,
    sourceSite: candidate.sourceSite,
    width: candidate.width,
    height: candidate.height,
    fileType: candidate.fileType,
    watermark: candidate.watermark,
    license: candidate.license,
  };
}

function createSearchStats(): SearchStats {
  return {
    requests: 0,
    requestsByProvider: {},
    cacheHits: 0,
    failures: 0,
    unavailableFailures: 0,
  };
}

function toNormalizedCandidate(
  candidate: NormalizedImageResult & { relevanceScore: number; scoreBreakdown: VisualCandidate["scoreBreakdown"]; rank: number },
): NormalizedImageResult {
  return candidate;
}

function downloadUrl(candidate: VisualCandidate): string {
  if (candidate.provider === "pexels") return candidate.imageUrl;
  if (candidate.fileType.toLowerCase() === "svg"
    || Math.max(candidate.width, candidate.height) > 2560) return candidate.previewUrl;
  return candidate.imageUrl;
}

function makeLicense(input: {
  kind: VisualCandidate["license"]["kind"];
  name: string;
  author?: string;
  evidence: VisualCandidate["license"]["evidence"];
}): VisualCandidate["license"] {
  return {
    kind: input.kind,
    name: input.name,
    url: null,
    author: input.author ?? null,
    authorUrl: null,
    attributionRequired: input.kind === "USER_PROVIDED" && Boolean(input.author),
    attributionText: input.author ? `Image provided by ${input.author}` : "",
    evidence: input.evidence,
  };
}

function downloadError(error: unknown): AppError {
  const reason = error instanceof Error ? error.message : String(error);
  return new AppError(422, "IMAGE_DOWNLOAD_FAILED", reason);
}

function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof ImageDownloadError) return error.retryable;
  if (error instanceof AppError && error.code === "IMAGE_DOWNLOAD_FAILED") {
    return (error.details as { retryable?: boolean } | undefined)?.retryable === true;
  }
  return false;
}
