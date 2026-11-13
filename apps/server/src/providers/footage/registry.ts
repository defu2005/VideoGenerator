import type { AppConfig } from "../../lib/config.js";
import { TokenBucketRateLimiter } from "../images/rateLimiter.js";
import { PexelsFootageProvider } from "./pexels.js";
import { PixabayFootageProvider } from "./pixabay.js";
import type { FootageHit, FootageSearchInput } from "./types.js";

const limiter = new TokenBucketRateLimiter({ pexels: 180, pixabay: 100 });

export async function searchFootage(
  config: AppConfig,
  query: string,
  opts: FootageSearchInput & { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<FootageHit[]> {
  const providers = [
    new PexelsFootageProvider(config, opts.fetchImpl),
    new PixabayFootageProvider(config, opts.fetchImpl),
  ];
  const batches = await Promise.all(providers.map(async (provider) => {
    if (!provider.enabled(config)) return [];
    try {
      await limiter.acquire(provider.id, opts.signal);
      return await provider.search({ ...opts, query });
    } catch {
      return [];
    }
  }));
  const seen = new Set<string>();
  const hits: FootageHit[] = [];
  for (const hit of batches.flat()) {
    if (!hit.author.trim() || !hit.licenseName.trim()) continue;
    const key = `${hit.provider}:${hit.clipId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
    if (hits.length >= opts.limit) break;
  }
  return hits;
}
