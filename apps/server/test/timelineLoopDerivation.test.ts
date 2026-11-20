import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineMusicInput, type TimelineSceneInput } from "@vg/shared";

// Loop derivation contract (packages/shared/src/timeline/build.ts):
// music.loop = sourceDurationSec !== null && (sourceDurationSec - startOffsetSec) < totalDurationSec

function scene(order: number): TimelineSceneInput {
  return {
    id: `s${order}`,
    order,
    label: `Scene ${order}`,
    noVisual: false,
    durationOverrideSec: null,
    estDurationSec: 5,
    voice: { trackId: `v${order}`, path: `/abs/voice${order}.mp3`, durationSec: 4 },
    visuals: [{ candidateId: `c${order}`, path: `visuals/${order}.jpg`, ready: true, licenseKind: "CC0", motion: null }],
  };
}

function music(sourceDurationSec: number | null, startOffsetSec = 0): TimelineMusicInput {
  return {
    candidateId: "m1",
    title: "Calm",
    path: "music/a.mp3",
    sourceDurationSec,
    startOffsetSec,
    volume: 0.25,
    fadeInSec: 2,
    fadeOutSec: 3,
    duckingDb: -12,
    licenseKind: "CC_BY",
  };
}

const scenes = [scene(0), scene(1), scene(2)];

function build(track: TimelineMusicInput | null) {
  return buildTimeline({ aspectRatio: "16:9", musicEnabled: true, music: track, scenes });
}

describe("timeline music loop derivation", () => {
  it("sets loop=true when the music source is shorter than the timeline", () => {
    const result = build(music(5));
    expect(result.totalDurationSec).toBeGreaterThan(5);
    expect(result.music).toMatchObject({ loop: true });
  });

  it("sets loop=false when the music source is longer than the timeline", () => {
    const result = build(music(600));
    expect(result.totalDurationSec).toBeLessThan(600);
    expect(result.music).toMatchObject({ loop: false });
  });

  it("sets loop=false when the source duration is unknown (null)", () => {
    const result = build(music(null));
    expect(result.music).not.toBeNull();
    expect(result.music).toMatchObject({ loop: false });
  });
});
