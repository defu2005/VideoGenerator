import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/lib/config.js";
import { ensureFootage, FOOTAGE_MAX_BYTES, pickFootageFile } from "../src/providers/footage/download.js";
import { searchFootage } from "../src/providers/footage/registry.js";
import type { FootageHit } from "../src/providers/footage/types.js";

const pexels = JSON.parse(readFileSync(new URL("./fixtures/footage/pexels-search.json", import.meta.url), "utf8"));
const pixabay = JSON.parse(readFileSync(new URL("./fixtures/footage/pixabay-search.json", import.meta.url), "utf8"));

function config(keys: { pexels?: string; pixabay?: string }): AppConfig {
  return {
    PEXELS_API_KEY: keys.pexels,
    PIXABAY_API_KEY: keys.pixabay,
    IMAGE_SEARCH_TIMEOUT_MS: 1000,
    IMAGE_SEARCH_USER_AGENT: "video-agent-test",
  } as AppConfig;
}

describe("searchFootage", () => {
  it("keeps licence fields and drops an empty author", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: URL | string) => {
      const href = String(url);
      seen.push(href);
      const body = href.includes("pexels.com") ? pexels : pixabay;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const hits = await searchFootage(config({ pexels: "pexels-test", pixabay: "pixabay-test" }), "biển", {
      orientation: "landscape",
      minDurationSec: 1,
      limit: 6,
      fetchImpl,
    });
    expect(hits.map((hit) => hit.clipId).sort()).toEqual(["101", "55"]);
    expect(hits.find((hit) => hit.provider === "pexels")).toMatchObject({
      author: "An Nguyen",
      licenseName: "Pexels License",
      pageUrl: "https://www.pexels.com/video/101",
    });
    expect(hits.find((hit) => hit.provider === "pixabay")?.licenseName).toBe("Pixabay Content License");
    expect(seen.some((url) => url.includes("api.pexels.com/videos/search") && url.includes("orientation=landscape"))).toBe(true);
    expect(seen.some((url) => url.includes("pixabay.com/api/videos/") && !url.includes("orientation="))).toBe(true);
  });

  it("does not call a provider whose key is missing", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const hits = await searchFootage(config({}), "biển", {
      orientation: "landscape",
      minDurationSec: 1,
      limit: 4,
      fetchImpl,
    });
    expect(hits).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("ensureFootage", () => {
  it("picks the smallest file that still covers the short side", () => {
    const files = [
      { url: "big", width: 1920, height: 1080, bytes: 9_000_000 },
      { url: "mid", width: 1280, height: 720, bytes: 4_000_000 },
      { url: "small", width: 640, height: 360, bytes: 900_000 },
    ];
    expect(pickFootageFile(files, 720)?.url).toBe("mid");
    expect(pickFootageFile([{ url: "huge", width: 1920, height: 1080, bytes: FOOTAGE_MAX_BYTES + 1 }], 100)).toBeNull();
  });

  it("refuses a download over 60 MB and reuses a file already on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vg-footage-"));
    const hit: FootageHit = {
      provider: "pexels",
      clipId: "101",
      url: "https://video.example/101.mp4",
      width: 640,
      height: 360,
      durationSec: 12,
      author: "An Nguyen",
      licenseName: "Pexels License",
      pageUrl: "https://www.pexels.com/video/101",
      previewImage: "",
      tags: [],
      files: [{ url: "https://video.example/101.mp4", width: 640, height: 360 }],
    };
    try {
      let calls = 0;
      const tooBig = (async () => {
        calls += 1;
        return new Response("nope", { status: 200, headers: { "content-length": String(FOOTAGE_MAX_BYTES + 1) } });
      }) as typeof fetch;
      expect((await ensureFootage(dir, hit, 360, tooBig)).path).toBeNull();
      const saved = await ensureFootage(dir, hit, 360, (async () => new Response(Buffer.from("clip"), { status: 200 })) as typeof fetch);
      expect(saved.path).toMatch(/pexels-101-360\.mp4$/);
      const again = await ensureFootage(dir, hit, 360, (async () => {
        calls += 1;
        throw new Error("không được tải lại");
      }) as typeof fetch);
      expect(again.path).toBe(saved.path);
      expect(calls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
