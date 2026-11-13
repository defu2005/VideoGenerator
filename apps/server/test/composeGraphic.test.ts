import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { COMPOSE_RENDER_VERSION, estimateRenderSeconds, ScenePlanSchema, stylePackFromChoices, templateManifest, templateTokenLint, validateScenePlan, type ScenePlan, type Shot, type TemplateStyle } from "@vg/shared";
import { planEval } from "../src/compose/eval/runEval.js";
import { composeAssetRoot } from "../src/compose/hyperframes.js";
import { prepareGraphicStyle } from "../src/compose/render/graphicStyle.js";
import { sceneCacheKey, sceneCacheMaterial } from "../src/compose/sceneClip.js";
import { finishedSeekSec, graphicRenderLimit, renderShot, withGraphicSlot } from "../src/compose/render/graphic.js";
import {
  END_HOLD_SEC,
  MIN_CONTRAST,
  contrastRatio,
  graphicColors,
  graphicSafeZone,
  graphicVariables,
  graphicVariant,
  kineticWordTimes,
} from "../src/compose/render/graphicVars.js";

const kinetic = (extra: Record<string, unknown> = {}): Shot => ({
  id: "scene-1-s0",
  kind: "kinetic_text",
  startSec: 0,
  endSec: 3,
  reason: "R2-hook",
  source: { kind: "kinetic_text", lines: ["Tiết kiệm 40%", "mỗi năm"], emphasis: [2], style: "bold", ...extra },
} as Shot);

const list = (extra: Record<string, unknown> = {}): Shot => ({
  id: "scene-3-s0",
  kind: "list_full",
  startSec: 0,
  endSec: 5,
  reason: "list",
  source: {
    kind: "list_full",
    title: "Thói quen buổi sáng",
    items: ["Uống một cốc nước ấm", "Vận động mười phút", "Không xem điện thoại"],
    ...extra,
  },
} as Shot);

const quote = (): Shot => ({
  id: "scene-5-s0",
  kind: "quote_full",
  startSec: 0,
  endSec: 5,
  reason: "quote",
  source: {
    kind: "quote_full",
    quote: "Đầu tư vào tri thức luôn mang lại lợi nhuận cao nhất",
    speaker: "Benjamin Franklin",
    role: "Nhà khoa học",
    emphasis: [3, 4],
    reveal: "ghost",
  },
} as Shot);

const compare = (extra: Record<string, unknown> = {}): Shot => ({
  id: "scene-4-s0",
  kind: "compare",
  startSec: 0,
  endSec: 4,
  reason: "compare",
  source: {
    kind: "compare",
    style: "versus",
    left: { label: "Thuê nhà", text: "8 triệu mỗi tháng" },
    right: { label: "Mua nhà", text: "15 triệu mỗi tháng" },
    rightAt: 1.6,
    ...extra,
  },
} as Shot);

const mapShot = (): Shot => ({
  id: "scene-4-s0",
  kind: "map",
  startSec: 0,
  endSec: 4,
  reason: "map",
  source: { kind: "map", focus: "VN", zoom: "push", highlight: "fill", sublabel: "Đông Nam Á" },
} as Shot);

const chart: Shot = {
  id: "scene-2-s1",
  kind: "chart",
  startSec: 3,
  endSec: 7,
  reason: "R1-numbers",
  source: { kind: "chart", chart: "bar", title: "Doanh thu", labels: ["2023", "2024"], values: [120, 180], unit: "tỷ" },
};

describe("graphic colours", () => {
  it("keeps a dark brand colour and reads white text at 4.5:1 or better", () => {
    const colors = graphicColors("#0F172A", "#F5C518");
    expect(colors.bg).toBe("#0F172A");
    expect(contrastRatio(colors.text, colors.bgLight)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio(colors.accent, colors.bgLight)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it.each(["#FFFFFF", "#F5C518", "#8FD3F4", "#FF6B6B", "#ccc"])("darkens the light brand colour %s", (brand) => {
    const colors = graphicColors(brand, "#F5C518");
    expect(colors.bg).not.toBe(brand.toUpperCase());
    expect(contrastRatio(colors.text, colors.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio(colors.text, colors.bgLight)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("lightens an accent that is too dark for the background", () => {
    const colors = graphicColors("#0F172A", "#1E293B");
    expect(contrastRatio(colors.accent, colors.bgLight)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("falls back to the defaults for a broken colour and always returns #RRGGBB", () => {
    const colors = graphicColors("blue", "rgb(1,2,3)");
    expect(colors.bg).toBe("#0F172A");
    expect(colors.accent).toBe("#F5C518");
    for (const value of [colors.bg, colors.bgLight, colors.bgDark, colors.text, colors.accent, colors.muted, ...colors.series]) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("graphic variant and safe zone", () => {
  it("is stable and uses all three looks", () => {
    expect(graphicVariant("p1", "s-0")).toBe(graphicVariant("p1", "s-0"));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => graphicVariant("project", `scene-${i}-s0`)));
    expect([...seen].sort()).toEqual([0, 1, 2]);
    const other = Array.from({ length: 30 }, (_, i) => graphicVariant("other", `scene-${i}-s0`));
    expect(other).not.toEqual(Array.from({ length: 30 }, (_, i) => graphicVariant("project", `scene-${i}-s0`)));
  });

  it("keeps the subtitle band and the 9:16 button column free", () => {
    expect(graphicSafeZone({ width: 1920, height: 1080 })).toEqual({ safe: { top: 0.06, left: 0.06, right: 0.06, bottom: 0.22 }, maxLines: 2 });
    expect(graphicSafeZone({ width: 1080, height: 1920 })).toEqual({ safe: { top: 0.06, left: 0.06, right: 0.12, bottom: 0.3 }, maxLines: 3 });
  });
});

describe("kinetic word times", () => {
  it("spreads words evenly and leaves the end hold free", () => {
    const times = kineticWordTimes(5, 3);
    expect(times[0]).toBe(0);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.max(...times) + 0.4).toBeLessThanOrEqual(3 - END_HOLD_SEC + 1e-9);
    expect(kineticWordTimes(1, 2)).toEqual([0]);
  });

  it("uses word times when they match, starting at the first word and clamped", () => {
    expect(kineticWordTimes(3, 3, [0.5, 1, 1.5])).toEqual([0, 0.5, 1]);
    const late = kineticWordTimes(3, 2, [0, 1, 5]);
    expect(late[2]).toBeCloseTo(2 - END_HOLD_SEC - 0.4);
    expect(kineticWordTimes(3, 3, [0, 1])).toEqual(kineticWordTimes(3, 3));
    expect(kineticWordTimes(2, 3, [0, Number.NaN])).toEqual(kineticWordTimes(2, 3));
  });

  it("never goes below zero on a very short shot", () => {
    expect(kineticWordTimes(4, 0.4).every((t) => t === 0)).toBe(true);
  });
});

describe("graphic variables", () => {
  it("gives the kinetic template words, colours, variant and safe zone", () => {
    const vars = graphicVariables(kinetic(), 3, { width: 1080, height: 1920 }, { projectId: "p", brandColor: "#FFFFFF" });
    expect((vars.words as { text: string }[]).map((word) => word.text)).toEqual(["Tiết", "kiệm", "40%", "mỗi", "năm"]);
    expect(vars.maxLines).toBe(3);
    expect(vars.variant).toBe(graphicVariant("p", "scene-1-s0"));
    expect(vars.durationSec).toBe(3);
    expect(vars).not.toHaveProperty("wordTimes");
    expect(contrastRatio("#FFFFFF", vars.brandColor as string)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it("passes the chart payload through unchanged", () => {
    const vars = graphicVariables(chart, 4, { width: 1920, height: 1080 }, { language: "en" });
    expect(vars).toMatchObject({ chart: "bar", title: "Doanh thu", labels: ["2023", "2024"], values: [120, 180], unit: "tỷ", language: "en", maxLines: 2 });
    expect(vars.style).toEqual(expect.objectContaining({ v: 1 }));
  });

  it("passes a resolved style, keeps a fixed axis, and changes with the pack", () => {
    const frame = { width: 1920, height: 1080 };
    const ctx = { projectId: "p", profileId: "channel", recipeId: "listicle" };
    const first = graphicVariables(list(), 5, frame, ctx).style as TemplateStyle;
    const again = graphicVariables(list(), 5, frame, ctx).style as TemplateStyle;
    expect(first.v).toBe(1);
    expect(first.fingerprint).toBe(again.fingerprint);
    expect(first.axes).toEqual(again.axes);
    expect(first.axes.layout).toBeTruthy();

    const pinned = graphicVariables(list({ highlight: "pop", marker: "dot" }), 5, frame, ctx).style as TemplateStyle;
    expect(pinned.axes.highlight).toBe("pop");
    expect(pinned.axes.marker).toBe("dot");

    const bare = graphicVariables(list(), 5, frame, { projectId: "p", profileId: "channel", stylePack: null }).style as TemplateStyle;
    const history = graphicVariables(list(), 5, frame, { projectId: "p", profileId: "channel", recipeId: "history", stylePack: null }).style as TemplateStyle;
    expect(history.fingerprint).not.toBe(bare.fingerprint);

    const news = stylePackFromChoices({ id: "newsroom", name: "Ban tin", presetId: "newsroom" });
    const paper = stylePackFromChoices({ id: "paper", name: "Trang giay", presetId: "paper" });
    const newsVars = graphicVariables(list(), 5, frame, { ...ctx, brandColor: "#112233", accentColor: "#F5C518", stylePack: news });
    const paperStyle = graphicVariables(list(), 5, frame, { ...ctx, stylePack: paper }).style as TemplateStyle;
    const newsStyle = newsVars.style as TemplateStyle;
    expect(newsStyle.fingerprint).not.toBe(paperStyle.fingerprint);
    expect(newsStyle.color.bg).not.toBe(paperStyle.color.bg);
    expect(newsStyle.packId).toBe("newsroom");
    expect(newsVars.brandColor).toBe(graphicColors("#112233", "#F5C518").bg);
    expect(newsVars.accentColor).toBe(graphicColors("#112233", "#F5C518").accent);
    expect(newsVars.colors).toEqual(graphicColors("#112233", "#F5C518"));
  });

  it("passes manifest axes for a tokens-v1 template and keeps the shot style string", () => {
    const frame = { width: 1920, height: 1080 };
    const ctx = { projectId: "p", profileId: "channel", recipeId: "explainer" };
    for (const shot of [compare(), quote(), kinetic(), chart, mapShot()]) {
      const vars = graphicVariables(shot, 5, frame, ctx);
      const manifest = templateManifest(shot.source.kind);
      expect(manifest?.contract, shot.source.kind).toBe("tokens-v1");
      const style = vars.style as TemplateStyle;
      for (const axis of manifest!.axes) {
        expect(axis.values.map((value) => value.id), `${shot.source.kind}.${axis.id}`).toContain(style.axes[axis.id]);
      }
    }
    expect(graphicVariables(compare(), 4, frame, ctx).shotStyle).toBe("versus");
    expect(graphicVariables(kinetic(), 3, frame, ctx).shotStyle).toBe("bold");
    const mapped = graphicVariables(mapShot(), 4, frame, ctx);
    expect(mapped.zoom).toBe("push");
    expect(mapped.highlight).toBe("fill");
    const tall = graphicVariables(compare(), 4, { width: 1080, height: 1920 }, ctx).style as TemplateStyle;
    expect(tall.axes.layout).toBe("stack");
    const news = stylePackFromChoices({ id: "newsroom", name: "Ban tin", presetId: "newsroom" });
    const paper = stylePackFromChoices({ id: "paper", name: "Trang giay", presetId: "paper" });
    const newsStyle = graphicVariables(compare(), 4, frame, { ...ctx, stylePack: news }).style as TemplateStyle;
    const paperStyle = graphicVariables(compare(), 4, frame, { ...ctx, stylePack: paper }).style as TemplateStyle;
    expect(newsStyle.fingerprint).not.toBe(paperStyle.fingerprint);
  });

  it("accepts plans with and without wordTimes", () => {
    const plan = (shot: Shot): ScenePlan => ({ sceneId: "s", durationSec: 3, durationFrames: 90, fps: 30, warnings: [], shots: [shot] });
    for (const shot of [kinetic(), kinetic({ wordTimes: [0, 0.3, 0.6, 1, 1.3] })]) {
      expect(ScenePlanSchema.safeParse(plan(shot)).success).toBe(true);
      expect(validateScenePlan(plan(shot), [])).toEqual([]);
    }
    expect(ScenePlanSchema.safeParse(plan(kinetic({ wordTimes: [-1] }))).success).toBe(false);
  });
});

describe("graphic templates", () => {
  const read = (name: string) => readFileSync(join(composeAssetRoot(), name), "utf8");
  const files = ["common.js", "kinetic_text/index.html", "chart/index.html", "compare/index.html", "map/index.html"];

  it("never clips diacritics: line-height ≥ 1.25 and no hidden overflow on text", () => {
    for (const file of files) {
      const text = read(file);
      for (const match of text.matchAll(/line-height:\s*([0-9.]+)/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(1.25);
      expect(text).not.toMatch(/text-overflow/);
      // Only the root frame may hide overflow.
      const hidden = [...text.matchAll(/overflow:\s*hidden/g)].length;
      expect(hidden).toBe(file === "common.js" ? 1 : 0);
    }
    expect(read("common.js")).toMatch(/const LH = 1\.3;/);
  });

  it("uses Be Vietnam Pro with a Noto Sans fallback and loads the shared script", () => {
    expect(read("common.js")).toMatch(/"Be Vietnam Pro","Noto Sans"/);
    for (const file of files.slice(1)) {
      expect(read(file)).toContain('<script src="common.js"></script>');
      expect(read(file)).toContain("VG.finish();");
      expect(read(file)).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    }
  });

  it("keeps list_full working when variables.style is missing", () => {
    const html = read("list_full/index.html");
    expect(html).not.toContain("list_full needs variables.style");
    expect(html).toContain("function fallbackListStyle()");
    expect(html).not.toContain("throw new Error");
  });

  it("token-lints converted templates and keeps the shot style read", () => {
    for (const id of ["list_full", "compare", "quote_full", "kinetic_text", "chart", "map"]) {
      expect(templateTokenLint(read(`${id}/index.html`)), id).toEqual([]);
    }
    expect(read("compare/index.html")).toContain("fallbackStyle()");
    expect(read("quote_full/index.html")).toContain("fallbackStyle()");
    expect(read("kinetic_text/index.html")).toContain("fallbackStyle()");
    expect(read("chart/index.html")).toContain("fallbackStyle()");
    expect(read("map/index.html")).toContain("fallbackStyle()");
    expect(read("compare/index.html")).toContain("v.shotStyle");
    expect(read("kinetic_text/index.html")).toContain("v.shotStyle");
  });

  it("holds the last frame: every tween goes through at() and the timeline spans the shot", () => {
    const common = read("common.js");
    expect(common).toContain("const END = Math.max(0.1, D - 0.2);");
    expect(common).toContain("tl.set({}, {}, D);");
    for (const file of files.slice(1)) {
      const calls = read(file).split("\n").filter((line) => /\btl\.(to|from|fromTo|set)\(/.test(line));
      expect(calls.length).toBeGreaterThan(3);
      for (const line of calls) expect(line, line).toMatch(/\bat\(|, start\)|, t0\)/);
    }
  });
});

describe("graphic renderShot", () => {
  it("hands the template its variables, the shared script and all font subsets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vg-graphic-"));
    try {
      let seen: Record<string, unknown> = {};
      let workFiles: boolean[] = [];
      const ffmpegArgs: string[][] = [];
      const result = await renderShot(kinetic({ wordTimes: [0, 0.2, 0.5, 0.9, 1.2] }), { width: 1080, height: 1920, fps: 30 }, {
        dataDir: dir,
        outDir: join(dir, "shots"),
        resolvePath: (path) => path,
        projectId: "p",
        brandColor: "#FFEE99",
        runTemplate: async (_command, args, _env, outputPath) => {
          const variablesFile = args[args.indexOf("--variables-file") + 1]!;
          seen = JSON.parse(readFileSync(variablesFile, "utf8")) as Record<string, unknown>;
          const work = dirname(variablesFile);
          workFiles = ["common.js", "index.html", "font.woff2", "font-bold.woff2", "font-latin.woff2", "font-latin-bold.woff2", "font-latin-ext.woff2", "font-latin-ext-bold.woff2"]
            .map((name) => existsSync(join(work, name)));
          writeFileSync(outputPath, "fake");
        },
        ffmpeg: async (args) => {
          ffmpegArgs.push(args);
          writeFileSync(args[args.length - 1]!, "fake");
        },
      });
      expect(result.warning).toBeUndefined();
      expect(result.frames).toBe(90);
      expect(workFiles.every(Boolean)).toBe(true);
      expect(seen.shotStyle).toBe("bold");
      expect(seen.style).toEqual(expect.objectContaining({ v: 1, fingerprint: expect.any(String) }));
      expect(seen.variant).toBe(graphicVariant("p", "scene-1-s0"));
      expect((seen.words as { t: number }[]).map((word) => word.t)).toEqual([0, 0.2, 0.5, 0.9, 1.2]);
      expect(seen.safe).toEqual({ top: 0.06, left: 0.06, right: 0.12, bottom: 0.3 });
      expect(contrastRatio("#FFFFFF", (seen.colors as { bgLight: string }).bgLight)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(ffmpegArgs).toHaveLength(1);
      expect(ffmpegArgs[0]!.join(" ")).toContain("-frames:v 90");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("seeks the finished frame and loops it to the exact frame count", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vg-graphic-static-"));
    const seek = finishedSeekSec(3, 30);
    expect(seek.startSec).toBeCloseTo(2.8, 5);
    expect(seek.endSec - seek.startSec).toBeCloseTo(1 / 30, 5);
    try {
      let args: string[] = [];
      const ffmpegArgs: string[][] = [];
      const result = await renderShot(kinetic(), { width: 1080, height: 1920, fps: 30 }, {
        dataDir: dir,
        outDir: join(dir, "shots"),
        resolvePath: (path) => path,
        composeGraphics: "static",
        graphicGrain: false,
        runTemplate: async (_command, commandArgs, _env, outputPath) => {
          args = commandArgs;
          writeFileSync(outputPath, "frame");
        },
        ffmpeg: async (commandArgs) => {
          ffmpegArgs.push(commandArgs);
          writeFileSync(commandArgs[commandArgs.length - 1]!, "clip");
        },
      });
      expect(args).toContain("--start");
      expect(args[args.indexOf("--start") + 1]).toBe(seek.startSec.toFixed(3));
      expect(args[args.indexOf("--end") + 1]).toBe(seek.endSec.toFixed(3));
      expect(seek.startSec).toBeGreaterThan(2.7);
      expect(seek.startSec).toBeLessThan(2.9);
      expect(args).toContain("--format");
      expect(args[args.indexOf("--format") + 1]).toBe("mp4");
      expect(ffmpegArgs).toHaveLength(1);
      expect(ffmpegArgs[0]).toContain("-frames:v");
      expect(ffmpegArgs[0]![ffmpegArgs[0]!.indexOf("-frames:v") + 1]).toBe("90");
      expect(ffmpegArgs[0]!.join(" ")).toContain("fade=t=in:st=0:d=0.2");
      expect(result.graphicPath).toBe("static");
      expect(result.frames).toBe(90);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips the second encode only when the probe matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vg-graphic-probe-"));
    const target = { width: 1080, height: 1920, fps: 30 };
    const match = { width: 1080, height: 1920, fps: 30, frames: 90, pixFmt: "yuv420p", codec: "h264" };
    try {
      const run = async (probe: typeof match, name: string) => {
        const calls: string[][] = [];
        const result = await renderShot(kinetic(), target, {
          dataDir: join(dir, name),
          outDir: join(dir, name, "shots"),
          resolvePath: (path) => path,
          composeGraphics: "animated",
          probeGraphic: async () => probe,
          runTemplate: async (_command, _args, _env, outputPath) => { writeFileSync(outputPath, "clip"); },
          ffmpeg: async (commandArgs) => {
            calls.push(commandArgs);
            writeFileSync(commandArgs[commandArgs.length - 1]!, "out");
          },
        });
        return { calls, result };
      };
      const kept = await run(match, "match");
      expect(kept.calls).toHaveLength(0);
      expect(kept.result.graphicPath).toBe("animated");
      const redone = await run({ ...match, codec: "vp9" }, "miss");
      expect(redone.calls).toHaveLength(1);
      expect(redone.result.graphicPath).toBe("reencoded");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("graphic cache and concurrency", () => {
  const plan = {
    sceneId: "s",
    durationSec: 3,
    durationFrames: 90,
    fps: 30,
    shots: [kinetic()],
    warnings: [],
  } satisfies ScenePlan;
  const target = { width: 1080, height: 1920, fps: 30 };
  const base = {
    dataDir: "d",
    outDir: "o",
    resolvePath: (path: string) => path,
    projectId: "p",
    language: "vi",
    brandColor: "#112233",
    accentColor: "#F5C518",
    composeGraphics: "animated" as const,
    graphicGrain: false,
  };

  it("changes the scene key when colour, language, mode, grain or version change", () => {
    const assets = ["a"];
    const first = sceneCacheKey(plan, assets, target, base);
    expect(sceneCacheKey(plan, assets, target, { ...base, brandColor: "#000000" })).not.toBe(first);
    expect(sceneCacheKey(plan, assets, target, { ...base, language: "en" })).not.toBe(first);
    expect(sceneCacheKey(plan, assets, target, { ...base, composeGraphics: "static" })).not.toBe(first);
    expect(sceneCacheKey(plan, assets, target, { ...base, graphicGrain: true })).not.toBe(first);
    expect(sceneCacheKey({ ...plan, shots: [kinetic({ lines: ["Khác"] })] }, assets, target, base)).not.toBe(first);
    const material = sceneCacheMaterial(plan, assets, target, base);
    expect(material.renderVersion).toBe(COMPOSE_RENDER_VERSION);
    const bumped = createHash("sha256").update(JSON.stringify({ ...material, renderVersion: COMPOSE_RENDER_VERSION + 1 })).digest("hex").slice(0, 24);
    expect(bumped).not.toBe(first);
    expect(first).toBe(sceneCacheKey(plan, assets, target, base));
  });

  it("changes the scene key when the style fingerprint or the axes change", () => {
    const frame = { width: target.width, height: target.height };
    const news = prepareGraphicStyle({
      projectId: "p",
      profileId: "channel",
      width: frame.width,
      height: frame.height,
      shots: plan.shots,
      pack: stylePackFromChoices({ id: "newsroom", name: "Ban tin", presetId: "newsroom" }),
    });
    const paper = prepareGraphicStyle({
      projectId: "p",
      profileId: "channel",
      width: frame.width,
      height: frame.height,
      shots: plan.shots,
      pack: stylePackFromChoices({ id: "paper", name: "Trang giay", presetId: "paper" }),
    });
    const key = (videoStyle: typeof news) => sceneCacheKey(plan, ["a"], target, { ...base, videoStyle });
    expect(news.fingerprint).not.toBe(paper.fingerprint);
    expect(key(news)).not.toBe(key(paper));
    expect(key(news)).toBe(key(news));
    const shot = plan.shots[0]!;
    const picked = news.byShot[shot.id]!;
    const tweaked = {
      fingerprint: news.fingerprint,
      byShot: {
        ...news.byShot,
        [shot.id]: { ...picked, axes: { ...picked.axes, background: picked.axes.background === "flat" ? "grid" : "flat" } },
      },
    };
    expect(key(tweaked)).not.toBe(key(news));
    const again = prepareGraphicStyle({
      projectId: "p",
      profileId: "channel",
      width: frame.width,
      height: frame.height,
      shots: plan.shots,
      pack: stylePackFromChoices({ id: "newsroom", name: "Ban tin", presetId: "newsroom" }),
    });
    expect(again.byShot[shot.id]?.axes).toEqual(news.byShot[shot.id]?.axes);
  });

  it("keeps the default at one graphic at a time and overlaps only a hand-set integer", async () => {
    expect(graphicRenderLimit()).toBe(1);
    process.env.COMPOSE_GRAPHIC_CONCURRENCY = "2";
    expect(graphicRenderLimit()).toBe(2);
    let active = 0;
    let peak = 0;
    const run = () => withGraphicSlot(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
    });
    await Promise.all([run(), run()]);
    expect(peak).toBe(2);
    delete process.env.COMPOSE_GRAPHIC_CONCURRENCY;
    expect(graphicRenderLimit()).toBe(1);
  });
});

describe("estimate on eval plans", () => {
  it("stays monotone for explainer, listicle and story", async () => {
    for (const id of ["explainer", "listicle", "story"] as const) {
      const { plan } = await planEval(id, "compose");
      const off = estimateRenderSeconds(plan, { composeGraphics: "off" }).seconds;
      const still = estimateRenderSeconds(plan, { composeGraphics: "static" }).seconds;
      const animated = estimateRenderSeconds(plan, { composeGraphics: "animated", graphicGrain: false }).seconds;
      expect(off, id).toBeLessThanOrEqual(still);
      expect(still, id).toBeLessThanOrEqual(animated);
    }
  });
});
