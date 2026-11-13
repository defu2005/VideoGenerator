import { describe, expect, it } from "vitest";
import { TimelineSchema } from "../src/schemas/timeline.js";
import { buildTimeline, renderTargetFor, VOICE_LEAD_SEC, type TimelineSceneInput } from "../src/timeline/build.js";

function scene(order: number, overrides: Partial<TimelineSceneInput> = {}): TimelineSceneInput {
  return {
    id: `s${order}`,
    order,
    label: `Scene ${order}`,
    noVisual: false,
    durationOverrideSec: null,
    estDurationSec: 5,
    voice: { trackId: `v${order}`, path: `/abs/voice${order}.mp3`, durationSec: 4 },
    visuals: [{ candidateId: `c${order}`, path: `visuals/${order}.jpg`, ready: true, licenseKind: "CC0", motion: null }],
    ...overrides,
  };
}

const music = {
  candidateId: "m1",
  title: "Calm",
  path: "music/a.mp3",
  sourceDurationSec: 10,
  startOffsetSec: 0,
  volume: 0.25,
  fadeInSec: 2,
  fadeOutSec: 3,
  duckingDb: -12,
  licenseKind: "CC_BY" as const,
};

describe("timeline builder", () => {
  it("picks the render size from the aspect ratio", () => {
    expect(renderTargetFor("16:9")).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(renderTargetFor("9:16")).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(renderTargetFor("1:1")).toEqual({ width: 1080, height: 1080, fps: 30 });
  });

  it("lays scenes on one frame-aligned clock, silent scenes included", () => {
    const result = buildTimeline({
      aspectRatio: "16:9",
      musicEnabled: false,
      music: null,
      scenes: [scene(1), scene(0), scene(2, { voice: null, estDurationSec: 3 })],
    });
    expect(result.scenes.map((item) => item.sceneId)).toEqual(["s0", "s1", "s2"]);
    // 0.1 lead + 4 voice + 0.3 tail = 4.4 s = 132 frames.
    expect(result.scenes[0].durationFrames).toBe(132);
    expect(result.scenes[1].startSec).toBe(4.4);
    expect(result.scenes[2]).toMatchObject({ startSec: 8.8, durationSec: 3, voice: null });
    expect(result.totalDurationSec).toBe(11.8);
    const frames = result.scenes.reduce((sum, item) => sum + item.durationFrames, 0);
    expect(frames / 30).toBeCloseTo(result.totalDurationSec, 3);
    expect(result.voiceOffsets).toEqual({ s0: VOICE_LEAD_SEC, s1: 4.5 });
    const { voiceOffsets: _offsets, ...timeline } = result;
    expect(TimelineSchema.parse({ ...timeline, subtitles: null })).toBeTruthy();
  });

  it("keeps fades inside scenes and longer at the video edges", () => {
    const result = buildTimeline({ aspectRatio: "16:9", musicEnabled: false, music: null, scenes: [scene(0), scene(1), scene(2)] });
    expect(result.scenes.map((item) => [item.fadeInSec, item.fadeOutSec])).toEqual([[0.5, 0], [0, 0], [0, 0.8]]);
  });

  it("never lets a manual duration cut the voice", () => {
    const result = buildTimeline({
      aspectRatio: "16:9",
      musicEnabled: false,
      music: null,
      scenes: [scene(0, { durationOverrideSec: 2 }), scene(1, { durationOverrideSec: 8 })],
    });
    expect(result.scenes[0].durationSec).toBe(4.4);
    expect(result.scenes[1].durationSec).toBe(8);
    expect(result.warnings.map((item) => item.code)).toEqual(["DURATION_OVERRIDE_TOO_SHORT"]);
  });

  it("splits several visuals evenly and alternates Ken Burns", () => {
    const result = buildTimeline({
      aspectRatio: "16:9",
      musicEnabled: false,
      music: null,
      scenes: [scene(0, {
        durationOverrideSec: 6,
        voice: null,
        visuals: [
          { candidateId: "a", path: "visuals/a.jpg", ready: true, licenseKind: "CC0", motion: null },
          { candidateId: "b", path: "visuals/b.jpg", ready: true, licenseKind: null, motion: null },
        ],
      })],
    });
    const [a, b] = result.scenes[0].visuals;
    expect([a.startSec, a.endSec, b.startSec, b.endSec]).toEqual([0, 3, 3, 6]);
    expect(a.motion.to.zoom).toBeGreaterThan(a.motion.from.zoom);
    expect(b.motion.to.zoom).toBeLessThan(b.motion.from.zoom);
    expect(result.licenseSummary).toEqual({ CC0: 1, UNKNOWN: 1 });
    expect(result.warnings.map((item) => item.code)).toEqual(["LICENSE_UNKNOWN"]);
  });

  it("keeps a copyrighted still on screen for at most four seconds", () => {
    const result = buildTimeline({
      aspectRatio: "16:9",
      musicEnabled: false,
      music: null,
      scenes: [scene(0, {
        durationOverrideSec: 12,
        voice: null,
        visuals: [{ candidateId: "still", path: "visuals/still.jpg", ready: true, licenseKind: "UNKNOWN", motion: null, commentary: true }],
      })],
    });
    const visual = result.scenes[0].visuals[0];
    expect(visual.endSec - visual.startSec).toBeLessThanOrEqual(4);
  });

  it("uses a placeholder for missing or unapproved visuals, silently for no-visual scenes", () => {
    const result = buildTimeline({
      aspectRatio: "16:9",
      musicEnabled: false,
      music: null,
      scenes: [
        scene(0, { visuals: [] }),
        scene(1, { visuals: [{ candidateId: "x", path: "visuals/x.jpg", ready: false, licenseKind: "CC0", motion: null }] }),
        scene(2, { visuals: [], noVisual: true }),
      ],
    });
    expect(result.scenes.every((item) => item.visuals[0].kind === "PLACEHOLDER")).toBe(true);
    expect(result.warnings.map((item) => [item.code, item.sceneId])).toEqual([
      ["VISUAL_MISSING", "s0"],
      ["VISUAL_NOT_APPROVED", "s1"],
    ]);
  });

  it("loops short music, flags NC licenses and warns when music is not ready", () => {
    const looped = buildTimeline({ aspectRatio: "9:16", musicEnabled: true, music, scenes: [scene(0), scene(1, { licenseKind: undefined } as never), scene(2)] });
    expect(looped.target.height).toBe(1920);
    expect(looped.music).toMatchObject({ loop: true, fadeInSec: 2, fadeOutSec: 3 });
    expect(looped.licenseSummary).toEqual({ CC0: 3, CC_BY: 1 });

    const nc = buildTimeline({ aspectRatio: "16:9", musicEnabled: true, music: { ...music, sourceDurationSec: 600, licenseKind: "CC_BY_NC" }, scenes: [scene(0)] });
    expect(nc.music?.loop).toBe(false);
    expect(nc.warnings.map((item) => item.code)).toEqual(["LICENSE_NON_COMMERCIAL"]);

    const missing = buildTimeline({ aspectRatio: "16:9", musicEnabled: true, music: null, scenes: [scene(0)] });
    expect(missing.music).toBeNull();
    expect(missing.warnings.map((item) => item.code)).toEqual(["MUSIC_NOT_READY"]);

    const off = buildTimeline({ aspectRatio: "16:9", musicEnabled: false, music, scenes: [scene(0)] });
    expect(off.music).toBeNull();
    expect(off.warnings).toEqual([]);
  });

  it("uses the recipe edit preset for the first transition", () => {
    const story = buildTimeline({ aspectRatio: "16:9", musicEnabled: false, music: null, scenes: [scene(0), scene(1)] });
    const calm = buildTimeline({ aspectRatio: "16:9", musicEnabled: false, music: null, scenes: [scene(0), scene(1)], editPreset: "calm" });
    expect(story.scenes[0]?.transitionOut?.type).toBe("zoomin");
    expect(calm.scenes[0]?.transitionOut?.type).toBe("fade");
  });
});
