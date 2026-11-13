import {
  applyVariantChoices,
  DEFAULT_VARIANT_WINDOW,
  genrePack,
  isGraphicKind,
  parseHex,
  pickVariants,
  resolveStyle,
  stylePackFromBrand,
  templateManifest,
  templateStyle,
  variantOptions,
  type ComposePlan,
  type LookHistory,
  type ResolvedStyle,
  type Shot,
  type StylePack,
  type TemplateStyle,
  type VariantInput,
  type VariantOptions,
  type VariantShot,
} from "@vg/shared";
import type { ComposeRenderContext } from "./context.js";

export type VideoGraphicStyle = NonNullable<ComposeRenderContext["videoStyle"]>;

export type GraphicStyleRequest = {
  projectId?: string;
  profileId?: string | null;
  recipeId?: string | null;
  brandColor?: string;
  accentColor?: string;
  /** A pack skips the profile and the brand pack. `null` forces no pack. */
  pack?: StylePack | null;
  /** When `pack` is omitted, the profile pack wins, then the project brand pack. */
  styles?: {
    packForProfile: (profileId: string) => StylePack | null;
    lookHistory: (profileId: string, window: number) => LookHistory;
  };
  /** Used when set. Otherwise loaded from `styles` for the profile. */
  history?: LookHistory;
  /** `shotId → variant key` chosen by the QUALITY director's LLM (see `llmChoiceAnswers`). Invalid keys keep the rule pick. */
  llmChoices?: Record<string, string>;
  width: number;
  height: number;
  shots: Shot[];
};

/** StylePack ids reject `:`, so the guide's `project:` + id is stored as `project-` + id. */
export function stylePackId(projectId: string | undefined): string {
  const cleaned = `project-${projectId ?? "none"}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "project";
}

/** A brand pack when the brand colour is hex. Otherwise null. */
export function brandStylePack(projectId: string | undefined, brandColor?: string, accentColor?: string): StylePack | null {
  if (!parseHex(brandColor)) return null;
  const colors = [brandColor, accentColor].filter((color): color is string => parseHex(color) !== null);
  return stylePackFromBrand({ id: stylePackId(projectId), name: "brand", colors });
}

/** Axis values the shot source already fixed. The picker keeps these. */
export function pinnedAxes(shot: Shot): Record<string, string> | undefined {
  if (!isGraphicKind(shot.source.kind)) return undefined;
  const manifest = templateManifest(shot.source.kind);
  if (!manifest) return undefined;
  const source = shot.source as Record<string, unknown>;
  const pinned: Record<string, string> = {};
  for (const axis of manifest.axes) {
    if (!axis.sourceField) continue;
    const value = source[axis.sourceField];
    if (typeof value !== "string") continue;
    if (!axis.values.some((item) => item.id === value)) continue;
    pinned[axis.id] = value;
  }
  return Object.keys(pinned).length > 0 ? pinned : undefined;
}

/** Profile pack, then the project brand pack, then none. An explicit `pack` wins, including `null`. */
export function packForGraphicStyle(input: Omit<GraphicStyleRequest, "shots">): StylePack | null {
  if (input.pack !== undefined) return input.pack;
  if (input.profileId && input.styles) {
    const fromProfile = input.styles.packForProfile(input.profileId);
    if (fromProfile) return fromProfile;
  }
  return brandStylePack(input.projectId, input.brandColor, input.accentColor);
}

/**
 * One look for the frame and one variant per graphic shot.
 * Call once per video with every shot, then put the result on the render context.
 * History comes from the channel's stored looks so the next video can rotate.
 */
function variantInputFor(input: Omit<GraphicStyleRequest, "shots" | "llmChoices">, shots: VariantShot[]): { resolved: ResolvedStyle; variants: VariantInput } {
  const pack = packForGraphicStyle(input);
  const resolved = resolveStyle(
    { genre: genrePack(input.recipeId)?.style ?? null, pack, video: null, shot: null },
    { width: input.width, height: input.height },
  );
  const history = input.history ?? (
    input.profileId && input.styles
      ? input.styles.lookHistory(input.profileId, DEFAULT_VARIANT_WINDOW)
      : { videos: [] }
  );
  return {
    resolved,
    variants: {
      seed: `${input.profileId ?? "none"}|${input.projectId ?? "none"}`,
      shots,
      tokens: resolved.tokens,
      aspect: resolved.aspect,
      packSeed: pack?.seed ?? pack?.id ?? "base",
      history,
    },
  };
}

/** QUALITY director: the best looks per graphic shot before the shots exist (no pinned axes yet). Rule pick first. */
export function graphicVariantOptions(
  input: Omit<GraphicStyleRequest, "shots" | "llmChoices">,
  shots: { id: string; templateId: string }[],
  limit = 4,
): VariantOptions[] {
  return variantOptions(variantInputFor(input, shots).variants, limit);
}

/**
 * `shotId → key` for the shots of a finished plan, from the choices the director's LLM made.
 * A choice belongs to the nth graphic shot of its scene. A key that the picker does not offer for
 * that shot is ignored later by `applyVariantChoices`.
 */
export function llmChoiceAnswers(plan: Pick<ComposePlan, "scenes" | "llmVariantChoices">): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const choice of plan.llmVariantChoices ?? []) {
    const scene = plan.scenes.find((item) => item.sceneId === choice.sceneId);
    const shot = scene?.shots.filter((item) => isGraphicKind(item.source.kind))[choice.n];
    if (shot && shot.source.kind === choice.templateId) answers[shot.id] = choice.key;
  }
  return answers;
}

export function prepareGraphicStyle(input: GraphicStyleRequest): VideoGraphicStyle {
  const shots = input.shots.filter((shot) => isGraphicKind(shot.source.kind));
  const { resolved, variants } = variantInputFor(input, shots.map((shot) => ({ id: shot.id, templateId: shot.source.kind, pinned: pinnedAxes(shot) })));
  let picks = pickVariants(variants);
  if (input.llmChoices && Object.keys(input.llmChoices).length > 0) {
    picks = applyVariantChoices(picks, variantOptions(variants), input.llmChoices);
  }
  const byShot: Record<string, TemplateStyle> = {};
  for (const pick of picks) byShot[pick.shotId] = templateStyle(resolved, pick.axes);
  return {
    fingerprint: resolved.fingerprint,
    byShot,
    packId: resolved.packId,
    packVersion: resolved.packVersion,
    resolved,
    picks,
  };
}

/** The video plan when this shot is in it, otherwise one shot against the same layers. */
export function styleForShot(
  shot: Shot,
  frame: { width: number; height: number },
  ctx: {
    projectId?: string;
    profileId?: string | null;
    recipeId?: string | null;
    brandColor?: string;
    accentColor?: string;
    stylePack?: StylePack | null;
    videoStyle?: VideoGraphicStyle;
  },
): TemplateStyle {
  const planned = ctx.videoStyle?.byShot[shot.id];
  if (planned) return planned;
  const prepared = prepareGraphicStyle({
    projectId: ctx.projectId,
    profileId: ctx.profileId,
    recipeId: ctx.recipeId,
    brandColor: ctx.brandColor,
    accentColor: ctx.accentColor,
    pack: ctx.stylePack,
    width: frame.width,
    height: frame.height,
    shots: [shot],
  });
  return prepared.byShot[shot.id] ?? templateStyle(resolveStyle({}, frame));
}

/** Fills `videoStyle` once for these shots when the caller did not resolve the video already. */
export function withGraphicStyle(
  ctx: ComposeRenderContext,
  shots: Shot[],
  frame: { width: number; height: number },
): ComposeRenderContext {
  if (ctx.videoStyle) return ctx;
  return {
    ...ctx,
    videoStyle: prepareGraphicStyle({
      projectId: ctx.projectId,
      profileId: ctx.profileId,
      recipeId: ctx.recipeId,
      brandColor: ctx.brandColor,
      accentColor: ctx.accentColor,
      pack: ctx.stylePack,
      width: frame.width,
      height: frame.height,
      shots,
    }),
  };
}
