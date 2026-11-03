import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ImageDownloadError, ImageStore, MAX_IMAGE_BYTES, isVisualFileName, parseImage } from "../src/services/imageStore.js";
import { deriveSceneVisualStatus } from "@vg/shared";

const projectId = "44444444-4444-4444-8444-444444444444";
const root = mkdtempSync(join(tmpdir(), "vg-image-store-"));
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "images");
const fixtures = {
  jpeg: readFileSync(join(fixtureDir, "tiny.jpg")),
  png: readFileSync(join(fixtureDir, "tiny.png")),
  gif: readFileSync(join(fixtureDir, "tiny.gif")),
  webpVp8x: readFileSync(join(fixtureDir, "tiny-webp-vp8x.webp")),
  webpVp8l: readFileSync(join(fixtureDir, "tiny-webp-vp8l.webp")),
  webpVp8: readFileSync(join(fixtureDir, "tiny-webp-vp8.webp")),
  truncated: readFileSync(join(fixtureDir, "truncated.png")),
  svg: readFileSync(join(fixtureDir, "not-image.svg")),
  html: readFileSync(join(fixtureDir, "not-image.html")),
};

function imageResponse(body: Buffer, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/octet-stream" } });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const entry of readdirSync(root)) rmSync(join(root, entry), { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("image format sniffing", () => {
  it("reads dimensions from JPEG, PNG, GIF, and all WebP headers", () => {
    expect(parseImage(fixtures.jpeg)).toMatchObject({ fileType: "jpg", width: 640, height: 480 });
    expect(parseImage(fixtures.png)).toMatchObject({ fileType: "png", width: 640, height: 480 });
    expect(parseImage(fixtures.gif)).toMatchObject({ fileType: "gif", width: 640, height: 480 });
    expect(parseImage(fixtures.webpVp8x)).toMatchObject({ fileType: "webp", width: 640, height: 480 });
    expect(parseImage(fixtures.webpVp8l)).toMatchObject({ fileType: "webp", width: 640, height: 480 });
    expect(parseImage(fixtures.webpVp8)).toMatchObject({ fileType: "webp", width: 640, height: 480 });
  });

  describe("derived scene visual status", () => {
    const selected = { candidateId: "candidate", status: "APPROVED" as const };
    it.each([
      [null, [], false, null, "NO_VISUAL"],
      [null, [], false, "RUNNING", "SEARCHING"],
      [{ candidateId: "candidate", status: "REPLACED" as const }, [], false, null, "REVIEW_REQUIRED"],
      [selected, [], false, null, "APPROVED"],
      [selected, [{ id: "candidate", localPath: "visuals/image.png", sha256: "a".repeat(64), actualWidth: 640, actualHeight: 480 }], false, null, "READY_FOR_RENDER"],
      [null, [], true, null, "SKIPPED"],
    ] as const)("derives %s state", (selection, candidates, noVisual, stageState, expected) => {
      expect(deriveSceneVisualStatus(selection, candidates, noVisual, stageState)).toBe(expected);
    });
  });

  it("rejects empty, truncated, SVG, HTML, and images below the minimum size", () => {
    for (const value of [
      Buffer.alloc(0),
      fixtures.truncated,
      fixtures.svg,
      fixtures.html,
    ]) expect(() => parseImage(value)).toThrow(ImageDownloadError);
    const store = new ImageStore(root, "fixture");
    const undersized = Buffer.from(fixtures.png);
    undersized.writeUInt32BE(319, 16);
    expect(() => store.storeBuffer(projectId, undersized)).toThrow(/minimum short side/);
  });
});

describe("image downloader", () => {
  it("saves identical bytes once using the SHA-256 content address", async () => {
    const bytes = fixtures.png;
    const fetchImpl = vi.fn(async () => imageResponse(bytes));
    const store = new ImageStore(root, "fixture agent", {
      fetchImpl,
      resolveHost: async () => ["203.0.113.10"],
    });
    const first = await store.download(projectId, "https://images.example.test/photo.png");
    const second = await store.download(projectId, "https://images.example.test/other.png");
    expect(first.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(second.localPath).toBe(first.localPath);
    expect(readFileSync(join(root, "projects", projectId, first.localPath))).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries one server error and sends the configured User-Agent", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(imageResponse(Buffer.alloc(0), 503))
      .mockResolvedValueOnce(imageResponse(fixtures.png));
    const store = new ImageStore(root, "task-agent/1.0", {
      fetchImpl,
      resolveHost: async () => ["203.0.113.10"],
    });
    await store.download(projectId, "https://images.example.test/photo.png");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "User-Agent": "task-agent/1.0" });
  });

  it("applies the request timeout and retries one timeout", async () => {
    const fetchImpl = vi.fn((_input: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const requestSignal = init?.signal;
      if (requestSignal?.aborted) {
        reject(requestSignal.reason);
        return;
      }
      requestSignal?.addEventListener("abort", () => reject(requestSignal.reason), { once: true });
    }));
    const store = new ImageStore(root, "fixture", {
      fetchImpl,
      resolveHost: async () => ["203.0.113.10"],
      timeoutMs: 1,
    });

    await expect(store.download(projectId, "https://images.example.test/slow"))
      .rejects.toThrow(/after one retry/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects private, loopback, and link-local IPs and DNS resolutions before fetching", async () => {
    const fetchImpl = vi.fn();
    const store = new ImageStore(root, "fixture", {
      fetchImpl,
      resolveHost: async () => ["10.0.0.5"],
    });
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "169.254.1.1", "[::1]", "[fe80::1]"]) {
      await expect(store.download(projectId, `http://${host}/image.png`)).rejects.toThrow(/private|loopback|link-local/);
    }
    await expect(store.download(projectId, "https://private.example.test/image.png"))
      .rejects.toThrow(/private|loopback|link-local/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("caps redirects at three and bodies at 25 MB", async () => {
    const redirectFetch = vi.fn(async (input: string | URL) =>
      new Response(null, { status: 302, headers: { location: new URL(String(input)).pathname === "/0" ? "/1" : `${Number(new URL(String(input)).pathname.slice(1)) + 1}` } }));
    const redirectStore = new ImageStore(root, "fixture", {
      fetchImpl: redirectFetch,
      resolveHost: async () => ["203.0.113.10"],
    });
    await expect(redirectStore.download(projectId, "https://images.example.test/0"))
      .rejects.toThrow(/maximum of 3 redirects/);

    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    const largeStore = new ImageStore(root, "fixture", {
      fetchImpl: async () => imageResponse(oversized),
      resolveHost: async () => ["203.0.113.10"],
    });
    await expect(largeStore.download(projectId, "https://images.example.test/large"))
      .rejects.toThrow(/25 MB/);
  });

  it("validates the visual file allowlist", () => {
    expect(isVisualFileName(`${"a".repeat(64)}.png`)).toBe(true);
    expect(isVisualFileName("..\\..\\secret.png")).toBe(false);
    expect(isVisualFileName(`${"a".repeat(64)}.svg`)).toBe(false);
  });
});
