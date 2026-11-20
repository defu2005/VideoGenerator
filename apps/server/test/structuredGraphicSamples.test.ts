import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ShotSource, Shot } from "@vg/shared";
import { renderComposeTemplate } from "../src/compose/hyperframes.js";
import { graphicVariables } from "../src/compose/render/graphicVars.js";
import { runFfmpeg } from "../src/media/ffmpeg.js";

/** Offline still-frame acceptance harness; deliberately opt-in because it launches Chromium/ffmpeg. */
describe.skipIf(process.env.VG_099_SAMPLES !== "1")("TASK-099 offline template stills", () => {
  it("renders both new token templates in both aspects", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-099-samples-"));
    const out = join(__dirname, "..", "..", "..", "docs", "compose", "samples", "task099"); mkdirSync(out, { recursive: true });
    const sources: ShotSource[] = [
      { kind: "diagram", title: "Vòng tuần hoàn của nước", layout: "flow", nodes: [{ id: "a", label: "Nước" }, { id: "b", label: "Hơi nước" }, { id: "c", label: "Mây" }, { id: "d", label: "Mưa" }], edges: [{ from: "a", to: "b", label: "Bay hơi" }, { from: "b", to: "c", label: "Ngưng tụ" }, { from: "c", to: "d" }], itemTimes: [0, 1.1, 2.2, 3.3] },
      { kind: "timeline", title: "Những bước tiến vào vũ trụ", events: [{ date: "1961", label: "Con người vào vũ trụ" }, { date: "1969", label: "Đặt chân lên Mặt Trăng" }, { date: "1971", label: "Trạm không gian đầu tiên" }], itemTimes: [0, 1.5, 3] },
    ];
    try {
      for (const source of sources.filter((source) => !process.env.VG_099_SAMPLE_KIND || source.kind === process.env.VG_099_SAMPLE_KIND)) for (const size of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
        const durationSec = 6, shot: Shot = { id: `sample-${source.kind}`, kind: source.kind, source, startSec: 0, endSec: durationSec, reason: "TASK-099 sample" };
        const rendered = await renderComposeTemplate({ dataDir: root, templateId: source.kind, variables: graphicVariables(shot, durationSec, size, {}), ...size, fps: 30, durationSec, format: "mp4", quality: "standard", startSec: 5, endSec: 5 + 1 / 30 });
        expect(rendered.warning).toBeUndefined(); expect(rendered.outputPath).not.toBe("");
        await runFfmpeg(["-y", "-i", rendered.outputPath, "-frames:v", "1", join(out, `${source.kind}-${size.width}x${size.height}.png`)]);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 180_000);
});
