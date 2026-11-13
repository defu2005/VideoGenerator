import type { BeatGrid } from "./schema.js";
import type { TimelineMusic } from "../schemas/timeline.js";

const HOP = 512;
const WINDOW = 1024;
const MIN_BPM = 70;
const MAX_BPM = 180;
const MIN_CONFIDENCE = 0.3;

export function detectBeats(pcm: Float32Array, sampleRate: number): BeatGrid | null {
  if (pcm.length < WINDOW || sampleRate <= 0) return null;
  const frames = Math.floor((pcm.length - WINDOW) / HOP) + 1;
  const energy = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * HOP;
    let sum = 0;
    for (let index = 0; index < WINDOW; index += 1) {
      const sample = pcm[start + index] ?? 0;
      sum += sample * sample;
    }
    energy[frame] = Math.sqrt(sum / WINDOW);
  }
  const onset = new Float32Array(frames);
  let onsetPeak = 0;
  for (let frame = 1; frame < frames; frame += 1) {
    const diff = energy[frame]! - energy[frame - 1]!;
    onset[frame] = diff > 0 ? diff : 0;
    if (onset[frame]! > onsetPeak) onsetPeak = onset[frame]!;
  }
  if (onsetPeak <= 0) return null;
  for (let frame = 0; frame < frames; frame += 1) onset[frame] = onset[frame]! / onsetPeak;

  const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * sampleRate / HOP));
  const maxLag = Math.min(frames - 3, Math.ceil((60 / MIN_BPM) * sampleRate / HOP));
  if (maxLag <= minLag) return null;
  const corr: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) corr[lag] = normalisedCorrelation(onset, lag);
  let peakCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) if (corr[lag]! > peakCorr) peakCorr = corr[lag]!;
  const samples = corr.slice(minLag, maxLag + 1).toSorted((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? 0;
  const confidence = Math.max(0, Math.min(1, peakCorr - median));
  if (confidence < MIN_CONFIDENCE) return null;
  let rough = minLag;
  let roughScore = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (corr[lag]! > roughScore) {
      roughScore = corr[lag]!;
      rough = lag;
    }
  }
  const peaks: number[] = [];
  for (let frame = 1; frame < frames - 1; frame += 1) {
    if (onset[frame]! >= 0.45 && onset[frame]! >= onset[frame - 1]! && onset[frame]! > onset[frame + 1]!) peaks.push(frame);
  }
  const gaps: number[] = [];
  for (let index = 1; index < peaks.length; index += 1) gaps.push(peaks[index]! - peaks[index - 1]!);
  const shortGaps = gaps.filter((gap) => gap >= minLag * 0.6);
  const smallest = shortGaps.length ? Math.min(...shortGaps) : rough;
  const local = shortGaps.filter((gap) => gap <= smallest * 1.45);
  const periodFrames = local.length >= 4
    ? local.reduce((sum, gap) => sum + gap, 0) / local.length
    : rough;
  const bpm = (60 * sampleRate) / (periodFrames * HOP);
  const anchor = peaks[0] ?? rough;
  const periodSec = periodFrames * HOP / sampleRate;
  let first = (anchor * HOP + WINDOW) / sampleRate;
  while (first - periodSec >= -0.02) first -= periodSec;
  if (first < 0) first += periodSec;
  const duration = pcm.length / sampleRate;
  const beatsSec: number[] = [];
  for (let time = first; time <= duration + 1e-3; time += periodSec) {
    if (time >= 0) beatsSec.push(Number(time.toFixed(4)));
  }
  return { bpm, beatsSec, confidence };
}

function normalisedCorrelation(onset: Float32Array, lag: number): number {
  let num = 0;
  let left = 0;
  let right = 0;
  const length = onset.length - lag;
  for (let frame = 0; frame < length; frame += 1) {
    const a = onset[frame]!;
    const b = onset[frame + lag]!;
    num += a * b;
    left += a * a;
    right += b * b;
  }
  const denom = Math.sqrt(left * right);
  return denom > 0 ? num / denom : 0;
}

export function musicToSceneBeats(
  grid: BeatGrid,
  music: Pick<TimelineMusic, "startOffsetSec" | "loop" | "sourceDurationSec">,
  sceneStartSec: number,
  sceneDurationSec: number,
): number[] {
  const source = music.sourceDurationSec && music.sourceDurationSec > 0
    ? music.sourceDurationSec
    : (grid.beatsSec[grid.beatsSec.length - 1] ?? 0);
  const hits: number[] = [];
  const push = (musicTime: number) => {
    const t = musicTime - sceneStartSec + music.startOffsetSec;
    if (t >= 0 && t <= sceneDurationSec) hits.push(Number(t.toFixed(4)));
  };
  if (!music.loop || !(source > 0)) {
    for (const beat of grid.beatsSec) push(beat);
  } else {
    const copies = Math.ceil((sceneStartSec + sceneDurationSec + music.startOffsetSec) / source) + 1;
    for (let copy = 0; copy < copies; copy += 1) {
      for (const beat of grid.beatsSec) push(copy * source + beat);
    }
  }
  return [...new Set(hits)].sort((a, b) => a - b);
}
