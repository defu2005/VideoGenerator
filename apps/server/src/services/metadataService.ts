import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  DEFAULT_AI_DISCLOSURE,
  VideoMetadataDraftSchema,
  appendDescriptionExtras,
  buildChapters,
  chaptersText,
  codeMetadataDraft,
  normalizeMetadataDraft,
  resolveBudget,
  type LlmCallUsage,
  type Project,
  type Script,
  type Timeline,
  type VideoMetadata,
  type VideoMetadataDraft,
  type VideoMetadataSource,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { GuidelineService } from "../guidelines/service.js";
import { LlmCache } from "../providers/llm/cache.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import type { LlmProviderRegistry, ResolvedLlmRoute } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { LlmError } from "../providers/llm/types.js";
import { metadataPrompt } from "../stages/timeline/metadataPrompt.js";
import { getProfilePromptContext } from "./profileService.js";
import type { RenderService } from "./renderService.js";
import type { TimelineService } from "./timelineService.js";

type MetadataRow = {
  project_id: string;
  input_hash: string;
  draft: string;
  edited: string | null;
  source: VideoMetadataSource;
  created_at: string;
  updated_at: string;
};

export type MetadataGenerateResult = {
  metadata: VideoMetadata;
  stale: boolean;
  reused: boolean;
  source: VideoMetadataSource;
};

type UsageRecorder = (usage: {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  tokensUnknown?: boolean;
  costUsd: number;
  provider?: string;
  model?: string;
  features?: Record<string, number>;
  calls?: LlmCallUsage[];
}) => void;

export class MetadataService {
  private readonly cache: LlmCache;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly registry: LlmProviderRegistry,
    private readonly timelines: TimelineService,
    private readonly render: RenderService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cache = new LlmCache(sqlite, config.LLM_CACHE_ENABLED);
  }

  get(project: Project | string): {
    metadata: VideoMetadata | null;
    stale: boolean;
    extras: { chaptersText: string; creditsText: string; disclosure: string };
  } {
    const projectId = typeof project === "string" ? project : project.id;
    const row = this.row(projectId);
    const timeline = this.timelines.get(projectId);
    const timelineHash = timeline.timeline ? timeline.inputHash : null;
    const extras = typeof project === "string"
      ? this.extrasForProjectId(projectId)
      : this.extrasForProject(project);
    if (!row) return { metadata: null, stale: Boolean(timelineHash), extras };
    return {
      metadata: this.toMetadata(row),
      stale: !timelineHash || row.input_hash !== timelineHash,
      extras,
    };
  }

  saveEdits(project: Project, edits: VideoMetadataDraft): ReturnType<MetadataService["get"]> {
    const existing = this.row(project.id);
    if (!existing) throw new AppError(404, "METADATA_NOT_FOUND", "Chưa có metadata để sửa. Hãy tạo trước.");
    const normalized = normalizeMetadataDraft(edits);
    const now = this.now().toISOString();
    this.sqlite.prepare("UPDATE video_metadata SET edited = ?, updated_at = ? WHERE project_id = ?")
      .run(JSON.stringify(normalized), now, project.id);
    return this.get(project);
  }

  async generate(project: Project, options: {
    overwriteEdits?: boolean;
    signal?: AbortSignal;
    warn?: (message: string, extra?: Record<string, unknown>) => void;
    recordUsage?: UsageRecorder;
    logger?: FastifyBaseLogger;
  } = {}): Promise<MetadataGenerateResult> {
    const timelineRow = this.timelines.get(project.id);
    if (!timelineRow.timeline) {
      throw new AppError(409, "TIMELINE_REQUIRED", "Cần timeline trước khi tạo metadata.");
    }
    const timeline = timelineRow.timeline;
    const inputHash = timelineRow.inputHash;
    const existing = this.row(project.id);
    if (existing?.edited && !options.overwriteEdits && existing.input_hash === inputHash) {
      return { metadata: this.toMetadata(existing), stale: false, reused: true, source: existing.source };
    }

    const script = this.readScript(project.id);
    const budget = resolveBudget(project);
    let draft: VideoMetadataDraft;
    let source: VideoMetadataSource = "CODE";
    let selected: ResolvedLlmRoute | undefined;

    if (budget.metadata) {
      try {
        selected = this.registry.resolveTask("metadata", project, getAppLlmSettings(this.sqlite));
        const narrationSummary = [
          script?.hook ?? "",
          ...(script?.sections ?? []).map((section) => `${section.heading}: ${section.narration}`),
          script?.outro ?? "",
        ].join("\n").replace(/\s+/g, " ").trim().slice(0, 1500);
        const guidance = new GuidelineService(this.sqlite).guidanceFor(project, ["metadata"]);
        const promptContext = getProfilePromptContext(this.sqlite, project.profileId);
        const titleCount = promptContext.titleAbTest ? 2 : 3;
        const prompt = metadataPrompt({
          project,
          scriptTitle: script?.title ?? project.title,
          hook: script?.hook ?? project.description,
          sectionHeadings: (script?.sections ?? []).map((section) => section.heading),
          narrationSummary,
          guidance,
          channelDirection: promptContext.direction,
          learnedNotes: promptContext.learnedNotes,
          titleCount,
        });
        const cacheKeyExtra = createHash("sha256")
          .update(JSON.stringify({
            inputHash,
            title: script?.title ?? project.title,
            hook: script?.hook ?? "",
            headings: (script?.sections ?? []).map((section) => section.heading),
            narrationSummary,
            platform: project.settings.platform,
            guidance,
            titleCount,
            learnedNotes: promptContext.learnedNotes ?? "",
          }))
          .digest("hex");
        const generated = await generateRoutedStructured({
          registry: this.registry,
          route: selected,
          task: "metadata",
          system: prompt.system,
          prompt: prompt.prompt,
          schema: VideoMetadataDraftSchema,
          schemaName: "VideoMetadataDraft",
          schemaVersion: "1",
          maxOutputTokens: Math.min(selected.maxOutputTokens ?? 2048, selected.provider.limits?.maxOutputTokens ?? 2048),
          repairAttempts: 0,
          signal: options.signal ?? new AbortController().signal,
          cache: this.cache,
          cacheKeyExtra,
          logger: options.logger,
        });
        draft = normalizeMetadataDraft(generated.value);
        source = "LLM";
        let costUsd = 0;
        try {
          costUsd = estimateLlmCost(this.config, generated.provider, generated.model, generated.usage);
        } catch (error) {
          options.logger?.error({ err: error }, "Could not estimate metadata cost");
        }
        options.recordUsage?.({
          ...generated.usage,
          costUsd,
          provider: generated.provider,
          model: generated.model,
          features: { metadata: generated.usage.llmCalls },
          calls: generated.usage.calls,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const usage = error instanceof LlmError ? error.usage : undefined;
        let costUsd = 0;
        if (usage && usage.llmCalls > 0) {
          try {
            costUsd = estimateLlmCost(this.config, selected?.provider.id ?? "unknown", selected?.model ?? "", usage);
          } catch (costError) {
            options.logger?.error({ err: costError }, "Could not estimate failed metadata cost");
          }
        }
        options.recordUsage?.({
          llmCalls: usage?.llmCalls ?? 0,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          ...(usage?.tokensUnknown ? { tokensUnknown: true } : {}),
          costUsd,
          ...(selected ? { provider: selected.provider.id } : {}),
          ...(selected?.model ? { model: selected.model } : {}),
          features: { metadata: usage?.llmCalls ?? 0 },
          ...(usage?.calls ? { calls: usage.calls } : {}),
        });
        options.warn?.("Metadata LLM failed; using code draft", { err: error });
        options.logger?.warn({ err: error }, "Metadata LLM failed; using code draft");
        draft = this.codeDraft(project, script);
        source = "CODE";
      }
    } else {
      options.recordUsage?.({
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        features: { metadata: 0 },
      });
      draft = this.codeDraft(project, script);
      source = "CODE";
    }

    if (getProfilePromptContext(this.sqlite, project.profileId).titleAbTest && draft.titles.length > 2) {
      draft = { ...draft, titles: draft.titles.slice(0, 2) };
    }

    const now = this.now().toISOString();
    const keepEdits = existing?.edited && !options.overwriteEdits ? existing.edited : null;
    this.sqlite.prepare(`INSERT INTO video_metadata (project_id, input_hash, draft, edited, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        input_hash = excluded.input_hash,
        draft = excluded.draft,
        edited = excluded.edited,
        source = excluded.source,
        updated_at = excluded.updated_at`).run(
      project.id,
      inputHash,
      JSON.stringify(draft),
      keepEdits,
      source,
      existing?.created_at ?? now,
      now,
    );

    const result = this.get(project);
    return {
      metadata: result.metadata!,
      stale: result.stale,
      reused: false,
      source,
    };
  }

  /** Full description with optional chapters, credits and AI disclosure for copy/export. */
  composeDescription(project: Project, draft: VideoMetadataDraft, options: {
    includeChapters?: boolean;
    includeCredits?: boolean;
    includeDisclosure?: boolean;
  } = {}): {
    description: string;
    chaptersText: string;
    creditsText: string;
    disclosure: string;
  } {
    const parts = this.extrasForProject(project);
    return {
      description: appendDescriptionExtras({
        description: draft.description,
        chaptersText: parts.chaptersText,
        creditsText: parts.creditsText,
        includeChapters: options.includeChapters,
        includeCredits: options.includeCredits,
        includeDisclosure: options.includeDisclosure,
        disclosure: parts.disclosure,
      }),
      ...parts,
    };
  }

  private extrasForProjectId(projectId: string): { chaptersText: string; creditsText: string; disclosure: string } {
    const timelineRow = this.timelines.get(projectId);
    const timeline = timelineRow.timeline;
    const script = this.readScript(projectId);
    const chapters = timeline ? buildChapters(timeline, script?.sections ?? []) : [];
    return {
      chaptersText: chaptersText(chapters),
      creditsText: "",
      disclosure: DEFAULT_AI_DISCLOSURE,
    };
  }

  private extrasForProject(project: Project): { chaptersText: string; creditsText: string; disclosure: string } {
    const timelineRow = this.timelines.get(project.id);
    const timeline = timelineRow.timeline;
    const script = this.readScript(project.id);
    const chapters = timeline ? buildChapters(timeline, script?.sections ?? []) : [];
    return {
      chaptersText: chaptersText(chapters),
      creditsText: timeline ? this.render.creditsText(project, timeline as Timeline) : "",
      disclosure: DEFAULT_AI_DISCLOSURE,
    };
  }

  private codeDraft(project: Project, script: Script | null): VideoMetadataDraft {
    return codeMetadataDraft({
      title: script?.title ?? project.title,
      hook: script?.hook ?? project.description,
      keywords: script?.music?.keywords ?? [],
    });
  }

  private readScript(projectId: string): Script | null {
    const row = this.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(projectId) as { data: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.data) as Script;
    } catch {
      return null;
    }
  }

  private row(projectId: string): MetadataRow | undefined {
    return this.sqlite.prepare("SELECT * FROM video_metadata WHERE project_id = ?").get(projectId) as MetadataRow | undefined;
  }

  private toMetadata(row: MetadataRow): VideoMetadata {
    return {
      projectId: row.project_id,
      inputHash: row.input_hash,
      draft: VideoMetadataDraftSchema.parse(typeof row.draft === "string" ? JSON.parse(row.draft) : row.draft),
      edited: row.edited
        ? VideoMetadataDraftSchema.parse(typeof row.edited === "string" ? JSON.parse(row.edited) : row.edited)
        : null,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
