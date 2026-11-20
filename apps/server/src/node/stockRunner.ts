import { GuidelineService } from "../guidelines/service.js";
import { probeDurationSec } from "../media/ffmpeg.js";
import { createStockExecutors } from "../pipeline/stockExecutors.js";
import { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getLlmVisionMarks } from "../providers/llm/settings.js";
import { createMusicProviders } from "../providers/music/registry.js";
import { TtsProviderRegistry } from "../providers/tts/registry.js";
import { AudioStore } from "../services/audioStore.js";
import { AutoReportService } from "../services/autoReportService.js";
import { ClipService } from "../services/clipService.js";
import { MetadataService } from "../services/metadataService.js";
import { MusicService } from "../services/musicService.js";
import { RenderService } from "../services/renderService.js";
import { ThumbnailService } from "../services/thumbnailService.js";
import { TimelineService } from "../services/timelineService.js";
import { VisualService } from "../services/visualService.js";
import { ClipExecutor } from "../stages/clip/clipExecutor.js";
import { RenderExecutor } from "../stages/render/renderExecutor.js";
import { VoiceExecutor } from "../stages/voice/voiceExecutor.js";
import { createRunnerRuntime } from "./runnerRuntime.js";
import { setRunnerKnowledgeLookup, type KnowledgeLookup } from "../retrieval/context.js";

/** Assemble the local services a segment can invoke. Control-only services do not participate. */
export function createStockRunner(input: Omit<Parameters<typeof createRunnerRuntime>[0], "executors" | "canApprove"> & {
  ttsSecret?: (providerId: string) => string | null;
  retrieve?: KnowledgeLookup;
}) {
  const { sqlite, config, logger } = input;
  if (input.retrieve) setRunnerKnowledgeLookup(sqlite, input.retrieve);
  const llm = new LlmProviderRegistry(config);
  llm.setVisionMarkLoader(() => getLlmVisionMarks(sqlite).models);
  const tts = new TtsProviderRegistry(config, { sqlite, secret: input.ttsSecret });
  const autoReport = new AutoReportService(sqlite);
  const music = new MusicService(sqlite, config, createMusicProviders(config), new AudioStore(config.DATA_DIR, config.IMAGE_SEARCH_USER_AGENT), probeDurationSec);
  const timeline = new TimelineService(sqlite, config);
  const render = new RenderService(sqlite, config, timeline, undefined, undefined, llm, autoReport);
  const thumbnails = new ThumbnailService(sqlite, config, timeline, undefined, llm);
  let visual: VisualService;
  return createRunnerRuntime({
    ...input,
    executors: (repository) => {
      visual = new VisualService(sqlite, repository, config, logger, { autoReport });
      const clips = new ClipService(sqlite, config, repository, llm, thumbnails);
      return createStockExecutors({
        sqlite, config, llm, visual, music, timeline, autoReport,
        voice: new VoiceExecutor(sqlite, tts, config), guidelines: new GuidelineService(sqlite),
        metadata: new MetadataService(sqlite, config, llm, timeline, render),
        render: new RenderExecutor(render, thumbnails, clips), clip: new ClipExecutor(clips),
      });
    },
    canApprove: (project, gate) => {
      if (gate === "VISUAL_REVIEW") return visual.canApproveVisualReview(project.id);
      if (gate === "MUSIC_REVIEW") return music.canApproveMusicReview(project);
      if (gate === "FINAL_APPROVAL") return timeline.canApproveFinal(project.id);
      return { allowed: true };
    },
  });
}
