import { describe, expect, it } from "vitest";
import { detectBeats, musicToSceneBeats } from "./beats.js";

function clicks(bpm: number, seconds = 20, rate = 11025): Float32Array {
  const pcm = new Float32Array(Math.round(rate * seconds));
  const period = (rate * 60) / bpm;
  const burst = Math.round(rate * 0.005);
  for (let start = 0; start + burst < pcm.length; start += period) {
    const at = Math.round(start);
    for (let index = 0; index < burst; index += 1) {
      pcm[at + index] = index % 2 === 0 ? 1 : -1;
    }
  }
  return pcm;
}

describe("detectBeats", () => {
  it.each([90, 120, 150])("finds %i BPM clicks within 2 BPM and 50ms", (bpm) => {
    const grid = detectBeats(clicks(bpm), 11025);
    expect(grid).not.toBeNull();
    expect(Math.abs(grid!.bpm - bpm)).toBeLessThanOrEqual(2);
    const period = 60 / bpm;
    const error = grid!.beatsSec
      .slice(0, 8)
      .map((beat) => Math.abs(beat - Math.round(beat / period) * period))
      .reduce((max, value) => Math.max(max, value), 0);
    expect(error).toBeLessThan(0.05);
  });

  it("returns null for white noise", () => {
    const pcm = new Float32Array(11025 * 8);
    let seed = 1;
    for (let index = 0; index < pcm.length; index += 1) {
      seed = (seed * 16807) % 2147483647;
      pcm[index] = seed / 2147483647 - 0.5;
    }
    expect(detectBeats(pcm, 11025)).toBeNull();
  });

  it("wraps a looping track and applies the start offset", () => {
    const grid = { bpm: 120, beatsSec: [0, 0.5], confidence: 1 };
    const hits = musicToSceneBeats(
      grid,
      { startOffsetSec: 0.25, loop: true, sourceDurationSec: 1 },
      10,
      2,
    );
    expect(hits[0]).toBeCloseTo(0.25);
    expect(hits).toContain(1.25);
  });
});
