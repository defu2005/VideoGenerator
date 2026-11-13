import { createHash, randomUUID } from "node:crypto";
import {
  deriveSceneVisualStatus,
  ProjectVisualsSchema,
  ScriptSchema,
  SceneVisualsSchema,
  SceneVisionMetaSchema,
  StoredVisualQueriesSchema,
  VisualCandidateSchema,
  VisualSelectionSchema,
  normalizeVisionCheckBatch,
  VisionCheckBatchSchema,
  VisionCheckSchema,
  assignDistinct,
  dedupeCandidates,
  rankCandidates,
  type Project,
  type Scene,
  type SceneVisionMeta,
  type VisualCandidate,
  type VisualSelection,
  type ScoreBreakdown,
  type VisionCheck,
  resolveBudget,
  visualFeaturesFor,
  stockWatermarkSuspected,
  webImageSearchSceneCap,
  isUnverifiedWebCandidate,
  preferredSources,
  ensureEntityPrefix,
  withNegativeTerms,
  workEntity,
  isFictionalWork,
  isHighRiskSource,
  isUnknownLicenseRisk,
  userOwnsVisualSelection,
  visualAttentionReason,
  VISUAL_ATTENTION_REASONS,
  type VisualAttentionReason,
  type LlmCallUsage,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { ImageDownloadError, ImageStore, isVisualFileName, parseImage, type StoredImage } from "./imageStore.js";
import { cropProjectImages, cropSceneImage, deleteSceneCrop, type CropAspect, type CropRecord } from "./imageCrop.js";
import { hashImage } from "./imageHash.js";
import { noteMissingDistinctVisual, noteVisualSearchUnavailable, visualCopyrightMode, visualQuality } from "./visualPolicy.js";
import { projectDir, resolveAssetPath } from "../storage/paths.js";
import { visionSourceProblem } from "./visionSource.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImageProviderBlockedError, ImageProviderError } from "../providers/images/http.js";
import { TokenBucketRateLimiter } from "../providers/images/rateLimiter.js";
import type {
  ImageOrientation,
  ImageSearchProvider,
  NormalizedImageResult,
} from "../providers/images/types.js";
import { ImageProviderRegistry } from "../providers/images/registry.js";
import { BraveImageProvider } from "../providers/images/brave.js";
import { BRAVE_IMAGE_REQUEST_USD, currentAutonomyBudget, recordAutomaticMediaCost } from "../operator/autonomyBudget.js";
import {
  HostDownloadRateLimiter,
} from "../providers/images/rateLimiter.js";
import {
  RobotsCache,
  WEB_CRAWL_USER_AGENT,
  isDeniedHost,
  parseDomainDenylist,
} from "../providers/images/webCrawl.js";
import {
  crawlPagesToCandidates,
  enrichBraveCandidates,
} from "../providers/images/crawlToCandidates.js";
import {
  searchPagesWithGeminiGrounding,
  WEB_IMAGE_GROUNDING_BATCH_SIZE,
} from "../providers/images/webGrounding.js";
import { getWebImageSettings } from "../settings/webImage.js";
import { getProfileDirection } from "./profileService.js";
import { isImageSourceEnabledInSettings, recordImageSourceBlocked } from "../settings/imageSources.js";
import { UnsplashImageProvider } from "../providers/images/unsplash.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import { StageError, type StageContext, type StageResult } from "../pipeline/stageExecutor.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { LlmCache } from "../providers/llm/cache.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { GuidelineService } from "../guidelines/service.js";
import { buildAltQueryPrompt, AltQueryResponseSchema } from "../stages/visuals/altQueryPrompt.js";
import { buildRerankPrompt, RerankResponseSchema } from "../stages/visuals/rerankPrompt.js";
import { buildVisionCheckPrompt } from "../stages/visuals/visionPrompts.js";
import {
  requireVisionRoute,
  runConsistencyCheck,
  verifySceneVision,
  type VisionCandidateInput,
} from "./visionVerify.js";
import { planSceneReuse, VISION_BATCH_SIZE } from "./visualReuse.js";
import type { AutoReportService } from "./autoReportService.js";

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
  /** Providers skipped for the rest of this stage run (Cloudflare / repeated 403). */
  blockedProviders: Set<string>;
  blockedReasons: Record<string, string>;
  consecutive403ByProvider: Record<string, number>;
  checkpointHits: number;
};

type SceneSearchData = {
  scene: Scene;
  queries: string[];
  candidates: NormalizedImageResult[];
  searchHash: string;
  /** Fully skipped this run (TASK-126: false for a reused scene that still needs vision). */
  unchanged: boolean;
  /** Stored candidates were reused instead of searching providers. */
  reused: boolean;
  /** Stored vision results, kept for reused scenes that run through the vision pass. */
  storedChecks?: Map<string, VisionCheck>;
  protectedSelection: boolean;
};

const VISUAL_CHECKPOINT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function isProtectedSelection(selection: { selectedBy?: string; status?: string } | null | undefined): boolean {
  return userOwnsVisualSelection(selection);
}

export class VisualService {
  private readonly limiter: TokenBucketRateLimiter;
  private readonly registry: ImageProviderRegistry;
  private readonly imageStore: ImageStore;

  private readonly autoReport: AutoReportService | null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly repository: JobRepository,
    private readonly config: AppConfig,
    private readonly logger?: FastifyBaseLogger,
    dependencies: {
      providers?: ImageSearchProvider[];
      limiter?: TokenBucketRateLimiter;
      imageStore?: ImageStore;
      autoReport?: AutoReportService;
    } = {},
  ) {
    this.registry = new ImageProviderRegistry(config, dependencies.providers);
    this.limiter = dependencies.limiter ?? new TokenBucketRateLimiter({
      wikimedia: config.IMAGE_SEARCH_PER_MINUTE_WIKIMEDIA,
      openverse: config.IMAGE_SEARCH_PER_MINUTE_OPENVERSE,
      pexels: config.IMAGE_SEARCH_PER_MINUTE_PEXELS,
      pixabay: config.IMAGE_SEARCH_PER_MINUTE_PIXABAY,
      unsplash: config.IMAGE_SEARCH_PER_MINUTE_UNSPLASH,
      nasa: config.IMAGE_SEARCH_PER_MINUTE_NASA,
      met: config.IMAGE_SEARCH_PER_MINUTE_MET,
      loc: config.IMAGE_SEARCH_PER_MINUTE_LOC,
      smithsonian: config.IMAGE_SEARCH_PER_MINUTE_SMITHSONIAN,
      europeana: config.IMAGE_SEARCH_PER_MINUTE_EUROPEANA,
      flickr: config.IMAGE_SEARCH_PER_MINUTE_FLICKR,
      brave: config.WEB_IMAGE_SEARCH_PER_MINUTE,
    });
    this.imageStore = dependencies.imageStore ?? new ImageStore(config.DATA_DIR, config.IMAGE_SEARCH_USER_AGENT, { minIntervalMs: config.IMAGE_DOWNLOAD_MIN_INTERVAL_MS });
    this.autoReport = dependencies.autoReport ?? null;
  }

  getProjectVisuals(projectId: string) {
    const project = this.requireProject(projectId);
    const visionRequired = this.visionRequired(project);
    const searchState = this.repository.getStage(projectId, "VISUAL_SEARCH").state;
    const scenes = this.loadScenes(projectId).map((scene) => {
      const selection = this.getSelection(projectId, scene.id);
      const selectedCandidate = selection ? this.findCandidate(selection.candidateId) : null;
      const candidateCount = this.sqlite.prepare(
        "SELECT COUNT(*) AS count FROM visual_candidates WHERE project_id = ? AND scene_id = ? AND discarded_at IS NULL",
      ).get(projectId, scene.id) as { count: number };
      const candidates = selectedCandidate ? [selectedCandidate] : [];
      const visionMeta = this.getVisionMeta(scene.id);
      const attentionReason = this.attentionReasonFor(selection, selectedCandidate, visionMeta, visionRequired);
      const status = deriveSceneVisualStatus(
        selection,
        candidates,
        scene.noVisual,
        searchState,
        visionMeta?.needsAttention === true,
        attentionReason,
      );
      return {
        sceneId: scene.id,
        order: scene.order,
        selection,
        selectedCandidate,
        candidateCount: candidateCount.count,
        needsUser: status === "NO_VISUAL" || status === "REVIEW_REQUIRED" || status === "NEEDS_ATTENTION",
        lowRelevance: selectedCandidate?.scoreBreakdown.lowRelevance === true,
        status,
        noVisual: scene.noVisual,
        visualDescription: scene.visualDescription,
        visualQueries: scene.visualQueries,
        narration: scene.narration,
        startSec: scene.startSec,
        durationSec: scene.durationOverrideSec ?? scene.estDurationSec,
        attentionReason,
        ...(visionMeta ? { visionMeta } : {}),
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
          ["NO_VISUAL", "SEARCHING", "REVIEW_REQUIRED", "NEEDS_ATTENTION", "APPROVED", "READY_FOR_RENDER", "SKIPPED"]
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
    const visionMeta = this.getVisionMeta(sceneId);
    const selected = selection ? candidates.find((item) => item.id === selection.candidateId) ?? null : null;
    const attentionReason = this.attentionReasonFor(
      selection,
      selected,
      visionMeta,
      this.visionRequired(this.requireProject(projectId)),
    );
    return SceneVisualsSchema.parse({
      selection,
      candidates,
      status: deriveSceneVisualStatus(
        selection,
        candidates,
        Boolean((this.sqlite.prepare("SELECT no_visual FROM scenes WHERE id = ?").get(sceneId) as { no_visual: number }).no_visual),
        this.repository.getStage(projectId, "VISUAL_SEARCH").state,
        visionMeta?.needsAttention === true,
        attentionReason,
      ),
      noVisual: Boolean((this.sqlite.prepare("SELECT no_visual FROM scenes WHERE id = ?").get(sceneId) as { no_visual: number }).no_visual),
      ...(visionMeta ? { visionMeta } : {}),
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
    const sceneText = [scene.visualDescription, scene.visualNotes, scene.narration, query].filter(Boolean).join(" ");
    const { providers, limits } = this.resolveProviders(providerIds, project, sceneText);
    const stats = createSearchStats();
    const results = await this.searchAcrossProviders(
      this.providerQuery(project.topic, query),
      providers,
      orientationFor(project.settings.aspectRatio),
      signal,
      stats,
      limits,
    );
    const current = this.getSceneVisuals(projectId, sceneId, true).candidates;
    const combined = dedupeCandidates([...current, ...results.map((result) => this.toCandidate(result, project, scene, query, ""))]);
    const ranked = this.rankVisuals(
      combined,
      query,
      scene.visualDescription || scene.visualNotes,
      project.settings.language,
      aspectNumber(project.settings.aspectRatio),
      providers.map((item) => item.id),
      visualCopyrightMode(this.sqlite, project.profileId),
      [project.topic, scene.visualQueries.primary].filter(Boolean),
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

  /**
   * Search the open web for a scene (Brave image API, then Gemini grounding if needed).
   * Reuses the scene's existing queries — no extra LLM query-writing call.
   */
  async researchOffTopic(projectId: string, input: { sceneIds?: string[]; reason?: string } = {}) {
    const project = this.requireProject(projectId);
    if (project.status === "RENDERING" || project.status === "GENERATING") {
      throw new AppError(409, "PROJECT_BUSY", "Dự án đang chạy hoặc đang render, không tìm lại ảnh.");
    }
    const rendering = this.sqlite.prepare(
      "SELECT 1 FROM jobs WHERE project_id = ? AND stage = 'RENDER' AND status IN ('QUEUED', 'RUNNING') LIMIT 1",
    ).get(projectId);
    if (rendering) throw new AppError(409, "PROJECT_BUSY", "Dự án đang render, không tìm lại ảnh.");
    const visuals = this.getProjectVisuals(projectId);
    const flagged = visuals.scenes.filter((scene) => scene.lowRelevance || scene.needsUser || scene.visionMeta?.needsAttention);
    const chosen = input.sceneIds?.length
      ? visuals.scenes.filter((scene) => input.sceneIds?.includes(scene.sceneId))
      : flagged;
    const ordered = [...chosen].sort((a, b) =>
      Number(a.selectedCandidate?.scoreBreakdown.keyword ?? 0) - Number(b.selectedCandidate?.scoreBreakdown.keyword ?? 0));
    const cap = webImageSearchSceneCap(visualFeaturesFor(resolveBudget(project), this.visualsQualityFor(project)), ordered.length);
    const sceneIds = ordered.slice(0, cap).map((scene) => scene.sceneId);
    const settings = getWebImageSettings(this.sqlite, this.config);
    const braveOn = settings.braveEnabled && Boolean(this.config.BRAVE_SEARCH_API_KEY?.trim());
    const groundingOn = settings.geminiGroundingEnabled && Boolean(this.config.GEMINI_API_KEY?.trim());
    if (!braveOn && !groundingOn) {
      noteVisualSearchUnavailable(this.sqlite, projectId);
      return { projectId, sceneIds, reason: input.reason ?? null, webSearch: false, searched: 0 };
    }
    let searched = 0;
    for (const sceneId of sceneIds) {
      await this.webSearch(projectId, sceneId);
      searched += 1;
    }
    return {
      projectId,
      sceneIds,
      reason: input.reason ?? (sceneIds.length ? "low_relevance" : null),
      webSearch: true,
      searched,
    };
  }

  async dedupeSceneVisuals(projectId: string): Promise<{ projectId: string; changed: number }> {
    const project = this.requireProject(projectId);
    if (project.status === "RENDERING" || project.status === "GENERATING") {
      throw new AppError(409, "PROJECT_BUSY", "Dự án đang chạy hoặc đang render, không đổi ảnh.");
    }
    const visuals = this.getProjectVisuals(projectId);
    const groups = new Map<string, typeof visuals.scenes>();
    for (const scene of visuals.scenes) {
      const candidate = scene.selectedCandidate;
      const key = candidate?.phash || candidate?.sourceUrl || candidate?.providerItemId;
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), scene]);
    }
    let changed = 0;
    for (const scenes of groups.values()) {
      if (scenes.length < 2) continue;
      const [first, ...later] = [...scenes].sort((a, b) => a.order - b.order);
      void first;
      for (const scene of later) {
        const selection = this.getSelection(projectId, scene.sceneId);
        if (selection?.selectedBy === "USER") continue;
        const currentKey = scene.selectedCandidate?.phash || scene.selectedCandidate?.sourceUrl;
        const alternative = this.listActiveCandidates(projectId, scene.sceneId).find((candidate) => {
          const key = candidate.phash || candidate.sourceUrl;
          return key !== currentKey && candidate.watermark !== "SUSPECTED";
        });
        if (!alternative) continue;
        await this.selectCandidate(projectId, scene.sceneId, alternative.id);
        changed += 1;
      }
    }
    return { projectId, changed };
  }

  async webSearch(projectId: string, sceneId: string, signal?: AbortSignal) {
    const project = this.requireProject(projectId);
    const scene = this.requireScene(projectId, sceneId);
    const settings = getWebImageSettings(this.sqlite, this.config);
    const braveKey = Boolean(this.config.BRAVE_SEARCH_API_KEY?.trim());
    const geminiKey = Boolean(this.config.GEMINI_API_KEY?.trim());
    const braveOn = settings.braveEnabled && braveKey;
    const groundingOn = settings.geminiGroundingEnabled && geminiKey;
    if (!braveOn && !groundingOn) {
      throw new AppError(
        503,
        "WEB_IMAGE_SEARCH_UNAVAILABLE",
        "Thiếu key: cấu hình BRAVE_SEARCH_API_KEY và/hoặc GEMINI_API_KEY, rồi bật nguồn ảnh web trong Cài đặt.",
      );
    }

    const queries = [
      scene.visualQueries.primary,
      ...scene.visualQueries.alternatives,
    ].map((query) => query.trim()).filter(Boolean);
    if (!queries.length) {
      throw new AppError(422, "WEB_IMAGE_QUERY_MISSING", "Scene chưa có từ khóa tìm ảnh.");
    }

    const denylist = settings.domainDenylist.length
      ? settings.domainDenylist
      : parseDomainDenylist(this.config.WEB_IMAGE_DOMAIN_DENYLIST);
    const hostLimiter = new HostDownloadRateLimiter(this.config.IMAGE_DOWNLOAD_MIN_INTERVAL_MS);
    const robotsCache = new RobotsCache({
      hostRateLimiter: hostLimiter,
      userAgent: WEB_CRAWL_USER_AGENT,
      signal,
    });
    const pageCache: { get(key: string): string | undefined; put(key: string, value: string): void } = {
      get: (key) => this.getCachedRaw(key),
      put: (key, value) => this.putCachedRaw(key, "web-crawl", key, value),
    };

    let braveRequests = 0;
    let groundingCalls = 0;
    let groundingModel = "";
    const collected: NormalizedImageResult[] = [];
    const usable = () => collected.filter((item) => item.imageUrl).length;

    if (braveOn) {
      const brave = new BraveImageProvider(this.config);
      await this.limiter.acquire("brave", signal);
      const primary = this.webQuery(project.topic, scene, queries[0]!);
      const braveHits = await brave.search({
        query: primary,
        perPage: 20,
        orientation: orientationFor(project.settings.aspectRatio),
        signal,
      });
      braveRequests += 1;
      const enriched = await enrichBraveCandidates({
        candidates: braveHits.slice(0, 12),
        denylist,
        config: this.config,
        cache: pageCache,
        robotsCache,
        dependencies: { hostRateLimiter: hostLimiter, signal, userAgent: WEB_CRAWL_USER_AGENT },
        signal,
      });
      collected.push(...enriched);
    }

    if (usable() < 3 && groundingOn) {
      const grounding = await searchPagesWithGeminiGrounding({
        scenes: [{
          sceneId: scene.id,
          query: this.webQuery(project.topic, scene, queries[0]!),
          alternativeQueries: queries.slice(1).map((query) => this.webQuery(project.topic, scene, query)),
        }],
        config: {
          ...this.config,
          WEB_IMAGE_GEMINI_MODEL: settings.geminiModel || this.config.WEB_IMAGE_GEMINI_MODEL,
        },
        signal,
        redirectDependencies: { hostRateLimiter: hostLimiter, signal },
      });
      groundingCalls += 1;
      groundingModel = grounding.model;
      const pageUrls = grounding.scenes.find((item) => item.sceneId === scene.id)?.pageUrls
        ?? grounding.scenes[0]?.pageUrls
        ?? [];
      const grounded = await crawlPagesToCandidates({
        pageUrls,
        query: queries[0]!,
        provider: "web-grounding",
        denylist,
        config: this.config,
        cache: pageCache,
        robotsCache,
        dependencies: { hostRateLimiter: hostLimiter, signal, userAgent: WEB_CRAWL_USER_AGENT },
        signal,
        whyPrefix: "Gemini grounding",
      });
      collected.push(...grounded);
    }

    const current = this.getSceneVisuals(projectId, sceneId, true).candidates;
    const combined = dedupeCandidates([
      ...current,
      ...collected.map((result) => this.toCandidate(result, project, scene, queries[0]!, "")),
    ]);
    const ranked = this.rankVisuals(
      combined,
      scene.visualQueries.primary,
      scene.visualDescription || scene.visualNotes,
      project.settings.language,
      aspectNumber(project.settings.aspectRatio),
      [...this.registry.list().map((item) => item.id), "brave", "web-grounding"],
      visualCopyrightMode(this.sqlite, project.profileId),
      [project.topic, scene.visualQueries.primary].filter(Boolean),
    ).slice(0, 24);

    this.repository.atomic(() => {
      for (const [rank, candidate] of ranked.entries()) this.saveCandidate({ ...candidate, rank });
      this.repository.emitVisualUpdated(projectId, sceneId, "web-searched");
    });

    return {
      ...this.getSceneVisuals(projectId, sceneId),
      usage: {
        braveRequests,
        groundingCalls,
        ...(groundingModel ? { groundingModel } : {}),
        features: {
          ...(braveRequests ? { braveImageSearchRequests: braveRequests } : {}),
          ...(groundingCalls ? { webImageGroundingCalls: groundingCalls } : {}),
        },
      },
    };
  }

  async selectCandidate(projectId: string, sceneId: string, candidateId: string) {
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
      this.clearNeedsAttention(sceneId);
      this.markTimelineStale(projectId);
      this.repository.emitVisualUpdated(projectId, sceneId, "selected");
    });
    await this.pingUnsplashDownload(candidate);
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
    const project = this.requireProject(projectId);
    const visionRequired = this.visionRequired(project);
    const scenes = this.loadScenes(projectId);
    let skipped = 0;
    const skipReasons: Record<string, number> = {};
    const noteSkip = (reason: string) => {
      skipped += 1;
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    };
    const eligible = scenes.flatMap((scene) => {
      const selection = this.getSelection(projectId, scene.id);
      if (!selection || !["DISCOVERED", "REVIEW_REQUIRED", "REPLACED"].includes(selection.status)) return [];
      const visionMeta = this.getVisionMeta(scene.id);
      const candidate = this.findCandidate(selection.candidateId);
      const gate = this.attentionReasonFor(selection, candidate, visionMeta, visionRequired);
      if (visionMeta?.needsAttention || gate) {
        noteSkip(gate ?? "vision_reject");
        return [];
      }
      // Never auto-approve unverified web finds — user must review license.
      if (candidate && isUnverifiedWebCandidate(candidate)) {
        noteSkip("source_risk");
        return [];
      }
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
    return { approved, failed, skipped, skipReasons };
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

  setSelectionMotion(
    projectId: string,
    sceneId: string,
    slot: number,
    motion: VisualSelection["motion"],
  ) {
    this.requireScene(projectId, sceneId);
    const selection = slot === 0
      ? this.getSelection(projectId, sceneId)
      : null;
    if (!selection || selection.slot !== slot) {
      throw new AppError(404, "VISUAL_SELECTION_NOT_FOUND", "This scene has no selected image for that slot.");
    }
    const now = new Date().toISOString();
    this.repository.atomic(() => {
      this.upsertSelection({ ...selection, motion, updatedAt: now });
      markStaleFrom(this.repository, projectId, "MUSIC_REVIEW");
      this.repository.emitVisualUpdated(projectId, sceneId, "motion-updated");
    });
    return this.getSceneVisuals(projectId, sceneId);
  }

  canApproveVisualReview(projectId: string): { allowed: true } | { allowed: false; message: string } {
    const visuals = this.getProjectVisuals(projectId);
    const blocked = visuals.scenes.filter((scene) => scene.status !== "READY_FOR_RENDER" && scene.status !== "SKIPPED");
    if (blocked.length === 0) return { allowed: true };
    const listed = blocked.slice(0, 8).map((scene) => {
      const reason = attentionLabel(scene.attentionReason);
      return reason ? `cảnh ${scene.order + 1} (${reason})` : `cảnh ${scene.order + 1}`;
    }).join(", ");
    const more = blocked.length > 8 ? ` và ${blocked.length - 8} cảnh nữa` : "";
    return {
      allowed: false,
      message: `${blocked.length} cảnh cần bạn chọn ảnh trước khi duyệt: ${listed}${more}.`,
    };
  }

  /**
   * AUTO: approve a scene only when the image passes the relevance gate.
   * Otherwise leave NEEDS_ATTENTION and let the visual gate wait for the user.
   */
  async autoResolve(projectId: string, signal?: AbortSignal): Promise<void> {
    const project = this.requireProject(projectId);
    this.autoReport?.clearStage(projectId, "VISUAL_REVIEW");
    const scenes = this.loadScenes(projectId);
    const visionRequired = this.visionRequired(project);
    const open = scenes.filter((scene) => {
      const status = this.getSceneVisuals(projectId, scene.id).status;
      return status !== "READY_FOR_RENDER" && status !== "SKIPPED";
    });
    const assigned = open.length > 0
      ? await this.searchWebForAttention(project, open, signal).then(() => this.distinctCandidateIds(project))
      : new Map<string, string>();
    const stuck: { sceneId: string; order: number; reason: VisualAttentionReason }[] = [];
    for (const scene of scenes) {
      if (signal?.aborted) throw signal.reason ?? new Error("Visual auto-resolve was aborted");
      const view = this.getSceneVisuals(projectId, scene.id);
      if (view.status === "READY_FOR_RENDER" || view.status === "SKIPPED") continue;
      const lockedSelection = this.getSelection(projectId, scene.id);
      if (lockedSelection && userOwnsVisualSelection(lockedSelection)) continue;
      const passing = this.listActiveCandidates(projectId, scene.id)
        .filter((candidate) => this.candidatePassesGate(candidate, visionRequired));
      const preferred = assigned.get(scene.id);
      const ordered = preferred
        ? [...passing].sort((left, right) => Number(right.id === preferred) - Number(left.id === preferred))
        : passing;
      const { approved, downloadFailures } = await this.tryApproveCandidatesInOrder(
        projectId, scene.id, ordered, signal,
      );
      this.reportDownloadFailures(projectId, scene.id, downloadFailures);
      if (approved) {
        this.clearNeedsAttention(scene.id);
        continue;
      }
      const selection = this.getSelection(projectId, scene.id);
      const candidate = selection ? this.findCandidate(selection.candidateId) : null;
      const reason = this.attentionReasonFor(selection, candidate, this.getVisionMeta(scene.id), visionRequired) ?? "no_candidate";
      this.markNeedsAttention(scene.id, reason);
      stuck.push({ sceneId: scene.id, order: scene.order, reason });
    }
    if (stuck.length === 0) return;
    this.autoReport?.add(projectId, {
      stage: "VISUAL_REVIEW",
      sceneId: null,
      code: "VISUAL_NEEDS_USER",
      severity: "WARN",
      message: `${stuck.length} cảnh chưa có ảnh đúng chủ đề. AUTO dừng để bạn chọn.`,
      data: { scenes: stuck },
    });
  }

  /** TASK-121: read-only per-scene view for the quality repair loop. Same gate code as autoResolve. */
  repairSceneView(projectId: string) {
    const project = this.requireProject(projectId);
    const visionRequired = this.visionRequired(project);
    return this.loadScenes(projectId).map((scene) => {
      const selection = this.getSelection(projectId, scene.id);
      const candidate = selection ? this.findCandidate(selection.candidateId) : null;
      const meta = this.getVisionMeta(scene.id);
      const owned = Boolean(selection && userOwnsVisualSelection(selection));
      const reason = scene.noVisual || owned ? null : this.attentionReasonFor(selection, candidate, meta, visionRequired);
      const alternatives = scene.noVisual || owned ? [] : this.listActiveCandidates(projectId, scene.id)
        .filter((item) => item.id !== candidate?.id && this.candidatePassesGate(item, visionRequired));
      return {
        sceneId: scene.id,
        order: scene.order,
        startSec: scene.startSec,
        durationSec: scene.durationOverrideSec ?? scene.estDurationSec,
        noVisual: scene.noVisual,
        owned,
        reason,
        hasPassingAlternative: alternatives.length > 0,
        selectedBy: selection?.selectedBy ?? null,
        candidateId: candidate?.id ?? null,
      };
    });
  }

  /** TASK-121: select the best existing candidate that passes the gate. Never lowers a threshold. */
  async repairPickNextCandidate(projectId: string, sceneId: string, signal?: AbortSignal) {
    const project = this.requireProject(projectId);
    this.requireScene(projectId, sceneId);
    const before = this.getSelection(projectId, sceneId);
    if (before && userOwnsVisualSelection(before)) return { changed: false, previousCandidateId: before.candidateId, candidateId: null };
    const visionRequired = this.visionRequired(project);
    const passing = this.listActiveCandidates(projectId, sceneId)
      .filter((item) => item.id !== before?.candidateId && this.candidatePassesGate(item, visionRequired));
    const { approved } = await this.tryApproveCandidatesInOrder(projectId, sceneId, passing, signal);
    if (approved) this.clearNeedsAttention(sceneId);
    return { changed: Boolean(approved), previousCandidateId: before?.candidateId ?? null, candidateId: approved?.id ?? null };
  }

  /** TASK-121: run the vision check again on the selected image of a scene (fallback route is in the router). */
  async repairVisionRecheck(projectId: string, sceneId: string, llmProviders: LlmProviderRegistry, signal?: AbortSignal) {
    this.requireScene(projectId, sceneId);
    const selection = this.getSelection(projectId, sceneId);
    if (!selection || userOwnsVisualSelection(selection)) return { changed: false };
    await this.visionCheckCandidate(projectId, sceneId, selection.candidateId, llmProviders, signal);
    return { changed: true };
  }

  /** TASK-121: stock-provider search with a query that was not used yet for this scene. */
  async repairResearchScene(projectId: string, sceneId: string, signal?: AbortSignal) {
    const project = this.requireProject(projectId);
    const scene = this.requireScene(projectId, sceneId);
    const selection = this.getSelection(projectId, sceneId);
    if (selection && userOwnsVisualSelection(selection)) return { changed: false, query: null as string | null };
    const used = new Set(this.getSceneVisuals(projectId, sceneId, true).candidates.map((item) => item.query.trim().toLowerCase()));
    const options = [
      ...scene.visualQueries.alternatives, scene.visualQueries.primary, scene.visualDescription, scene.visualNotes,
      `${project.topic} ${scene.narration.split(/\s+/).slice(0, 6).join(" ")}`,
    ].map((item) => item.trim()).filter(Boolean);
    const query = options.find((item) => !used.has(item.toLowerCase())) ?? options[0] ?? project.topic;
    await this.searchScene(projectId, sceneId, query, undefined, signal);
    return { changed: true, query };
  }

  /** TASK-121: web search for one scene. Unverified web finds never auto-approve (candidatePassesGate). */
  async repairWebSearchScene(projectId: string, sceneId: string, signal?: AbortSignal) {
    this.requireScene(projectId, sceneId);
    const selection = this.getSelection(projectId, sceneId);
    if (selection && userOwnsVisualSelection(selection)) return { changed: false };
    await this.webSearch(projectId, sceneId, signal);
    return { changed: true };
  }

  /** True when the profile's source policy already allows web image sources. */
  repairWebAllowed(): boolean {
    const settings = getWebImageSettings(this.sqlite, this.config);
    return (settings.braveEnabled && Boolean(this.config.BRAVE_SEARCH_API_KEY?.trim()))
      || (settings.geminiGroundingEnabled && Boolean(this.config.GEMINI_API_KEY?.trim()));
  }

  /** TASK-121: generic findable description. Narration is not changed. */
  repairRephraseScene(projectId: string, sceneId: string): { changed: boolean; previous: string; next: string } {
    const project = this.requireProject(projectId);
    const scene = this.requireScene(projectId, sceneId);
    const selection = this.getSelection(projectId, sceneId);
    if (selection && userOwnsVisualSelection(selection)) return { changed: false, previous: scene.visualDescription, next: scene.visualDescription };
    const topicWords = new Set(project.topic.toLowerCase().split(/\s+/));
    const kept = scene.visualDescription.split(/\s+/).filter((word, index) => {
      const capitalised = /^\p{Lu}/u.test(word) && index > 0;
      return !capitalised || topicWords.has(word.toLowerCase());
    });
    const generic = kept.length >= 3 ? kept.join(" ") : `Minh họa chung: ${scene.narration.split(/\s+/).slice(0, 10).join(" ")}`;
    const next = generic === scene.visualDescription ? `${project.topic} ${generic}`.slice(0, 300) : generic.slice(0, 300);
    const now = new Date().toISOString();
    this.sqlite.prepare("UPDATE scenes SET visual_description = ?, visual_queries = ?, updated_at = ? WHERE id = ?")
      .run(next, JSON.stringify({ ...scene.visualQueries, primary: next, alternatives: [] }), now, sceneId);
    const meta = this.getVisionMeta(sceneId) ?? {};
    this.writeVisionMeta(sceneId, projectId, { ...meta, repair: "rephrase" });
    return { changed: true, previous: scene.visualDescription, next };
  }

  /** TASK-121: switch to a shot that needs no matching photo. The compose director draws the card. */
  repairSwitchShotType(projectId: string, sceneId: string): { changed: boolean; shot: string; previousCandidateId: string | null } {
    const scene = this.requireScene(projectId, sceneId);
    const selection = this.getSelection(projectId, sceneId);
    if (selection && userOwnsVisualSelection(selection)) return { changed: false, shot: "none", previousCandidateId: selection.candidateId };
    const shot = /["“”]/.test(scene.narration) ? "quote_full"
      : scene.narration.split(/[,;]/).length >= 4 ? "list_full"
        : "text_card";
    this.repository.atomic(() => {
      this.sqlite.prepare("UPDATE scenes SET no_visual = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), sceneId);
      const meta = this.getVisionMeta(sceneId) ?? {};
      const { needsAttention: _needsAttention, reason: _reason, ...rest } = meta;
      void _needsAttention; void _reason;
      this.writeVisionMeta(sceneId, projectId, { ...rest, repair: "shot_type", repairShot: shot as "text_card" | "quote_full" | "list_full" });
      this.markTimelineStale(projectId);
      this.repository.emitVisualUpdated(projectId, sceneId, "shot-switched");
    });
    return { changed: true, shot, previousCandidateId: selection?.candidateId ?? null };
  }

  private writeVisionMeta(sceneId: string, projectId: string, meta: SceneVisionMeta): void {
    const now = new Date().toISOString();
    const updated = this.sqlite.prepare("UPDATE visual_search_state SET vision_meta = ?, updated_at = ? WHERE scene_id = ?")
      .run(JSON.stringify(meta), now, sceneId);
    if (updated.changes > 0) return;
    this.sqlite.prepare(
      "INSERT INTO visual_search_state (scene_id, project_id, search_hash, vision_meta, updated_at) VALUES (?, ?, '', ?, ?)",
    ).run(sceneId, projectId, JSON.stringify(meta), now);
  }

  private listActiveCandidates(projectId: string, sceneId: string): VisualCandidate[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM visual_candidates WHERE project_id = ? AND scene_id = ? AND discarded_at IS NULL ORDER BY rank, created_at",
    ).all(projectId, sceneId) as Record<string, unknown>[];
    return rows.map((row) => this.candidateFromRow(row));
  }

  /** Ranked candidates excluding ones that already failed to download. */
  private rankedCandidates(candidates: VisualCandidate[]): VisualCandidate[] {
    return [...candidates]
      .filter((candidate) => !candidate.downloadError)
      .sort((left, right) => {
        const leftFit = left.visionCheck?.fit;
        const rightFit = right.visionCheck?.fit;
        if (leftFit != null && rightFit != null && leftFit !== rightFit) return rightFit - leftFit;
        if (leftFit != null && rightFit == null) return -1;
        if (leftFit == null && rightFit != null) return 1;
        if (right.relevanceScore !== left.relevanceScore) return right.relevanceScore - left.relevanceScore;
        return left.rank - right.rank;
      });
  }

  private bestCandidate(candidates: VisualCandidate[]): VisualCandidate | null {
    return this.rankedCandidates(candidates)[0] ?? null;
  }

  /**
   * Try candidates in bestCandidate order (verified-first when the caller passes that pool).
   * On download failure, skip that candidate and try the next (cap 5). Never throws for download errors.
   */
  private async tryApproveCandidatesInOrder(
    projectId: string,
    sceneId: string,
    candidates: VisualCandidate[],
    signal?: AbortSignal,
    maxAttempts = 5,
  ): Promise<{
    approved: VisualCandidate | null;
    downloadFailures: { id: string; host: string | null; status: number | null }[];
  }> {
    const ordered = this.rankedCandidates(candidates).slice(0, maxAttempts);
    const downloadFailures: { id: string; host: string | null; status: number | null }[] = [];
    for (const pick of ordered) {
      if (signal?.aborted) throw signal.reason ?? new Error("Visual auto-resolve was aborted");
      try {
        await this.forceApproveCandidate(projectId, sceneId, pick, signal);
        return { approved: pick, downloadFailures };
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (!isImageDownloadFailedError(error)) throw error;
        downloadFailures.push({
          id: pick.id,
          host: candidateHost(pick),
          status: downloadFailureStatus(error),
        });
      }
    }
    return { approved: null, downloadFailures };
  }

  private reportDownloadFailures(
    projectId: string,
    sceneId: string,
    failures: { id: string; host: string | null; status: number | null }[],
  ): void {
    if (failures.length === 0) return;
    this.autoReport?.add(projectId, {
      stage: "VISUAL_REVIEW",
      sceneId,
      code: "VISUAL_DOWNLOAD_FAILED",
      severity: "WARN",
      message: `Không tải được ${failures.length} ảnh ứng viên — đã thử ảnh khác hoặc bỏ qua.`,
      data: {
        failed: failures.map((item) => ({
          candidateId: item.id,
          host: item.host,
          status: item.status,
        })),
      },
    });
  }

  private async forceApproveCandidate(
    projectId: string,
    sceneId: string,
    candidate: VisualCandidate,
    signal?: AbortSignal,
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.getSelection(projectId, sceneId);
    const selection = VisualSelectionSchema.parse({
      id: existing?.id ?? randomUUID(),
      projectId,
      sceneId,
      slot: 0,
      candidateId: candidate.id,
      status: "DISCOVERED",
      selectedBy: "AGENT",
      motion: existing?.motion ?? null,
      reviewedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.repository.atomic(() => {
      this.upsertSelection(selection);
      this.sqlite.prepare("UPDATE scenes SET no_visual = 0 WHERE project_id = ? AND id = ?").run(projectId, sceneId);
    });
    await this.approveSelected(projectId, sceneId, selection, candidate, signal);
  }

  private attentionReasonFor(
    selection: { selectedBy?: string; status?: string } | null,
    candidate: VisualCandidate | null,
    visionMeta: SceneVisionMeta | null | undefined,
    visionRequired: boolean,
  ): VisualAttentionReason | null {
    const fit = candidate?.visionCheck?.fit
      ?? (typeof candidate?.scoreBreakdown.visionFit === "number" ? candidate.scoreBreakdown.visionFit : null);
    const hasVisionResult = candidate?.visionCheck != null || typeof fit === "number";
    const fromCandidate = visualAttentionReason({
      selection,
      lowRelevance: candidate?.scoreBreakdown.lowRelevance === true,
      visionFit: fit,
      visionIssues: candidate?.visionCheck?.issues,
      sourceRisk: candidate ? this.candidateSourceRisk(candidate, this.domainDenylist()) : false,
      fitThreshold: 7,
      visionRequired,
      hasVisionResult,
      invalidSource: candidate?.scoreBreakdown.invalidSource === true,
    });
    if (fromCandidate) return fromCandidate;
    if (!visionMeta?.needsAttention || userOwnsVisualSelection(selection)) return null;
    if (visionMeta.reason && (VISUAL_ATTENTION_REASONS as readonly string[]).includes(visionMeta.reason)) {
      return visionMeta.reason as VisualAttentionReason;
    }
    return "vision_reject";
  }

  private candidatePassesGate(candidate: VisualCandidate, visionRequired = false): boolean {
    if (candidate.scoreBreakdown.invalidSource === true) return false;
    if (isUnverifiedWebCandidate(candidate) || candidate.watermark === "SUSPECTED") return false;
    if (stockWatermarkSuspected({
      sourceSite: candidate.sourceSite,
      imageUrl: candidate.imageUrl,
      sourceUrl: candidate.sourceUrl,
      sourcePageUrl: candidate.sourcePageUrl,
    })) return false;
    const fit = candidate.visionCheck?.fit
      ?? (typeof candidate.scoreBreakdown.visionFit === "number" ? candidate.scoreBreakdown.visionFit : null);
    return visualAttentionReason({
      selection: { selectedBy: "AGENT", status: "DISCOVERED" },
      lowRelevance: candidate.scoreBreakdown.lowRelevance === true,
      visionFit: fit,
      visionIssues: candidate.visionCheck?.issues,
      sourceRisk: this.candidateSourceRisk(candidate, this.domainDenylist()),
      fitThreshold: 7,
      visionRequired,
      hasVisionResult: candidate.visionCheck != null || typeof fit === "number",
      invalidSource: false,
    }) === null;
  }

  private async searchWebForAttention(project: Project, scenes: Scene[], signal?: AbortSignal): Promise<void> {
    const settings = getWebImageSettings(this.sqlite, this.config);
    const braveOn = settings.braveEnabled && Boolean(this.config.BRAVE_SEARCH_API_KEY?.trim());
    const groundingOn = settings.geminiGroundingEnabled && Boolean(this.config.GEMINI_API_KEY?.trim());
    if (!braveOn && !groundingOn) {
      if (isFictionalWork({ topic: project.topic, niche: getProfileDirection(this.sqlite, project.profileId) })) {
        noteVisualSearchUnavailable(this.sqlite, project.id);
      }
      return;
    }
    for (const scene of scenes) {
      if (signal?.aborted) throw signal.reason ?? new Error("Visual auto-resolve was aborted");
      try {
        await this.webSearch(project.id, scene.id, signal);
      } catch (error) {
        this.logger?.warn({ err: error, sceneId: scene.id }, "Extra web search before asking the user failed");
        break;
      }
    }
  }

  private markNeedsAttention(sceneId: string, reason: VisualAttentionReason): void {
    const meta = this.getVisionMeta(sceneId) ?? {};
    const next = { ...meta, needsAttention: true, reason };
    const updated = this.sqlite.prepare(
      "UPDATE visual_search_state SET vision_meta = ?, updated_at = ? WHERE scene_id = ?",
    ).run(JSON.stringify(next), new Date().toISOString(), sceneId);
    if (updated.changes > 0) return;
    const project = this.sqlite.prepare("SELECT project_id FROM scenes WHERE id = ?")
      .get(sceneId) as { project_id: string } | undefined;
    if (!project) return;
    this.sqlite.prepare(
      `INSERT INTO visual_search_state (scene_id, project_id, search_hash, vision_meta, updated_at)
       VALUES (?, ?, '', ?, ?)`,
    ).run(sceneId, project.project_id, JSON.stringify(next), new Date().toISOString());
  }

  private providerQuery(topic: string, query: string): string {
    return ensureEntityPrefix(stripQueryModifiers(query), workEntity(topic));
  }

  private webQuery(topic: string, scene: Scene, query: string): string {
    const sceneText = [
      scene.narration,
      scene.visualDescription,
      scene.visualNotes,
      scene.visualQueries.primary,
      ...scene.visualQueries.alternatives,
    ].join(" ");
    return withNegativeTerms(this.providerQuery(topic, query), sceneText);
  }

  private clearNeedsAttention(sceneId: string): void {
    const meta = this.getVisionMeta(sceneId);
    if (!meta?.needsAttention) return;
    const next = { ...meta, needsAttention: false };
    const updated = this.sqlite.prepare(
      "UPDATE visual_search_state SET vision_meta = ?, updated_at = ? WHERE scene_id = ?",
    ).run(JSON.stringify(next), new Date().toISOString(), sceneId);
    if (updated.changes > 0) return;
    const project = this.sqlite.prepare("SELECT project_id FROM scenes WHERE id = ?")
      .get(sceneId) as { project_id: string } | undefined;
    if (!project) return;
    this.sqlite.prepare(
      `INSERT INTO visual_search_state (scene_id, project_id, search_hash, vision_meta, updated_at)
       VALUES (?, ?, '', ?, ?)`,
    ).run(sceneId, project.project_id, JSON.stringify(next), new Date().toISOString());
  }

  private findNeighbourWithImage(
    scenes: Scene[],
    target: Scene,
  ): { scene: Scene; candidate: VisualCandidate } | null {
    const ordered = [...scenes].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((scene) => scene.id === target.id);
    if (index < 0) return null;
    const tryScene = (scene: Scene | undefined) => {
      if (!scene || scene.id === target.id) return null;
      const selection = this.getSelection(scene.projectId, scene.id);
      if (!selection) return null;
      const candidate = this.findCandidate(selection.candidateId);
      if (!candidate?.localPath || !candidate.sha256) return null;
      if (selection.status !== "APPROVED" && selection.status !== "CUSTOM" && selection.status !== "REPLACED") {
        // Allow neighbour that is already ready or at least downloaded.
        if (!candidate.localPath) return null;
      }
      return { scene, candidate };
    };
    for (let offset = 1; offset < ordered.length; offset += 1) {
      const prev = tryScene(ordered[index - offset]);
      if (prev) return prev;
      const next = tryScene(ordered[index + offset]);
      if (next) return next;
    }
    return null;
  }

  private cloneCandidateToScene(
    projectId: string,
    sceneId: string,
    source: VisualCandidate,
  ): VisualCandidate {
    const now = new Date().toISOString();
    const cloned = VisualCandidateSchema.parse({
      ...source,
      id: randomUUID(),
      projectId,
      sceneId,
      providerItemId: `reuse:${source.id}`,
      scoreBreakdown: {
        ...source.scoreBreakdown,
        reusedNeighbour: true,
        reusedFromSceneId: source.sceneId,
      },
      why: source.why ?? "Tái sử dụng ảnh scene lân cận (AUTO)",
      rank: 0,
      discardedAt: null,
      createdAt: now,
      searchHash: source.searchHash ?? "",
      downloadError: null,
    });
    this.saveCandidate(cloned);
    return this.findCandidate(cloned.id) ?? cloned;
  }

  async cropScenes(projectId: string, sceneIds: string[] | undefined, aspects: CropAspect[]) {
    this.requireProject(projectId);
    return cropProjectImages(this.sqlite, {
      dataDir: this.config.DATA_DIR,
      projectId,
      sceneIds,
      aspects,
      overwriteManual: false,
    });
  }

  async saveManualCrop(projectId: string, sceneId: string, aspect: CropAspect, box: { x: number; y: number; width: number; height: number }) {
    return cropSceneImage(this.sqlite, {
      dataDir: this.config.DATA_DIR,
      projectId,
      sceneId,
      aspect,
      box,
      overwriteManual: true,
    });
  }

  removeCrop(projectId: string, sceneId: string, aspect: CropAspect): void {
    deleteSceneCrop(this.sqlite, projectId, sceneId, aspect);
  }

  async cropScene(projectId: string, sceneId: string, aspect?: CropAspect): Promise<CropRecord> {
    const project = this.requireProject(projectId);
    const chosen = aspect ?? (project.settings.aspectRatio === "9:16" || project.settings.aspectRatio === "1:1" ? project.settings.aspectRatio : "16:9");
    const target = chosen === "9:16" ? { width: 1080, height: 1920 } : chosen === "1:1" ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 };
    return cropSceneImage(this.sqlite, {
      dataDir: this.config.DATA_DIR,
      projectId,
      sceneId,
      aspect: chosen,
      renderWidth: target.width,
      renderHeight: target.height,
    });
  }

  private visualsQualityFor(project: Project) {
    return project.settings.visuals?.quality ?? visualQuality(this.sqlite, project.profileId);
  }

  private visionRequired(project: Project): boolean {
    return visualFeaturesFor(resolveBudget(project), this.visualsQualityFor(project)).visionCheck;
  }

  private domainDenylist(): readonly string[] {
    return getWebImageSettings(this.sqlite, this.config).domainDenylist;
  }

  private urlDenied(
    candidate: { sourcePageUrl?: string | null; sourceUrl?: string | null; imageUrl?: string | null; sourceSite?: string | null },
    denylist: readonly string[],
  ): boolean {
    return [candidate.sourcePageUrl, candidate.sourceUrl, candidate.imageUrl, candidate.sourceSite].some((value) => {
      if (!value) return false;
      try {
        return isDeniedHost(new URL(value).hostname, denylist);
      } catch {
        return isDeniedHost(value, denylist);
      }
    });
  }

  private candidateSourceRisk(
    candidate: {
      sourcePageUrl?: string | null;
      sourceUrl?: string | null;
      imageUrl?: string | null;
      sourceSite?: string | null;
      provider?: string;
      license: { kind: string };
      licenseVerified?: boolean;
    },
    denylist: readonly string[],
  ): boolean {
    return isHighRiskSource([candidate.sourcePageUrl, candidate.sourceUrl, candidate.imageUrl, candidate.sourceSite])
      || isUnknownLicenseRisk({
        provider: candidate.provider,
        licenseKind: candidate.license.kind,
        licenseVerified: candidate.licenseVerified,
      })
      || this.urlDenied(candidate, denylist);
  }

  private rankedCandidateAllowed(
    candidate: NormalizedImageResult & { scoreBreakdown: ScoreBreakdown },
    check: VisionCheck | undefined,
    visionRequired: boolean,
    threshold: number,
    denylist: readonly string[],
  ): boolean {
    if (candidate.scoreBreakdown.invalidSource === true) return false;
    const webUnknown = candidate.watermark === "UNKNOWN"
      && (candidate.provider === "brave" || candidate.provider === "web-grounding" || candidate.provider === "openverse");
    const watermarkIssue = check?.issues.includes("watermark") || check?.issues.includes("text_overlay");
    if (watermarkIssue || (webUnknown && !check)) return false;
    if (candidate.scoreBreakdown.lowRelevance === true) return false;
    if (this.candidateSourceRisk(candidate, denylist)) return false;
    const fit = check?.fit ?? (typeof candidate.scoreBreakdown.visionFit === "number" ? candidate.scoreBreakdown.visionFit : null);
    if (visionRequired && fit == null) return false;
    if (fit != null && fit < threshold) return false;
    if (check?.issues.some((issue) => issue === "wrong_subject" || issue === "nsfw" || issue === "logo_only")) return false;
    return !isUnverifiedWebCandidate(candidate) && !candidate.downloadError
      && candidate.watermark !== "SUSPECTED"
      && !stockWatermarkSuspected({
        sourceSite: candidate.sourceSite,
        imageUrl: candidate.imageUrl,
        sourceUrl: candidate.sourceUrl,
        sourcePageUrl: candidate.sourcePageUrl,
      });
  }

  /** After web search, pick one passing image per scene. User locks stay put. */
  private distinctCandidateIds(project: Project): Map<string, string> {
    const visionOn = this.visionRequired(project);
    const chosen = new Map<string, string>();
    const pools = this.loadScenes(project.id).map((scene) => {
      const selection = this.getSelection(project.id, scene.id);
      const locked = selection && userOwnsVisualSelection(selection)
        ? this.findCandidate(selection.candidateId)
        : null;
      const candidates = this.listActiveCandidates(project.id, scene.id)
        .filter((candidate) => this.candidatePassesGate(candidate, visionOn));
      return {
        sceneId: scene.id,
        order: scene.order,
        candidates: candidates.map((candidate) => fromStoredCandidate(candidate)),
        ...(locked && !locked.downloadError ? { lockedCandidate: fromStoredCandidate(locked) } : {}),
      };
    });
    for (const assignment of assignDistinct(pools)) {
      if (!assignment.candidate) continue;
      const stored = this.listActiveCandidates(project.id, assignment.sceneId).find((candidate) =>
        candidate.provider === assignment.candidate?.provider
        && candidate.providerItemId === assignment.candidate.providerItemId);
      if (stored) chosen.set(assignment.sceneId, stored.id);
    }
    return chosen;
  }

  private async visionCandidateFile(
    projectId: string,
    candidate: VisualCandidate,
    signal?: AbortSignal,
  ): Promise<string> {
    if (candidate.localPath) {
      let localPath: string;
      try {
        localPath = resolveAssetPath(this.config.DATA_DIR, projectId, candidate.localPath);
      } catch {
        throw new AppError(422, "VISION_SOURCE_MISSING", "Không có tệp ảnh cục bộ để kiểm tra vision.");
      }
      if (!existsSync(localPath)) {
        throw new AppError(422, "VISION_SOURCE_MISSING", "Không có tệp ảnh cục bộ để kiểm tra vision.");
      }
      if (visionSourceProblem(readFileSync(localPath))) {
        this.persistInvalidSource(candidate);
        throw new AppError(422, "VISION_SOURCE_INVALID", "Ảnh nguồn quá nhỏ hoặc không đọc được, không gửi cho AI nhìn.");
      }
      return localPath;
    }
    try {
      return await this.ensureVisionLocalFile(
        projectId,
        candidate.id,
        candidate.previewUrl || candidate.imageUrl,
        signal,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "VISION_SOURCE_INVALID") this.persistInvalidSource(candidate);
      throw error;
    }
  }

  private persistInvalidSource(candidate: VisualCandidate): void {
    this.sqlite.prepare("UPDATE visual_candidates SET score_breakdown = ? WHERE id = ?").run(
      JSON.stringify({ ...candidate.scoreBreakdown, invalidSource: true }),
      candidate.id,
    );
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
      const status = error instanceof ImageDownloadError ? error.status : undefined;
      const host = error instanceof ImageDownloadError ? error.host : undefined;
      throw new AppError(422, "IMAGE_DOWNLOAD_FAILED", reason, {
        retryable: error instanceof ImageDownloadError && error.retryable && !isNonRetryableHttpStatus(status),
        ...(status !== undefined ? { status } : {}),
        ...(host ? { host } : {}),
      });
    }
    const now = new Date().toISOString();
    const hashed = await hashImage(resolveAssetPath(this.config.DATA_DIR, projectId, stored.localPath));
    this.repository.atomic(() => {
      this.updateCandidateDownload(candidate.id, stored, hashed);
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
      this.clearNeedsAttention(sceneId);
      this.markTimelineStale(projectId);
      this.repository.emitVisualUpdated(projectId, sceneId, "custom-selected");
    });
    return this.getSceneVisuals(projectId, sceneId);
  }

  private updateCandidateDownload(candidateId: string, stored: StoredImage, hashed: { phash: string; phashCenter: string } | null): void {
    this.sqlite.prepare(
      "UPDATE visual_candidates SET local_path = ?, sha256 = ?, bytes = ?, actual_width = ?, actual_height = ?, file_type = ?, downloaded_at = ?, download_error = NULL, phash = ?, phash_center = ? WHERE id = ?",
    ).run(
      stored.localPath,
      stored.sha256,
      stored.bytes,
      stored.width,
      stored.height,
      stored.fileType,
      stored.downloadedAt,
      hashed?.phash ?? null,
      hashed?.phashCenter ?? null,
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
    const enabledProviders = this.resolveProviders(undefined, project).providers;
    const featureSettings = resolveFeatures(this.sqlite, project);
    const stats = createSearchStats();
    let llmCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const llmCallDetails: LlmCallUsage[] = [];
    const inputHashes: string[] = [];
    const sceneSearches: SceneSearchData[] = [];
    const sectionQueries = this.loadSectionQueries(project.id);
    const visionRequired = this.visionRequired(project);
    let reverifiedScenes = 0;

    for (const [index, scene] of scenes.entries()) {
      if (context.signal.aborted) throw context.signal.reason ?? new Error("Visual search was aborted");
      const searchHash = createHash("sha256").update(JSON.stringify([
        scene.visualQueries,
        scene.queryVariant,
        scene.visualDescription,
        scene.visualNotes,
        project.topic,
        project.settings.language,
        project.settings.aspectRatio,
        sectionQueries.get(scene.sectionId ?? ""),
        enabledProviders.map((provider) => provider.id),
        featureSettings.visualSearchBreadth,
      ])).digest("hex");
      inputHashes.push(searchHash);
      const state = this.sqlite.prepare("SELECT search_hash FROM visual_search_state WHERE scene_id = ?")
        .get(scene.id) as { search_hash: string } | undefined;
      const existing = this.getSceneVisuals(project.id, scene.id, true).candidates;
      const selection = this.getSelection(project.id, scene.id);
      const protectedSelection = isProtectedSelection(selection);
      const selectedCandidate = selection ? this.findCandidate(selection.candidateId) : null;
      const hasVision = (candidate: VisualCandidate) =>
        candidate.visionCheck != null || typeof candidate.scoreBreakdown.visionFit === "number";
      const plan = planSceneReuse({
        hashMatches: state?.search_hash === searchHash,
        visionRequired,
        protectedSelection,
        hasValidSelection: Boolean(selectedCandidate && !selectedCandidate.discardedAt
          && this.candidatePassesGate(selectedCandidate, visionRequired)),
        topCandidatesVisionChecked: existing.slice(0, VISION_BATCH_SIZE).map(hasVision),
      });
      if (plan.reuseCandidates) {
        const storedChecks = new Map<string, VisionCheck>();
        for (const candidate of existing) {
          if (candidate.visionCheck) storedChecks.set(`${candidate.provider}:${candidate.providerItemId}`, candidate.visionCheck);
        }
        sceneSearches.push({
          scene,
          queries: [scene.visualQueries.primary, ...scene.visualQueries.alternatives],
          candidates: existing.map((candidate) => fromStoredCandidate(candidate)),
          searchHash,
          unchanged: plan.skip,
          reused: true,
          ...(plan.needsVerify ? { storedChecks } : {}),
          protectedSelection,
        });
        if (plan.needsVerify) reverifiedScenes += 1;
      } else {
        const sceneText = [scene.visualDescription, scene.visualNotes, scene.narration].filter(Boolean).join(" ");
        const { providers: sceneProviders, limits } = this.resolveProviders(undefined, project, sceneText);
        const saved = this.loadVisualCheckpoint(scene.id, searchHash);
        const resolved = saved ?? await this.resolveQueries(
          scene,
          sectionQueries.get(scene.sectionId ?? ""),
          project.settings.aspectRatio,
          project.settings.language,
          sceneProviders,
          stats,
          context.signal,
          project.topic,
          featureSettings.visualSearchBreadth,
          limits,
        );
        if (saved) stats.checkpointHits += 1;
        else this.saveVisualCheckpoint(scene.id, project.id, searchHash, resolved.queries, resolved.candidates);
        sceneSearches.push({
          scene,
          queries: resolved.queries,
          candidates: resolved.candidates,
          searchHash,
          unchanged: false,
          reused: false,
          protectedSelection,
        });
      }
      context.reportProgress(Math.round(((index + 1) / Math.max(1, scenes.length)) * 55), `Searching visuals: scene ${index + 1}/${scenes.length}`);
    }

    if (stats.requests > 0 && stats.failures === stats.requests && stats.unavailableFailures === stats.failures) {
      throw new StageError("All image providers are unavailable", "IMAGE_SEARCH_UNAVAILABLE", true);
    }

    const assistScenes = featureSettings.altQueryAssist
      ? sceneSearches.filter((item) => !item.unchanged && !item.reused && this.relevantCount(
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
          })), new GuidelineService(this.sqlite).guidanceFor(project, ["visuals"])),
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
            ) >= featureSettings.visualSearchBreadth) break;
            item.candidates.push(...await this.searchAcrossProviders(
              this.providerQuery(project.topic, query),
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

    const copyrightMode = visualCopyrightMode(this.sqlite, project.profileId);
    const rankedScenes = sceneSearches.map((item) => {
      const combined = dedupeCandidates(item.candidates);
      let ranked = this.rankVisuals(
        combined,
        item.scene.visualQueries.primary,
        item.scene.visualDescription || item.scene.visualNotes,
        project.settings.language,
        aspectNumber(project.settings.aspectRatio),
        enabledProviders.map((provider) => provider.id),
        copyrightMode,
        [project.topic, item.scene.visualQueries.primary].filter(Boolean),
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

    const budgetFeatures = visualFeaturesFor(resolveBudget(project), this.visualsQualityFor(project));
    let braveImageSearchRequests = 0;
    let webImageGroundingCalls = 0;
    const webCap = webImageSearchSceneCap(budgetFeatures, rankedScenes.length);
    const allowsOptionalWebSearch = () => (currentAutonomyBudget()?.state ?? "normal") === "normal";
    let braveOn = false;
    const webSearched = new Set<string>();
    const webReasons: Array<{ sceneId: string; reason: "low_relevance" | "vision_reject" }> = [];
    const topicWarningIds = new Set<string>();
    if (webCap > 0 && allowsOptionalWebSearch()) {
      const settings = getWebImageSettings(this.sqlite, this.config);
      braveOn = settings.braveEnabled && Boolean(this.config.BRAVE_SEARCH_API_KEY?.trim());
      const groundingOn = settings.geminiGroundingEnabled && Boolean(this.config.GEMINI_API_KEY?.trim());
      const fictional = isFictionalWork({
        topic: project.topic,
        niche: getProfileDirection(this.sqlite, project.profileId),
      });
      const lowScenes = rankedScenes.filter((entry) => {
        if (entry.item.unchanged || entry.item.protectedSelection) return false;
        if (fictional) return true;
        return !entry.ranked[0] || entry.ranked[0].scoreBreakdown.lowRelevance === true;
      }).sort((a, b) => (a.ranked[0]?.scoreBreakdown.keyword ?? 1) - (b.ranked[0]?.scoreBreakdown.keyword ?? 1)).slice(0, webCap);
      if (!braveOn && !groundingOn && lowScenes.length) {
        noteVisualSearchUnavailable(this.sqlite, project.id);
        for (const entry of lowScenes) topicWarningIds.add(entry.item.scene.id);
      }
      if (braveOn || groundingOn) {
        if (lowScenes.length) {
          context.reportProgress(65, `Web image search for ${lowScenes.length} low-relevance scene(s)`);
          const denylist = settings.domainDenylist.length
            ? settings.domainDenylist
            : parseDomainDenylist(this.config.WEB_IMAGE_DOMAIN_DENYLIST);
          const hostLimiter = new HostDownloadRateLimiter(this.config.IMAGE_DOWNLOAD_MIN_INTERVAL_MS);
          const robotsCache = new RobotsCache({
            hostRateLimiter: hostLimiter,
            userAgent: WEB_CRAWL_USER_AGENT,
            signal: context.signal,
          });
          const pageCache = {
            get: (key: string) => this.getCachedRaw(key),
            put: (key: string, value: string) => this.putCachedRaw(key, "web-crawl", key, value),
          };

          // Brave per scene first
          for (const entry of lowScenes) {
            if (!braveOn || !allowsOptionalWebSearch()) break;
            webSearched.add(entry.item.scene.id);
            webReasons.push({ sceneId: entry.item.scene.id, reason: "low_relevance" });
            if (context.signal.aborted) throw context.signal.reason ?? new Error("Visual search was aborted");
            try {
              const brave = new BraveImageProvider(this.config);
              await this.limiter.acquire("brave", context.signal);
              if (!allowsOptionalWebSearch()) break;
              const hits = await brave.search({
                query: this.webQuery(project.topic, entry.item.scene, entry.item.queries[0] ?? entry.item.scene.visualQueries.primary),
                perPage: 20,
                orientation: orientationFor(project.settings.aspectRatio),
                signal: context.signal,
              });
              braveImageSearchRequests += 1;
              const enriched = await enrichBraveCandidates({
                candidates: hits.slice(0, 10),
                denylist,
                config: this.config,
                cache: pageCache,
                robotsCache,
                dependencies: { hostRateLimiter: hostLimiter, signal: context.signal, userAgent: WEB_CRAWL_USER_AGENT },
                signal: context.signal,
              });
              if (enriched.length) {
                const merged = dedupeCandidates([...entry.ranked, ...enriched]);
                entry.ranked = this.rankVisuals(
                  merged,
                  entry.item.scene.visualQueries.primary,
                  entry.item.scene.visualDescription || entry.item.scene.visualNotes,
                  project.settings.language,
                  aspectNumber(project.settings.aspectRatio),
                  [...enabledProviders.map((provider) => provider.id), "brave", "web-grounding"],
                  copyrightMode,
                  [project.topic, entry.item.scene.visualQueries.primary].filter(Boolean),
                ).slice(0, 24);
                entry.item.candidates = entry.ranked.map((candidate) => toNormalizedCandidate(candidate));
              }
            } catch (error) {
              context.logger.warn({ err: error, sceneId: entry.item.scene.id }, "Brave web image search failed");
            }
          }

          // Gemini grounding for scenes still short on usable images
          const stillLow = lowScenes.filter((entry) => {
            const usable = entry.ranked.filter((candidate) => candidate.scoreBreakdown.lowRelevance !== true);
            return usable.length < 3;
          });
          if (groundingOn && stillLow.length) {
            for (let offset = 0; offset < stillLow.length; offset += WEB_IMAGE_GROUNDING_BATCH_SIZE) {
              if (!allowsOptionalWebSearch()) break;
              if (context.signal.aborted) throw context.signal.reason ?? new Error("Visual search was aborted");
              const batch = stillLow.slice(offset, offset + WEB_IMAGE_GROUNDING_BATCH_SIZE);
              try {
                const grounding = await searchPagesWithGeminiGrounding({
                  scenes: batch.map((entry) => ({
                    sceneId: entry.item.scene.id,
                    query: this.webQuery(project.topic, entry.item.scene, entry.item.queries[0] ?? entry.item.scene.visualQueries.primary),
                    alternativeQueries: entry.item.queries.slice(1).map((query) => this.webQuery(project.topic, entry.item.scene, query)),
                  })),
                  config: {
                    ...this.config,
                    WEB_IMAGE_GEMINI_MODEL: settings.geminiModel || this.config.WEB_IMAGE_GEMINI_MODEL,
                  },
                  signal: context.signal,
                  redirectDependencies: { hostRateLimiter: hostLimiter, signal: context.signal },
                });
                webImageGroundingCalls += 1;
                llmCalls += 1;
                llmCallDetails.push({
                  task: "webImageGrounding",
                  provider: "gemini",
                  model: grounding.model || settings.geminiModel || this.config.WEB_IMAGE_GEMINI_MODEL,
                  inputTokens: 0,
                  outputTokens: 0,
                  cached: false,
                  fallback: false,
                  ok: true,
                });
                for (const entry of batch) {
                  const pageUrls = grounding.scenes.find((item) => item.sceneId === entry.item.scene.id)?.pageUrls ?? [];
                  if (!pageUrls.length) continue;
                  const grounded = await crawlPagesToCandidates({
                    pageUrls,
                    query: this.webQuery(project.topic, entry.item.scene, entry.item.queries[0] ?? entry.item.scene.visualQueries.primary),
                    provider: "web-grounding",
                    denylist,
                    config: this.config,
                    cache: pageCache,
                    robotsCache,
                    dependencies: { hostRateLimiter: hostLimiter, signal: context.signal, userAgent: WEB_CRAWL_USER_AGENT },
                    signal: context.signal,
                    whyPrefix: "Gemini grounding",
                  });
                  if (!grounded.length) continue;
                  const merged = dedupeCandidates([...entry.ranked, ...grounded]);
                  entry.ranked = this.rankVisuals(
                    merged,
                    entry.item.scene.visualQueries.primary,
                    entry.item.scene.visualDescription || entry.item.scene.visualNotes,
                    project.settings.language,
                    aspectNumber(project.settings.aspectRatio),
                    [...enabledProviders.map((provider) => provider.id), "brave", "web-grounding"],
                    copyrightMode,
                    [project.topic, entry.item.scene.visualQueries.primary].filter(Boolean),
                  ).slice(0, 24);
                  entry.item.candidates = entry.ranked.map((candidate) => toNormalizedCandidate(candidate));
                }
              } catch (error) {
                context.logger.warn({ err: error }, "Gemini web grounding failed");
                const message = error instanceof Error ? error.message : String(error);
                if (/HTTP (?:404|410)/.test(message)) break;
              }
            }
          }
        }
      }
    }

    const visionMetaByScene = new Map<string, SceneVisionMeta>();
    const visionChecksByCandidateKey = new Map<string, VisionCheck>();
    let visionSkippedTotal = 0;
    let visionBatchFailuresTotal = 0;
    let visionCheckedTotal = 0;
    let visionCheckedWeb = 0;
    const webFailedScenes = new Set<string>();
    const visionUnavailableScenes = new Set<string>();
    const newWebKeysByScene = new Map<string, Set<string>>();
    for (const { item } of rankedScenes) {
      for (const [key, check] of item.storedChecks ?? []) {
        visionChecksByCandidateKey.set(`${item.scene.id}:${key}`, check);
      }
    }
    if (budgetFeatures.visionCheck) {
      requireVisionRoute(llmProviders, project, this.sqlite);
      context.reportProgress(70, "Vision-checking candidate images");
      for (const entry of rankedScenes) {
        if (context.signal.aborted) throw context.signal.reason ?? new Error("Visual search was aborted");
        if (entry.item.unchanged || entry.item.protectedSelection || !entry.ranked.length) continue;
        const labeled = (await Promise.all(entry.ranked.slice(0, 5).map(async (candidate) => {
          const id = `${candidate.provider}:${candidate.providerItemId}`;
          const label = /force-lowfit/i.test(entry.item.scene.label)
            ? `lowfit-${id}`
            : id;
          const localPath = await this.attachVisionFile(
            project.id,
            candidate,
            id,
            candidate.previewUrl || candidate.imageUrl,
            context.signal,
          );
          if (!localPath) return [];
          return [{
            id,
            label,
            localPath,
            relevanceScore: candidate.relevanceScore,
            textRerank: candidate.scoreBreakdown.llmRank,
            candidate,
          }];
        }))).flat();
        const verified = await verifySceneVision({
          project,
          scene: {
            sceneId: entry.item.scene.id,
            narration: entry.item.scene.narration,
            visualDescription: entry.item.scene.visualDescription || entry.item.scene.visualNotes,
            queries: [entry.item.scene.visualQueries.primary, ...entry.item.scene.visualQueries.alternatives],
            candidates: labeled.map(({ id, label, localPath, relevanceScore, textRerank }) => ({
              id, label, localPath, relevanceScore, textRerank,
            })),
          },
          budget: budgetFeatures,
          aspectRatio: project.settings.aspectRatio,
          registry: llmProviders,
          sqlite: this.sqlite,
          config: this.config,
          signal: context.signal,
          logger: context.logger,
          searchMore: async (_sceneId, queries) => {
            const found: VisionCandidateInput[] = [];
            for (const query of queries) {
              const results = await this.searchAcrossProviders(
                this.providerQuery(project.topic, query),
                enabledProviders,
                orientationFor(project.settings.aspectRatio),
                context.signal,
                stats,
              );
              for (const result of results) {
                const id = `${result.provider}:${result.providerItemId}`;
                if (entry.ranked.some((existing) => existing.provider === result.provider && existing.providerItemId === result.providerItemId)) {
                  continue;
                }
                const rankedExtra = this.rankVisuals(
                  [result],
                  entry.item.scene.visualQueries.primary,
                  entry.item.scene.visualDescription || entry.item.scene.visualNotes,
                  project.settings.language,
                  aspectNumber(project.settings.aspectRatio),
                  enabledProviders.map((provider) => provider.id),
                  copyrightMode,
                  [project.topic, entry.item.scene.visualQueries.primary].filter(Boolean),
                );
                const candidate = rankedExtra[0];
                if (!candidate) continue;
                entry.ranked.push(candidate);
                const localPath = await this.attachVisionFile(
                  project.id,
                  candidate,
                  id,
                  candidate.previewUrl || candidate.imageUrl,
                  context.signal,
                );
                if (!localPath) continue;
                found.push({
                  id,
                  label: /force-lowfit/i.test(entry.item.scene.label) ? `lowfit-${id}` : `highfit-${id}`,
                  localPath,
                  relevanceScore: candidate.relevanceScore,
                });
              }
            }
            return found;
          },
        });
        llmCalls += verified.usage.llmCalls;
        inputTokens += verified.usage.inputTokens;
        outputTokens += verified.usage.outputTokens;
        llmCallDetails.push(...verified.usage.calls);
        visionSkippedTotal += verified.visionSkipped;
        visionBatchFailuresTotal += verified.visionBatchFailures;
        visionCheckedTotal += verified.checks.size;
        for (const [key, check] of verified.checks) {
          visionChecksByCandidateKey.set(`${entry.item.scene.id}:${key}`, check);
          const score = verified.scores.get(key);
          const match = entry.ranked.find((candidate) => `${candidate.provider}:${candidate.providerItemId}` === key);
          if (match && score !== undefined) {
            match.relevanceScore = score;
            match.scoreBreakdown = { ...match.scoreBreakdown, visionFit: check.fit, total: score };
          }
        }
        entry.ranked = [...entry.ranked].sort((a, b) => b.relevanceScore - a.relevanceScore)
          .map((candidate, rank) => ({ ...candidate, rank }));
        visionMetaByScene.set(entry.item.scene.id, {
          needsAttention: verified.needsAttention,
          reason: verified.needsAttention ? (verified.reason || "vision_reject") : verified.reason,
          reSearchHistory: verified.reSearchHistory,
          verifiedFit: verified.bestFit,
        });
      }

      const rejected = rankedScenes.filter((entry) => {
        const meta = visionMetaByScene.get(entry.item.scene.id);
        return meta?.needsAttention === true && !webSearched.has(entry.item.scene.id) && !entry.item.unchanged && !entry.item.protectedSelection;
      }).sort((a, b) => (a.ranked[0]?.scoreBreakdown.keyword ?? 1) - (b.ranked[0]?.scoreBreakdown.keyword ?? 1))
        .slice(0, Math.max(0, webCap - webSearched.size));
      if (braveOn && allowsOptionalWebSearch() && rejected.length) {
        for (const entry of rejected) {
          if (!allowsOptionalWebSearch()) break;
          webSearched.add(entry.item.scene.id);
          webReasons.push({ sceneId: entry.item.scene.id, reason: "vision_reject" });
          try {
            const brave = new BraveImageProvider(this.config);
            await this.limiter.acquire("brave", context.signal);
            const hits = await brave.search({
              query: this.webQuery(project.topic, entry.item.scene, entry.item.queries[0] ?? entry.item.scene.visualQueries.primary),
              perPage: 20,
              orientation: orientationFor(project.settings.aspectRatio),
              signal: context.signal,
            });
            braveImageSearchRequests += 1;
            if (hits.length) {
              const before = new Set(entry.ranked.map((candidate) => `${candidate.provider}:${candidate.providerItemId}`));
              const hitKeys = new Set(hits.slice(0, 10).map((hit) => `${hit.provider}:${hit.providerItemId}`));
              entry.ranked = this.rankVisuals(
                dedupeCandidates([...entry.ranked, ...hits.slice(0, 10)]),
                entry.item.scene.visualQueries.primary,
                entry.item.scene.visualDescription || entry.item.scene.visualNotes,
                project.settings.language,
                aspectNumber(project.settings.aspectRatio),
                [...enabledProviders.map((provider) => provider.id), "brave"],
                copyrightMode,
                [project.topic, entry.item.scene.visualQueries.primary].filter(Boolean),
              ).slice(0, 24);
              const fresh = new Set(entry.ranked
                .map((candidate) => `${candidate.provider}:${candidate.providerItemId}`)
                .filter((key) => hitKeys.has(key) && !before.has(key)));
              if (fresh.size) newWebKeysByScene.set(entry.item.scene.id, fresh);
            }
          } catch (error) {
            webFailedScenes.add(entry.item.scene.id);
            context.logger.warn({ err: error, sceneId: entry.item.scene.id }, "Brave search after vision reject failed");
          }
        }
      }

      // TASK-126: web hits added after a vision reject get the same vision check. The gate is not loosened.
      for (const [sceneId, freshKeys] of newWebKeysByScene) {
        if (context.signal.aborted) throw context.signal.reason ?? new Error("Visual search was aborted");
        const entry = rankedScenes.find((candidateScene) => candidateScene.item.scene.id === sceneId);
        if (!entry) continue;
        const toCheck = entry.ranked
          .filter((candidate) => freshKeys.has(`${candidate.provider}:${candidate.providerItemId}`)
            && !visionChecksByCandidateKey.has(`${sceneId}:${candidate.provider}:${candidate.providerItemId}`))
          .slice(0, VISION_BATCH_SIZE);
        if (!toCheck.length) continue;
        if (!allowsOptionalWebSearch()) {
          visionUnavailableScenes.add(sceneId);
          continue;
        }
        try {
          const labeled = (await Promise.all(toCheck.map(async (candidate) => {
            const id = `${candidate.provider}:${candidate.providerItemId}`;
            const localPath = await this.attachVisionFile(
              project.id,
              candidate,
              id,
              candidate.previewUrl || candidate.imageUrl,
              context.signal,
            );
            if (!localPath) return [];
            return [{
              id,
              label: /force-lowfit/i.test(entry.item.scene.label) ? `lowfit-${id}` : id,
              localPath,
              relevanceScore: candidate.relevanceScore,
              textRerank: candidate.scoreBreakdown.llmRank,
            }];
          }))).flat();
          if (!labeled.length) {
            visionUnavailableScenes.add(sceneId);
            continue;
          }
          const verified = await verifySceneVision({
            project,
            scene: {
              sceneId,
              narration: entry.item.scene.narration,
              visualDescription: entry.item.scene.visualDescription || entry.item.scene.visualNotes,
              queries: [entry.item.scene.visualQueries.primary, ...entry.item.scene.visualQueries.alternatives],
              candidates: labeled,
            },
            budget: { ...budgetFeatures, visionRetryRounds: 0 },
            aspectRatio: project.settings.aspectRatio,
            registry: llmProviders,
            sqlite: this.sqlite,
            config: this.config,
            signal: context.signal,
            logger: context.logger,
            searchMore: async () => [],
          });
          llmCalls += verified.usage.llmCalls;
          inputTokens += verified.usage.inputTokens;
          outputTokens += verified.usage.outputTokens;
          llmCallDetails.push(...verified.usage.calls);
          visionSkippedTotal += verified.visionSkipped;
          visionBatchFailuresTotal += verified.visionBatchFailures;
          visionCheckedTotal += verified.checks.size;
          visionCheckedWeb += verified.checks.size;
          for (const [key, check] of verified.checks) {
            visionChecksByCandidateKey.set(`${sceneId}:${key}`, check);
            const score = verified.scores.get(key);
            const match = entry.ranked.find((candidate) => `${candidate.provider}:${candidate.providerItemId}` === key);
            if (match && score !== undefined) {
              match.relevanceScore = score;
              match.scoreBreakdown = { ...match.scoreBreakdown, visionFit: check.fit, total: score };
            }
          }
          entry.ranked = [...entry.ranked].sort((a, b) => b.relevanceScore - a.relevanceScore)
            .map((candidate, rank) => ({ ...candidate, rank }));
          if (verified.checks.size === 0) {
            visionUnavailableScenes.add(sceneId);
          } else if (!verified.needsAttention) {
            const previous = visionMetaByScene.get(sceneId);
            visionMetaByScene.set(sceneId, {
              ...previous,
              needsAttention: false,
              reason: undefined,
              cause: undefined,
              verifiedFit: verified.bestFit,
            });
          }
        } catch (error) {
          if (context.signal.aborted) throw error;
          visionUnavailableScenes.add(sceneId);
          context.logger.warn({ err: error, sceneId }, "Vision check of web images failed; they stay unverified");
        }
      }

      // TASK-126: one clear cause per scene that still has no passing image.
      for (const entry of rankedScenes) {
        const sceneId = entry.item.scene.id;
        if (entry.item.unchanged || entry.item.protectedSelection) continue;
        const meta = visionMetaByScene.get(sceneId);
        if (!entry.ranked.length) {
          visionMetaByScene.set(sceneId, {
            ...meta,
            needsAttention: true,
            reason: "no_candidate",
            cause: "no_candidates",
          });
          continue;
        }
        if (meta?.needsAttention !== true) continue;
        const cause = visionUnavailableScenes.has(sceneId)
          ? "vision_unavailable"
          : webFailedScenes.has(sceneId) ? "web_failed" : "vision_reject";
        visionMetaByScene.set(sceneId, {
          ...meta,
          cause,
          ...(cause === "vision_unavailable" ? { reason: "vision_missing" } : {}),
        });
      }

      const consistencyScenes = rankedScenes.flatMap(({ item, ranked }) => {
        const top = ranked[0];
        if (!top) return [];
        const key = `${top.provider}:${top.providerItemId}`;
        const meta = visionMetaByScene.get(item.scene.id);
        if (meta?.needsAttention) return [];
        const local = join(projectDir(this.config.DATA_DIR, project.id), "vision-cache", `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.jpg`);
        if (!existsSync(local)) return [];
        return [{
          sceneId: item.scene.id,
          label: item.scene.label,
          visualDescription: item.scene.visualDescription || item.scene.visualNotes,
          imageLabel: key,
          localPath: local,
        }];
      });
      if (consistencyScenes.length) {
        const consistency = await runConsistencyCheck({
          project,
          scenes: consistencyScenes,
          registry: llmProviders,
          sqlite: this.sqlite,
          config: this.config,
          signal: context.signal,
          logger: context.logger,
        });
        llmCalls += consistency.usage.llmCalls;
        inputTokens += consistency.usage.inputTokens;
        outputTokens += consistency.usage.outputTokens;
        llmCallDetails.push(...consistency.usage.calls);
        for (const [sceneId, reasons] of consistency.flags) {
          const meta = visionMetaByScene.get(sceneId) ?? {};
          visionMetaByScene.set(sceneId, {
            ...meta,
            needsAttention: true,
            reason: meta.reason ?? reasons[0],
            consistencyFlags: reasons,
          });
        }
      }
    }

    const domainDenylist = this.domainDenylist();
    const assignPool = (item: typeof rankedScenes[number]["item"], ranked: typeof rankedScenes[number]["ranked"]) => {
      const currentSelection = this.getSelection(project.id, item.scene.id);
      const selectedCandidate = currentSelection && item.protectedSelection
        ? this.findCandidate(currentSelection.candidateId)
        : null;
      return {
        sceneId: item.scene.id,
        order: item.scene.order,
        candidates: ranked.filter((candidate) => {
          const check = visionChecksByCandidateKey.get(`${item.scene.id}:${candidate.provider}:${candidate.providerItemId}`);
          return this.rankedCandidateAllowed(
            candidate,
            check,
            budgetFeatures.visionCheck,
            budgetFeatures.visionThreshold,
            domainDenylist,
          );
        }),
        ...(selectedCandidate && !selectedCandidate.downloadError
          ? { lockedCandidate: fromStoredCandidate(selectedCandidate) }
          : {}),
      };
    };
    for (const entry of rankedScenes) {
      entry.ranked = dedupeCandidates(entry.ranked);
    }
    let selections = assignDistinct(rankedScenes.map(({ item, ranked }) => assignPool(item, ranked)));
    const extraRounds: Array<{ sceneId: string; queries: string[]; found: number }> = [];
    if (selections.some((assignment) => assignment.needsMoreSearch)) {
      for (const entry of rankedScenes) {
        if (!selections.some((assignment) => assignment.sceneId === entry.item.scene.id && assignment.needsMoreSearch)) continue;
        if (entry.item.protectedSelection) continue;
        const tried = new Set(entry.item.queries);
        const extras = entry.item.scene.visualQueries.alternatives
          .map((query) => stripQueryModifiers(query.trim()))
          .filter((query) => query && !tried.has(query))
          .slice(0, 3);
        if (!extras.length) continue;
        const found: NormalizedImageResult[] = [];
        for (const query of extras) {
          found.push(...await this.searchAcrossProviders(
            this.providerQuery(project.topic, query),
            enabledProviders,
            orientationFor(project.settings.aspectRatio),
            context.signal,
            stats,
          ));
        }
        extraRounds.push({ sceneId: entry.item.scene.id, queries: extras, found: found.length });
        if (!found.length) continue;
        entry.ranked = this.rankVisuals(
          dedupeCandidates([...entry.ranked, ...found]),
          entry.item.scene.visualQueries.primary,
          entry.item.scene.visualDescription || entry.item.scene.visualNotes,
          project.settings.language,
          aspectNumber(project.settings.aspectRatio),
          enabledProviders.map((provider) => provider.id),
          copyrightMode,
          [project.topic, entry.item.scene.visualQueries.primary].filter(Boolean),
        ).slice(0, 24);
        entry.item.queries.push(...extras);
      }
      for (const entry of rankedScenes) {
        entry.ranked = dedupeCandidates(entry.ranked);
      }
      selections = assignDistinct(rankedScenes.map(({ item, ranked }) => assignPool(item, ranked)));
    }
    let candidateCount = 0;
    const autoSelectedUnsplash: VisualCandidate[] = [];
    const replacedAgent = new Map<string, string>();
    this.repository.atomic(() => {
      for (const { item, ranked } of rankedScenes) {
        if (!item.unchanged) {
          const currentSelection = this.getSelection(project.id, item.scene.id);
          const keepSelection = isProtectedSelection(currentSelection);
          if (currentSelection?.selectedBy === "AGENT" && !keepSelection) {
            replacedAgent.set(item.scene.id, currentSelection.candidateId);
          }
          const keptId = keepSelection && currentSelection ? currentSelection.candidateId : null;
          this.sqlite.prepare(
            "DELETE FROM visual_candidates WHERE scene_id = ? AND (? IS NULL OR id != ?)",
          ).run(item.scene.id, keptId, keptId);
          if (!keepSelection) {
            this.sqlite.prepare("DELETE FROM visual_selections WHERE scene_id = ? AND slot = 0").run(item.scene.id);
          }
          ranked.forEach((candidate) => {
            const key = `${candidate.provider}:${candidate.providerItemId}`;
            const visionCheck = visionChecksByCandidateKey.get(`${item.scene.id}:${key}`) ?? null;
            this.saveCandidate({
              ...candidate,
              id: randomUUID(),
              projectId: project.id,
              sceneId: item.scene.id,
              origin: "SEARCH",
              query: candidate.searchQuery ?? item.scene.visualQueries.primary,
              licenseVerified: candidate.licenseVerified ?? true,
              discardedAt: null,
              createdAt: new Date().toISOString(),
              searchHash: item.searchHash,
              visionCheck,
            });
          });
          const visionMeta = visionMetaByScene.get(item.scene.id) ?? (topicWarningIds.has(item.scene.id)
            ? { needsAttention: true, reason: "Ảnh có thể không đúng chủ đề — bật Brave hoặc tự chọn ảnh" }
            : null);
          this.sqlite.prepare(
            "INSERT INTO visual_search_state (scene_id, project_id, search_hash, vision_meta, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scene_id) DO UPDATE SET search_hash = excluded.search_hash, vision_meta = excluded.vision_meta, updated_at = excluded.updated_at",
          ).run(item.scene.id, project.id, item.searchHash, visionMeta ? JSON.stringify(visionMeta) : null, new Date().toISOString());
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
        if (item.protectedSelection) continue;
        let replacedFrom = replacedAgent.get(assignment.sceneId);
        if (item.unchanged) {
          const current = this.getSelection(project.id, assignment.sceneId);
          if (!current || userOwnsVisualSelection(current) || current.candidateId === selected.id) continue;
          const currentCandidate = this.findCandidate(current.candidateId);
          const ranked = rankedScenes.find((entry) => entry.item.scene.id === assignment.sceneId)?.ranked ?? [];
          const pickIndex = ranked.findIndex((candidate) =>
            candidate.provider === selected.provider && candidate.providerItemId === selected.providerItemId);
          const currentIndex = currentCandidate
            ? ranked.findIndex((candidate) =>
              candidate.provider === currentCandidate.provider && candidate.providerItemId === currentCandidate.providerItemId)
            : -1;
          const currentFails = !currentCandidate || !this.candidatePassesGate(currentCandidate, budgetFeatures.visionCheck);
          const betterRank = pickIndex >= 0 && (currentIndex < 0 || pickIndex < currentIndex);
          if (!currentFails && !betterRank) continue;
          if (!this.candidatePassesGate(selected, budgetFeatures.visionCheck)) continue;
          replacedFrom = current.candidateId;
        }
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
        const previousId = replacedFrom;
        if (previousId && previousId !== selected.id) {
          const meta = this.getVisionMeta(assignment.sceneId) ?? {};
          const nextMeta = {
            ...meta,
            selectionHistory: [
              ...(meta.selectionHistory ?? []),
              { at: now, fromCandidateId: previousId, toCandidateId: selected.id },
            ],
          };
          this.sqlite.prepare(
            "UPDATE visual_search_state SET vision_meta = ?, updated_at = ? WHERE scene_id = ?",
          ).run(JSON.stringify(nextMeta), now, assignment.sceneId);
        }
        autoSelectedUnsplash.push(selected);
      }
    });
    this.sqlite.prepare("DELETE FROM visual_search_checkpoints WHERE project_id = ?").run(project.id);
    for (const selected of autoSelectedUnsplash) {
      await this.pingUnsplashDownload(selected);
    }
    const missingDistinct = selections.filter((assignment) => assignment.needsMoreSearch);
    if (missingDistinct.length) {
      noteMissingDistinctVisual(this.sqlite, project.id, missingDistinct.length);
      this.autoReport?.add(project.id, {
        stage: "VISUAL_SEARCH",
        sceneId: missingDistinct[0]?.sceneId ?? null,
        code: "VISUAL_EXTRA_SEARCH",
        severity: "WARN",
        message: `${missingDistinct.length} cảnh chưa có ảnh riêng.`,
        data: { sceneIds: missingDistinct.map((assignment) => assignment.sceneId), rounds: extraRounds },
      });
    }

    if (braveImageSearchRequests > 0) {
      recordAutomaticMediaCost(this.sqlite, {
        profileId: project.profileId,
        projectId: project.id,
        amountUsd: braveImageSearchRequests * BRAVE_IMAGE_REQUEST_USD,
        note: "Tìm ảnh Brave",
      });
    }
    context.recordUsage({
      llmCalls,
      inputTokens,
      outputTokens,
      ...(llmCallDetails.length ? { calls: llmCallDetails } : {}),
      features: {
        imageProviderRequests: stats.requests,
        imageCacheHits: stats.cacheHits,
        ...(braveImageSearchRequests ? { braveImageSearchRequests } : {}),
        ...(webReasons.length ? { webSearchReasons: webReasons.length } : {}),
        ...(webImageGroundingCalls ? { webImageGroundingCalls } : {}),
      },
    });
    const cacheHits = stats.cacheHits;
    const projectVisuals = this.getProjectVisuals(project.id);
    const relevantSelections = projectVisuals.scenes.filter((scene) => scene.selectedCandidate
      && scene.selectedCandidate.scoreBreakdown.lowRelevance !== true).length;
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1_000);
    const requestSummary = enabledProviders.map((provider) => {
      if (stats.blockedProviders.has(provider.id)) {
        return `${provider.id}: ${stats.blockedReasons[provider.id] ?? "blocked (Cloudflare)"}`;
      }
      const short = provider.id === "wikimedia" ? "W" : provider.id === "openverse" ? "O" : provider.id === "pexels" ? "P" : provider.id;
      return `${short} ${stats.requestsByProvider[provider.id] ?? 0}`;
    }).join(" / ");
    const reasonSummary = webReasons.map((item) => `${item.reason}:${item.sceneId.slice(0, 8)}`).join(" ");
    const reused = stats.checkpointHits > 0 ? ` · dùng lại ${stats.checkpointHits} cảnh đã tìm` : "";
    const visionSkipNote = visionSkippedTotal > 0
      ? ` · Vision: ${visionSkippedTotal} ảnh không đọc được kết quả${visionBatchFailuresTotal ? `, ${visionBatchFailuresTotal} batch lỗi` : ""}, cần bạn xem`
      : "";
    const visionNote = visionRequired
      ? ` · vision checked ${visionCheckedTotal} (web ${visionCheckedWeb})${reverifiedScenes ? ` · re-verified ${reverifiedScenes} scene(s) from stored candidates` : ""}`
      : "";
    const causeCounts: Record<string, number> = {};
    for (const meta of visionMetaByScene.values()) {
      if (meta.needsAttention && meta.cause) causeCounts[meta.cause] = (causeCounts[meta.cause] ?? 0) + 1;
    }
    const causeSummary = Object.entries(causeCounts).map(([cause, count]) => `${cause} ${count}`).join(", ");
    const noneReason = visionRequired && relevantSelections === 0 && scenes.length > 0
      ? ` · 0 selected${causeSummary ? `: ${causeSummary}` : ": every scene was skipped as unchanged or kept by the user"}`
      : causeSummary ? ` · needs attention: ${causeSummary}` : "";
    const message = `${scenes.length} scenes · ${relevantSelections} relevant · ${candidateCount} candidates · requests ${requestSummary} · cache ${cacheHits} · LLM calls ${llmCalls} · ${elapsedSeconds} s${reused}${visionNote}${visionSkipNote}${noneReason}${reasonSummary ? ` · web ${reasonSummary}` : ""}`;
    context.reportProgress(100, message);
    return {
      outputHash: createHash("sha256").update(inputHashes.join("")).digest("hex"),
      message,
    };
  }

  private loadVisualCheckpoint(sceneId: string, searchHash: string): { queries: string[]; candidates: NormalizedImageResult[] } | null {
    const row = this.sqlite.prepare(
      "SELECT queries, candidates, created_at FROM visual_search_checkpoints WHERE scene_id = ? AND search_hash = ?",
    ).get(sceneId, searchHash) as { queries: string; candidates: string; created_at: string } | undefined;
    if (!row) return null;
    const age = Date.now() - Date.parse(row.created_at);
    if (!Number.isFinite(age) || age < 0 || age >= VISUAL_CHECKPOINT_MAX_AGE_MS) return null;
    const queries = parseCheckpoint<string[]>(row.queries);
    const candidates = parseCheckpoint<NormalizedImageResult[]>(row.candidates);
    if (!queries || !candidates) return null;
    return { queries, candidates };
  }

  private saveVisualCheckpoint(
    sceneId: string,
    projectId: string,
    searchHash: string,
    queries: string[],
    candidates: NormalizedImageResult[],
  ): void {
    this.sqlite.prepare(
      `INSERT INTO visual_search_checkpoints (scene_id, project_id, search_hash, queries, candidates, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scene_id) DO UPDATE SET
         project_id = excluded.project_id,
         search_hash = excluded.search_hash,
         queries = excluded.queries,
         candidates = excluded.candidates,
         created_at = excluded.created_at`,
    ).run(sceneId, projectId, searchHash, JSON.stringify(queries), JSON.stringify(candidates), new Date().toISOString());
  }

  private async resolveQueries(
    scene: Scene,
    sectionPrimary: string | undefined,
    aspectRatio: Project["settings"]["aspectRatio"],
    language: Project["settings"]["language"],
    providers: ImageSearchProvider[],
    stats: SearchStats,
    signal: AbortSignal,
    topic: string,
    breadth = 8,
    limits?: Partial<Record<string, number>>,
  ): Promise<{ queries: string[]; candidates: NormalizedImageResult[] }> {
    const queries: string[] = [];
    const results: NormalizedImageResult[] = [];
    const seenQueries = new Set<string>();
    const entity = workEntity(topic);
    const rawPrimary = stripQueryModifiers(scene.visualQueries.primary);
    const rawAlternatives = scene.visualQueries.alternatives.map(stripQueryModifiers).filter(Boolean);
    const primary = ensureEntityPrefix(rawPrimary, entity);
    const alternatives = rawAlternatives.map((query) => ensureEntityPrefix(query, entity));
    const search = async (query: string, ladderStep: number): Promise<void> => {
      const stripped = stripQueryModifiers(query);
      if (!stripped) return;
      const cleanQuery = ensureEntityPrefix(stripped, entity);
      const key = normalizeQuery(cleanQuery);
      if (!key || seenQueries.has(key) || this.relevantCount(
        results,
        scene.visualQueries.primary,
        scene.visualDescription || scene.visualNotes,
        language,
        aspectRatio,
        providers.map((provider) => provider.id),
      ) >= breadth) return;
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
        limits,
      ));
    };
    await search(primary, 1);
    for (const query of alternatives) await search(query, 2);
    await search(simplifyQuery(rawPrimary), 3);
    for (const query of properNounQueries([rawPrimary, ...rawAlternatives])) await search(query, 4);
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
    limits?: Partial<Record<string, number>>,
  ): Promise<NormalizedImageResult[]> {
    const providerResults = await Promise.all(providers.map(async (provider) => {
      if (signal?.aborted) throw signal.reason ?? new Error("Visual search was aborted");
      if (stats.blockedProviders.has(provider.id)) return [];
      const perPage = limits?.[provider.id] ?? 10;
      const cacheKey = createHash("sha256").update(JSON.stringify([
        provider.id,
        normalizeQuery(query),
        perPage,
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
        const found = await provider.search({ query, perPage, orientation, signal });
        stats.consecutive403ByProvider[provider.id] = 0;
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
        this.noteProviderSearchFailure(provider.id, error, stats);
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

  /** Per-run circuit breaker: one Cloudflare block or two consecutive HTTP 403s → skip provider. */
  private noteProviderSearchFailure(providerId: string, error: unknown, stats: SearchStats): void {
    if (error instanceof ImageProviderBlockedError) {
      this.blockProviderForRun(providerId, stats, "blocked (Cloudflare)");
      return;
    }
    if (error instanceof ImageProviderError && (error.status === 404 || error.status === 410)) {
      this.blockProviderForRun(providerId, stats, `unavailable (HTTP ${error.status})`);
      return;
    }
    if (error instanceof ImageProviderError && error.status === 403) {
      const count = (stats.consecutive403ByProvider[providerId] ?? 0) + 1;
      stats.consecutive403ByProvider[providerId] = count;
      if (count >= 2) {
        this.blockProviderForRun(providerId, stats, "blocked (HTTP 403)");
        return;
      }
      this.logger?.warn({ err: error, provider: providerId }, "Image provider search failed");
      return;
    }
    stats.consecutive403ByProvider[providerId] = 0;
    this.logger?.warn({ err: error, provider: providerId }, "Image provider search failed");
  }

  private blockProviderForRun(providerId: string, stats: SearchStats, reason = "blocked (Cloudflare)"): void {
    if (stats.blockedProviders.has(providerId)) return;
    stats.blockedProviders.add(providerId);
    stats.blockedReasons[providerId] = reason;
    try {
      recordImageSourceBlocked(this.sqlite, providerId);
    } catch (error) {
      this.logger?.warn({ err: error, provider: providerId }, "Failed to persist image source block health");
    }
    this.logger?.warn({ provider: providerId }, "Image provider blocked for rest of stage run");
  }

  private resolveProviders(
    ids?: string[],
    project?: Project,
    sceneText?: string,
  ): { providers: ImageSearchProvider[]; limits?: Partial<Record<string, number>> } {
    const settingsFiltered = this.registry.list().filter((provider) =>
      isImageSourceEnabledInSettings(this.sqlite, provider.id));
    let providers = ids
      ? ids.map((id) => {
        const provider = this.registry.get(id);
        if (!provider) throw new AppError(400, "INVALID_IMAGE_PROVIDER", `Image provider "${id}" is not enabled.`);
        if (!isImageSourceEnabledInSettings(this.sqlite, id)) {
          throw new AppError(400, "INVALID_IMAGE_PROVIDER", `Image provider "${id}" is disabled in settings.`);
        }
        return provider;
      })
      : settingsFiltered;
    let limits: Partial<Record<string, number>> | undefined;
    if (project && !ids) {
      const plan = preferredSources(
        {
          topic: project.topic,
          style: project.settings.style,
          sceneText,
        },
        { sceneText },
      );
      const byId = new Map(providers.map((provider) => [provider.id, provider]));
      const ordered: ImageSearchProvider[] = [];
      for (const id of plan.order) {
        const provider = byId.get(id);
        if (provider) {
          ordered.push(provider);
          byId.delete(id);
        }
      }
      for (const provider of byId.values()) ordered.push(provider);
      providers = ordered;
      limits = plan.limits;
    }
    if (providers.length === 0) throw new AppError(503, "IMAGE_SEARCH_UNAVAILABLE", "No image search providers are enabled.");
    return { providers, limits };
  }

  private async pingUnsplashDownload(candidate: VisualCandidate): Promise<void> {
    if (candidate.provider !== "unsplash") return;
    if (candidate.scoreBreakdown.unsplashDownloadPinged === true) return;
    const location = typeof candidate.scoreBreakdown.unsplashDownloadLocation === "string"
      ? candidate.scoreBreakdown.unsplashDownloadLocation
      : undefined;
    if (!location || !this.config.UNSPLASH_ACCESS_KEY?.trim()) return;
    try {
      const provider = new UnsplashImageProvider(this.config);
      await provider.trackDownload(location);
      const nextBreakdown = {
        ...candidate.scoreBreakdown,
        unsplashDownloadPinged: true,
      };
      this.sqlite.prepare("UPDATE visual_candidates SET score_breakdown = ? WHERE id = ?")
        .run(JSON.stringify(nextBreakdown), candidate.id);
    } catch (error) {
      this.logger?.warn({ err: error, candidateId: candidate.id }, "Unsplash download ping failed");
    }
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

  private getCachedRaw(key: string): string | undefined {
    const row = this.sqlite.prepare("SELECT response, created_at FROM image_search_cache WHERE key = ?")
      .get(key) as CacheRow | undefined;
    if (!row) return undefined;
    const age = Date.now() - Date.parse(row.created_at);
    if (age > this.config.IMAGE_SEARCH_CACHE_TTL_HOURS * 3_600_000) {
      this.sqlite.prepare("DELETE FROM image_search_cache WHERE key = ?").run(key);
      return undefined;
    }
    return typeof row.response === "string" ? row.response : JSON.stringify(row.response);
  }

  private putCachedRaw(key: string, provider: string, query: string, response: string): void {
    this.sqlite.prepare(
      "INSERT INTO image_search_cache (key, provider, query, response, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at",
    ).run(key, provider, query, response, new Date().toISOString());
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
    copyrightMode: "off" | "commentary" = "off",
    entities: string[] = [],
  ) {
    const unsplashMeta = new Map<string, { location?: string; pinged?: boolean }>();
    for (const candidate of candidates) {
      const key = `${candidate.provider}:${candidate.providerItemId}`;
      const fromResult = "downloadLocation" in candidate
        && typeof candidate.downloadLocation === "string"
        ? candidate.downloadLocation
        : undefined;
      const breakdown = "scoreBreakdown" in candidate ? candidate.scoreBreakdown : undefined;
      const location = fromResult
        ?? (typeof breakdown?.unsplashDownloadLocation === "string" ? breakdown.unsplashDownloadLocation : undefined);
      const pinged = breakdown?.unsplashDownloadPinged === true;
      if (location || pinged) unsplashMeta.set(key, { location, pinged });
    }
    const rankable = candidates.map((candidate) => {
      const savedPosition = "scoreBreakdown" in candidate
        && typeof candidate.scoreBreakdown.providerPosition === "number"
        ? candidate.scoreBreakdown.providerPosition
        : undefined;
      return {
        ...candidate,
        aspectRatio: candidate.width / candidate.height,
        watermark: stockWatermarkSuspected({
          sourceSite: candidate.sourceSite,
          imageUrl: candidate.imageUrl,
          sourceUrl: candidate.sourceUrl,
          sourcePageUrl: candidate.sourcePageUrl,
        }) ? "SUSPECTED" : candidate.watermark,
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
        copyrightMode,
        entities,
      },
    ).map((item) => {
      const meta = unsplashMeta.get(`${item.provider}:${item.providerItemId}`);
      if (!meta) return item;
      return {
        ...item,
        scoreBreakdown: {
          ...item.scoreBreakdown,
          ...(meta.location ? { unsplashDownloadLocation: meta.location } : {}),
          ...(meta.pinged ? { unsplashDownloadPinged: true } : {}),
        },
      };
    });
  }

  private toCandidate(
    result: NormalizedImageResult,
    project: Project,
    scene: Scene,
    query: string,
    searchHash: string,
  ): VisualCandidate {
    const { providerPosition = 0, searchQuery, downloadLocation, ...candidateResult } = result;
    return VisualCandidateSchema.parse({
      id: randomUUID(),
      projectId: project.id,
      sceneId: scene.id,
      origin: "SEARCH",
      ...candidateResult,
      query: searchQuery ?? query,
      aspectRatio: result.width / result.height,
      relevanceScore: 0,
      scoreBreakdown: {
        providerPosition,
        ...(downloadLocation ? { unsplashDownloadLocation: downloadLocation } : {}),
      },
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
      `INSERT INTO visual_candidates (id, project_id, scene_id, origin, provider, provider_item_id, source_provider, query, title, description, tags, preview_url, image_url, source_url, source_page_url, source_site, width, height, aspect_ratio, file_type, watermark, relevance_score, score_breakdown, license, license_verified, why, rank, discarded_at, created_at, search_hash, local_path, sha256, bytes, actual_width, actual_height, downloaded_at, download_error, vision_check)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET query=excluded.query, title=excluded.title, description=excluded.description, tags=excluded.tags,
       preview_url=excluded.preview_url, image_url=excluded.image_url, source_url=excluded.source_url, source_page_url=excluded.source_page_url, source_site=excluded.source_site,
       width=excluded.width, height=excluded.height, aspect_ratio=excluded.aspect_ratio, file_type=excluded.file_type,
       watermark=excluded.watermark, relevance_score=excluded.relevance_score, score_breakdown=excluded.score_breakdown,
       license=excluded.license, license_verified=excluded.license_verified, why=excluded.why, rank=excluded.rank, search_hash=excluded.search_hash, vision_check=COALESCE(excluded.vision_check, visual_candidates.vision_check)`,
    ).run(
      id, candidate.projectId, candidate.sceneId, candidate.origin, candidate.provider, candidate.providerItemId,
      candidate.sourceProvider ?? null, candidate.query, candidate.title, candidate.description, JSON.stringify(candidate.tags),
      candidate.previewUrl, candidate.imageUrl, candidate.sourceUrl, candidate.sourcePageUrl ?? null, candidate.sourceSite,
      candidate.width, candidate.height,
      candidate.aspectRatio, candidate.fileType, candidate.watermark, candidate.relevanceScore,
      JSON.stringify(candidate.scoreBreakdown), JSON.stringify(candidate.license),
      candidate.licenseVerified !== false ? 1 : 0, candidate.why ?? null,
      candidate.rank, candidate.discardedAt,
      candidate.createdAt, candidate.searchHash ?? "",
      candidate.localPath ?? null, candidate.sha256 ?? null, candidate.bytes ?? null,
      candidate.actualWidth ?? null, candidate.actualHeight ?? null, candidate.downloadedAt ?? null,
      candidate.downloadError ?? null,
      candidate.visionCheck ? JSON.stringify(candidate.visionCheck) : null,
    );
  }

  private candidateFromRow(row: Record<string, unknown>): VisualCandidate {
    const visionRaw = row.vision_check;
    const visionParsed = visionRaw
      ? VisionCheckSchema.safeParse(typeof visionRaw === "string" ? JSON.parse(visionRaw) : visionRaw)
      : null;
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
      ...(row.source_page_url ? { sourcePageUrl: row.source_page_url } : {}),
      sourceSite: row.source_site,
      width: row.width,
      height: row.height,
      aspectRatio: row.aspect_ratio,
      fileType: row.file_type,
      watermark: row.watermark,
      relevanceScore: row.relevance_score,
      scoreBreakdown: parseJson(row.score_breakdown, {}),
      license: parseJson(row.license, {}),
      licenseVerified: row.license_verified === undefined || row.license_verified === null
        ? true
        : Boolean(row.license_verified),
      ...(typeof row.why === "string" && row.why ? { why: row.why } : {}),
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
      visionCheck: visionParsed?.success ? visionParsed.data : null,
      ...(typeof row.phash === "string" ? { phash: row.phash } : {}),
      ...(typeof row.phash_center === "string" ? { phashCenter: row.phash_center } : {}),
    });
  }

  private getVisionMeta(sceneId: string): SceneVisionMeta | undefined {
    const row = this.sqlite.prepare("SELECT vision_meta FROM visual_search_state WHERE scene_id = ?")
      .get(sceneId) as { vision_meta: string | null } | undefined;
    if (!row?.vision_meta) return undefined;
    const parsed = SceneVisionMetaSchema.safeParse(
      typeof row.vision_meta === "string" ? JSON.parse(row.vision_meta) : row.vision_meta,
    );
    return parsed.success ? parsed.data : undefined;
  }

  private async attachVisionFile(
    projectId: string,
    candidate: { scoreBreakdown: ScoreBreakdown },
    key: string,
    url: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    try {
      return await this.ensureVisionLocalFile(projectId, key, url, signal);
    } catch (error) {
      if (error instanceof AppError && error.code === "VISION_SOURCE_INVALID") {
        candidate.scoreBreakdown = { ...candidate.scoreBreakdown, invalidSource: true };
        this.logger?.warn({ err: error, key }, "Skipping vision for an unreadable source image");
        return null;
      }
      if (error instanceof AppError && error.code === "VISION_SOURCE_MISSING") {
        this.logger?.warn({ err: error, key }, "Skipping vision because the source image is missing");
        return null;
      }
      throw error;
    }
  }

  private async ensureVisionLocalFile(
    projectId: string,
    key: string,
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const folder = join(projectDir(this.config.DATA_DIR, projectId), "vision-cache");
    mkdirSync(folder, { recursive: true });
    const dest = join(folder, `${createHash("sha256").update(key).digest("hex").slice(0, 16)}.jpg`);
    if (existsSync(dest) && !visionSourceProblem(readFileSync(dest))) return dest;
    let stored: StoredImage;
    try {
      stored = await this.imageStore.download(projectId, url, signal);
    } catch (error) {
      if (error instanceof ImageDownloadError && /too small/i.test(error.message)) {
        throw new AppError(422, "VISION_SOURCE_INVALID", error.message);
      }
      const message = error instanceof Error ? error.message : "Không tải được ảnh nguồn.";
      throw new AppError(422, "VISION_SOURCE_MISSING", message);
    }
    const source = resolveAssetPath(this.config.DATA_DIR, projectId, stored.localPath);
    if (!existsSync(source)) {
      throw new AppError(422, "VISION_SOURCE_MISSING", "Không có file ảnh nguồn.");
    }
    const bytes = readFileSync(source);
    if (visionSourceProblem(bytes)) {
      throw new AppError(422, "VISION_SOURCE_INVALID", "Ảnh nguồn quá nhỏ hoặc không đọc được.");
    }
    writeFileSync(dest, bytes);
    return dest;
  }

  async visionCheckCandidate(
    projectId: string,
    sceneId: string,
    candidateId: string,
    llmProviders: LlmProviderRegistry,
    signal?: AbortSignal,
  ) {
    this.requireScene(projectId, sceneId);
    const candidate = this.findCandidate(candidateId);
    if (!candidate || candidate.sceneId !== sceneId) {
      throw new AppError(404, "VISUAL_CANDIDATE_NOT_FOUND", "Không tìm thấy ảnh ứng viên.");
    }
    const project = this.requireProject(projectId);
    requireVisionRoute(llmProviders, project, this.sqlite);
    const localPath = await this.visionCandidateFile(projectId, candidate, signal);
    const scene = this.loadScenes(projectId).find((item) => item.id === sceneId)!;
    const route = llmProviders.resolveTask("visionCheck", project, getAppLlmSettings(this.sqlite));
    const prompt = buildVisionCheckPrompt({
      narration: scene.narration,
      visualDescription: scene.visualDescription || scene.visualNotes,
      aspectRatio: project.settings.aspectRatio,
      images: [{ label: candidate.id }],
    });
    try {
      const generated = await generateRoutedStructured({
        registry: llmProviders,
        route,
        task: "visionCheck",
        system: prompt.system,
        prompt: prompt.prompt,
        schema: VisionCheckBatchSchema,
        schemaName: "VisionCheck",
        schemaVersion: "2",
        maxOutputTokens: 1_200,
        repairAttempts: 1,
        signal: signal ?? new AbortController().signal,
        cache: new LlmCache(this.sqlite, this.config.LLM_CACHE_ENABLED),
        normalize: (raw) => normalizeVisionCheckBatch(raw).value,
        images: [{ path: localPath, label: candidate.id }],
        visionCacheDir: join(projectDir(this.config.DATA_DIR, projectId), "vision-cache"),
      });
      const image = generated.value.images[0];
      if (!image) throw new AppError(502, "LLM_INVALID_OUTPUT", "Vision check không trả kết quả.");
      const check: VisionCheck = {
        fit: image.fit,
        depicts: image.depicts,
        issues: image.issues,
        cropOk: image.cropOk,
        model: generated.model,
        checkedAt: new Date().toISOString(),
      };
      this.sqlite.prepare("UPDATE visual_candidates SET vision_check = ? WHERE id = ?")
        .run(JSON.stringify(check), candidate.id);
      this.repository.emitVisualUpdated(projectId, sceneId, "vision-checked");
      return {
        candidate: this.findCandidate(candidate.id)!,
        usage: generated.usage,
        estimate: { calls: 1, images: 1 },
      };
    } catch (error) {
      if (error instanceof LlmError) {
        throw new AppError(error.code === "VISION_PROVIDER_REQUIRED" ? 422 : 502, error.code, error.message);
      }
      throw error;
    }
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

function attentionLabel(reason: string | null | undefined): string | null {
  switch (reason) {
    case "lowRelevance": return "ảnh lệch chủ đề";
    case "vision_reject": return "AI nhìn loại ảnh";
    case "vision_missing": return "chưa có kết quả AI nhìn";
    case "invalid_source": return "ảnh nguồn không dùng được";
    case "no_candidate": return "không có ảnh đúng";
    case "source_risk": return "nguồn rủi ro cao";
    default: return null;
  }
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

function resolveFeatures(sqlite: Database.Database, project: Project): {
  altQueryAssist: boolean;
  semanticImageRerank: boolean;
  visualSearchBreadth: 8 | 16 | 32;
} {
  const features = visualFeaturesFor(resolveBudget(project), project.settings.visuals?.quality ?? visualQuality(sqlite, project.profileId));
  return {
    altQueryAssist: features.altQueryAssist,
    semanticImageRerank: features.semanticImageRerank,
    visualSearchBreadth: features.visualSearchBreadth,
  };
}

function fromStoredCandidate(candidate: VisualCandidate): NormalizedImageResult {
  const providerPosition = candidate.scoreBreakdown.providerPosition;
  const downloadLocation = typeof candidate.scoreBreakdown.unsplashDownloadLocation === "string"
    ? candidate.scoreBreakdown.unsplashDownloadLocation
    : undefined;
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
    ...(candidate.sourcePageUrl ? { sourcePageUrl: candidate.sourcePageUrl } : {}),
    sourceSite: candidate.sourceSite,
    width: candidate.width,
    height: candidate.height,
    fileType: candidate.fileType,
    watermark: candidate.watermark,
    license: candidate.license,
    licenseVerified: candidate.licenseVerified,
    ...(candidate.why ? { why: candidate.why } : {}),
    ...(downloadLocation ? { downloadLocation } : {}),
    ...(candidate.downloadError ? { downloadError: candidate.downloadError } : {}),
    ...(candidate.phash ? { phash: candidate.phash } : {}),
    ...(candidate.phashCenter ? { phashCenter: candidate.phashCenter } : {}),
  };
}

function createSearchStats(): SearchStats {
  return {
    requests: 0,
    requestsByProvider: {},
    cacheHits: 0,
    failures: 0,
    unavailableFailures: 0,
    blockedProviders: new Set(),
    blockedReasons: {},
    consecutive403ByProvider: {},
    checkpointHits: 0,
  };
}

function parseCheckpoint<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

const NON_RETRYABLE_DOWNLOAD_STATUSES = new Set([401, 403, 404, 410]);

function isNonRetryableHttpStatus(status: number | undefined): boolean {
  return status != null && NON_RETRYABLE_DOWNLOAD_STATUSES.has(status);
}

export function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof ImageDownloadError) {
    if (isNonRetryableHttpStatus(error.status)) return false;
    return error.retryable;
  }
  if (error instanceof AppError && error.code === "IMAGE_DOWNLOAD_FAILED") {
    const details = error.details as { retryable?: boolean; status?: number } | undefined;
    if (isNonRetryableHttpStatus(details?.status)) return false;
    return details?.retryable === true;
  }
  return false;
}

function isImageDownloadFailedError(error: unknown): boolean {
  if (error instanceof ImageDownloadError) return true;
  return error instanceof AppError && error.code === "IMAGE_DOWNLOAD_FAILED";
}

function downloadFailureStatus(error: unknown): number | null {
  if (error instanceof ImageDownloadError) return error.status ?? null;
  if (error instanceof AppError && error.code === "IMAGE_DOWNLOAD_FAILED") {
    const status = (error.details as { status?: number } | undefined)?.status;
    return status ?? null;
  }
  return null;
}

function candidateHost(candidate: VisualCandidate): string | null {
  try {
    return new URL(downloadUrl(candidate)).hostname;
  } catch {
    return null;
  }
}
