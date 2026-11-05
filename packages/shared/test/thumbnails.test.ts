import { describe, expect, it } from "vitest";
import {
  buildThumbnailVideoFilter,
  candidateFrameTimes,
  escapeDrawtextPath,
  fallbackThumbnailChoice,
  jpegQscaleUntilFit,
  parseFrameProbe,
  rankByScore,
  scoreFrame,
  thumbnailUploadError,
  YOUTUBE_THUMB_MAX_BYTES,
} from "../src/index.js";

describe("thumbnail candidate times", () => {
  it("skips the opening fade and adds the hook at 1.0 s", () => {
    const times = candidateFrameTimes([
      { sceneId: "a", order: 0, startSec: 0, endSec: 10, durationSec: 10, fadeInSec: 0.5 },
      { sceneId: "b", order: 1, startSec: 10, endSec: 12, durationSec: 2, fadeInSec: 0.5 },
    ]);
    expect(times).toEqual([
      { sceneId: "a", timeSec: 1, kind: "hook" },
      { sceneId: "a", timeSec: 4, kind: "scene" },
      { sceneId: "b", timeSec: 10.8, kind: "scene" },
    ]);
    const shortFade = candidateFrameTimes([
      { sceneId: "c", order: 0, startSec: 0, endSec: 1, durationSec: 1, fadeInSec: 0.5 },
    ]);
    expect(shortFade.find((item) => item.kind === "scene")?.timeSec).toBeGreaterThanOrEqual(0.5);
    expect(shortFade.every((item) => item.timeSec >= 0.5)).toBe(true);
  });

  it("keeps at most 8 frames", () => {
    const scenes = Array.from({ length: 12 }, (_, order) => ({
      sceneId: `s${order}`,
      order,
      startSec: order * 5,
      endSec: order * 5 + 5,
      durationSec: 5,
      fadeInSec: 0,
    }));
    expect(candidateFrameTimes(scenes)).toHaveLength(8);
  });
});

describe("thumbnail scores", () => {
  it("drops black and flat frames and ranks the sharper frame first", () => {
    const ranked = rankByScore([
      { id: "black", metrics: { meanLuma: 4, sharpness: 1, colorSpread: 0.01 } },
      { id: "flat", metrics: { meanLuma: 140, sharpness: 2, colorSpread: 0.02 } },
      { id: "soft", metrics: { meanLuma: 120, sharpness: 10, colorSpread: 0.5 } },
      { id: "sharp", metrics: { meanLuma: 130, sharpness: 80, colorSpread: 0.6 } },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["sharp", "soft"]);
    expect(scoreFrame({ meanLuma: 4, sharpness: 90, colorSpread: 0.5 })).toBeNull();
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("maps blurdetect values above 1 and ranks the sharper frame first", () => {
    const sharp = parseFrameProbe([
      "[Parsed_metadata_2 @ 000001] lavfi.blur=3.876687",
      "[Parsed_metadata_2 @ 000001] lavfi.signalstats.YAVG=128.5",
      "[Parsed_metadata_2 @ 000001] lavfi.signalstats.YLOW=40",
      "[Parsed_metadata_2 @ 000001] lavfi.signalstats.YHIGH=200",
      "[Parsed_metadata_2 @ 000001] lavfi.signalstats.YDIF=0",
      "[Parsed_metadata_2 @ 000001] lavfi.signalstats.SATAVG=40",
    ].join("\n"));
    const soft = parseFrameProbe([
      "lavfi.signalstats.YAVG=128.5",
      "lavfi.signalstats.YLOW=40",
      "lavfi.signalstats.YHIGH=200",
      "lavfi.signalstats.YDIF=0",
      "lavfi.signalstats.SATAVG=40",
      "lavfi.blur=8.2",
    ].join("\n"));
    expect(sharp?.meanLuma).toBe(128.5);
    expect(sharp?.sharpness).toBeCloseTo(100 / (1 + 3.876687));
    expect(soft?.sharpness).toBeCloseTo(100 / (1 + 8.2));
    expect(sharp!.sharpness).toBeGreaterThan(soft!.sharpness);
    const ranked = rankByScore([
      { id: "soft", metrics: soft! },
      { id: "sharp", metrics: sharp! },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["sharp", "soft"]);
    expect(ranked[0]!.score).toBeGreaterThan(0);
    expect(scoreFrame(parseFrameProbe("lavfi.signalstats.YAVG=3\nlavfi.signalstats.YDIF=0\nlavfi.blur=0.9")!)).toBeNull();
  });

  it("does not score a single frame as 0 when blurdetect is missing", () => {
    const contrast = parseFrameProbe([
      "lavfi.signalstats.YAVG=120.443",
      "lavfi.signalstats.YLOW=41",
      "lavfi.signalstats.YHIGH=209",
      "lavfi.signalstats.YDIF=0",
      "lavfi.signalstats.SATAVG=40",
    ].join("\n"));
    expect(contrast?.sharpness).toBe(168);
    expect(scoreFrame(contrast!)).toBeGreaterThan(0);

    const sharpEdge = parseFrameProbe([
      "lavfi.signalstats.YAVG=120",
      "lavfi.signalstats.YLOW=41",
      "lavfi.signalstats.YHIGH=209",
      "lavfi.signalstats.YDIF=0",
      "lavfi.signalstats.SATAVG=40",
      "lavfi.signalstats.YAVG=4.49703",
    ].join("\n"));
    const softEdge = parseFrameProbe([
      "lavfi.signalstats.YAVG=120",
      "lavfi.signalstats.YLOW=68",
      "lavfi.signalstats.YHIGH=175",
      "lavfi.signalstats.YDIF=0",
      "lavfi.signalstats.SATAVG=40",
      "lavfi.signalstats.YAVG=0.0129167",
    ].join("\n"));
    expect(sharpEdge?.sharpness).toBeCloseTo(4.49703);
    expect(sharpEdge!.sharpness).toBeGreaterThan(softEdge!.sharpness);
    const ranked = rankByScore([
      { id: "soft", metrics: softEdge! },
      { id: "sharp", metrics: sharpEdge! },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["sharp", "soft"]);
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });
});

describe("drawtext text files", () => {
  const samples = ["Don't miss it", "Bí ẩn: 100% thật, đúng không?", "a\\b"];

  it("points drawtext at textfile with expansion=none and keeps the copy out of the filter", () => {
    for (const [sampleIndex, text] of samples.entries()) {
      const built = buildThumbnailVideoFilter({
        text,
        position: "bottom",
        fontFile: "C:\\Windows\\Fonts\\arialbd.ttf",
        width: 1280,
        height: 720,
        brandColor: "#C45C26",
        textFilePath: (index) => `C:\\proj\\render\\thumbnails\\text\\${sampleIndex}-${index}.txt`,
      });
      expect(built.textFiles.length).toBeGreaterThan(0);
      expect(built.filter).toContain("fontfile='C\\:/Windows/Fonts/arialbd.ttf'");
      expect(built.filter).toContain("0xC45C26");
      expect(built.filter).not.toContain(text);
      expect(built.filter).not.toMatch(/(^|:)text=(?!file)/);
      const textfileRefs = built.filter.match(/textfile='/g) ?? [];
      expect(textfileRefs).toHaveLength(built.textFiles.length);
      for (const file of built.textFiles) {
        expect(built.filter).toContain(`textfile='${escapeDrawtextPath(file.path)}':expansion=none`);
        expect(file.path.endsWith(".txt")).toBe(true);
      }
      expect(built.textFiles.map((file) => file.text).join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    }
  });

  it("scales and crops only when there is no overlay text", () => {
    const built = buildThumbnailVideoFilter({
      text: "   ",
      position: "bottom",
      fontFile: "C:\\Windows\\Fonts\\arialbd.ttf",
      width: 1280,
      height: 720,
      brandColor: "#3B82F6",
      textFilePath: () => {
        throw new Error("text file");
      },
    });
    expect(built.textFiles).toEqual([]);
    expect(built.filter).not.toContain("drawtext");
    expect(built.filter).toContain("scale=1280:720");
  });
});

describe("jpeg quality loop", () => {
  it("lowers quality until the YouTube jpg is at most 2 MB", () => {
    const fitted = jpegQscaleUntilFit((qscale) => (qscale < 6 ? 3_000_000 : 1_500_000));
    expect(fitted.bytes).toBeLessThanOrEqual(YOUTUBE_THUMB_MAX_BYTES);
    expect(fitted.qscale).toBeGreaterThanOrEqual(6);
  });
});

describe("thumbnail fallback and upload checks", () => {
  it("uses the first overlay idea and the bottom position", () => {
    expect(fallbackThumbnailChoice({ thumbnailText: ["Bí ẩn", "Khác"], title: "Tiêu đề" })).toEqual({
      text: "Bí ẩn",
      position: "bottom",
      source: "auto",
    });
  });

  it("rejects the wrong type and files over 5 MB", () => {
    expect(thumbnailUploadError({ type: "image/gif", size: 100 })).toMatch(/PNG hoặc JPG/);
    expect(thumbnailUploadError({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    expect(thumbnailUploadError({ type: "image/jpeg", size: 1024 })).toBeNull();
  });
});
