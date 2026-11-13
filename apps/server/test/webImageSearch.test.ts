import { testActor } from "./testActor.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { licenseFromCcUrl } from "@vg/shared";
import { parseConfig } from "../src/lib/config.js";
import { BraveImageProvider, mapBraveImageResults } from "../src/providers/images/brave.js";
import {
  assignPagesToScenes,
  extractGroundingRedirectUris,
  isWebGroundingEnabled,
  searchPagesWithGeminiGrounding,
} from "../src/providers/images/webGrounding.js";
import {
  extractPageImages,
  followRedirectsSafely,
  isDeniedHost,
  parseRobotsTxt,
  pickLicenseFromHints,
  validatePublicHttpUrl,
  WEB_CRAWL_USER_AGENT,
} from "../src/providers/images/webCrawl.js";
import {
  countBraveRequestsThisMonth,
  getWebImageSettingsStatus,
  saveWebImageSettings,
} from "../src/settings/webImage.js";

const fixtures = join(process.cwd(), "test", "fixtures");
const htmlDir = join(fixtures, "html");

describe("Brave image search mapping", () => {
  it("maps Brave JSON to candidates with licenseVerified false and sourcePageUrl", () => {
    const data = JSON.parse(readFileSync(join(fixtures, "brave-image-search.json"), "utf8"));
    const results = mapBraveImageResults(data, { query: "AlphaGo Lee Sedol", perPage: 20 });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      provider: "brave",
      licenseVerified: false,
      sourcePageUrl: "https://deepmind.google/research/alphago/",
      sourceSite: "deepmind.google",
      imageUrl: "https://deepmind.google/static/alphago-lee-sedol.jpg",
    });
    expect(results[0].why).toContain("AlphaGo Lee Sedol");
    expect(results[0].why).toContain("deepmind.google");
  });

  it("is disabled when BRAVE_SEARCH_API_KEY is missing", () => {
    const config = parseConfig({ WORKER_ENABLED: "false" });
    expect(new BraveImageProvider(config).enabled()).toBe(false);
  });

  it("calls Brave API with subscription token when key is set", async () => {
    const config = parseConfig({ WORKER_ENABLED: "false", BRAVE_SEARCH_API_KEY: "test-brave-key" });
    const fetchImpl = vi.fn(async () => new Response(
      readFileSync(join(fixtures, "brave-image-search.json"), "utf8"),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const provider = new BraveImageProvider(config, fetchImpl);
    expect(provider.enabled()).toBe(true);
    const results = await provider.search({
      query: "AlphaGo Lee Sedol",
      perPage: 20,
      orientation: "landscape",
      signal: new AbortController().signal,
    });
    expect(results).toHaveLength(2);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("api.search.brave.com/res/v1/images/search");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      "X-Subscription-Token": "test-brave-key",
    });
  });
});

describe("extractPageImages", () => {
  it("extracts og:image + CC license and marks licenseVerified via licenseFromCcUrl", () => {
    const html = readFileSync(join(htmlDir, "og-cc.html"), "utf8");
    const pageUrl = "https://example.org/articles/alphago";
    const extracted = extractPageImages(html, pageUrl);
    expect(extracted.title).toBe("AlphaGo Match Photo");
    expect(extracted.description).toContain("Lee Sedol");
    expect(extracted.images.some((image) => image.url.includes("alphago-1920.jpg"))).toBe(true);
    expect(extracted.images.some((image) => image.url.endsWith("/images/legacy-src.jpg"))).toBe(true);
    expect(extracted.images.some((image) => image.url.includes("jsonld.jpg"))).toBe(true);
    expect(extracted.images.some((image) => image.url.endsWith("/images/board.jpg"))).toBe(true);
    expect(extracted.images.every((image) => !image.url.endsWith("small.png"))).toBe(true);
    expect(extracted.licenseHints.some((hint) => /creativecommons\.org\/licenses\/by/i.test(hint))).toBe(true);

    const picked = pickLicenseFromHints(extracted.licenseHints);
    expect(picked?.verified).toBe(true);
    expect(picked?.license.kind).toBe("CC_BY");
    expect(licenseFromCcUrl(extracted.licenseHints[0]!).verified).toBe(true);
  });

  it("picks the largest srcset candidate", () => {
    const html = readFileSync(join(htmlDir, "srcset-only.html"), "utf8");
    const extracted = extractPageImages(html, "https://photos.example/gallery");
    expect(extracted.images).toHaveLength(1);
    expect(extracted.images[0]?.url).toBe("https://photos.example/img/mountain-1280.jpg");
    expect(extracted.images[0]?.alt).toBe("Mountain ridge at dusk");
  });
});

describe("denylist and robots", () => {
  it("skips pinterest hosts via denylist", () => {
    expect(isDeniedHost("www.pinterest.com", [])).toBe(true);
    expect(isDeniedHost("i.pinimg.com", [])).toBe(true);
    expect(isDeniedHost("pinterest.co.uk", ["pinterest.co.uk"])).toBe(true);
    expect(isDeniedHost("deepmind.google", ["pinterest.com", "pinimg.com"])).toBe(false);
  });

  it("parses robots.txt and disallows matching paths", () => {
    const text = readFileSync(join(htmlDir, "robots-disallow.txt"), "utf8");
    const rules = parseRobotsTxt(text, WEB_CRAWL_USER_AGENT);
    expect(rules.isAllowed("/private/secret.html")).toBe(false);
    expect(rules.isAllowed("/public/ok.html")).toBe(true);
    const star = parseRobotsTxt(text, "OtherBot/1.0");
    expect(star.isAllowed("/secret/x")).toBe(false);
    expect(star.isAllowed("/ok")).toBe(true);
  });
});

describe("SSRF and redirects", () => {
  it("blocks private IP via injected resolveHost", async () => {
    await expect(
      validatePublicHttpUrl("https://evil.example/page", async () => ["127.0.0.1"]),
    ).rejects.toThrow(/private|loopback|link-local/i);
    await expect(
      validatePublicHttpUrl("https://evil.example/page", async () => ["10.0.0.5"]),
    ).rejects.toThrow(/private|loopback|link-local/i);
    await expect(
      validatePublicHttpUrl("http://192.168.1.1/x"),
    ).rejects.toThrow(/private|loopback|link-local/i);
  });

  it("follows redirects safely with mock fetch", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("start.example")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://final.example/page" },
        });
      }
      return new Response(null, { status: 200 });
    });
    const finalUrl = await followRedirectsSafely("https://start.example/a", {
      fetchImpl,
      resolveHost: async () => ["203.0.113.10"],
      method: "GET",
    });
    expect(finalUrl).toBe("https://final.example/page");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses redirect to a private host", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    }));
    await expect(followRedirectsSafely("https://start.example/a", {
      fetchImpl,
      resolveHost: async (hostname) => hostname === "start.example" ? ["203.0.113.10"] : ["127.0.0.1"],
      method: "GET",
    })).rejects.toThrow(/private|loopback|link-local/i);
  });
});

describe("Gemini grounding", () => {
  it("reads only groundingMetadata redirect uris (not model text URLs)", () => {
    const body = JSON.parse(readFileSync(join(fixtures, "gemini-grounding.json"), "utf8"));
    const uris = extractGroundingRedirectUris(body);
    expect(uris).toEqual([
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABCDEF123",
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/WIKI456",
    ]);
    expect(uris.some((uri) => uri.includes("evil.example"))).toBe(false);
  });

  it("assigns resolved pages across scenes and reports enabled from GEMINI_API_KEY", async () => {
    expect(isWebGroundingEnabled(parseConfig({ WORKER_ENABLED: "false" }))).toBe(false);
    const config = parseConfig({
      WORKER_ENABLED: "false",
      GEMINI_API_KEY: "test-gemini",
      WEB_IMAGE_GEMINI_MODEL: "gemini-2.5-flash",
    });
    expect(isWebGroundingEnabled(config)).toBe(true);

    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("generativelanguage.googleapis.com")) {
        return new Response(readFileSync(join(fixtures, "gemini-grounding.json"), "utf8"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("ABCDEF123")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://deepmind.google/research/alphago/" },
        });
      }
      if (url.includes("WIKI456")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://en.wikipedia.org/wiki/AlphaGo_versus_Lee_Sedol" },
        });
      }
      if (url.includes("deepmind.google") || url.includes("wikipedia.org")) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const result = await searchPagesWithGeminiGrounding({
      scenes: [
        { sceneId: "scene-a", query: "AlphaGo Lee Sedol" },
        { sceneId: "scene-b", query: "Go board" },
      ],
      config,
      fetchImpl,
      redirectDependencies: {
        resolveHost: async () => ["203.0.113.10"],
      },
    });
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.rawRedirectUris).toHaveLength(2);
    expect(result.scenes[0]?.pageUrls[0]).toContain("deepmind.google");
    expect(result.scenes[1]?.pageUrls[0]).toContain("wikipedia.org");
  });

  it("round-robins pages when assigning to scenes", () => {
    const assigned = assignPagesToScenes(
      [{ sceneId: "a", query: "q1" }, { sceneId: "b", query: "q2" }],
      ["https://one.example", "https://two.example", "https://three.example"],
    );
    expect(assigned[0]?.pageUrls).toEqual(["https://one.example", "https://three.example"]);
    expect(assigned[1]?.pageUrls).toEqual(["https://two.example"]);
  });
});

describe("web image settings", () => {
  it("exposes keyConfigured without revealing keys and counts monthly Brave usage", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        scope TEXT,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        error TEXT,
        usage TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        run_after TEXT NOT NULL,
        previous_state TEXT NOT NULL DEFAULT 'PENDING'
      );
    `);
    const now = new Date(2026, 10, 4);
    const monthIso = new Date(2026, 10, 2).toISOString();
    sqlite.prepare(
      "INSERT INTO jobs (id, project_id, stage, status, usage, created_at, run_after) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "VISUAL_SEARCH",
      "SUCCEEDED",
      JSON.stringify({
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        features: { braveImageSearchRequests: 7 },
      }),
      monthIso,
      monthIso,
    );

    const config = parseConfig({
      WORKER_ENABLED: "false",
      BRAVE_SEARCH_API_KEY: "secret-should-not-leak",
      GEMINI_API_KEY: "gemini-secret",
      WEB_IMAGE_DOMAIN_DENYLIST: "pinterest.com,pinimg.com,pinterest.co.uk",
    });
    saveWebImageSettings(sqlite, {
      braveEnabled: true,
      geminiGroundingEnabled: false,
      geminiModel: "gemini-2.5-flash",
      domainDenylist: ["pinterest.com", "pinimg.com"],
    });
    const status = getWebImageSettingsStatus(sqlite, config, now);
    expect(status.keyConfigured).toEqual({ brave: true, gemini: true });
    expect(status.geminiGroundingEnabled).toBe(false);
    expect(status.braveRequestsThisMonth).toBe(7);
    expect(JSON.stringify(status)).not.toContain("secret-should-not-leak");
    expect(JSON.stringify(status)).not.toContain("gemini-secret");
    expect(countBraveRequestsThisMonth(sqlite, now)).toBe(7);

    const noKeys = getWebImageSettingsStatus(
      sqlite,
      parseConfig({ WORKER_ENABLED: "false" }),
      now,
    );
    expect(noKeys.keyConfigured).toEqual({ brave: false, gemini: false });
  });
});

describe("config defaults", () => {
  it("loads web image env defaults", () => {
    const config = parseConfig({ WORKER_ENABLED: "false" });
    expect(config.WEB_IMAGE_GEMINI_MODEL).toBe("gemini-2.5-flash");
    expect(config.WEB_IMAGE_SEARCH_PER_MINUTE).toBe(30);
    expect(config.WEB_IMAGE_DOMAIN_DENYLIST).toContain("pinterest.com");
    expect(config.BRAVE_SEARCH_API_KEY).toBeUndefined();
  });
});

describe("web-search route and auto-approve gate", () => {
  it("returns 503 when both keys are missing", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { randomUUID } = await import("node:crypto");
    const { buildApp } = await import("../src/app.js");
    const dataDir = mkdtempSync(join(tmpdir(), "vg-web-route-"));
    const config = parseConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: join(dataDir, "app.db"),
      WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
      IMAGE_PROVIDERS: "mock",
      LLM_ENABLE_MOCK: "true",
      LLM_DEFAULT_PROVIDER: "mock",
    });
    const app = buildApp({ testActor,  config });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { topic: "Web search route", settings: { budget: { mode: "BALANCED" } } },
      });
      const project = created.json<{ id: string }>();
      const sqlite = new Database(config.DATABASE_PATH);
      const sceneId = randomUUID();
      const now = new Date().toISOString();
      sqlite.prepare(
        `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
          music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
          input_hash, created_at, updated_at)
         VALUES (?, ?, 0, 'section', NULL, 'S1', 'narration', 'notes', ?,
          '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'fixture', ?, ?)`,
      ).run(sceneId, project.id, JSON.stringify({ primary: "AlphaGo Lee Sedol", alternatives: [], queryVariant: false }), now, now);
      sqlite.close();

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/scenes/${sceneId}/visuals/web-search`,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: { code: "WEB_IMAGE_SEARCH_UNAVAILABLE" },
      });

      const settings = await app.inject({ method: "GET", url: "/api/settings/web-image" });
      expect(settings.statusCode).toBe(200);
      expect(settings.json()).toMatchObject({
        keyConfigured: { brave: false, gemini: false },
      });
    } finally {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("skips unverified web candidates in approveAll", async () => {
    const { isUnverifiedWebCandidate } = await import("@vg/shared");
    expect(isUnverifiedWebCandidate({ provider: "brave", licenseVerified: false })).toBe(true);
    expect(isUnverifiedWebCandidate({ provider: "web-grounding", licenseVerified: false })).toBe(true);
    expect(isUnverifiedWebCandidate({ provider: "brave", licenseVerified: true })).toBe(false);
    expect(isUnverifiedWebCandidate({ provider: "wikimedia", licenseVerified: false })).toBe(false);
  });
});
