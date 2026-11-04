import { describe, expect, it } from "vitest";
import { musicQueryFor, rankMusicTracks, scoreMusicTrack, type RawMusicTrack } from "../src/music/rank.js";

const input = { mood: "calm hopeful piano", energy: "low", keywords: ["ambient"], videoDurationSec: 120 };

function track(overrides: Partial<RawMusicTrack> & { title: string }): RawMusicTrack {
  return { artist: null, durationSec: 180, genres: [], tags: [], licenseKind: "CC_BY", ...overrides };
}

describe("music ranking", () => {
  it("prefers instrumental tracks that match the mood and cover the video", () => {
    const ranked = rankMusicTracks([
      track({ title: "Pop song", tags: ["vocals", "pop", "upbeat"] }),
      track({ title: "Quiet morning", tags: ["calm", "piano", "ambient", "instrumental"] }),
      track({ title: "Calm loop", tags: ["calm", "piano"], durationSec: 40 }),
    ], input);
    expect(ranked.map((item) => item.title)).toEqual(["Quiet morning", "Calm loop", "Pop song"]);
    expect(ranked[2].breakdown.instrumental).toBeLessThan(0);
  });

  it("drops tracks shorter than 20 seconds and keeps unknown durations", () => {
    const ranked = rankMusicTracks([
      track({ title: "Jingle", durationSec: 12, tags: ["calm"] }),
      track({ title: "Unknown", durationSec: null, tags: ["calm"] }),
    ], input);
    expect(ranked.map((item) => item.title)).toEqual(["Unknown"]);
  });

  it("gives a small bonus for commercial-friendly licenses without blocking others", () => {
    const open = scoreMusicTrack(track({ title: "A", tags: ["calm"], licenseKind: "CC0" }), input);
    const nc = scoreMusicTrack(track({ title: "B", tags: ["calm"], licenseKind: "CC_BY_NC_ND" }), input);
    expect(open.score).toBeGreaterThan(nc.score);
    expect(nc.usable).toBe(true);
  });

  it("builds a short query from the script mood, keywords and scene moods", () => {
    expect(musicQueryFor({ mood: "Calm, hopeful", keywords: [] }, ["tense", "tense", "warm"])).toBe("calm hopeful tense");
    expect(musicQueryFor({ mood: "", keywords: [] })).toBe("calm ambient");
  });
});
