import { describe, expect, it } from "vitest";
import {
  buildCreditsText,
  buildFinalPlan,
  buildSceneClipPlan,
  concatListText,
  duckVolumeExpr,
  parseBlackdetect,
  parseProgressSeconds,
  splitFrames,
  voiceIntervals,
  zoompanExprs,
  type TimelineScene,
} from "../src/index.js";

const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.5 } };

function scene(overrides: Partial<TimelineScene> = {}): TimelineScene {
  return {
    sceneId: "s1",
    order: 0,
    label: "Mở đầu",
    startSec: 0,
    endSec: 3,
    durationSec: 3,
    durationFrames: 90,
    voice: { trackId: "t1", path: "voice/s1.mp3", startSec: 0.1, durationSec: 2.5 },
    visuals: [{ kind: "IMAGE", candidateId: "c1", path: "visuals/a.jpg", startSec: 0, endSec: 3, motion, licenseKind: "CC0" }],
    fadeInSec: 0.5,
    fadeOutSec: 0.25,
    ...overrides,
  };
}

describe("splitFrames", () => {
  it("gives a single visual every frame", () => {
    expect(splitFrames(scene(), 30)).toEqual([90]);
  });

  it("splits by visual times and lets the last one take the remainder", () => {
    const visuals = [
      { ...scene().visuals[0], startSec: 0, endSec: 1.01 },
      { ...scene().visuals[0], startSec: 1.01, endSec: 2 },
      { ...scene().visuals[0], startSec: 2, endSec: 3 },
    ];
    const frames = splitFrames(scene({ visuals, durationFrames: 91 }), 30);
    expect(frames).toEqual([30, 30, 31]);
    expect(frames.reduce((a, b) => a + b, 0)).toBe(91);
  });

  it("keeps at least one frame per visual", () => {
    const visuals = [
      { ...scene().visuals[0], startSec: 0, endSec: 0 },
      { ...scene().visuals[0], startSec: 0, endSec: 10 },
    ];
    const frames = splitFrames(scene({ visuals, durationFrames: 3 }), 30);
    expect(frames).toEqual([1, 2]);
  });
});

describe("zoompanExprs", () => {
  it("eases zoom with smoothstep and keeps a static centre", () => {
    const { z, x, y } = zoompanExprs(motion, 90);
    expect(z).toContain("(1+(0.12)*");
    expect(z).toContain("min(on/89,1)");
    expect(x).toBe("max(0,min(iw-iw/zoom,0.5*iw-iw/zoom/2))");
    expect(y).toBe("max(0,min(ih-ih/zoom,0.5*ih-ih/zoom/2))");
  });

  it("clamps bad values and handles one-frame clips", () => {
    const { z } = zoompanExprs({ type: "zoom", from: { zoom: 0.2 }, to: { zoom: 9 } }, 1);
    expect(z).toBe("(1+(3)*(0)*(0)*(3-2*(0)))");
  });
});

describe("buildSceneClipPlan", () => {
  it("builds an image chain with zoompan, trim and in-clip fades", () => {
    const plan = buildSceneClipPlan(scene(), { width: 160, height: 90, fps: 30 }, (path) => `/p/${path}`);
    expect(plan.inputArgs).toEqual(["-i", "/p/visuals/a.jpg"]);
    expect(plan.frames).toBe(90);
    expect(plan.filter).toContain("scale=320:180:force_original_aspect_ratio=increase");
    expect(plan.filter).toContain("zoompan=z='");
    expect(plan.filter).toContain(":d=90:s=160x90:fps=30");
    expect(plan.filter).toContain("fade=t=in:st=0:d=0.5");
    expect(plan.filter).toContain("fade=t=out:st=2.75:d=0.25");
    expect(plan.filter.trim().endsWith("[out]")).toBe(true);
  });

  it("uses a grey colour source for placeholders and concatenates several visuals", () => {
    const visuals = [
      { kind: "PLACEHOLDER" as const, candidateId: null, path: null, startSec: 0, endSec: 1.5, motion, licenseKind: null },
      { ...scene().visuals[0], startSec: 1.5, endSec: 3 },
    ];
    const plan = buildSceneClipPlan(scene({ visuals, fadeInSec: 0, fadeOutSec: 0 }), { width: 160, height: 90, fps: 30 }, (p) => p);
    expect(plan.inputArgs.slice(0, 4)).toEqual(["-f", "lavfi", "-i", "color=c=0x374151:s=160x90:r=30"]);
    expect(plan.filter).toContain("[0:v]trim=end_frame=45");
    expect(plan.filter).toContain("[v0][v1]concat=n=2:v=1:a=0[cat]");
    expect(plan.filter).not.toContain("fade=");
  });

  it("scales a file that was already cropped and leaves other files on the cover crop", () => {
    const path = scene().visuals[0]?.path ?? "";
    const cropped = buildSceneClipPlan(scene(), { width: 160, height: 90, fps: 30 }, (item) => `/p/${item}`, {
      croppedPaths: new Set([path]),
    });
    expect(cropped.filter).toContain("scale=160:90:flags=lanczos");
    expect(cropped.filter).not.toContain("force_original_aspect_ratio=increase");
    const plain = buildSceneClipPlan(scene(), { width: 160, height: 90, fps: 30 }, (item) => `/p/${item}`);
    expect(plain.filter).toContain("force_original_aspect_ratio=increase");
  });
});

describe("ducking", () => {
  it("merges voice intervals closer than the gap", () => {
    const scenes = [
      scene({ voice: { trackId: "a", path: "a", startSec: 0.1, durationSec: 2 } }),
      scene({ sceneId: "s2", voice: { trackId: "b", path: "b", startSec: 2.5, durationSec: 1 } }),
      scene({ sceneId: "s3", voice: { trackId: "c", path: "c", startSec: 5, durationSec: 1 } }),
      scene({ sceneId: "s4", voice: null }),
    ];
    expect(voiceIntervals(scenes)).toEqual([[0.1, 3.5], [5, 6]]);
  });

  it("builds a gain expression with ramps, or null when there is nothing to duck", () => {
    const expr = duckVolumeExpr([[1, 3]], -12)!;
    expect(expr).toBe("1-0.7488*(clip((t-0.75)/0.25,0,1)*clip((3.25-t)/0.25,0,1))");
    expect(duckVolumeExpr([], -12)).toBeNull();
    expect(duckVolumeExpr([[1, 2]], 0)).toBeNull();
  });
});

describe("buildFinalPlan", () => {
  const scenes = [
    scene(),
    scene({ sceneId: "s2", order: 1, startSec: 3, endSec: 5, voice: null }),
    scene({ sceneId: "s3", order: 2, startSec: 5, endSec: 8, voice: { trackId: "t3", path: "voice/s3.mp3", startSec: 5.1, durationSec: 2 } }),
  ];
  const music = {
    candidateId: "m",
    title: "Calm",
    path: "music/a.mp3",
    sourceDurationSec: 4,
    loop: true,
    startOffsetSec: 1,
    volume: 0.2,
    fadeInSec: 2,
    fadeOutSec: 3,
    duckingDb: -12,
    licenseKind: null,
  };

  it("delays each voice, ducks looped music and masters with loudnorm", () => {
    const plan = buildFinalPlan({
      totalDurationSec: 8,
      scenes,
      music,
      concatListPath: "/r/clips.txt",
      resolvePath: (path) => `/p/${path}`,
      assFileName: "subtitles.ass",
    });
    expect(plan.inputArgs).toEqual([
      "-f", "concat", "-safe", "0", "-i", "/r/clips.txt",
      "-i", "/p/voice/s1.mp3",
      "-i", "/p/voice/s3.mp3",
      "-stream_loop", "-1", "-i", "/p/music/a.mp3",
    ]);
    expect(plan.videoMap).toBe("[vout]");
    expect(plan.reencodeVideo).toBe(true);
    expect(plan.filter).toContain("[0:v]ass='subtitles.ass'[vout]");
    expect(plan.filter).toContain("adelay=delays=100:all=1[a1]");
    expect(plan.filter).toContain("adelay=delays=5100:all=1[a2]");
    expect(plan.filter).toContain("[a1][a2]amix=inputs=2:normalize=0");
    expect(plan.filter).toContain("apad=whole_dur=8,atrim=0:8");
    expect(plan.filter).toContain("[3:a]atrim=start=1,");
    expect(plan.filter).toContain("volume=0.2,volume='1-0.7488*(");
    expect(plan.filter).toContain("afade=t=out:st=5:d=3");
    expect(plan.filter).toContain("loudnorm=I=-14:TP=-1.5:LRA=11");
    expect(plan.filter.trim().endsWith("[aout]")).toBe(true);
  });

  it("copies video and uses silence when there is no voice, music or subtitles", () => {
    const plan = buildFinalPlan({
      totalDurationSec: 2,
      scenes: [scene({ voice: null })],
      music: null,
      concatListPath: "c.txt",
      resolvePath: (path) => path,
      assFileName: null,
    });
    expect(plan.videoMap).toBe("0:v");
    expect(plan.reencodeVideo).toBe(false);
    expect(plan.filter).toContain("anullsrc=r=48000:cl=stereo,atrim=0:2[voice]");
    expect(plan.filter).not.toContain("amix");
  });

  it("joins non-cut transitions with xfade and overlays graphics before subtitles", () => {
    const plan = buildFinalPlan({
      totalDurationSec: 8,
      scenes,
      music: null,
      concatListPath: "/r/clips.txt",
      resolvePath: (path) => path,
      assFileName: "subtitles.ass",
      xfadeAvailable: true,
      sceneClips: [
        { path: "/c/a.mp4", sceneId: "s1", startSec: 0, durationSec: 4, transitionOut: { type: "fade", durationSec: 0.4 } },
        { path: "/c/b.mp4", sceneId: "s2", startSec: 4, durationSec: 4, transitionOut: null },
      ],
      graphics: [{ path: "/g/title.webm", startSec: 0.5, endSec: 3 }],
    });
    expect(plan.inputArgs.slice(0, 4)).toEqual(["-i", "/c/a.mp4", "-i", "/c/b.mp4"]);
    expect(plan.inputArgs).toContain("/g/title.webm");
    expect(plan.filter).toContain("xfade=transition=fade:duration=0.4:offset=4");
    expect(plan.filter.indexOf("overlay=")).toBeLessThan(plan.filter.indexOf("ass="));
    expect(plan.reencodeVideo).toBe(true);
    expect(plan.warning).toBeNull();
  });
});

describe("helpers", () => {
  it("writes concat lines with forward slashes and escaped quotes", () => {
    expect(concatListText(["C:\\a\\b.mp4", "/x/it's.mp4"])).toBe("file 'C:/a/b.mp4'\nfile '/x/it'\\''s.mp4'\n");
  });

  it("reads progress and blackdetect output", () => {
    expect(parseProgressSeconds("frame=1\nout_time_us=1500000\nout_time_us=2500000\n")).toBe(2.5);
    expect(parseProgressSeconds("frame=1")).toBeNull();
    expect(parseBlackdetect("[blackdetect @ 0x1] black_start:1.2 black_end:3.5 black_duration:2.3")).toEqual([{ startSec: 1.2, endSec: 3.5 }]);
  });

  it("lists every asset, with 'chưa rõ' for an unknown license", () => {
    const text = buildCreditsText({
      videoTitle: "Video A",
      scenes: [
        { order: 1, label: "Hai", visuals: [{ title: "Núi", author: "An", licenseName: null, licenseUrl: null, sourceUrl: "https://x/1", attributionText: null }] },
        { order: 0, label: "Một", visuals: [{ title: "Biển", author: null, licenseName: "CC BY 4.0", licenseUrl: "https://cc/by", sourceUrl: null, attributionText: "Ảnh: B" }] },
      ],
      music: { title: "Calm", artist: "C", author: null, licenseName: "CC0", licenseUrl: null, sourceUrl: null, attributionText: null },
      licenseSummary: { CC0: 1, CC_BY: 1, UNKNOWN: 1 },
    });
    expect(text.indexOf("Cảnh 1 · Một")).toBeLessThan(text.indexOf("Cảnh 2 · Hai"));
    expect(text).toContain("Giấy phép: chưa rõ");
    expect(text).toContain("Giấy phép: CC BY 4.0 (https://cc/by)");
    expect(text).toContain("Ghi công: Ảnh: B");
    expect(text).toContain("Tác giả: C");
    expect(text).toContain("- UNKNOWN: 1");
  });
});
