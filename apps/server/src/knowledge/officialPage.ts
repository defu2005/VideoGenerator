import { redactExportText, robotsDisallows } from "@vg/shared";
import { AppError } from "../lib/errors.js";

type FetchPage = (url: string, init?: RequestInit) => Promise<Response>;
/** Shared provider-intel/D1 robots and bounded-body reader. The caller validates official/public origins. */
export async function fetchOfficialPage(url: string, fetchPage: FetchPage, userAgent: string) {
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
