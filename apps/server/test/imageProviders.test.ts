import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { rankCandidates } from "@vg/shared";
import { parseConfig } from "../src/lib/config.js";
import { OpenverseImageProvider } from "../src/providers/images/openverse.js";
import { PexelsImageProvider } from "../src/providers/images/pexels.js";
import { TokenBucketRateLimiter } from "../src/providers/images/rateLimiter.js";
import { WikimediaImageProvider } from "../src/providers/images/wikimedia.js";
import { fetchJsonWithRetry } from "../src/providers/images/http.js";

const fixtures = join(process.cwd(), "test", "fixtures");
const config = parseConfig({ WORKER_ENABLED: "false", IMAGE_PROVIDERS: "mock" });
const signal = new AbortController().signal;
const fixtureFetch = (name: string) => vi.fn(async () => new Response(
  readFileSync(join(fixtures, name), "utf8"),
  { status: 200, headers: { "content-type": "application/json" } },
));

describe("image providers", () => {
  it("parses Wikimedia fixture and preserves API license metadata", async () => {
    const fetchImpl = fixtureFetch("wikimedia-search.json");
    const results = await new WikimediaImageProvider(config, fetchImpl).search({
      query: "mountain", perPage: 10, orientation: "landscape", signal,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      providerItemId: "101",
      fileType: "jpeg",
      license: { kind: "CC_BY", author: "Jane Doe", evidence: "api", attributionRequired: true },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toContain("gsrsearch=mountain");
  });

  it("filters mature Openverse results and normalizes creative commons metadata", async () => {
    const results = await new OpenverseImageProvider(config, fixtureFetch("openverse-search.json")).search({
      query: "river", perPage: 10, orientation: "landscape", signal,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      providerItemId: "ov-1",
      sourceSite: "Flickr",
      license: { kind: "CC_BY_SA", attributionText: "Photo by A Photographer" },
    });
  });

  it("uses and caches an Openverse client-credentials token", async () => {
    const authenticatedConfig = parseConfig({
      WORKER_ENABLED: "false",
      IMAGE_PROVIDERS: "openverse",
      OPENVERSE_CLIENT_ID: "test-client",
      OPENVERSE_CLIENT_SECRET: "test-secret",
    });
    const token = ["access", "token"].join("-");
    const fetchImpl = vi.fn(async (input: string | URL) => String(input).includes("/auth_tokens/token/")
      ? new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), { status: 200 })
      : new Response(readFileSync(join(fixtures, "openverse-search.json"), "utf8"), { status: 200 }));
    const provider = new OpenverseImageProvider(authenticatedConfig, fetchImpl);
    await provider.search({ query: "river", perPage: 10, orientation: "landscape", signal });
    await provider.search({ query: "mountain", perPage: 10, orientation: "landscape", signal });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("POST");
    expect(fetchImpl.mock.calls[1][1]?.headers).toHaveProperty("Authorization");
    expect(authenticatedConfig.IMAGE_SEARCH_PER_MINUTE_OPENVERSE).toBe(100);
  });

  it("ranks a recorded irrelevant provider response below a relevant candidate", async () => {
    const irrelevant = await new WikimediaImageProvider(
      config,
      fixtureFetch("wikimedia-irrelevant-search.json"),
    ).search({ query: "Lee Sedol AlphaGo", perPage: 10, orientation: "landscape", signal });
    const [relevant] = await new WikimediaImageProvider(config, fixtureFetch("wikimedia-search.json"))
      .search({ query: "Lee Sedol AlphaGo", perPage: 10, orientation: "landscape", signal });
    const ranked = rankCandidates([
      ...irrelevant.map((item) => ({ ...item, searchQuery: "Lee Sedol AlphaGo" })),
      { ...relevant, title: "Lee Sedol AlphaGo match", searchQuery: "Lee Sedol AlphaGo" },
    ], { queryTerms: "Lee Sedol AlphaGo", sceneTerms: "", targetAspect: 16 / 9 });
    expect(ranked[0].title).toBe("Lee Sedol AlphaGo match");
    expect(ranked[1].scoreBreakdown.lowRelevance).toBe(true);
  });

  it("parses Pexels with an API key and correct photographer credit", async () => {
    const pexelsConfig = parseConfig({ PEXELS_API_KEY: "test-key", WORKER_ENABLED: "false" });
    const fetchImpl = fixtureFetch("pexels-search.json");
    const results = await new PexelsImageProvider(pexelsConfig, fetchImpl).search({
      query: "river", perPage: 10, orientation: "portrait", signal,
    });
    expect(results[0]).toMatchObject({
      providerItemId: "9001",
      license: { kind: "ROYALTY_FREE", attributionRequired: false, attributionText: "Photo by Alex on Pexels" },
    });
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "test-key" });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("orientation=portrait");
  });
});

describe("provider rate limiter", () => {
  it("waits according to each provider's configured request rate", async () => {
    let time = 0;
    const waits: number[] = [];
    const limiter = new TokenBucketRateLimiter(
      { openverse: 20 },
      () => time,
      async (milliseconds) => {
        waits.push(milliseconds);
        time += milliseconds;
      },
    );
    await limiter.acquire("openverse");
    await limiter.acquire("openverse");
    expect(waits).toEqual([3_000]);
  });
});

describe("provider HTTP retry policy", () => {
  it("retries 429 after Retry-After and retries a timed-out request once", async () => {
    vi.useFakeTimers();
    try {
      const retriedFetch = vi.fn()
        .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } }))
        .mockResolvedValueOnce(new Response("{\"ok\":true}", { status: 200 }));
      const pending = fetchJsonWithRetry({
        url: new URL("https://images.test/search"),
        config,
        fetchImpl: retriedFetch,
        signal,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ ok: true });
      expect(retriedFetch).toHaveBeenCalledTimes(2);

      const timedOutFetch = vi.fn((_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }));
      const timeoutPending = fetchJsonWithRetry({
        url: new URL("https://images.test/timeout"),
        config,
        fetchImpl: timedOutFetch as typeof fetch,
        signal,
      });
      const timeoutExpectation = expect(timeoutPending).rejects.toThrow();
      await vi.runAllTimersAsync();
      await timeoutExpectation;
      expect(timedOutFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
