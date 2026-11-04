import type { LicenseKind } from "../enums.js";
import type { LicenseMetadata } from "../schemas/visual.js";

type RawValue = { value?: string; source?: string } | string | null | undefined;

function rawText(value: RawValue): string {
  return typeof value === "string" ? value : value?.value ?? "";
}

function cleanHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(?:p|div)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function licenseKind(value: string): LicenseKind {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (/^(cc0|cc0 1\.0|creative commons zero)$/.test(normalized)) return "CC0";
  if (/^(public domain|pdm)$/.test(normalized)) return "PUBLIC_DOMAIN";
  if (/cc by nc nd|by nc nd/.test(normalized)) return "CC_BY_NC_ND";
  if (/cc by nc sa|by nc sa/.test(normalized)) return "CC_BY_NC_SA";
  if (/cc by nd|by nd/.test(normalized)) return "CC_BY_ND";
  if (/cc by nc|by nc/.test(normalized)) return "CC_BY_NC";
  if (/cc by sa|by sa/.test(normalized)) return "CC_BY_SA";
  if (/cc by|^by$/.test(normalized)) return "CC_BY";
  if (/royalty free|pexels/.test(normalized)) return "ROYALTY_FREE";
  if (/all rights reserved/.test(normalized)) return "ALL_RIGHTS_RESERVED";
  return "UNKNOWN";
}

function isAttributionRequired(kind: LicenseKind): boolean {
  return kind === "CC_BY" || kind === "CC_BY_SA" || kind === "CC_BY_NC"
    || kind === "CC_BY_ND" || kind === "CC_BY_NC_SA" || kind === "CC_BY_NC_ND";
}

export function normalizeWikimediaLicense(metadata: Record<string, RawValue> = {}): LicenseMetadata {
  const original = cleanHtml(rawText(metadata.LicenseShortName) || rawText(metadata.UsageTerms));
  const kind = licenseKind(original);
  const author = cleanHtml(rawText(metadata.Artist) || rawText(metadata.Credit)) || null;
  const credit = cleanHtml(rawText(metadata.Credit));
  const attributionFlag = rawText(metadata.AttributionRequired).toLowerCase();
  const attributionRequired = attributionFlag
    ? attributionFlag === "true" || attributionFlag === "1" || attributionFlag === "yes"
    : isAttributionRequired(kind);
  const url = rawText(metadata.LicenseUrl).trim();
  return {
    kind,
    name: original || "Unknown license",
    url: isUrl(url) ? url : null,
    author,
    authorUrl: null,
    attributionRequired,
    attributionText: credit || (author ? `By ${author}` : ""),
    evidence: "api",
  };
}

export function normalizeOpenverseLicense(input: {
  license?: string | null;
  license_version?: string | null;
  license_url?: string | null;
  creator?: string | null;
  creator_url?: string | null;
  attribution?: string | null;
}): LicenseMetadata {
  const raw = input.license ?? "";
  const kind = licenseKind(raw);
  return {
    kind,
    name: raw ? `${raw}${input.license_version ? ` ${input.license_version}` : ""}` : "Unknown license",
    url: isUrl(input.license_url) ? input.license_url : null,
    author: input.creator?.trim() || null,
    authorUrl: isUrl(input.creator_url) ? input.creator_url : null,
    attributionRequired: isAttributionRequired(kind),
    attributionText: input.attribution?.trim() || "",
    evidence: "api",
  };
}

export function normalizePexelsLicense(photographer: string, photographerUrl?: string): LicenseMetadata {
  const author = photographer.trim() || null;
  return {
    kind: "ROYALTY_FREE",
    name: "Pexels License",
    url: "https://www.pexels.com/license/",
    author,
    authorUrl: isUrl(photographerUrl) ? photographerUrl : null,
    attributionRequired: false,
    attributionText: author ? `Photo by ${author} on Pexels` : "Pexels License",
    evidence: "api",
  };
}

export function normalizeLicense(input: {
  provider: "wikimedia" | "openverse" | "pexels";
  metadata?: Record<string, RawValue>;
} & Parameters<typeof normalizeOpenverseLicense>[0] & {
  photographer?: string;
  photographerUrl?: string;
}): LicenseMetadata {
  if (input.provider === "wikimedia") return normalizeWikimediaLicense(input.metadata);
  if (input.provider === "openverse") return normalizeOpenverseLicense(input);
  return normalizePexelsLicense(input.photographer ?? "", input.photographerUrl);
}

/** Map a Creative Commons / PD license URL (or nearby text) to metadata. Returns null if unrecognized. */
export function licenseFromCcUrl(
  urlOrText: string,
  author?: string | null,
): { license: LicenseMetadata; verified: boolean } | null {
  const raw = urlOrText.trim();
  if (!raw) return null;
  let kind: LicenseKind | null = null;
  let name = "";
  let url: string | null = null;
  const lower = raw.toLowerCase();
  if (/creativecommons\.org\/publicdomain\/zero/i.test(lower) || /\/publicdomain\/zero\//i.test(lower)) {
    kind = "CC0";
    name = "CC0 1.0";
  } else if (/creativecommons\.org\/publicdomain\/mark/i.test(lower) || /\bpublic.?domain\b/i.test(lower) && /creativecommons\.org/i.test(lower)) {
    kind = "PUBLIC_DOMAIN";
    name = "Public Domain Mark";
  } else if (/creativecommons\.org\/licenses\//i.test(lower)) {
    const match = lower.match(/creativecommons\.org\/licenses\/([a-z0-9-]+)/i);
    const slug = match?.[1] ?? "";
    kind = licenseKind(slug.replace(/-/g, " "));
    if (kind === "UNKNOWN") return null;
    name = `CC ${slug.toUpperCase().replace(/-/g, "-")}`;
  } else {
    const guessed = licenseKind(raw);
    if (guessed === "UNKNOWN" || guessed === "ALL_RIGHTS_RESERVED" || guessed === "ROYALTY_FREE" || guessed === "USER_PROVIDED") {
      return null;
    }
    kind = guessed;
    name = raw;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") url = parsed.toString();
  } catch {
    url = null;
  }
  const authorText = author?.trim() || null;
  return {
    verified: true,
    license: {
      kind,
      name: name || kind,
      url,
      author: authorText,
      authorUrl: null,
      attributionRequired: isAttributionRequired(kind),
      attributionText: authorText ? `By ${authorText}` : "",
      evidence: "page_meta",
    },
  };
}

function isUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:" || new URL(value).protocol === "http:";
  } catch {
    return false;
  }
}
