// TASK-146 slice 5 commit C: group consecutive scenes by emotion into music segments of at least 20 s.
// Design default, not a sourced rule. Pure function; no production caller yet.

export const MUSIC_SEGMENT_MIN_SEC = 20;

export type MusicSegmentScene = { startSec: number; endSec: number; emotion?: string | null };
export type MusicSegment = { startSec: number; endSec: number; emotion: string | null };

type Run = { startSec: number; endSec: number; emotion: string | null };

/**
 * The emotion with the most seconds in the group; a tie goes to the one that appears first. A real emotion beats
 * a missing one: hook and outro scenes carry none, so `null` wins only when no scene in the group has an emotion.
 */
function dominantEmotion(group: Run[]): string | null {
  const seconds = new Map<string | null, number>();
  for (const run of group) seconds.set(run.emotion, (seconds.get(run.emotion) ?? 0) + (run.endSec - run.startSec));
  const hasReal = [...seconds.keys()].some((emotion) => emotion !== null);
  let best: string | null = null;
  let bestSec = -1;
  for (const [emotion, sec] of seconds) {
    if (emotion === null && hasReal) continue;
    if (sec > bestSec) {
      best = emotion;
      bestSec = sec;
    }
  }
  return best;
}

/**
 * Consecutive scenes with the same emotion form runs. Runs are added to a segment until it reaches `minSec`.
 * A trailing short segment joins the previous one. Each segment takes its dominant emotion, and adjacent
 * segments with the same emotion merge.
 */
export function musicSegments(scenes: MusicSegmentScene[], minSec = MUSIC_SEGMENT_MIN_SEC): MusicSegment[] {
  const runs: Run[] = [];
  for (const scene of [...scenes].sort((a, b) => a.startSec - b.startSec)) {
    const emotion = scene.emotion ?? null;
    const last = runs[runs.length - 1];
    if (last && last.emotion === emotion) last.endSec = scene.endSec;
    else runs.push({ startSec: scene.startSec, endSec: scene.endSec, emotion });
  }

  const groups: Run[][] = [];
  let current: Run[] = [];
  let length = 0;
  for (const run of runs) {
    current.push(run);
    length += run.endSec - run.startSec;
    if (length >= minSec) {
      groups.push(current);
      current = [];
      length = 0;
    }
  }
  if (current.length) {
    const previous = groups[groups.length - 1];
    if (previous) previous.push(...current);
    else groups.push(current);
  }

  const segments: MusicSegment[] = [];
  for (const group of groups) {
    const segment: MusicSegment = {
      startSec: group[0]!.startSec,
      endSec: group[group.length - 1]!.endSec,
      emotion: dominantEmotion(group),
    };
    const previous = segments[segments.length - 1];
    if (previous && previous.emotion === segment.emotion) previous.endSec = segment.endSec;
    else segments.push(segment);
  }
  return segments;
}
