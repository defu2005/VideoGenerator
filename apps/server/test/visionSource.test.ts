import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST } from "@vg/shared";
import { isDeniedHost } from "../src/providers/images/webCrawl.js";
import { parseImage } from "../src/services/imageStore.js";
import { visionSourceProblem } from "../src/services/visionSource.js";
import { resolveAssetPath } from "../src/storage/paths.js";
import { solidPng } from "./pngFixture.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("visual asset paths and vision source size", () => {
  it("resolves a project-relative visuals path and rejects a path outside the project", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vg-asset-"));
    roots.push(dataDir);
    const projectId = "33333333-3333-4333-8333-333333333333";
    const resolved = resolveAssetPath(dataDir, projectId, "visuals/abc.jpg");
    expect(resolved.replace(/\\/g, "/")).toBe(
      join(dataDir, "projects", projectId, "visuals", "abc.jpg").replace(/\\/g, "/"),
    );
    expect(() => resolveAssetPath(dataDir, projectId, "../secret.jpg")).toThrow(/outside the project/);
  });

  it("marks images under 64 px or 2 KB invalid and accepts a padded 320 px PNG", () => {
    expect(visionSourceProblem(Buffer.from("img"))).toBe("invalid_source");
    expect(visionSourceProblem(solidPng(32, 32))).toBe("invalid_source");
    const usable = solidPng(320, 320);
    expect(usable.byteLength).toBeGreaterThanOrEqual(2048);
    expect(parseImage(usable)).toMatchObject({ width: 320, height: 320, fileType: "png" });
    expect(visionSourceProblem(usable)).toBeNull();
  });

  it("denies wallpaper and AI-gallery hosts from the default list", () => {
    for (const host of ["wallpaperflare.com", "www.craiyon.com", "nightcafe.studio", "pinimg.com"]) {
      expect(isDeniedHost(host, DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST)).toBe(true);
    }
    expect(isDeniedHost("commons.wikimedia.org", DEFAULT_WEB_IMAGE_DOMAIN_DENYLIST)).toBe(false);
  });

  it("keeps the server dev watcher off data, tmp and artifacts", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: { dev: string };
    };
    expect(pkg.scripts.dev).toContain("tsx watch");
    expect(pkg.scripts.dev).toContain("--exclude ../../data/**");
    expect(pkg.scripts.dev).toContain("--exclude ../../tmp/**");
    expect(pkg.scripts.dev).toContain("--exclude ../../artifacts/**");
    expect(pkg.scripts.dev).not.toContain("compose");
  });
});
