import { createHash } from "node:crypto";
import {
  MusicAssistOutputSchema,
  resolveBudget,
  type MusicAssistOutput,
  type Script,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../lib/config.js";
import { AppError } from "../../lib/errors.js";
import { GuidelineService } from "../../guidelines/service.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { LlmCache } from "../../providers/llm/cache.js";
import { estimateLlmCost } from "../../providers/llm/pricing.js";
import { generateRoutedStructured } from "../../providers/llm/structured.js";
import type { LlmProviderRegistry, ResolvedLlmRoute } from "../../providers/llm/registry.js";
import { getAppLlmSettings } from "../../providers/llm/settings.js";
import { LlmError } from "../../providers/llm/types.js";
import { AudioDownloadError } from "../../services/audioStore.js";
import type { MusicService } from "../../services/musicService.js";
import type { AutoReportService } from "../../services/autoReportService.js";
import { musicAssistPrompt } from "./musicAssistPrompt.js";

function errorCode(error: unknown): string {
  return error instanceof LlmError ? error.code : "UNKNOWN";
}

export class MusicSearchExecutor implements StageExecutor {
  readonly stage = "MUSIC_SEARCH" as const;
  private readonly cache: LlmCache;

  constructor(
    private readonly music: MusicService,
    private readonly sqlite: Database.Database,
    private readonly registry: LlmProviderRegistry,
    private readonly config: AppConfig,
    private readonly autoReport?: AutoReportService,
  ) {
    this.cache = new LlmCache(sqlite, config.LLM_CACHE_ENABLED);
  }

  async run(context: StageContext) {
    const project = context.project;
    if (!project.settings.music.enabled) {
      this.music.selectNone(project, "AGENT");
      context.recordUsage({
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        features: { musicAssist: 0 },
      });
      return { message: "Nhạc nền đang tắt", outputHash: "music-disabled" };
    }

    context.reportProgress(10, "Đang tìm nhạc nền");
    const selection = this.music.selectionRow(project.id);
    const hasOverride = Boolean(selection?.query_override?.trim());
    const budget = resolveBudget(project);
    let assist: MusicAssistOutput | null = null;
    let assistNote = "";

    if (budget.musicAssist && !hasOverride) {
      let selected: ResolvedLlmRoute | undefined;
      try {
        context.reportProgress(25, "AI gợi ý nhạc");
        selected = this.registry.resolveTask("musicAssist", project, getAppLlmSettings(this.sqlite));
        const script = this.readScript(project.id);
        const scenes = this.sqlite.prepare("SELECT music_mood FROM scenes WHERE project_id = ? ORDER BY \"order\"")
          .all(project.id) as Array<{ music_mood: string }>;
        const music = script?.music ?? { mood: "", energy: "medium" as const, keywords: [] as string[] };
        const narrationSample = [
          script?.hook ?? "",
          ...(script?.sections ?? []).map((section) => section.narration),
          script?.outro ?? "",
        ].join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
        const guidance = new GuidelineService(this.sqlite).guidanceFor(project, ["music"]);
        const prompt = musicAssistPrompt({
          project,
          scriptTitle: script?.title ?? project.title,
          hook: script?.hook ?? "",
          narrationSample,
          sceneMoods: scenes.map((scene) => scene.music_mood),
          music: { mood: music.mood, keywords: music.keywords },
          guidance,
        });
        const cacheKeyExtra = createHash("sha256")
          .update(JSON.stringify({
            topic: project.topic,
            title: script?.title ?? "",
            hook: script?.hook ?? "",
            narrationSample,
            moods: scenes.map((scene) => scene.music_mood),
            music,
            guidance,
          }))
          .digest("hex");
        const generated = await generateRoutedStructured({
          registry: this.registry,
          route: selected,
          task: "musicAssist",
          system: prompt.system,
          prompt: prompt.prompt,
          schema: MusicAssistOutputSchema,
          schemaName: "MusicAssist",
          schemaVersion: "1",
          maxOutputTokens: Math.min(selected.maxOutputTokens ?? 1024, selected.provider.limits?.maxOutputTokens ?? 1024),
          repairAttempts: 0,
          signal: context.signal,
          cache: this.cache,
          cacheKeyExtra,
          logger: context.logger,
        });
        assist = generated.value;
        let costUsd = 0;
        try {
          costUsd = estimateLlmCost(this.config, generated.provider, generated.model, generated.usage);
        } catch (error) {
          context.logger.error({ err: error }, "Could not estimate music assist cost");
        }
        context.recordUsage({
          ...generated.usage,
          costUsd,
          provider: generated.provider,
          model: generated.model,
          features: { musicAssist: generated.usage.llmCalls },
          calls: generated.usage.calls,
        });
        assistNote = generated.cached ? " · AI gợi ý (cache)" : " · AI gợi ý";
      } catch (error) {
        if (context.signal.aborted) throw error;
        const usage = error instanceof LlmError ? error.usage : undefined;
        let costUsd = 0;
        if (usage && usage.llmCalls > 0) {
          try {
            costUsd = estimateLlmCost(this.config, selected?.provider.id ?? "unknown", selected?.model ?? "", usage);
          } catch (costError) {
            context.logger.error({ err: costError }, "Could not estimate failed music assist cost");
          }
        }
        context.recordUsage({
          llmCalls: usage?.llmCalls ?? 0,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          ...(usage?.tokensUnknown ? { tokensUnknown: true } : {}),
          costUsd,
          ...(selected ? { provider: selected.provider.id } : {}),
          ...(selected?.model ? { model: selected.model } : {}),
          features: { musicAssist: usage?.llmCalls ?? 0 },
          ...(usage?.calls ? { calls: usage.calls } : {}),
        });
        context.logger.warn({ err: error, code: errorCode(error) }, "Music assist skipped; using code query");
        assistNote = ` · AI gợi ý bỏ qua (${errorCode(error)})`;
        this.music.saveAssist(project.id, null);
      }
    } else {
      context.recordUsage({
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        features: { musicAssist: 0 },
      });
      if (!budget.musicAssist || hasOverride) this.music.saveAssist(project.id, null);
    }

    let outcome;
    try {
      outcome = await this.music.search(project, {
        signal: context.signal,
        warn: (message) => context.logger.warn(message),
        assist,
      });
    } catch (error) {
      if (error instanceof AudioDownloadError) throw new StageError(error.message, "MUSIC_SEARCH_FAILED", true);
      throw error;
    }
    context.reportProgress(70, `${outcome.candidates.length} bản nhạc`);

    const before = this.music.selectionRow(project.id);
    const userDecided = before?.selected_by === "USER";
    if (!userDecided) this.music.preselectTop(project);

    let approvedNote = "";
    if (project.mode === "AUTO" && !userDecided) {
      this.autoReport?.clearStage(project.id, "MUSIC_REVIEW");
      const current = this.music.selectionRow(project.id);
      if (current?.candidate_id) {
        try {
          await this.music.select(project, current.candidate_id, "AGENT", context.signal);
          approvedNote = " · đã tự chọn bản đầu";
          this.autoReport?.add(project.id, {
            stage: "MUSIC_REVIEW",
            code: "MUSIC_AUTO_PICKED",
            severity: "INFO",
            message: "AUTO đã chọn bản nhạc xếp hạng cao nhất.",
            data: { candidateId: current.candidate_id },
          });
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          context.logger.warn(`Auto music download failed: ${error.message}`);
          this.music.selectNone(project, "AGENT");
          approvedNote = " · tải nhạc lỗi, bỏ nhạc nền";
          this.autoReport?.add(project.id, {
            stage: "MUSIC_REVIEW",
            code: "MUSIC_NONE",
            severity: "WARN",
            message: "Không dùng nhạc — tải bản chọn thất bại.",
            data: { reason: error.message },
          });
        }
      } else {
        this.music.selectNone(project, "AGENT");
        approvedNote = " · không có bản phù hợp, bỏ nhạc nền";
        this.autoReport?.add(project.id, {
          stage: "MUSIC_REVIEW",
          code: "MUSIC_NONE",
          severity: "WARN",
          message: "Không dùng nhạc — không có bản ứng viên phù hợp.",
          data: null,
        });
      }
    }

    const after = this.music.selectionRow(project.id);
    const outputHash = createHash("sha256")
      .update(`${after?.search_hash ?? ""}\u0000${after?.candidate_id ?? ""}\u0000${after?.status ?? ""}`)
      .digest("hex");
    const failed = outcome.failedProviders.length ? ` · lỗi: ${outcome.failedProviders.join(", ")}` : "";
    return {
      message: `"${outcome.query}" · ${outcome.candidates.length} bản${outcome.reused ? " (dùng lại)" : ""}${failed}${assistNote}${approvedNote}`,
      outputHash,
    };
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
}
