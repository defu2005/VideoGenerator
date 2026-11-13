export {
  COMPOSE_VERSION,
  COMPOSE_RENDER_VERSION,
  SHOT_KINDS,
  ShotKindSchema,
  MIN_SHOT_SEC,
  MIN_GRAPHIC_SHOT_SEC,
  MAX_GRAPHIC_SHOT_SEC,
  FootageLicenseSchema,
  ShotSourceSchema,
  ShotSchema,
  KindSpanSchema,
  ScenePlanSchema,
  BeatGridSchema,
  ComposeStatsSchema,
  ComposePlanSchema,
  LlmVariantChoiceSchema,
  shotFrames,
  validateScenePlan,
} from "./schema.js";
export type {
  ShotKind,
  FootageLicense,
  ShotSource,
  Shot,
  KindSpan,
  ScenePlan,
  BeatGrid,
  ComposeStats,
  ComposePlan,
  LlmVariantChoice,
} from "./schema.js";
export {
  applyGraphicTiming,
  CompareSourceSchema,
  fitGraphicPayload,
  ListSourceSchema,
  MapGeoSchema,
  MapSourceSchema,
  QuoteSourceSchema,
  graphicDurationBounds,
  GRAPHIC_KINDS,
  isGraphicKind,
  quoteWords,
  shotVariantParams,
} from "./graphicKind.js";
export type { GraphicKind } from "./graphicKind.js";
export { boxesOverlap, labelFromGeometry, pointInRing, visibleLabelIndexes, visualLabelPoint } from "./mapLabel.js";
export type { LabelBox, LngLat } from "./mapLabel.js";
export { sceneWords, cutCandidates } from "./words.js";
export type { SceneWord, Cut } from "./words.js";
export { detectBeats, musicToSceneBeats } from "./beats.js";
export { paceBand, paceSpan } from "./pacing.js";
export type { PaceBand } from "./pacing.js";
export { computeStats } from "./metrics.js";
export { DIGITS_ONLY, getLangPack } from "./lang/index.js";
export type { ComposeLangPack } from "./lang/index.js";
export { comparableGroups, findContrastWord, parseNumbers, startsWithOrdinal } from "./numbers.js";
export type { NumberGroup, NumberMention, NumberUnit } from "./numbers.js";
export { checkVariety, enforceVariety } from "./variety.js";
export { RENDER_COST_TABLE, estimateRenderSeconds, formatRenderEstimate } from "./estimate.js";
export type { EstimatePlan, RenderCostTable, RenderTimeEstimate } from "./estimate.js";
export type { VarietyChange, VarietyScene } from "./variety.js";
export {
  FOOTAGE_AUTHOR_LIMIT,
  FOOTAGE_EDGE_SEC,
  FOOTAGE_MIN_SCORE,
  FOOTAGE_REUSE_GAP_SEC,
  assignFootage,
  emptyFootageUse,
  footageFit,
  footageKey,
  footageRelevance,
  noteFootageUse,
  pickInSec,
  rankFootage,
} from "./footage.js";
export type { FootageRankOptions, FootageUse, RankableFootage } from "./footage.js";
