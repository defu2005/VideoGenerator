import { asRecord } from "../llm/http.js";
import type { AppConfig } from "../../lib/config.js";
import {
  followRedirectsSafely,
  WEB_CRAWL_TIMEOUT_MS,
  WEB_CRAWL_USER_AGENT,
  type SafeFetchDependencies,
} from "./webCrawl.js";
import type { FetchJson } from "./types.js";

export const WEB_IMAGE_GROUNDING_BATCH_SIZE = 5;

export type GroundingSceneInput = {
  sceneId: string;
  query: string;
  alternativeQueries?: string[];
};

export type GroundingScenePages = {
  sceneId: string;
  pageUrls: string[];
};

export type WebGroundingResult = {
  scenes: GroundingScenePages[];
  model: string;
  rawRedirectUris: string[];
};

type GeminiGroundingResponse = {
  candidates?: unknown[];
};

/**
 * Ask Gemini (with google_search tool) for source page URLs for up to 5 scenes.
 * Only trusts groundingMetadata.groundingChunks[].web.uri — never model text URLs.
 */
export async function searchPagesWithGeminiGrounding(input: {
  scenes: GroundingSceneInput[];
  config: AppConfig;
  fetchImpl?: FetchJson;
  signal?: AbortSignal;
  resolveRedirects?: boolean;
  redirectDependencies?: SafeFetchDependencies;
}): Promise<WebGroundingResult> {
  const apiKey = input.config.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return { scenes: input.scenes.map((scene) => ({ sceneId: scene.sceneId, pageUrls: [] })), model: "", rawRedirectUris: [] };
  }

  const model = (input.config.WEB_IMAGE_GEMINI_MODEL || input.config.GEMINI_MODEL || "gemini-2.5-flash").trim();
  const batch = input.scenes.slice(0, WEB_IMAGE_GROUNDING_BATCH_SIZE);
  const prompt = buildGroundingPrompt(batch);
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "User-Agent": WEB_CRAWL_USER_AGENT },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.2,
      },
    }),
    signal: AbortSignal.any([
      AbortSignal.timeout(input.config.LLM_TIMEOUT_MS ?? 120_000),
      ...(input.signal ? [input.signal] : []),
    ]),
  });

  if (!response.ok) {
    throw new Error(`Gemini grounding returned HTTP ${response.status}`);
  }
  const body = await response.json() as GeminiGroundingResponse;
  const redirectUris = extractGroundingRedirectUris(body);

  const resolved: string[] = [];
  if (input.resolveRedirects !== false) {
    for (const uri of redirectUris) {
      try {
        const finalUrl = await followRedirectsSafely(uri, {
          fetchImpl,
          userAgent: WEB_CRAWL_USER_AGENT,
          timeoutMs: WEB_CRAWL_TIMEOUT_MS,
          signal: input.signal,
          method: "GET",
          ...input.redirectDependencies,
        });
        resolved.push(finalUrl);
      } catch {
        // drop unresolvable redirects
      }
    }
  } else {
    resolved.push(...redirectUris);
  }

  // Assign resolved page URLs round-robin across scenes (grounding chunks are not scene-indexed).
  const scenes = assignPagesToScenes(batch, resolved);
  return { scenes, model, rawRedirectUris: redirectUris };
}

export function extractGroundingRedirectUris(body: unknown): string[] {
  const root = asRecord(body);
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const uris: string[] = [];
  for (const candidate of candidates) {
    const meta = asRecord(asRecord(candidate).groundingMetadata);
    const chunks = Array.isArray(meta.groundingChunks) ? meta.groundingChunks : [];
    for (const chunk of chunks) {
      const web = asRecord(asRecord(chunk).web);
      if (typeof web.uri === "string" && web.uri.trim()) {
        uris.push(web.uri.trim());
      }
    }
  }
  return [...new Set(uris)];
}

export function buildGroundingPrompt(scenes: GroundingSceneInput[]): string {
  const lines = scenes.map((scene, index) => {
    const alts = scene.alternativeQueries?.filter(Boolean).slice(0, 3) ?? [];
    const altText = alts.length ? ` (also: ${alts.join("; ")})` : "";
    return `${index + 1}. sceneId=${scene.sceneId} query="${scene.query}"${altText}`;
  });
  return [
    "Find authoritative source web pages that likely contain a high-quality photograph or illustration for each scene below.",
    "Prefer museum, encyclopedia, news, research, or official project pages. Avoid Pinterest and image aggregators.",
    "Use Google Search. Do not invent URLs.",
    "Scenes:",
    ...lines,
  ].join("\n");
}

export function assignPagesToScenes(
  scenes: GroundingSceneInput[],
  pageUrls: string[],
): GroundingScenePages[] {
  if (scenes.length === 0) return [];
  const buckets: string[][] = scenes.map(() => []);
  pageUrls.forEach((url, index) => {
    buckets[index % scenes.length]?.push(url);
  });
  return scenes.map((scene, index) => ({
    sceneId: scene.sceneId,
    pageUrls: buckets[index] ?? [],
  }));
}

export function isWebGroundingEnabled(config: AppConfig): boolean {
  return Boolean(config.GEMINI_API_KEY?.trim());
}
