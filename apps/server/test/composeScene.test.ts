import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { ScenePlan } from "@vg/shared";
import { resolveFfmpegPath, resolveFfprobePath } from "../src/media/ffmpeg.js";
import { renderComposedScene } from "../src/compose/sceneClip.js";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(stderr))));
  });
}

function framesOf(file: string): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(resolveFfprobePath(), [
      "-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => (code === 0 ? resolvePromise(Number(stdout.trim())) : rejectPromise(new Error(stderr))));
  });
}

describe("renderComposedScene", () => {
  it("joins two one-second testsrc shots into exactly 60 frames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vg-scene-"));
    const clip = join(dir, "src.mp4");
    try {
      await run(resolveFfmpegPath(), [
        "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=1.2",
        "-frames:v", "36", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", clip,
      ]);
      const shot = (id: string, start: number): ScenePlan["shots"][number] => ({
        id,
        kind: "footage",
        startSec: start,
        endSec: start + 1,
        reason: "test",
        source: {
          kind: "footage",
          clipId: id,
          path: clip,
          inSec: 0,
          license: { provider: "pexels", clipId: id, author: "Test", licenseName: "Pexels License", pageUrl: "https://www.pexels.com/video/x" },
        },
      });
      const plan: ScenePlan = {
        sceneId: "s",
        durationSec: 2,
        durationFrames: 60,
        fps: 30,
        warnings: [],
        shots: [shot("a", 0), shot("b", 1)],
      };
      const out = join(dir, "out.mp4");
      const rendered = await renderComposedScene(plan, { width: 160, height: 90, fps: 30 }, {
        dataDir: dir,
        outDir: join(dir, "shots"),
        resolvePath: (path) => path,
      }, out);
      expect(rendered.frames).toBe(60);
      expect(await framesOf(out)).toBe(60);
      // Second render hits the cache and must still write the clip to the new outPath.
      const again = join(dir, "again", "out.mp4");
      await renderComposedScene(plan, { width: 160, height: 90, fps: 30 }, {
        dataDir: dir,
        outDir: join(dir, "shots"),
        resolvePath: (path) => path,
      }, again);
      expect(await framesOf(again)).toBe(60);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
