import { describe, expect, it } from "vitest";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_FULL_SCOPE,
  chooseVoice,
  keepSceneIds,
  sceneDurationsFromVoices,
  sceneNeedsShorten,
  translationNeedsReview,
  trimMetadata,
  voicePaddingSec,
  youtubeLanguageExtras,
} from "@vg/shared";

describe("translation planning", () => {
  it("keeps scene ids and asks to shorten only an over-long scene", () => {
    const original = [{ id: "scene-a" }, { id: "scene-b" }];
    const translated = keepSceneIds(original, [
      { id: "scene-b", narration: "Second" },
      { id: "scene-a", narration: "First" },
    ]);
    expect(translated.map((scene) => scene.id)).toEqual(["scene-a", "scene-b"]);
    expect(sceneNeedsShorten(2, "word ".repeat(80), "en")).toBe(true);
    expect(sceneNeedsShorten(2, "Short line.", "en")).toBe(false);
  });

  it("retiming follows the new voice durations", () => {
    const durations = sceneDurationsFromVoices([
      { id: "a", order: 0, voiceDurationSec: 2 },
      { id: "b", order: 1, voiceDurationSec: 8 },
    ]);
    expect(durations.a).toBeGreaterThanOrEqual(2);
    expect(durations.a).toBeLessThan(2 + voicePaddingSec() + 0.2);
    expect(durations.b).toBeGreaterThan(durations.a!);
  });

  it("keeps the original audio for subtitles only", () => {
    const choice = chooseVoice({
      mode: "subtitles_only",
      original: { path: "parent/voice.wav", durationSec: 4.5 },
      synthesized: { path: "child/voice.wav", durationSec: 9 },
    });
    expect(choice).toEqual({ path: "parent/voice.wav", durationSec: 4.5, reusedOriginal: true });
  });

  it("trims metadata to platform limits", () => {
    const trimmed = trimMetadata({
      titles: ["T".repeat(140), "Second title"],
      description: "D".repeat(4000),
      tags: Array.from({ length: 20 }, (_, index) => `tag${index}`),
      hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"],
      thumbnailText: ["Overlay text that is definitely too long for a thumbnail"],
    });
    expect(trimmed.titles[0]).toHaveLength(100);
    expect(trimmed.description).toHaveLength(1500);
    expect(trimmed.tags).toHaveLength(15);
    expect(trimmed.hashtags).toHaveLength(5);
    expect(trimmed.thumbnailText[0]!.length).toBeLessThanOrEqual(32);
  });

  it("opens one review gate only when automation is off", () => {
    expect(translationNeedsReview(false)).toBe(true);
    expect(translationNeedsReview(true)).toBe(false);
  });

  it("calls YouTube localizations and captions only when the scopes are granted", () => {
    expect(youtubeLanguageExtras([])).toMatchObject({ updateLocalizations: false, insertCaptions: false });
    expect(youtubeLanguageExtras([YOUTUBE_FULL_SCOPE]).updateLocalizations).toBe(true);
    expect(youtubeLanguageExtras([YOUTUBE_FULL_SCOPE]).insertCaptions).toBe(false);
    expect(youtubeLanguageExtras([YOUTUBE_FORCE_SSL_SCOPE]).insertCaptions).toBe(true);
    expect(youtubeLanguageExtras([]).hints.length).toBeGreaterThan(0);
  });
});
