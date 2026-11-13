import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildOverlayFilter,
  clampGraphics,
  emphasisAfterGraphicFailure,
  fallbackGraphics,
  motionCacheKey,
  sha256Hex,
  motionRenderArgs,
  motionTelemetryEnv,
  MOTION_TEMPLATES,
  overlayWithinFrame,
  truncateMotionText,
} from "../src/index.js";

const motionRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "server", "assets", "motion");

describe("motion graphics", () => {
  it("keeps templates local and aligned with meta.json", () => {
    for (const spec of MOTION_TEMPLATES) {
      const html = readFileSync(join(motionRoot, spec.id, "index.html"), "utf8");
      const meta = JSON.parse(readFileSync(join(motionRoot, spec.id, "meta.json"), "utf8")) as { variables: { name: string }[]; id: string };
      expect(html).not.toMatch(/https?:\/\/|\/\/cdn|@import url\(/);
      expect(html).toContain("gsap.timeline({ paused: true })");
      expect(html).toContain("window.__timelines = { main: tl }");
      expect(html).not.toContain("Math.random");
      expect(html).not.toContain("Date.now");
      expect(meta.id).toBe(spec.id);
      expect(meta.variables.map((item) => item.name)).toEqual(spec.variables.map((item) => item.name));
    }
    expect(readdirSync(motionRoot).filter((name) => name !== "build-templates.mjs")).toHaveLength(MOTION_TEMPLATES.length);
  });

  it("builds telemetry env and Windows webm args", () => {
    expect(motionTelemetryEnv({})).toMatchObject({
      HYPERFRAMES_NO_TELEMETRY: "1",
      DO_NOT_TRACK: "1",
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
    });
    const rendered = motionRenderArgs({
      workDir: "C:/work", outputPath: "C:/out.webm", variablesFile: "C:/work/variables.json", fps: 30, workers: 2, platform: "win32",
    });
    expect(rendered.format).toBe("webm");
    expect(rendered.args).toContain("--variables-file");
    expect(rendered.args).toContain("--workers");
  });

  it("changes the cache key when any input changes and truncates NFC text", () => {
    const base = { templateId: "title_card", version: 1, variables: { title: "A" }, width: 1080, height: 1920, fps: 30, durationSec: 3, hyperframesVersion: "0.9.14" };
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(motionCacheKey(base)).toHaveLength(64);
    expect(motionCacheKey(base)).not.toBe(motionCacheKey({ ...base, durationSec: 4 }));
    expect(truncateMotionText("a\u0301".repeat(3), 2)).toBe("áá");
  });

  it("picks a hook title, a number, a list item, a progress bar and an end card", () => {
    const graphics = fallbackGraphics({
      title: "Hố đen",
      aspect: "9:16",
      totalDurationSec: 40,
      preset: "energetic",
      channelName: "Vũ Trụ",
      scenes: [
        { sceneId: "a", startSec: 0, durationSec: 8, label: "Mở", hook: true, placeholder: true },
        { sceneId: "b", startSec: 16, durationSec: 8, label: "Nặng 3 tỷ", narration: "khoảng 3 tỷ mặt trời" },
        { sceneId: "c", startSec: 32, durationSec: 8, label: "Thứ nhất là chân trời", placeholder: true },
      ],
    });
    expect(graphics.some((item) => item.templateId === "title_card" && item.variables.title === "Hố đen")).toBe(true);
    expect(graphics.some((item) => item.templateId === "number_counter")).toBe(true);
    expect(graphics.some((item) => item.templateId === "list_item")).toBe(true);
    expect(graphics.some((item) => item.templateId === "progress_bar")).toBe(true);
    expect(graphics.some((item) => item.templateId === "end_card")).toBe(true);
  });

  it("drops an unknown template and a colliding overlay", () => {
    const result = clampGraphics({
      totalDurationSec: 20,
      scenes: [{ sceneId: "a", startSec: 0, durationSec: 10, label: "A" }],
      graphics: [
        { id: "1", templateId: "title_card", sceneId: "a", startSec: 0, durationSec: 3, variables: { title: "Rất dài ".repeat(20), subtitle: "", color: "#fff" }, layer: "overlay", source: "user" },
        { id: "2", templateId: "quote_card", sceneId: "a", startSec: 1, durationSec: 3, variables: { quote: "xin chào", author: "", color: "#fff" }, layer: "overlay", source: "user" },
        { id: "3", templateId: "nope" as "title_card", sceneId: "a", startSec: 0, durationSec: 3, variables: {}, layer: "overlay", source: "user" },
      ],
    });
    expect(result.graphics).toHaveLength(1);
    expect(String(result.graphics[0].variables.title).length).toBeLessThanOrEqual(48);
    expect(result.dropped).toContain("nope");
  });

  it("groups overlays past 12 and stays within one frame", () => {
    const clips = Array.from({ length: 13 }, (_, index) => ({ id: String(index), startSec: index, endSec: index + 0.5, inputIndex: index + 1 }));
    const filter = buildOverlayFilter(clips, "[0:v]");
    expect(filter.groups).toBe(2);
    expect(filter.filter).toContain("enable='between(t,0,0.5)'");
    expect(overlayWithinFrame(clips[0].startSec, 0, 30)).toBe(true);
    expect(emphasisAfterGraphicFailure(["punch_in", "callout"], false)).not.toContain("callout");
    expect(emphasisAfterGraphicFailure(["punch_in"], true)).toContain("callout");
  });
});
