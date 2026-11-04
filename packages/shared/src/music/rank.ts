import type { LicenseKind } from "../enums.js";

/** A track as returned by any music provider, before it is stored. */
export interface RawMusicTrack {
  title: string;
  artist?: string | null;
  durationSec: number | null;
  genres: string[];
  tags: string[];
  licenseKind: LicenseKind;
}

export interface MusicRankInput {
  mood: string;
  energy: string;
  keywords: string[];
  videoDurationSec: number;
  /** Soft penalty terms from music assist (never hard-filters). */
  avoid?: string[];
}

export interface MusicScore {
  score: number;
  breakdown: Record<string, number>;
  /** False when the track is too short to use at all. */
  usable: boolean;
}

export const MIN_MUSIC_DURATION_SEC = 20;

const STOP_WORDS = new Set(["and", "the", "a", "of", "with", "music", "background", "track", "song", "for", "nhạc", "nền", "và"]);
const VOCAL_WORDS = ["vocal", "vocals", "singing", "singer", "lyrics", "rap", "song", "voice", "choir"];
const INSTRUMENTAL_WORDS = ["instrumental", "ambient", "background", "soundtrack", "score", "cinematic", "lofi", "lo-fi", "piano", "orchestral"];
const ENERGY_WORDS: Record<string, string[]> = {
  low: ["calm", "soft", "relaxing", "peaceful", "slow", "gentle", "ambient", "chill", "quiet", "sad", "melancholic"],
  medium: ["warm", "uplifting", "hopeful", "light", "positive", "inspiring", "moderate"],
  high: ["energetic", "epic", "upbeat", "powerful", "fast", "action", "dramatic", "intense", "driving", "rock"],
};
const COMMERCIAL_OK: LicenseKind[] = ["CC0", "PUBLIC_DOMAIN", "CC_BY", "CC_BY_SA", "ROYALTY_FREE"];

export function musicWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function trackWords(track: RawMusicTrack): Set<string> {
  return new Set([...track.tags, ...track.genres, track.title].flatMap(musicWords));
}

export function scoreMusicTrack(track: RawMusicTrack, input: MusicRankInput): MusicScore {
  const words = trackWords(track);
  const wanted = [...new Set([...musicWords(input.mood), ...input.keywords.flatMap(musicWords)])];
  const matched = wanted.filter((word) => words.has(word)).length;
  const mood = wanted.length ? matched / wanted.length : 0;

  const hasVocals = VOCAL_WORDS.some((word) => words.has(word)) && !words.has("instrumental");
  const instrumental = hasVocals ? -0.3 : INSTRUMENTAL_WORDS.some((word) => words.has(word)) ? 0.15 : 0;

  const energyList = ENERGY_WORDS[input.energy] ?? [];
  const energy = energyList.some((word) => words.has(word)) ? 0.1 : 0;

  let duration = 0;
  let usable = true;
  if (track.durationSec !== null) {
    if (track.durationSec < MIN_MUSIC_DURATION_SEC) usable = false;
    else if (track.durationSec >= input.videoDurationSec) duration = 0.15;
    else duration = Math.max(-0.15, 0.1 - 0.25 * (1 - track.durationSec / Math.max(1, input.videoDurationSec)));
  }

  const license = COMMERCIAL_OK.includes(track.licenseKind) ? 0.05 : 0;
  const avoidWords = [...new Set((input.avoid ?? []).flatMap(musicWords))];
  const avoidHits = avoidWords.filter((word) => words.has(word)).length;
  const avoid = avoidWords.length && avoidHits > 0 ? round(-0.08 * Math.min(3, avoidHits)) : 0;

  const breakdown = {
    mood: round(mood * 0.55),
    instrumental,
    energy,
    duration: round(duration),
    license,
    ...(avoid !== 0 ? { avoid } : {}),
  };
  const score = round(Object.values(breakdown).reduce((sum, value) => sum + value, 0));
  return { score, breakdown, usable };
}

export function rankMusicTracks<T extends RawMusicTrack>(tracks: T[], input: MusicRankInput, limit = 12): Array<T & MusicScore> {
  return tracks
    .map((track) => ({ ...track, ...scoreMusicTrack(track, input) }))
    .filter((track) => track.usable)
    .sort((a, b) => b.score - a.score || (b.durationSec ?? 0) - (a.durationSec ?? 0))
    .slice(0, limit);
}

/** Build a short search query from the script's music hints and the scenes' moods. */
export function musicQueryFor(music: { mood: string; keywords: string[] }, sceneMoods: string[] = []): string {
  const counts = new Map<string, number>();
  for (const word of sceneMoods.flatMap(musicWords)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const sceneWords = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word);
  const words = [...new Set([...musicWords(music.mood), ...music.keywords.flatMap(musicWords), ...sceneWords])];
  const picked = words.slice(0, 3);
  return (picked.length ? picked : ["calm", "ambient"]).join(" ");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
