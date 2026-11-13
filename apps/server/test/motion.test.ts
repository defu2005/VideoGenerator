import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerMotionRoutes } from "../src/api/motion.js";
import { inlineMotionPreview, prepareMotionFolder, renderMotionGraphic, safeTemplateDir } from "../src/media/motion.js";

const require = createRequire(import.meta.url);

describe("motion render", () => {
  it("prepares a local folder and skips the spawn on a cache hit", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-motion-"));
    const prepared = prepareMotionFolder({
      templateId: "title_card",
      workDir: join(root, "work"),
      variables: { title: "Hố đen", subtitle: "", color: "#F8FAFC" },
      width: 1080,
      height: 1920,
      fps: 30,
      durationSec: 3,
      workers: 2,
      outputPath: join(root, "out.webm"),
    });
    expect(prepared.env.HYPERFRAMES_NO_TELEMETRY).toBe("1");
    expect(prepared.args).toContain("--format");
    expect(prepared.format).toBe("webm");
    let calls = 0;
    const first = await renderMotionGraphic({
      dataDir: root,
      templateId: "title_card",
      variables: { title: "Hố đen" },
      width: 320,
      height: 180,
      fps: 30,
      durationSec: 2,
      run: async (_command, _args, _env, outputPath) => { calls += 1; writeFileSync(outputPath, "ok"); },
    });
    expect(first.warning).toBeUndefined();
    expect(calls).toBe(1);
    const second = await renderMotionGraphic({
      dataDir: root,
      templateId: "title_card",
      variables: { title: "Hố đen" },
      width: 320,
      height: 180,
      fps: 30,
      durationSec: 2,
      run: async () => { calls += 1; },
    });
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
    const failed = await renderMotionGraphic({
      dataDir: root,
      templateId: "kinetic_word",
      variables: { text: "bí mật" },
      width: 320,
      height: 180,
      fps: 30,
      durationSec: 1,
      run: async () => { throw new Error("timeout"); },
    });
    expect(failed.warning).toMatch(/kinetic_word/);
    expect(safeTemplateDir("../title_card")).toBeNull();
    expect(inlineMotionPreview("title_card", { title: "A" })).toContain("getVariables");
    rmSync(root, { recursive: true, force: true });
  });

  it("serves an inlined preview and rejects a traversal path", async () => {
    const app = Fastify({ logger: false });
    registerMotionRoutes(app, { dataDir: tmpdir() });
    const ok = await app.inject({
      method: "GET",
      url: `/api/motion/preview?template=title_card&variables=${encodeURIComponent(JSON.stringify({ title: "Hố đen" }))}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/html");
    expect(ok.body).toContain("Hố đen");
    expect(ok.body).toContain("getVariables");
    expect(ok.body).toContain("vg-seek");
    expect(ok.body).toContain("Phát");
    const blocked = await app.inject({ method: "GET", url: "/api/motion/preview?template=../title_card" });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.body).toContain("không hợp lệ");
    await app.close();
  });

  const smoke = process.env.HYPERFRAMES_SMOKE === "1" ? it : it.skip;
  smoke("renders a 2s title card with an alpha pixel format", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-motion-smoke-"));
    const result = await renderMotionGraphic({
      dataDir: root,
      templateId: "title_card",
      variables: { title: "Hố đen", subtitle: "Vũ trụ" },
      width: 320,
      height: 180,
      fps: 30,
      durationSec: 2,
      workers: 1,
    });
    expect(result.outputPath).not.toBe("");
    const probe = require("ffprobe-static") as { path: string };
    const checked = spawnSync(probe.path, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=pix_fmt",
      "-of", "csv=p=0",
      result.outputPath,
    ], { encoding: "utf8" });
    expect(checked.stdout.toLowerCase()).toMatch(/yuva|rgba/);
    rmSync(root, { recursive: true, force: true });
  }, 120_000);
});
