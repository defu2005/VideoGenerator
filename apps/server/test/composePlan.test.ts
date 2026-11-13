import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beatGridForMusic } from "../src/compose/beatsFile.js";
import { planProject } from "../src/compose/composeService.js";
import { renderComposeTemplate, runHyperframes } from "../src/compose/hyperframes.js";
import type { FootageHit } from "../src/providers/footage/types.js";
import type { TimelineScene } from "@vg/shared";

function scene(id: string, seconds: number): TimelineScene {
  const frames = Math.round(seconds * 30);
  return {
    sceneId: id,
    order: 0,
    label: id,
    startSec: 0,
    endSec: frames / 30,
    durationSec: frames / 30,
    durationFrames: frames,
    voice: null,
    visuals: [{
      kind: "IMAGE",
      candidateId: "still-1",
      path: "still.png",
      startSec: 0,
      endSec: frames / 30,
      motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1, x: 0.5, y: 0.5 } },
      motionPreset: "static",
      licenseKind: "ROYALTY_FREE",
    }],
    fadeInSec: 0,
    fadeOutSec: 0,
  };
}

function hit(id: string): FootageHit {
  return {
    provider: "pexels",
    clipId: id,
    url: `https://video.example/${id}.mp4`,
    width: 640,
    height: 360,
    durationSec: 8,
    author: "An Nguyen",
    licenseName: "Pexels License",
    pageUrl: `https://www.pexels.com/video/${id}`,
    previewImage: "",
    tags: [],
    files: [],
  };
}

describe("planProject", () => {
  it("uses footage only when a scene has at least two hits, otherwise a still", async () => {
    const words = Array.from({ length: 8 }, (_, index) => ({ startSec: index * 0.4, endSec: index * 0.4 + 0.3, text: index === 7 ? "xong." : "từ" }));
    const plan = await planProject({
      timeline: { scenes: [scene("a", 8), { ...scene("b", 8), sceneId: "b" }], music: null },
      scenes: [
        { id: "a", narration: "Một hai.", visualQueries: { primary: "biển", alternatives: [] } },
        { id: "b", narration: "Ba.", visualQueries: { primary: "rừng", alternatives: [] } },
      ],
      voiceTracks: [
        { sceneId: "a", words, timingSource: "provider" },
        { sceneId: "b", words, timingSource: "provider" },
      ],
      recipeId: "explainer",
      preset: "news",
      aspect: "16:9",
      footageSearch: async (query) => query === "biển" ? ["1", "2", "3", "4"].map(hit) : [hit("9")],
    });
    expect(plan.engine).toBe("compose");
    expect(plan.scenes[0]?.shots.every((shot) => shot.kind === "footage")).toBe(true);
    expect(new Set(plan.scenes[0]?.shots.map((shot) => shot.source.kind === "footage" ? shot.source.clipId : ""))).not.toEqual(new Set([""]));
    // TASK-067b part 3: the in-point depends on the room in the clip. The shot never runs past the 8 s clip.
    expect(plan.scenes[0]?.shots.every((shot) => shot.source.kind !== "footage" || shot.source.inSec + (shot.endSec - shot.startSec) <= 8 + 1e-6)).toBe(true);
    expect(plan.scenes[1]?.shots.every((shot) => shot.kind === "still")).toBe(true);
    expect(plan.scenes[0]?.warnings).toEqual([]);
  });

  it("falls back to one still when the director returns no usable span", async () => {
    const timelineScene = scene("a", 0.9);
    const plan = await planProject({
      timeline: { scenes: [timelineScene] },
      scenes: [{ id: "a", narration: "" }],
      voiceTracks: [],
      recipeId: "story",
      preset: "calm",
      aspect: "16:9",
      director: {
        id: "short-graphic",
        directScenes: async () => [[{ kind: "kinetic_text", wordStart: 0, wordEnd: 0, reason: "ngắn" }]],
      },
    });
    expect(plan.scenes[0]?.shots).toHaveLength(1);
    expect(plan.scenes[0]?.shots[0]?.kind).toBe("still");
    expect(plan.scenes[0]?.warnings.some((warning) => warning.includes("cảnh tĩnh"))).toBe(true);
  });
});

describe("renderComposeTemplate", () => {
  it("asks the injected runner to write the cached file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vg-compose-"));
    try {
      const first = await renderComposeTemplate({
        dataDir: dir,
        templateId: "kinetic_text",
        variables: { lines: ["Xin chào"], emphasis: [0], style: "bold", brandColor: "#0F172A", accentColor: "#F5C518" },
        width: 160,
        height: 90,
        fps: 30,
        durationSec: 1,
        run: async (_command, _args, _env, outputPath) => {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(outputPath, "webm");
        },
      });
      expect(first.cached).toBe(false);
      expect(first.outputPath.endsWith(".webm") || first.outputPath.endsWith(".mov")).toBe(true);
      const second = await renderComposeTemplate({
        dataDir: dir,
        templateId: "kinetic_text",
        variables: { lines: ["Xin chào"], emphasis: [0], style: "bold", brandColor: "#0F172A", accentColor: "#F5C518" },
        width: 160,
        height: 90,
        fps: 30,
        durationSec: 1,
        run: async () => { throw new Error("không render lại"); },
      });
      expect(second.cached).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runHyperframes", () => {
  // Fake command: node writes more than 1 MB to stdout, then exits with the given code.
  const noisy = (code: number) => [
    "-e",
    `const line = "x".repeat(1023) + "\\n"; let n = 0;
     const pump = () => { while (n < 1500) { n++; if (!process.stdout.write(line)) { process.stdout.once("drain", pump); return; } }
       process.stdout.write("last-line\\n", () => process.exit(${code})); };
     pump();`,
  ];

  it("does not hang when the child writes over 1 MB to stdout", async () => {
    await expect(runHyperframes(process.execPath, noisy(0), process.env, "")).resolves.toBeUndefined();
  }, 20_000);

  it("keeps only the last 20 stdout lines in the error", async () => {
    const error = await runHyperframes(process.execPath, noisy(3), process.env, "").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const lines = (error as Error).message.split("\n");
    expect(lines.length).toBeLessThanOrEqual(20);
    expect(lines.at(-1)).toBe("last-line");
  }, 20_000);
});

describe("beatGridForMusic", () => {
  it("caches a decoded click track", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vg-beats-"));
    const rate = 11025;
    const pcm = Buffer.alloc(rate * 8 * 4);
    const view = new Float32Array(pcm.buffer);
    const period = rate * 0.5;
    const burst = Math.round(rate * 0.005);
    for (let start = 0; start + burst < view.length; start += period) {
      const at = Math.round(start);
      for (let index = 0; index < burst; index += 1) view[at + index] = index % 2 === 0 ? 1 : -1;
    }
    let calls = 0;
    try {
      const grid = await beatGridForMusic(dir, join(dir, "missing.wav"), async () => {
        calls += 1;
        return pcm;
      });
      expect(grid?.bpm).toBeGreaterThan(100);
      await beatGridForMusic(dir, join(dir, "missing.wav"), async () => {
        calls += 1;
        return pcm;
      });
      expect(calls).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
