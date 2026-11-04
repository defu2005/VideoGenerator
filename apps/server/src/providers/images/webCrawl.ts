import { isIP } from "node:net";
import { licenseFromCcUrl, normalizeWikimediaLicense, type LicenseMetadata } from "@vg/shared";
import { defaultResolveHost, isBlockedHostname } from "../../services/imageStore.js";
import { HostDownloadRateLimiter } from "./rateLimiter.js";
import { fetchJsonWithRetry } from "./http.js";
import type { AppConfig } from "../../lib/config.js";
import type { FetchJson } from "./types.js";

export const WEB_CRAWL_USER_AGENT = "videoGenerator/1.0 (+local app)";
export const WEB_CRAWL_MAX_HTML_BYTES = 2 * 1024 * 1024;
export const WEB_CRAWL_TIMEOUT_MS = 10_000;
export const WEB_CRAWL_MAX_REDIRECTS = 3;
export const WEB_CRAWL_MAX_IMAGES = 5;
const MIN_IMAGE_SIDE = 320;

export type PageImageCandidate = {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
};

export type ExtractedPageImages = {
  images: PageImageCandidate[];
  title: string;
  description: string;
  licenseHints: string[];
};

export type RobotsRules = {
  isAllowed(path: string): boolean;
};

export type PageCache = {
  get(key: string): string | undefined;
  put(key: string, value: string): void;
};

export type SafeFetchDependencies = {
  fetchImpl?: FetchJson;
  resolveHost?: (hostname: string) => Promise<string[]>;
  hostRateLimiter?: HostDownloadRateLimiter;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
  signal?: AbortSignal;
};

export class WebCrawlError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "WebCrawlError";
  }
}

/** Validate http(s) URL and block private / loopback / link-local hosts (SSRF). */
export async function validatePublicHttpUrl(
  value: string,
  resolveHost: (hostname: string) => Promise<string[]> = defaultResolveHost,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebCrawlError("URL is invalid.", "INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebCrawlError("Only HTTP and HTTPS URLs are allowed.", "INVALID_PROTOCOL");
  }
  if (url.username || url.password) {
    throw new WebCrawlError("URLs with embedded credentials are not allowed.", "CREDENTIALS");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isBlockedHostname(hostname)) {
    throw new WebCrawlError("URL points to a private, loopback, or link-local host.", "SSRF");
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 0) {
    let addresses: string[];
    try {
      addresses = await resolveHost(hostname);
    } catch (error) {
      throw new WebCrawlError(
        `Host could not be resolved: ${error instanceof Error ? error.message : String(error)}.`,
        "DNS",
      );
    }
    if (addresses.length === 0 || addresses.some(isBlockedHostname)) {
      throw new WebCrawlError("URL resolves to a private, loopback, or link-local host.", "SSRF");
    }
  }
  return url;
}

/** Match hostname (and parents) against a denylist. Always denies pinterest.* / pinimg.com. */
export function isDeniedHost(hostname: string, denylist: readonly string[] = []): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "pinimg.com" || host.endsWith(".pinimg.com")) return true;
  if (host === "pinterest.com" || host.endsWith(".pinterest.com") || /^pinterest\./.test(host)) return true;
  for (const entry of denylist) {
    const denied = entry.trim().toLowerCase();
    if (!denied) continue;
    if (host === denied || host.endsWith(`.${denied}`)) return true;
  }
  return false;
}

export function parseDomainDenylist(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value !== "string") {
    return value.map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/**
 * Parse robots.txt for the given User-Agent (falls back to `*`).
 * Only implements Disallow / Allow / User-agent — enough for crawl skip checks.
 */
export function parseRobotsTxt(text: string, userAgent: string): RobotsRules {
  const ua = userAgent.trim().toLowerCase();
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: { agents: string[]; rules: { allow: boolean; path: string }[] } | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length > 0 || current.agents.length === 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (key === "disallow") current.rules.push({ allow: false, path: value });
    else if (key === "allow") current.rules.push({ allow: true, path: value });
  }

  const matching = groups.filter((group) => group.agents.some((agent) => agent === "*" || ua.includes(agent) || agent.includes(ua)));
  const specific = matching.filter((group) => group.agents.some((agent) => agent !== "*"));
  const rules = (specific.length > 0 ? specific : matching).flatMap((group) => group.rules);

  return {
    isAllowed(path: string): boolean {
      const target = path.startsWith("/") ? path : `/${path}`;
      let decision: boolean | undefined;
      let bestLength = -1;
      for (const rule of rules) {
        if (rule.path === "") {
          // Empty Disallow means allow all for this agent group.
          if (!rule.allow) {
            if (bestLength < 0) {
              decision = true;
              bestLength = 0;
            }
          }
          continue;
        }
        if (!target.startsWith(rule.path)) continue;
        if (rule.path.length >= bestLength) {
          bestLength = rule.path.length;
          decision = rule.allow;
        }
      }
      return decision ?? true;
    },
  };
}

export function resolveRedirectUrl(current: URL, location: string): string {
  return new URL(location, current).toString();
}

/** Follow redirects manually with SSRF checks on every hop. Returns final URL (HEAD/GET). */
export async function followRedirectsSafely(
  initialUrl: string,
  dependencies: SafeFetchDependencies & { method?: "HEAD" | "GET" } = {},
): Promise<string> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost;
  const maxRedirects = dependencies.maxRedirects ?? WEB_CRAWL_MAX_REDIRECTS;
  const userAgent = dependencies.userAgent ?? WEB_CRAWL_USER_AGENT;
  const timeoutMs = dependencies.timeoutMs ?? WEB_CRAWL_TIMEOUT_MS;
  let current = initialUrl;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const parsed = await validatePublicHttpUrl(current, resolveHost);
    if (dependencies.hostRateLimiter) {
      await dependencies.hostRateLimiter.acquire(parsed.hostname, dependencies.signal);
    }
    const response = await fetchImpl(parsed, {
      method: dependencies.method ?? "HEAD",
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      redirect: "manual",
      signal: AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(dependencies.signal ? [dependencies.signal] : []),
      ]),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new WebCrawlError("Redirect missing Location header.", "REDIRECT");
      if (redirect === maxRedirects) throw new WebCrawlError("Exceeded maximum redirects.", "REDIRECT");
      current = resolveRedirectUrl(parsed, location);
      continue;
    }
    await response.body?.cancel();
    if (!response.ok && response.status !== 405 && response.status !== 501) {
      // Some hosts reject HEAD; caller may retry with GET. Still return the validated URL.
      if (dependencies.method === "HEAD" && (response.status === 405 || response.status === 501)) {
        return parsed.toString();
      }
    }
    return parsed.toString();
  }
  throw new WebCrawlError("Exceeded maximum redirects.", "REDIRECT");
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new WebCrawlError("HTML exceeds the 2 MB download limit.", "TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

/** Fetch HTML through the SSRF-safe path (manual redirects, size/time limits, rate limit). */
export async function fetchHtmlSafe(
  initialUrl: string,
  dependencies: SafeFetchDependencies = {},
): Promise<{ url: string; html: string }> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const resolveHost = dependencies.resolveHost ?? defaultResolveHost;
  const maxRedirects = dependencies.maxRedirects ?? WEB_CRAWL_MAX_REDIRECTS;
  const maxBytes = dependencies.maxBytes ?? WEB_CRAWL_MAX_HTML_BYTES;
  const userAgent = dependencies.userAgent ?? WEB_CRAWL_USER_AGENT;
  const timeoutMs = dependencies.timeoutMs ?? WEB_CRAWL_TIMEOUT_MS;
  let current = initialUrl;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const parsed = await validatePublicHttpUrl(current, resolveHost);
    if (dependencies.hostRateLimiter) {
      await dependencies.hostRateLimiter.acquire(parsed.hostname, dependencies.signal);
    }
    const response = await fetchImpl(parsed, {
      method: "GET",
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      redirect: "manual",
      signal: AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(dependencies.signal ? [dependencies.signal] : []),
      ]),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new WebCrawlError("Redirect missing Location header.", "REDIRECT");
      if (redirect === maxRedirects) throw new WebCrawlError("Exceeded maximum redirects.", "REDIRECT");
      current = resolveRedirectUrl(parsed, location);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new WebCrawlError(`Page returned HTTP ${response.status}.`, "HTTP");
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new WebCrawlError("HTML exceeds the 2 MB download limit.", "TOO_LARGE");
    }
    const html = await readBoundedText(response, maxBytes);
    return { url: parsed.toString(), html };
  }
  throw new WebCrawlError("Exceeded maximum redirects.", "REDIRECT");
}

export class RobotsCache {
  private readonly cache = new Map<string, RobotsRules>();

  constructor(private readonly dependencies: SafeFetchDependencies = {}) {}

  async forHost(origin: string): Promise<RobotsRules> {
    const base = new URL(origin);
    const key = base.host.toLowerCase();
    const hit = this.cache.get(key);
    if (hit) return hit;
    const robotsUrl = `${base.protocol}//${base.host}/robots.txt`;
    let rules: RobotsRules = { isAllowed: () => true };
    try {
      const { html } = await fetchHtmlSafe(robotsUrl, this.dependencies);
      rules = parseRobotsTxt(html, this.dependencies.userAgent ?? WEB_CRAWL_USER_AGENT);
    } catch {
      // Missing/unreachable robots.txt → allow (standard crawler courtesy).
      rules = { isAllowed: () => true };
    }
    this.cache.set(key, rules);
    return rules;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function resolveMaybeRelative(base: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = decodeHtmlEntities(value.trim());
  if (!trimmed || trimmed.startsWith("data:")) return undefined;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return undefined;
  }
}

function metaContent(html: string, propertyOrName: string): string | undefined {
  const escaped = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta\\s+[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta\\s+[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return undefined;
}

function extractTitle(html: string): string {
  const og = metaContent(html, "og:title");
  if (og) return og;
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : "";
}

function extractLicenseHints(html: string, pageUrl: string): string[] {
  const hints: string[] = [];
  const linkLicense = /<link\s+[^>]*rel\s*=\s*["'][^"']*\blicense\b[^"']*["'][^>]*>/gi;
  for (const tag of html.match(linkLicense) ?? []) {
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const resolved = resolveMaybeRelative(pageUrl, href);
    if (resolved) hints.push(resolved);
  }
  const anchorLicense = /<a\s+[^>]*rel\s*=\s*["'][^"']*\blicense\b[^"']*["'][^>]*>/gi;
  for (const tag of html.match(anchorLicense) ?? []) {
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const resolved = resolveMaybeRelative(pageUrl, href);
    if (resolved) hints.push(resolved);
  }
  const ccUrls = html.match(/https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\/[^\s"'<>]+/gi) ?? [];
  for (const url of ccUrls) hints.push(url.replace(/[.,);]+$/, ""));
  return [...new Set(hints)];
}

function parseSrcsetLargest(srcset: string, pageUrl: string): string | undefined {
  let bestUrl: string | undefined;
  let bestScore = -1;
  for (const part of srcset.split(",")) {
    const bits = part.trim().split(/\s+/);
    const candidate = bits[0];
    if (!candidate) continue;
    const descriptor = bits[1] ?? "";
    let score = 1;
    const widthMatch = descriptor.match(/^(\d+)w$/i);
    const densityMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
    if (widthMatch) score = Number(widthMatch[1]);
    else if (densityMatch) score = Number(densityMatch[1]) * 1000;
    const resolved = resolveMaybeRelative(pageUrl, candidate);
    if (!resolved) continue;
    if (score > bestScore) {
      bestScore = score;
      bestUrl = resolved;
    }
  }
  return bestUrl;
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))
    ?? tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, "i"));
  return match?.[1] ? decodeHtmlEntities(match[1]) : undefined;
}

function nearbyFigcaption(html: string, imgIndex: number): string | undefined {
  const windowStart = Math.max(0, imgIndex - 400);
  const windowEnd = Math.min(html.length, imgIndex + 800);
  const slice = html.slice(windowStart, windowEnd);
  const match = slice.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
  if (!match?.[1]) return undefined;
  return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractJsonLdImages(html: string, pageUrl: string): PageImageCandidate[] {
  const images: PageImageCandidate[] = [];
  const scriptPattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      collectJsonLdImages(data, pageUrl, images);
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return images;
}

function collectJsonLdImages(value: unknown, pageUrl: string, out: PageImageCandidate[]): void {
  if (!value) return;
  if (typeof value === "string") {
    const resolved = resolveMaybeRelative(pageUrl, value);
    if (resolved) out.push({ url: resolved });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdImages(item, pageUrl, out);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if ("image" in record) collectJsonLdImages(record.image, pageUrl, out);
  if (typeof record.url === "string" && (record["@type"] === "ImageObject" || record.type === "ImageObject")) {
    const resolved = resolveMaybeRelative(pageUrl, record.url);
    if (resolved) {
      out.push({
        url: resolved,
        width: typeof record.width === "number" ? record.width : undefined,
        height: typeof record.height === "number" ? record.height : undefined,
      });
    }
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectJsonLdImages(nested, pageUrl, out);
  }
}

function pushUnique(images: PageImageCandidate[], candidate: PageImageCandidate | undefined): void {
  if (!candidate?.url) return;
  if (images.some((item) => item.url === candidate.url)) return;
  images.push(candidate);
}

/** Cheap regex/attribute scan — no DOM dependency. Max 5 images. */
export function extractPageImages(html: string, pageUrl: string): ExtractedPageImages {
  const images: PageImageCandidate[] = [];
  const title = extractTitle(html);
  const description = metaContent(html, "og:description")
    ?? metaContent(html, "description")
    ?? "";
  const licenseHints = extractLicenseHints(html, pageUrl);

  for (const property of ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]) {
    const content = metaContent(html, property);
    const resolved = resolveMaybeRelative(pageUrl, content);
    if (resolved) pushUnique(images, { url: resolved });
  }

  const imageSrcLinks = html.match(/<link\s+[^>]*rel\s*=\s*["'][^"']*\bimage_src\b[^"']*["'][^>]*>/gi) ?? [];
  for (const tag of imageSrcLinks) {
    const resolved = resolveMaybeRelative(pageUrl, attr(tag, "href"));
    if (resolved) pushUnique(images, { url: resolved });
  }

  for (const candidate of extractJsonLdImages(html, pageUrl)) {
    pushUnique(images, candidate);
  }

  const imgPattern = /<img\b[^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  const sized: PageImageCandidate[] = [];
  while ((imgMatch = imgPattern.exec(html)) !== null) {
    const tag = imgMatch[0];
    const width = Number(attr(tag, "width")) || undefined;
    const height = Number(attr(tag, "height")) || undefined;
    const alt = attr(tag, "alt") || nearbyFigcaption(html, imgMatch.index);
    const srcset = attr(tag, "srcset");
    const src = attr(tag, "src");
    const fromSrcset = srcset ? parseSrcsetLargest(srcset, pageUrl) : undefined;
    const resolved = fromSrcset ?? resolveMaybeRelative(pageUrl, src);
    if (!resolved) continue;
    const candidate: PageImageCandidate = { url: resolved, alt, width, height };
    if (width && height && Math.min(width, height) >= MIN_IMAGE_SIDE) {
      sized.push(candidate);
    } else if (fromSrcset) {
      sized.push(candidate);
    }
  }
  for (const candidate of sized) pushUnique(images, candidate);

  return {
    images: images.slice(0, WEB_CRAWL_MAX_IMAGES),
    title,
    description,
    licenseHints,
  };
}

export function pickLicenseFromHints(
  hints: readonly string[],
  author?: string | null,
): { license: LicenseMetadata; verified: boolean } | null {
  for (const hint of hints) {
    const mapped = licenseFromCcUrl(hint, author);
    if (mapped) return mapped;
  }
  return null;
}

export function unknownWebLicense(): LicenseMetadata {
  return {
    kind: "UNKNOWN",
    name: "Unknown license",
    url: null,
    author: null,
    authorUrl: null,
    attributionRequired: false,
    attributionText: "",
    evidence: "none",
  };
}

const COMMONS_FILE_PATH = /\/wiki\/File:(.+)$/i;

export function isWikimediaCommonsFilePage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "commons.wikimedia.org" && host !== "commons.m.wikimedia.org") return false;
    return COMMONS_FILE_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

type CommonsImageinfoResponse = {
  query?: {
    pages?: Record<string, {
      imageinfo?: {
        extmetadata?: Record<string, { value?: string }>;
      }[];
    }>;
  };
};

/** Resolve license for a Commons File: page via the imageinfo API (same props as wikimedia search). */
export async function fetchCommonsFileLicense(
  pageUrl: string,
  config: AppConfig,
  fetchImpl?: FetchJson,
  signal?: AbortSignal,
): Promise<{ license: LicenseMetadata; verified: boolean } | null> {
  if (!isWikimediaCommonsFilePage(pageUrl)) return null;
  const parsed = new URL(pageUrl);
  const match = parsed.pathname.match(COMMONS_FILE_PATH);
  if (!match?.[1]) return null;
  const title = `File:${decodeURIComponent(match[1].replace(/_/g, " "))}`;
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({
    action: "query",
    format: "json",
    titles: title,
    prop: "imageinfo",
    iiprop: "extmetadata",
  }).toString();
  const data = await fetchJsonWithRetry({
    url: api,
    config,
    fetchImpl,
    signal,
    init: { headers: { "User-Agent": WEB_CRAWL_USER_AGENT } },
  }) as CommonsImageinfoResponse;
  const page = Object.values(data.query?.pages ?? {})[0];
  const metadata = page?.imageinfo?.[0]?.extmetadata;
  if (!metadata) return null;
  const license = normalizeWikimediaLicense(metadata);
  if (license.kind === "UNKNOWN") return { license, verified: false };
  return { license, verified: true };
}

export type CrawlPageResult = ExtractedPageImages & {
  finalUrl: string;
  skipped?: "denylist" | "robots" | "ssrf" | "error";
  skipReason?: string;
};

/**
 * Crawl one source page: denylist → robots → fetch → extract.
 * Cache get/put are injectable (caller typically uses image_search_cache).
 */
export async function crawlSourcePage(input: {
  pageUrl: string;
  denylist?: readonly string[];
  cache?: PageCache;
  robotsCache?: RobotsCache;
  dependencies?: SafeFetchDependencies;
  config?: AppConfig;
  fetchCommonsLicense?: boolean;
}): Promise<CrawlPageResult> {
  const dependencies = {
    userAgent: WEB_CRAWL_USER_AGENT,
    timeoutMs: WEB_CRAWL_TIMEOUT_MS,
    maxRedirects: WEB_CRAWL_MAX_REDIRECTS,
    maxBytes: WEB_CRAWL_MAX_HTML_BYTES,
    ...input.dependencies,
  };
  let parsed: URL;
  try {
    parsed = await validatePublicHttpUrl(input.pageUrl, dependencies.resolveHost ?? defaultResolveHost);
  } catch (error) {
    return {
      finalUrl: input.pageUrl,
      images: [],
      title: "",
      description: "",
      licenseHints: [],
      skipped: error instanceof WebCrawlError && error.code === "SSRF" ? "ssrf" : "error",
      skipReason: error instanceof Error ? error.message : String(error),
    };
  }

  if (isDeniedHost(parsed.hostname, input.denylist ?? [])) {
    return {
      finalUrl: parsed.toString(),
      images: [],
      title: "",
      description: "",
      licenseHints: [],
      skipped: "denylist",
      skipReason: `Denied host: ${parsed.hostname}`,
    };
  }

  const cacheKey = `webcrawl:v1:${parsed.toString()}`;
  const cached = input.cache?.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as CrawlPageResult;
    } catch {
      // fall through
    }
  }

  const robots = input.robotsCache ?? new RobotsCache(dependencies);
  try {
    const rules = await robots.forHost(parsed.origin);
    if (!rules.isAllowed(parsed.pathname + parsed.search)) {
      const skipped: CrawlPageResult = {
        finalUrl: parsed.toString(),
        images: [],
        title: "",
        description: "",
        licenseHints: [],
        skipped: "robots",
        skipReason: "Disallowed by robots.txt",
      };
      input.cache?.put(cacheKey, JSON.stringify(skipped));
      return skipped;
    }
  } catch {
    // treat robots failure as allow
  }

  try {
    const { url: finalUrl, html } = await fetchHtmlSafe(parsed.toString(), dependencies);
    const extracted = extractPageImages(html, finalUrl);
    const result: CrawlPageResult = { ...extracted, finalUrl };
    input.cache?.put(cacheKey, JSON.stringify(result));
    return result;
  } catch (error) {
    return {
      finalUrl: parsed.toString(),
      images: [],
      title: "",
      description: "",
      licenseHints: [],
      skipped: "error",
      skipReason: error instanceof Error ? error.message : String(error),
    };
  }
}
