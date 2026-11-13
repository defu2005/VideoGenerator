/** Query and source rules for scene images. No network, no LLM. */

export const NEGATIVE_QUERY_TERMS = [
  "cosplay",
  "parade",
  "statue",
  "wallpaper",
  "NASA",
  "marching band",
  "stock photo",
] as const;

export const HIGH_RISK_SOURCE_HOSTS = [
  "reddit.com",
  "redd.it",
  "deviantart.com",
  "pixiv.net",
  "furaffinity.net",
  "zerochan.net",
  "danbooru.donmai.us",
  "gelbooru.org",
  "e621.net",
  "imgur.com",
  "tumblr.com",
  "fandom.com",
  "aminoapps.com",
  "knowyourmeme.com",
  "weheartit.com",
  "artstation.com",
  "behance.net",
  "pinterest.com",
  "pinimg.com",
] as const;

const FICTION_MARKERS = /\b(manga|anime|game|film|movie|novel|fiction|light novel|tiểu thuyết|phim|truyện tranh|visual novel)\b/i;

export const VISUAL_ATTENTION_REASONS = [
  "lowRelevance",
  "vision_reject",
  "vision_missing",
  "invalid_source",
  "no_candidate",
  "source_risk",
] as const;
export type VisualAttentionReason = (typeof VISUAL_ATTENTION_REASONS)[number];

export function workEntity(topic: string): string | null {
  const trimmed = topic.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/);
  if (words.length > 8 || trimmed.length > 80) return null;
  return trimmed;
}

export function ensureEntityPrefix(query: string, entity: string | null | undefined): string {
  const clean = query.trim();
  if (!clean || !entity) return clean;
  if (clean.toLocaleLowerCase().includes(entity.toLocaleLowerCase())) return clean;
  return `${entity} ${clean}`.trim();
}

export function withNegativeTerms(
  query: string,
  sceneText: string,
  terms: readonly string[] = NEGATIVE_QUERY_TERMS,
): string {
  const hay = sceneText.toLocaleLowerCase();
  const extra = terms.filter((term) => term.trim() && !hay.includes(term.toLocaleLowerCase()));
  if (extra.length === 0) return query.trim();
  const flags = extra.map((term) => (term.includes(" ") ? `-"${term}"` : `-${term}`));
  return `${query.trim()} ${flags.join(" ")}`;
}

export function isFictionalWork(input: { topic: string; niche?: string | null }): boolean {
  return FICTION_MARKERS.test(`${input.topic}\n${input.niche ?? ""}`);
}

export function isHighRiskSource(urls: Array<string | null | undefined>): boolean {
  const hosts = urls.flatMap((value) => {
    if (!value) return [];
    try {
      return [new URL(value).hostname.toLocaleLowerCase()];
    } catch {
      return [value.toLocaleLowerCase()];
    }
  });
  return hosts.some((host) => HIGH_RISK_SOURCE_HOSTS.some((denied) => host === denied || host.endsWith(`.${denied}`)));
}

const UNKNOWN_LICENSE_WEB_PROVIDERS = new Set(["brave", "web-grounding"]);

/**
 * UNKNOWN on a web search, or an unverified UNKNOWN licence, is high risk.
 * A stock hit with licenseVerified true stays a ranking penalty only.
 */
export function isUnknownLicenseRisk(input: {
  provider?: string | null;
  licenseKind?: string | null;
  licenseVerified?: boolean | null;
}): boolean {
  if (input.licenseKind !== "UNKNOWN") return false;
  if (input.licenseVerified === false) return true;
  return UNKNOWN_LICENSE_WEB_PROVIDERS.has(input.provider ?? "");
}

export function userOwnsVisualSelection(selection: { selectedBy?: string; status?: string } | null | undefined): boolean {
  if (!selection) return false;
  if (selection.selectedBy === "USER") return true;
  return selection.status === "CUSTOM" || selection.status === "AI_GENERATED";
}

export function visualAttentionReason(input: {
  selection: { selectedBy?: string; status?: string } | null;
  lowRelevance?: boolean;
  visionFit?: number | null;
  visionIssues?: readonly string[];
  sourceRisk?: boolean;
  fitThreshold?: number;
  visionRequired?: boolean;
  hasVisionResult?: boolean;
  invalidSource?: boolean;
}): VisualAttentionReason | null {
  if (!input.selection || userOwnsVisualSelection(input.selection)) return null;
  if (input.invalidSource) return "invalid_source";
  if (input.sourceRisk) return "source_risk";
  if (input.lowRelevance) return "lowRelevance";
  const issues = input.visionIssues ?? [];
  if (issues.some((issue) => issue === "wrong_subject" || issue === "watermark" || issue === "nsfw" || issue === "logo_only")) {
    return "vision_reject";
  }
  const threshold = input.fitThreshold ?? 7;
  if (input.visionFit != null && input.visionFit < threshold) return "vision_reject";
  if (input.visionRequired && input.hasVisionResult !== true) return "vision_missing";
  return null;
}
