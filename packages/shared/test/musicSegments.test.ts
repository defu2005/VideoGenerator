import { describe, expect, it } from "vitest";
import { musicSegments } from "../src/music/segments.js";

// TASK-146 slice 5 commit C red tests: consecutive scenes group by emotion into segments of at least 20 s.
// A short trailing segment joins the previous one; a segment takes the emotion with the most seconds (ties go to
// the earlier emotion); adjacent segments with the same emotion merge. Pure function, no production caller yet.

// The key is left out when no emotion is given, so the object matches the optional property type exactly.
const scene = (startSec: number, endSec: number, emotion?: string | null) => ({
  startSec,
  endSec,
  ...(emotion === undefined ? {} : { emotion }),
});

describe("TASK-146 slice 5 commit C: music segments", () => {
  it("returns no segments for no scenes", () => {
    expect(musicSegments([])).toEqual([]);
  });

  it("keeps one segment when every scene shares an emotion, even when it is longer than 20 s", () => {
    expect(musicSegments([scene(0, 10, "calm"), scene(10, 30, "calm")])).toEqual([
      { startSec: 0, endSec: 30, emotion: "calm" },
    ]);
  });

  it("closes a segment once it reaches 20 s", () => {
    const segments = musicSegments([
      scene(0, 10, "A"),
      scene(10, 20, "B"),
      scene(20, 30, "C"),
      scene(30, 40, "D"),
    ]);
    expect(segments).toEqual([
      { startSec: 0, endSec: 20, emotion: "A" },
      { startSec: 20, endSec: 40, emotion: "C" },
    ]);
  });

  it("merges a short emotion into its neighbour, then merges the two same-emotion neighbours", () => {
    const segments = musicSegments([scene(0, 15, "A"), scene(15, 20, "B"), scene(20, 40, "A")]);
    expect(segments).toEqual([{ startSec: 0, endSec: 40, emotion: "A" }]);
  });

  it("joins a short trailing segment into the previous one", () => {
    const segments = musicSegments([scene(0, 20, "A"), scene(20, 25, "B")]);
    expect(segments).toEqual([{ startSec: 0, endSec: 25, emotion: "A" }]);
  });

  it("recomputes the emotion after a trailing join, so the most seconds decide", () => {
    // A 8 s, B 4 s, C 8 s closes at 20 s with a tie between A and C (A is earlier, so A would win).
    // The trailing B 5 s joins it, and B's 9 s then leads.
    const segments = musicSegments([scene(0, 8, "A"), scene(8, 12, "B"), scene(12, 20, "C"), scene(20, 25, "B")]);
    expect(segments).toEqual([{ startSec: 0, endSec: 25, emotion: "B" }]);
  });

  it("takes the emotion with the most seconds in a segment", () => {
    const segments = musicSegments([scene(0, 6, "X"), scene(6, 18, "Y"), scene(18, 20, "X")]);
    expect(segments).toEqual([{ startSec: 0, endSec: 20, emotion: "Y" }]);
  });

  it("breaks a seconds tie in favour of the emotion that comes first", () => {
    expect(musicSegments([scene(0, 10, "Y"), scene(10, 20, "X")])).toEqual([{ startSec: 0, endSec: 20, emotion: "Y" }]);
  });

  it("keeps a lone short segment when there is nothing before it to join", () => {
    expect(musicSegments([scene(0, 5, "A")])).toEqual([{ startSec: 0, endSec: 5, emotion: "A" }]);
  });

  it("treats a missing emotion as one kind, grouped like any other value", () => {
    expect(musicSegments([scene(0, 10), scene(10, 25, null)])).toEqual([{ startSec: 0, endSec: 25, emotion: null }]);
  });

  it("lets a real emotion beat a missing one in the same segment, so hook and outro do not own the music", () => {
    const segments = musicSegments([scene(0, 12), scene(12, 20, "curious"), scene(20, 40, "awe")]);
    expect(segments).toEqual([
      { startSec: 0, endSec: 20, emotion: "curious" },
      { startSec: 20, endSec: 40, emotion: "awe" },
    ]);
  });

  it("gives the same result whatever order the scenes arrive in", () => {
    const ordered = [scene(0, 10, "A"), scene(10, 20, "B"), scene(20, 30, "C"), scene(30, 40, "D")];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[3]!, ordered[1]!];
    expect(musicSegments(shuffled)).toEqual(musicSegments(ordered));
  });
});
