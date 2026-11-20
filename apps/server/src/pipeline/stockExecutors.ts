import type Database from "better-sqlite3";
import type { PipelineStage } from "@vg/shared";
import type { GuidelineService } from "../guidelines/service.js";
import type { AppConfig } from "../lib/config.js";
import { MediaFetchExecutor } from "../node/mediaFetch.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import type { AutoReportService } from "../services/autoReportService.js";
import type { MetadataService } from "../services/metadataService.js";
import type { MusicService } from "../services/musicService.js";
import type { TimelineService } from "../services/timelineService.js";
import type { VisualService } from "../services/visualService.js";
import { MusicSearchExecutor } from "../stages/music/musicSearchExecutor.js";
import { ResearchExecutor } from "../stages/research/researchExecutor.js";
import { ScenePlanExecutor } from "../stages/scenes/scenePlanExecutor.js";
import { ScriptExecutor } from "../stages/script/scriptExecutor.js";
import { SubtitleExecutor } from "../stages/subtitle/subtitleExecutor.js";
import { TimelineExecutor } from "../stages/timeline/timelineExecutor.js";
import { VisualSearchExecutor } from "../stages/visuals/visualSearchExecutor.js";
import type { StageExecutor } from "./stageExecutor.js";

export function createStockExecutors(deps: {
  sqlite: Database.Database;
  config: AppConfig;
  llm: LlmProviderRegistry;
  visual: VisualService;
  voice: StageExecutor;
  music: MusicService;
  timeline: TimelineService;
  guidelines: GuidelineService;
  metadata: MetadataService;
  autoReport: AutoReportService;
  render: StageExecutor;
  clip: StageExecutor;
}): Map<PipelineStage, StageExecutor> {
  const { sqlite, config, llm } = deps;
  return new Map<PipelineStage, StageExecutor>([
    ["RESEARCH", new ResearchExecutor(sqlite, llm, config)],
    ["SCRIPT", new ScriptExecutor(sqlite, llm, config)],
    ["SCENE_PLAN", new ScenePlanExecutor(sqlite, llm, config)],
    ["VISUAL_SEARCH", new VisualSearchExecutor(deps.visual, llm)],
    ["VOICE", deps.voice],
    ["MEDIA_FETCH", new MediaFetchExecutor(config.DATA_DIR)],
    ["SUBTITLE", new SubtitleExecutor(sqlite, config)],
    ["MUSIC_SEARCH", new MusicSearchExecutor(deps.music, sqlite, llm, config, deps.autoReport)],
    ["TIMELINE", new TimelineExecutor(deps.timeline, deps.guidelines, deps.metadata)],
    ["RENDER", deps.render],
    ["CLIP", deps.clip],
  ]);
}
