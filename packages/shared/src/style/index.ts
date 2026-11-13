/** Per-channel style system, genre packs and variant engine (TASK-106). See docs/architecture/style-system.md. */
export { colorDistance, contrastRatio, parseHex, toHex } from "./color.js";
export { BASE_CONTRAST, checkPalette, PaletteSeedSchema, resolvePalette, SHAPE_CONTRAST, TEXT_CONTRAST } from "./palette.js";
export type { ContrastIssue, PaletteRoles, PaletteSeed } from "./palette.js";
export {
  BACKGROUND_TREATMENTS,
  BASE_STYLE_TOKENS,
  diffStyleTokens,
  EASE_FAMILIES,
  ENTRANCES,
  LAYOUT_FAMILIES,
  mergeStyleTokens,
  SafeZoneSchema,
  STYLE_ASPECTS,
  StyleTokensPatchSchema,
  StyleTokensSchema,
} from "./tokens.js";
export type { BackgroundTreatment, EaseFamily, Entrance, FontRef, LayoutFamily, StyleAspect, StyleSafeZone, StyleTokens, StyleTokensPatch } from "./tokens.js";
export { DEFAULT_FONT_ID, FONT_FALLBACK_STACK, FONT_REGISTRY, FontSpecSchema, fontStack, resolveFont } from "./fonts.js";
export type { FontIssue, FontSpec } from "./fonts.js";
export {
  reviseStylePack,
  STYLE_PACK_ORIGINS,
  STYLE_PRESETS,
  styleHash,
  stylePackFingerprint,
  stylePackFromBrand,
  stylePackFromChoices,
  stylePackFromProposal,
  StylePackSchema,
  stylePackTokens,
  stylePreset,
} from "./pack.js";
export type { StylePack, StylePreset } from "./pack.js";
export { layeredTokens, resolveStyle, styleAspect, styleRhythm, templateStyle } from "./resolve.js";
export type { ResolvedStyle, StyleFrame, StyleLayers, TemplateStyle } from "./resolve.js";
export {
  AXIS_ROLES,
  axisChoices,
  BACKGROUND_AXIS,
  ENTRANCE_AXIS,
  homeSize,
  PERMISSIVE_LICENSES,
  TEMPLATE_MANIFESTS,
  TemplateAttributionSchema,
  TemplateAxisSchema,
  templateImportProblems,
  templateManifest,
  TemplateManifestSchema,
  templateTokenLint,
} from "./axes.js";
export type { AxisContext, AxisRole, TemplateAxis, TemplateManifest } from "./axes.js";
export { applyVariantChoices, DEFAULT_VARIANT_WINDOW, lookHistoryEntry, pickVariants, variantKey, variantOptions } from "./picker.js";
export type { LookHistory, VariantInput, VariantOptions, VariantPick, VariantShot } from "./picker.js";
export {
  buildVideoLook,
  comboSimilarity,
  compareVisualSameness,
  DEFAULT_VISUAL_SAMENESS_SETTINGS,
  frameSimilarity,
  kindSimilarity,
  styleSimilarity,
  VideoLookSchema,
  visualSameness,
  visualSamenessIssues,
  VisualSamenessSettingsSchema,
} from "./sameness.js";
export type { SamenessParts, VideoLook, VisualSamenessScores, VisualSamenessSettings } from "./sameness.js";
export { directivesForRecipe, GENRE_PACKS, GENRE_SHOT_KINDS, genreDirectives, genrePack, GenrePackSchema, genreRecipe } from "./genre.js";
export type { GenreDirectives, GenrePack, GenrePackInput } from "./genre.js";
