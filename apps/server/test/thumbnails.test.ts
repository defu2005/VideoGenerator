import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import ffmpegStatic from "ffmpeg-static";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineSchema, buildThumbnailVideoFilter, parseFrameProbe, rankByScore, type Timeline } from "@vg/shared";
import { registerThumbnailRoutes } from "../src/api/thumbnails.js";
import { runFfmpeg, type FfmpegRunOptions } from "../src/media/ffmpeg.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import { ThumbnailService, resolveSubtitleFontFile } from "../src/services/thumbnailService.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const ffmpegStaticBin = typeof ffmpegStatic === "string" && existsSync(ffmpegStatic) ? ffmpegStatic : "";

type Harness = ReturnType<typeof createPipelineHarness>;
const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.08, x: 0.5, y: 0.5 } };

function timeline(): Timeline {
  return TimelineSchema.parse({
    formatVersion: 1,
    target: { width: 1280, height: 720, fps: 30 },
    totalDurationSec: 15,
    scenes: [
      {
        sceneId: "11111111-1111-4111-8111-111111111111", order: 0, label: "Mở", startSec: 0, endSec: 10,
        durationSec: 10, durationFrames: 300, voice: null,
        visuals: [{ kind: "PLACEHOLDER", candidateId: null, path: null, startSec: 0, endSec: 10, motion, licenseKind: null }],
        fadeInSec: 0.5, fadeOutSec: 0,
      },
      {
        sceneId: "22222222-2222-4222-8222-222222222222", order: 1, label: "Sau", startSec: 10, endSec: 15,
        durationSec: 5, durationFrames: 150, voice: null,
        visuals: [{ kind: "PLACEHOLDER", candidateId: null, path: null, startSec: 10, endSec: 15, motion, licenseKind: null }],
        fadeInSec: 0, fadeOutSec: 0,
      },
    ],
    music: null,
    subtitles: null,
    warnings: [],
    licenseSummary: {},
  });
}

function fakeTools() {
  const calls: string[][] = [];
  const ffmpeg = async (args: string[], _options?: FfmpegRunOptions) => {
    calls.push(args);
    if (args.includes("-filters")) return { stdout: "blurdetect\nsignalstats\n", stderr: "" };
    const out = args[args.length - 1] ?? "";
    if (out === "-") {
      const input = args[args.indexOf("-i") + 1] ?? "";
      let note = "";
      try {
        note = readFileSync(input, "utf8");
      } catch {
        note = "";
      }
      const black = note.includes("t=4.000");
      const sharp = note.includes("t=1.000");
      const stderr = black
        ? "lavfi.signalstats.YAVG=4\nlavfi.signalstats.YLOW=2\nlavfi.signalstats.YHIGH=6\nlavfi.signalstats.YDIF=0\nlavfi.signalstats.SATAVG=1\nlavfi.blur=12.4"
        : sharp
          ? "lavfi.signalstats.YAVG=128\nlavfi.signalstats.YLOW=40\nlavfi.signalstats.YHIGH=200\nlavfi.signalstats.YDIF=0\nlavfi.signalstats.SATAVG=40\nlavfi.blur=3.876687"
          : "lavfi.signalstats.YAVG=110\nlavfi.signalstats.YLOW=50\nlavfi.signalstats.YHIGH=170\nlavfi.signalstats.YDIF=0\nlavfi.signalstats.SATAVG=30\nlavfi.blur=8.2";
      return { stdout: "", stderr };
    }
    if (out.endsWith(".jpg")) {
      const q = Number(args[args.indexOf("-q:v") + 1] ?? "2");
      const big = out.includes("landscape") && q <= 4;
      writeFileSync(out, Buffer.alloc(big ? 2_500_000 : 1000, 1));
      return { stdout: "", stderr: "" };
    }
    const ss = args.includes("-ss") ? args[args.indexOf("-ss") + 1] : "still";
    writeFileSync(out, `t=${ss}`);
    return { stdout: "", stderr: "" };
  };
  return { calls, tools: { ffmpeg } };
}

function overlayBlob(dataDir: string, projectId: string): string {
  const root = join(projectDir(dataDir, projectId), "render", "thumbnails", "text");
  const chunks: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".txt")) chunks.push(readFileSync(path, "utf8"));
    }
  };
  walk(root);
  return chunks.join("");
}

function setup(mode: "BALANCED" | "MAX" = "BALANCED") {
  const harness = createPipelineHarness();
  harnesses.push(harness);
  const project = harness.repository.getProject(harness.projectId)!;
  project.settings.budget = { mode };
  project.settings.llm = { default: { provider: "mock", model: "mock-v1" } };
  harness.sqlite.prepare("UPDATE projects SET title = ?, settings = ? WHERE id = ?").run(
    "Đại dương",
    JSON.stringify(project.settings),
    harness.projectId,
  );
  const now = new Date().toISOString();
  const video = join(harness.config.DATA_DIR, "out.mp4");
  mkdirSync(harness.config.DATA_DIR, { recursive: true });
  writeFileSync(video, "video");
  harness.sqlite.prepare(
    `INSERT INTO renders (id, project_id, input_hash, status, output_path, duration_sec, size_bytes, width, height, report, created_at, version, pinned)
     VALUES (?, ?, 'h', 'DONE', ?, 15, 10, 1280, 720, '{}', ?, 1, 0)`,
  ).run(randomUUID(), harness.projectId, video, now);
  harness.sqlite.prepare(
    `INSERT INTO video_metadata (project_id, input_hash, draft, source, created_at, updated_at)
     VALUES (?, 'h', ?, 'CODE', ?, ?)`,
  ).run(
    harness.projectId,
    JSON.stringify({
      titles: ["Đại dương"],
      description: "",
      tags: [],
      hashtags: [],
      thumbnailText: ["Bí ẩn: 100%"],
    }),
    now,
    now,
  );
  const fresh = harness.repository.getProject(harness.projectId)!;
  return { harness, project: fresh, video };
}

describe("thumbnail generation", () => {
  it("drops the black frame, uses the LLM pick, and keeps the landscape jpg under 2 MB", async () => {
    const { harness, project } = setup("MAX");
    const { calls, tools } = fakeTools();
    const llm = new LlmProviderRegistry({ ...harness.config, LLM_ENABLE_MOCK: true });
    const service = new ThumbnailService(harness.sqlite, harness.config, { get: () => ({ timeline: timeline() }) }, tools, llm);
    const state = await service.ensureAuto(project, new AbortController().signal);
    expect(state.meta).toMatchObject({
      source: "ai",
      text: "Bí ẩn đại dương",
      position: "bottom",
      frameTimeSec: 1,
    });
    expect(state.candidates.map((item) => item.timeSec)).toEqual([1, 12]);
    expect(state.candidates[0]!.score).toBeGreaterThan(state.candidates[1]!.score);
    expect(state.candidates.every((item) => item.score > 0)).toBe(true);
    expect(state.hasLandscape).toBe(true);
    expect(state.hasCover).toBe(true);
    const landscape = calls.filter((args) => args.some((arg) => arg.includes("landscape.jpg")));
    expect(landscape.some((args) => args.includes("6"))).toBe(true);
    const final = landscape[landscape.length - 1]!;
    const filterArg = final[final.indexOf("-vf") + 1] ?? "";
    expect(filterArg).toContain("textfile=");
    expect(filterArg).toContain("expansion=none");
    expect(filterArg).not.toContain("Bí ẩn");
    const written = overlayBlob(harness.config.DATA_DIR, harness.projectId);
    expect(written).toContain("Bí ẩn");
    expect(written).toContain("dương");
    const row = harness.sqlite.prepare("SELECT thumbnail_path FROM projects WHERE id = ?").get(harness.projectId) as { thumbnail_path: string };
    expect(readFileSync(row.thumbnail_path).length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("falls back when the budget has no vision pick", async () => {
    const { harness, project } = setup("BALANCED");
    const { calls, tools } = fakeTools();
    const service = new ThumbnailService(harness.sqlite, harness.config, { get: () => ({ timeline: timeline() }) }, tools);
    const state = await service.ensureAuto(project, new AbortController().signal);
    expect(state.meta).toMatchObject({ source: "auto", text: "Bí ẩn: 100%", position: "bottom" });
    const filter = calls.flat().join("\n");
    expect(filter).toContain("textfile=");
    expect(filter).toContain("expansion=none");
    expect(filter).not.toContain("Bí ẩn");
    expect(filter).not.toContain("%");
    const written = overlayBlob(harness.config.DATA_DIR, harness.projectId);
    expect(written).toContain("Bí ẩn");
    expect(written).toContain("100%");
  });

  it("falls back when the provider cannot see images", async () => {
    const { harness, project } = setup("MAX");
    const { tools } = fakeTools();
    const blind = {
      resolveTask: () => ({
        provider: { id: "ollama", capabilities: { vision: false, maxImagesPerCall: 1 } },
        model: "x",
      }),
    };
    const service = new ThumbnailService(
      harness.sqlite,
      harness.config,
      { get: () => ({ timeline: timeline() }) },
      tools,
      blind as never,
    );
    const state = await service.ensureAuto(project, new AbortController().signal);
    expect(state.meta?.source).toBe("auto");
    expect(state.meta?.text).toBe("Bí ẩn: 100%");
  });

  it("keeps a manual choice when generation runs again", async () => {
    const { harness, project } = setup("BALANCED");
    const { calls, tools } = fakeTools();
    const service = new ThumbnailService(harness.sqlite, harness.config, { get: () => ({ timeline: timeline() }) }, tools);
    await service.ensureAuto(project, new AbortController().signal);
    const manual = await service.recompose(project, { frameId: "c2", text: "Giữ lại", position: "top" }, new AbortController().signal);
    expect(manual.meta).toMatchObject({ source: "manual", text: "Giữ lại", position: "top" });
    const before = calls.length;
    const again = await service.ensureAuto(project, new AbortController().signal);
    expect(again.meta?.source).toBe("manual");
    expect(again.meta?.text).toBe("Giữ lại");
    expect(calls.length).toBe(before);
  });

  it("rejects an upload that is the wrong type or too large", async () => {
    const { harness, project } = setup("BALANCED");
    const service = new ThumbnailService(harness.sqlite, harness.config, { get: () => ({ timeline: null }) }, fakeTools().tools);
    await expect(service.upload(project, Buffer.from([0, 1, 2, 3]), new AbortController().signal))
      .rejects.toMatchObject({ code: "THUMBNAIL_TYPE" });
    await expect(service.upload(project, Buffer.alloc(5 * 1024 * 1024 + 1, 0xff), new AbortController().signal))
      .rejects.toMatchObject({ code: "THUMBNAIL_TOO_LARGE" });

    const app = Fastify();
    app.addContentTypeParser(/^image\/(?:jpeg|png|gif)$/, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    registerThumbnailRoutes(app, service, { getProject: async (id) => harness.repository.getProject(id) });
    const gif = await app.inject({
      method: "POST",
      url: `/api/projects/${harness.projectId}/thumbnail/upload`,
      headers: { "content-type": "image/gif" },
      payload: Buffer.from("GIF89a"),
    });
    expect(gif.statusCode).toBe(400);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const ok = await app.inject({
      method: "POST",
      url: `/api/projects/${harness.projectId}/thumbnail/upload`,
      headers: { "content-type": "image/jpeg" },
      payload: jpeg,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().meta.source).toBe("manual");
    await app.close();
  });

  it("serves landscape and a candidate through the image route", async () => {
    const { harness, project } = setup("BALANCED");
    const { tools } = fakeTools();
    const service = new ThumbnailService(harness.sqlite, harness.config, { get: () => ({ timeline: timeline() }) }, tools);
    const state = await service.ensureAuto(project, new AbortController().signal);
    const candidateId = state.candidates[0]?.id;
    expect(candidateId).toBeTruthy();
    const app = Fastify();
    registerThumbnailRoutes(app, service, { getProject: async (id) => harness.repository.getProject(id) });
    const landscape = await app.inject({
      method: "GET",
      url: `/api/projects/${harness.projectId}/thumbnail/image/landscape`,
    });
    expect(landscape.statusCode).toBe(200);
    expect(String(landscape.headers["content-type"])).toMatch(/image\/jpeg/);
    const frame = await app.inject({
      method: "GET",
      url: `/api/projects/${harness.projectId}/thumbnail/image/${candidateId}`,
    });
    expect(frame.statusCode).toBe(200);
    expect(String(frame.headers["content-type"])).toMatch(/image\/(?:jpeg|png)/);
    const unknown = await app.inject({
      method: "GET",
      url: `/api/projects/${harness.projectId}/thumbnail/image/nope`,
    });
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });
});

function writePlan(text: string, font: string, dir: string, width: number, height: number) {
  const built = buildThumbnailVideoFilter({
    text,
    position: "bottom",
    fontFile: font,
    width,
    height,
    brandColor: "#C45C26",
    textFilePath: (index) => join(dir, "text", `${index}.txt`),
  });
  for (const file of built.textFiles) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.text, "utf8");
  }
  return built;
}

function runStaticFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegStaticBin, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

describe("thumbnail frame ranking with ffmpeg", () => {
  it.skipIf(!ffmpegStaticBin)("ranks a sharp testsrc2 frame above gblur sigma 20", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-thumb-rank-"));
    const sharpPath = join(dir, "sharp.png");
    const softPath = join(dir, "soft.png");
    const sharpFrame = await runStaticFfmpeg([
      "-y", "-hide_banner", "-nostdin",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=1",
      "-frames:v", "1",
      sharpPath,
    ]);
    expect(sharpFrame.code).toBe(0);
    const softFrame = await runStaticFfmpeg([
      "-y", "-hide_banner", "-nostdin",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=1",
      "-vf", "gblur=sigma=20",
      "-frames:v", "1",
      softPath,
    ]);
    expect(softFrame.code).toBe(0);

    const probe = async (file: string) => {
      const result = await runStaticFfmpeg([
        "-hide_banner", "-nostdin",
        "-i", file,
        "-vf", "blurdetect,signalstats,metadata=mode=print",
        "-f", "null", "-",
      ]);
      expect(result.code).toBe(0);
      return parseFrameProbe(result.stderr);
    };
    const sharp = await probe(sharpPath);
    const soft = await probe(softPath);
    expect(sharp).not.toBeNull();
    expect(soft).not.toBeNull();
    expect(sharp!.sharpness).toBeGreaterThan(soft!.sharpness);
    const ranked = rankByScore([
      { id: "soft", metrics: soft! },
      { id: "sharp", metrics: sharp! },
    ]);
    expect(ranked[0]?.id).toBe("sharp");
    expect(ranked[0]!.score).toBeGreaterThan(0);
  }, 30_000);
});

describe("thumbnail drawtext with ffmpeg", () => {
  it("renders Bí ẩn đại dương with the subtitle font", async () => {
    const font = resolveSubtitleFontFile();
    const dir = mkdtempSync(join(tmpdir(), "vg-thumb-"));
    const src = join(dir, "in.png");
    const out = join(dir, "out.jpg");
    await runFfmpeg(["-y", "-hide_banner", "-f", "lavfi", "-i", "color=c=0x224466:s=320x180", "-frames:v", "1", src]);
    const built = writePlan("Bí ẩn đại dương", font, dir, 320, 180);
    expect(built.filter).toContain("textfile=");
    expect(built.filter).toContain("expansion=none");
    expect(built.filter).not.toContain("Bí ẩn");
    expect(built.textFiles.map((file) => file.text).join("")).toContain("Bí ẩn");
    expect(built.textFiles.map((file) => file.text).join("")).toContain("dương");
    await runFfmpeg(["-y", "-hide_banner", "-i", src, "-vf", built.filter, "-frames:v", "1", "-q:v", "3", out]);
    const bytes = readFileSync(out);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes.length).toBeGreaterThan(400);
  });

  it.skipIf(!ffmpegStaticBin)("keeps quotes, percent and backslash with the ffmpeg-static binary", async () => {
    const font = resolveSubtitleFontFile();
    const dir = mkdtempSync(join(tmpdir(), "vg-thumb-text-"));
    const src = join(dir, "in.png");
    const frame = await runStaticFfmpeg([
      "-y", "-hide_banner", "-nostdin",
      "-f", "lavfi", "-i", "color=c=0x224466:s=640x360",
      "-frames:v", "1",
      src,
    ]);
    expect(frame.code).toBe(0);
    const texts = ["Don't miss it", "Bí ẩn: 100% thật, đúng không?", "a\\b"];
    for (const [index, text] of texts.entries()) {
      const built = writePlan(text, font, join(dir, String(index)), 640, 360);
      expect(built.filter).toContain("textfile=");
      expect(built.filter).toContain("expansion=none");
      expect(built.filter).not.toContain(text);
      const out = join(dir, `out-${index}.jpg`);
      const result = await runStaticFfmpeg([
        "-y", "-hide_banner", "-nostdin",
        "-i", src,
        "-vf", built.filter,
        "-frames:v", "1",
        "-q:v", "3",
        out,
      ]);
      expect(result.code).toBe(0);
      expect(result.stderr).not.toContain("Stray %");
    }
  }, 30_000);
});
