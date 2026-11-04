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
  if (/royalty free|pexels|unsplash/.test(normalized)) return "ROYALTY_FREE";
  if (/pixabay/.test(normalized)) return "PIXABAY";
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

export function normalizePixabayLicense(user: string, pageUrl?: string): LicenseMetadata {
  const author = user.trim() || null;
  return {
    kind: "PIXABAY",
    name: "Pixabay Content License",
    url: "https://pixabay.com/service/license/",
    author,
    authorUrl: isUrl(pageUrl) ? pageUrl : null,
    attributionRequired: false,
    attributionText: author ? `Image by ${author} on Pixabay` : "Pixabay Content License",
    evidence: "api",
  };
}

export function normalizeUnsplashLicense(
  photographer: string,
  photographerUrl?: string,
  photoUrl?: string,
): LicenseMetadata {
  const author = photographer.trim() || null;
  const profile = isUrl(photographerUrl) ? photographerUrl : null;
  const withUtm = (url: string | null) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has("utm_source")) parsed.searchParams.set("utm_source", "videoagent");
      if (!parsed.searchParams.has("utm_medium")) parsed.searchParams.set("utm_medium", "referral");
      return parsed.toString();
    } catch {
      return url;
    }
  };
  const authorLink = withUtm(profile);
  void photoUrl;
  return {
    kind: "ROYALTY_FREE",
    name: "Unsplash License",
    url: "https://unsplash.com/license",
    author,
    authorUrl: authorLink,
    attributionRequired: true,
    attributionText: author
      ? `Photo by ${author} on Unsplash`
      : "Photo on Unsplash",
    evidence: "api",
  };
}

/** Flickr license ids that are CC or public-domain / no known restrictions. */
export const FLICKR_CC_PD_LICENSE_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

export function normalizeFlickrLicense(
  licenseId: number,
  ownerName?: string,
  photoUrl?: string,
): LicenseMetadata | null {
  if (!FLICKR_CC_PD_LICENSE_IDS.has(licenseId)) return null;
  const map: Record<number, { kind: LicenseKind; name: string; url: string | null }> = {
    1: { kind: "CC_BY_NC_SA", name: "CC BY-NC-SA 2.0", url: "https://creativecommons.org/licenses/by-nc-sa/2.0/" },
    2: { kind: "CC_BY_NC", name: "CC BY-NC 2.0", url: "https://creativecommons.org/licenses/by-nc/2.0/" },
    3: { kind: "CC_BY_NC_ND", name: "CC BY-NC-ND 2.0", url: "https://creativecommons.org/licenses/by-nc-nd/2.0/" },
    4: { kind: "CC_BY", name: "CC BY 2.0", url: "https://creativecommons.org/licenses/by/2.0/" },
    5: { kind: "CC_BY_SA", name: "CC BY-SA 2.0", url: "https://creativecommons.org/licenses/by-sa/2.0/" },
    6: { kind: "CC_BY_ND", name: "CC BY-ND 2.0", url: "https://creativecommons.org/licenses/by-nd/2.0/" },
    7: { kind: "PUBLIC_DOMAIN", name: "No known copyright restrictions", url: null },
    8: { kind: "PUBLIC_DOMAIN", name: "United States Government Work", url: null },
    9: { kind: "CC0", name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    10: { kind: "PUBLIC_DOMAIN", name: "Public Domain Mark", url: "https://creativecommons.org/publicdomain/mark/1.0/" },
  };
  const mapped = map[licenseId];
  if (!mapped) return null;
  const author = ownerName?.trim() || null;
  return {
    kind: mapped.kind,
    name: mapped.name,
    url: mapped.url,
    author,
    authorUrl: null,
    attributionRequired: isAttributionRequired(mapped.kind),
    attributionText: author
      ? `Photo by ${author} on Flickr${isUrl(photoUrl) ? ` (${photoUrl})` : ""}`
      : mapped.name,
    evidence: "api",
  };
}

export function normalizeNasaLicense(input: {
  photographer?: string | null;
  center?: string | null;
  title?: string | null;
  nasaId?: string | null;
}): LicenseMetadata {
  const photographer = input.photographer?.trim() || null;
  const center = input.center?.trim() || null;
  const parts = [
    photographer ? `Photographer: ${photographer}` : null,
    center ? `NASA/${center}` : "NASA",
    input.title?.trim() || null,
  ].filter(Boolean);
  return {
    kind: "PUBLIC_DOMAIN",
    name: "NASA Image (public domain)",
    url: input.nasaId
      ? `https://images.nasa.gov/details/${encodeURIComponent(input.nasaId)}`
      : "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    author: photographer ?? (center ? `NASA/${center}` : "NASA"),
    authorUrl: null,
    attributionRequired: false,
    attributionText: parts.join(" · "),
    evidence: "api",
  };
}

export function normalizeMetLicense(artist?: string | null, objectUrl?: string): LicenseMetadata {
  const author = artist?.trim() || null;
  return {
    kind: "CC0",
    name: "CC0 1.0 (The Met Open Access)",
    url: "https://www.metmuseum.org/about-the-met/policies-and-documents/open-access",
    author,
    authorUrl: isUrl(objectUrl) ? objectUrl : null,
    attributionRequired: false,
    attributionText: author
      ? `${author} · The Metropolitan Museum of Art (CC0)`
      : "The Metropolitan Museum of Art (CC0)",
    evidence: "api",
  };
}

export function normalizeLocLicense(rightsText: string, creator?: string | null): LicenseMetadata | null {
  if (!/no known restrictions/i.test(rightsText)) return null;
  const author = creator?.trim() || null;
  return {
    kind: "PUBLIC_DOMAIN",
    name: "No known restrictions on publication",
    url: "https://www.loc.gov/rr/print/195_copr.html",
    author,
    authorUrl: null,
    attributionRequired: false,
    attributionText: author
      ? `${author} · Library of Congress (No known restrictions)`
      : "Library of Congress (No known restrictions)",
    evidence: "api",
  };
}

export function normalizeSmithsonianLicense(access: string, credit?: string | null): LicenseMetadata | null {
  if (access.trim().toUpperCase() !== "CC0") return null;
  const author = credit?.trim() || null;
  return {
    kind: "CC0",
    name: "CC0 (Smithsonian Open Access)",
    url: "https://www.si.edu/openaccess/licenses",
    author,
    authorUrl: null,
    attributionRequired: false,
    attributionText: author
      ? `${author} · Smithsonian Open Access (CC0)`
      : "Smithsonian Open Access (CC0)",
    evidence: "api",
  };
}

export function normalizeEuropeanaLicense(
  rightsUrl: string | undefined,
  creator?: string | null,
): LicenseMetadata {
  const fromUrl = rightsUrl ? licenseFromCcUrl(rightsUrl, creator) : null;
  if (fromUrl) return fromUrl.license;
  const author = creator?.trim() || null;
  return {
    kind: "UNKNOWN",
    name: rightsUrl?.trim() || "Europeana open reuse",
    url: isUrl(rightsUrl) ? rightsUrl : null,
    author,
    authorUrl: null,
    attributionRequired: false,
    attributionText: author ? `By ${author} via Europeana` : "via Europeana",
    evidence: "api",
  };
}

export function normalizeLicense(input: {
  provider: "wikimedia" | "openverse" | "pexels" | "pixabay" | "unsplash";
  metadata?: Record<string, RawValue>;
} & Parameters<typeof normalizeOpenverseLicense>[0] & {
  photographer?: string;
  photographerUrl?: string;
  photoUrl?: string;
  user?: string;
  pageUrl?: string;
}): LicenseMetadata {
  if (input.provider === "wikimedia") return normalizeWikimediaLicense(input.metadata);
  if (input.provider === "openverse") return normalizeOpenverseLicense(input);
  if (input.provider === "pixabay") return normalizePixabayLicense(input.user ?? "", input.pageUrl);
  if (input.provider === "unsplash") {
    return normalizeUnsplashLicense(input.photographer ?? "", input.photographerUrl, input.photoUrl);
  }
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
