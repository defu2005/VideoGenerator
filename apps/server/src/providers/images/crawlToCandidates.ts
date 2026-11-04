import { createHash } from "node:crypto";
import type { AppConfig } from "../../lib/config.js";
import {
  crawlSourcePage,
  fetchCommonsFileLicense,
  pickLicenseFromHints,
  unknownWebLicense,
  type PageCache,
  type RobotsCache,
  type SafeFetchDependencies,
} from "./webCrawl.js";
import type { FetchJson, NormalizedImageResult } from "./types.js";

export function hashProviderItemId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

/** Crawl source pages and map extracted images to normalized candidates. */
export async function crawlPagesToCandidates(input: {
  pageUrls: string[];
  query: string;
  provider: "brave" | "web-grounding";
  denylist: readonly string[];
  config: AppConfig;
  cache?: PageCache;
  robotsCache?: RobotsCache;
  dependencies?: SafeFetchDependencies;
  fetchImpl?: FetchJson;
  signal?: AbortSignal;
  whyPrefix?: string;
  maxPages?: number;
  maxCandidates?: number;
}): Promise<NormalizedImageResult[]> {
  const maxPages = input.maxPages ?? 8;
  const maxCandidates = input.maxCandidates ?? 12;
  const results: NormalizedImageResult[] = [];
  const seen = new Set<string>();

  for (const pageUrl of input.pageUrls.slice(0, maxPages)) {
    if (results.length >= maxCandidates) break;
    const crawled = await crawlSourcePage({
      pageUrl,
      denylist: input.denylist,
      cache: input.cache,
      robotsCache: input.robotsCache,
      dependencies: { ...input.dependencies, signal: input.signal, fetchImpl: input.fetchImpl },
      config: input.config,
    });
    if (crawled.skipped || crawled.images.length === 0) continue;

    let license = unknownWebLicense();
    let licenseVerified = false;
    const fromHints = pickLicenseFromHints(crawled.licenseHints);
    if (fromHints) {
      license = fromHints.license;
      licenseVerified = fromHints.verified;
    } else {
      try {
        const commons = await fetchCommonsFileLicense(
          crawled.finalUrl,
          input.config,
          input.fetchImpl,
          input.signal,
        );
        if (commons) {
          license = commons.license;
          licenseVerified = commons.verified;
        }
      } catch {
        // keep unknown
      }
    }

    const sourceSite = safeHostname(crawled.finalUrl) || "web";
    for (const image of crawled.images) {
      if (results.length >= maxCandidates) break;
      if (seen.has(image.url)) continue;
      seen.add(image.url);
      const width = image.width && image.width > 0 ? image.width : 1280;
      const height = image.height && image.height > 0 ? image.height : 720;
      const title = crawled.title || image.alt || "";
      const why = `${input.whyPrefix ?? input.provider} result for '${input.query}' from ${sourceSite}`;
      results.push({
        provider: input.provider,
        providerItemId: hashProviderItemId(input.provider, image.url),
        title,
        description: [crawled.description, image.alt].filter(Boolean).join(" — ").slice(0, 500),
        tags: [],
        previewUrl: image.url,
        imageUrl: image.url,
        sourceUrl: crawled.finalUrl,
        sourcePageUrl: crawled.finalUrl,
        sourceSite,
        width,
        height,
        fileType: guessFileType(image.url),
        watermark: "UNKNOWN",
        license,
        licenseVerified,
        why,
        searchQuery: input.query,
        providerPosition: Math.max(0, 1 - results.length / maxCandidates),
      });
    }
  }
  return results;
}

/** Prefer Brave direct image URLs; optionally upgrade license by crawling the source page. */
export async function enrichBraveCandidates(input: {
  candidates: NormalizedImageResult[];
  denylist: readonly string[];
  config: AppConfig;
  cache?: PageCache;
  robotsCache?: RobotsCache;
  dependencies?: SafeFetchDependencies;
  fetchImpl?: FetchJson;
  signal?: AbortSignal;
}): Promise<NormalizedImageResult[]> {
  const enriched: NormalizedImageResult[] = [];
  for (const candidate of input.candidates) {
    const pageUrl = candidate.sourcePageUrl || candidate.sourceUrl;
    let next = { ...candidate };
    try {
      const crawled = await crawlSourcePage({
        pageUrl,
        denylist: input.denylist,
        cache: input.cache,
        robotsCache: input.robotsCache,
        dependencies: { ...input.dependencies, signal: input.signal, fetchImpl: input.fetchImpl },
        config: input.config,
      });
      if (!crawled.skipped) {
        const fromHints = pickLicenseFromHints(crawled.licenseHints);
        if (fromHints) {
          next = { ...next, license: fromHints.license, licenseVerified: fromHints.verified };
        } else {
          const commons = await fetchCommonsFileLicense(crawled.finalUrl, input.config, input.fetchImpl, input.signal);
          if (commons) {
            next = { ...next, license: commons.license, licenseVerified: commons.verified };
          }
        }
        if (crawled.title && !next.title) next = { ...next, title: crawled.title };
        if (crawled.description && !next.description) next = { ...next, description: crawled.description };
      }
    } catch {
      // keep Brave candidate as-is (unverified)
    }
    enriched.push(next);
  }
  return enriched;
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function guessFileType(url: string): string {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "png";
  if (path.endsWith(".webp")) return "webp";
  if (path.endsWith(".gif")) return "gif";
  if (path.endsWith(".svg")) return "svg";
  return "jpeg";
}
