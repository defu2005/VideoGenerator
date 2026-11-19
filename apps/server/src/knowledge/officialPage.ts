import { redactExportText, robotsDisallows } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { fetchResponseSafely, type SafeFetchDependencies } from "../providers/images/webCrawl.js";

type FetchPage = (url: string, init?: RequestInit) => Promise<Response>;
/** Shared provider-intel/D1 robots and bounded-body reader. The caller validates official/public origins. */
export async function fetchOfficialPage(url: string, fetchPage: FetchPage, userAgent: string,
  safety?: { validateUrl: (url: string) => Promise<unknown>; resolveHost?: SafeFetchDependencies["resolveHost"] }) {
  if (safety) return fetchPublicPage(url, fetchPage, userAgent, safety);
  const target = new URL(url);
  const headers = { "user-agent": userAgent, accept: "text/html,application/json,text/plain,application/rss+xml,application/atom+xml" };
  const robots = await fetchPage(new URL("/robots.txt", target).href, { headers, signal: AbortSignal.timeout(15_000) });
  const robotsText = await boundedText(robots);
  if (!robots.ok || robotsDisallows(robotsText, target.pathname || "/")) throw new AppError(403, "ROBOTS_DISALLOW", "robots.txt không cho phép lấy trang này.");
  const response = await fetchPage(url, { headers, signal: AbortSignal.timeout(15_000) });
  const raw = await boundedText(response);
  const finalUrl = response.headers.get("location") ? new URL(response.headers.get("location")!, url).href : response.url || url;
  const canonical = raw.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
  return { status: response.status, ok: response.ok, url: finalUrl, text: redactExportText(raw).slice(0, 60_000),
    canonical: canonical ? new URL(canonical, url).href : null };
}
/** Public research uses the same bounded reader/robots policy with manual, validated redirects. */
async function fetchPublicPage(initial: string, fetchPage: FetchPage, userAgent: string,
  safety: { validateUrl: (url: string) => Promise<unknown>; resolveHost?: SafeFetchDependencies["resolveHost"] }) {
  const options = { userAgent, resolveHost: safety.resolveHost, timeoutMs: 15_000, method: "GET" as const, allowHttpErrors: true,
    fetchImpl: (value: string | URL | Request, init?: RequestInit) => fetchPage(String(value), { ...init, credentials: "omit" }),
  };
  async function robots(url: string) {
      const { response } = await fetchResponseSafely(new URL("/robots.txt", url).href, { ...options, beforeRequest: async (target) => { await safety.validateUrl(target.href); } });
      const text = await boundedText(response);
      if (!response.ok || robotsDisallows(text, new URL(url).pathname)) throw new AppError(403, "ROBOTS_DISALLOW", "Không thể xác nhận robots.txt cho trang.");
  }
    const { url, response } = await fetchResponseSafely(initial, { ...options, beforeRequest: async (target) => { await safety.validateUrl(target.href); await robots(target.href); } });
    const raw = await boundedText(response);
    return { status: response.status, ok: response.ok, url, text: redactExportText(raw).slice(0, 60_000), canonical: null };
}
async function boundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > 2_000_000) { await reader.cancel(); throw new Error("Trang vượt giới hạn đọc."); }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}
