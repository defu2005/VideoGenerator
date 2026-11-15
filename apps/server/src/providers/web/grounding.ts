import { asRecord } from "../llm/http.js";

/** Shared Gemini metadata parser. Generated prose is deliberately never parsed for URLs. */
export function groundingSources(body: unknown): Array<{ url: string; title: string }> {
  const candidates = asRecord(body).candidates;
  const sources = new Map<string, { url: string; title: string }>();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const chunks = asRecord(asRecord(candidate).groundingMetadata).groundingChunks;
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      const web = asRecord(asRecord(chunk).web);
      if (typeof web.uri !== "string" || !web.uri.trim()) continue;
      const url = web.uri.trim();
      sources.set(url, { url, title: typeof web.title === "string" ? web.title.slice(0, 300) : "" });
    }
  }
  return [...sources.values()];
}

export const googleSearchTool = () => ({ google_search: {} });
