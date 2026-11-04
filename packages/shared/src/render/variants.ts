import type { AccountFormat } from "../schemas/profile.js";
import type { RenderVariantAspect } from "../schemas/render.js";
import { defaultMaxCharsPerLine } from "../subtitles/index.js";
import { renderTargetFor } from "../timeline/build.js";

/** TikTok / Reels soft limit used only for a render warning (never cuts the video). */
export const VERTICAL_DURATION_WARN_SEC = 180;

export function aspectFromAccountFormat(format: AccountFormat): RenderVariantAspect {
  return format === "vertical" ? "9:16" : "16:9";
}

/** Unique aspects required by enabled profile accounts. */
export function aspectsNeededFromAccounts(
  accounts: Array<{ format: AccountFormat; enabled?: boolean }>,
): RenderVariantAspect[] {
  const needed = new Set<RenderVariantAspect>();
  for (const account of accounts) {
    if (account.enabled === false) continue;
    needed.add(aspectFromAccountFormat(account.format));
  }
  return [...needed].sort();
}

/**
 * Aspects that still need a finished render.
 * A row with null `aspectRatio` counts as the project's default aspect.
 */
export function missingRenderAspects(input: {
  needed: RenderVariantAspect[];
  projectAspect: "16:9" | "9:16" | "1:1";
  existing: Array<{ aspectRatio?: "16:9" | "9:16" | "1:1" | null; status: string; deleted?: boolean }>;
}): RenderVariantAspect[] {
  const done = new Set<string>();
  for (const row of input.existing) {
    if (row.status !== "DONE" || row.deleted) continue;
    const aspect = row.aspectRatio ?? input.projectAspect;
    done.add(aspect);
  }
  return input.needed.filter((aspect) => !done.has(aspect));
}

export function renderAspectLabel(aspect: "16:9" | "9:16" | "1:1" | null | undefined): string {
  if (aspect === "9:16") return "Dọc 9:16";
  if (aspect === "1:1") return "Vuông 1:1";
  return "Ngang 16:9";
}

/** Encode / decode the aspectRatio carried on a RENDER job's `scope`. */
export function renderJobScope(aspectRatio?: RenderVariantAspect | null): string | null {
  if (!aspectRatio) return null;
  return `aspect:${aspectRatio}`;
}

export function parseRenderJobScope(scope: string | null | undefined): RenderVariantAspect | null {
  if (!scope) return null;
  if (scope === "aspect:9:16") return "9:16";
  if (scope === "aspect:16:9") return "16:9";
  return null;
}

export type SubtitleLayout = {
  aspectRatio: "16:9" | "9:16" | "1:1";
  width: number;
  height: number;
  maxCharsPerLine: number;
  fontSize: number;
  /** ASS MarginV — distance from the bottom edge. */
  marginBottom: number;
};

/**
 * Subtitle layout for a given output aspect.
 * Vertical: ~60% of the landscape maxChars (min 16), larger font vs width,
 * lower-third placement above the bottom 15% TikTok/Reels safe zone.
 */
export function subtitleLayoutForAspect(
  aspectRatio: "16:9" | "9:16" | "1:1",
  landscapeMaxChars?: number,
): SubtitleLayout {
  const { width, height } = renderTargetFor(aspectRatio);
  if (aspectRatio === "9:16") {
    const base = Number.isFinite(landscapeMaxChars) && Number(landscapeMaxChars) > 0
      ? Number(landscapeMaxChars)
      : defaultMaxCharsPerLine("16:9");
    return {
      aspectRatio,
      width,
      height,
      maxCharsPerLine: Math.max(16, Math.round(base * 0.6)),
      fontSize: Math.round(width * 0.055),
      // Above the bottom 15% UI chrome; still in the lower third (~18% from bottom).
      marginBottom: Math.round(height * 0.18),
    };
  }
  return {
    aspectRatio,
    width,
    height,
    maxCharsPerLine: defaultMaxCharsPerLine(aspectRatio),
    fontSize: Math.round(height * 0.05),
    marginBottom: Math.round(height * 0.08),
  };
}
