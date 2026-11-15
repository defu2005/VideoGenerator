import { z } from "zod";
import { PROTECTED_PROJECT_ID, redactExportText, redactOperatorText } from "@vg/shared";
import { generateRoutedStructured } from "../llm/structured.js";
import type { LlmProviderRegistry, ResolvedLlmRoute } from "../llm/registry.js";
import type { LlmCache } from "../llm/cache.js";

export function researchQuery(raw: string, privateValues: readonly string[] = []): string {
  let query = redactExportText(redactOperatorText(raw));
  for (const value of [PROTECTED_PROJECT_ID, ...privateValues].filter(Boolean).sort((a, b) => b.length - a.length)) {
    query = query.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[private]");
  }
  return query.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[private]")
    .replace(/\b[A-Za-z0-9_-]{28,}\b/g, "[private]")
    .replace(/\d[\d.,%]*/g, "[number]").replace(/\s+/g, " ").trim().slice(0, 200);
}
const SearchResultSchema = z.object({ sources: z.array(z.object({ url: z.url(), title: z.string() })).max(100) });
export type SearchResult = { status: "ok" | "unavailable"; results: Array<{ url: string; title: string }>; usage?: Awaited<ReturnType<typeof generateRoutedStructured>>["usage"] };

/** Existing routed accounting/quota/fallback path; source URLs come exclusively from Gemini metadata. */
export async function searchPublicWeb(input: {
  query: string; site?: string; recency?: string; privateValues?: readonly string[];
  registry: LlmProviderRegistry; route: ResolvedLlmRoute; signal: AbortSignal; beforeProviderCall?: () => void;
  cache?: LlmCache;
}): Promise<SearchResult> {
  const query = researchQuery(input.query, input.privateValues);
  if (!query || !input.route.provider.capabilities?.nativeSearch) return { status: "unavailable", results: [] };
  const site = input.site?.toLowerCase();
  if (site && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(site)) throw new Error("RESEARCH_SITE_INVALID");
  const suffix = [site ? `site:${site}` : "", input.recency ? `Recency: ${researchQuery(input.recency, input.privateValues).slice(0, 40)}` : ""].filter(Boolean).join(" ");
  const result = await generateRoutedStructured({ registry: input.registry, route: input.route, task: "research",
    nativeSearch: true, schema: SearchResultSchema, schemaName: "researchWebSources", schemaVersion: "1", repairAttempts: 0,
    system: "Find public primary sources using Google Search. Do not send private channel information. Return only cited sources.",
    prompt: `${query.slice(0, Math.max(0, 199 - suffix.length))} ${suffix}`.trim().slice(0, 200),
    maxOutputTokens: 1024, signal: input.signal, beforeProviderCall: input.beforeProviderCall, cache: input.cache,
  });
  const results = result.value.sources.filter((source) => {
    const url = new URL(source.url);
    return url.protocol === "https:" && !url.username && !url.password && (!site || url.hostname === site || url.hostname.endsWith(`.${site}`));
  });
  return { status: "ok", results, usage: result.usage };
}
