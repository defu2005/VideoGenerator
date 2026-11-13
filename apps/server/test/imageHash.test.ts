import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { hashImage } from "../src/services/imageHash.js";

const execFileAsync = promisify(execFile);

describe("imageHash", () => {
  it("hashes a generated PNG and matches a copy", async () => {
    if (!ffmpegPath) {
      console.info("Bỏ qua: ffmpeg-static không có binary trên máy này.");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "vg-hash-fixture-"));
    const file = join(dir, "tiny.png");
    try {
      await execFileAsync(ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=16x16", "-frames:v", "1", file,
      ], { timeout: 10_000 });
      const first = await hashImage(file);
      const second = await hashImage(file);
      expect(first?.phash).toMatch(/^[a-f0-9]{16}$/);
      expect(second?.phash).toBe(first?.phash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
