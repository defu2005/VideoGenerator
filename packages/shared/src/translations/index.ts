import { buildTimeline, VOICE_LEAD_SEC, VOICE_TAIL_SEC } from "../timeline/build.js";
import { YOUTUBE_FORCE_SSL_SCOPE, YOUTUBE_FULL_SCOPE } from "../publishing/youtubeHelp.js";
import type { VideoMetadataDraft } from "../schemas/metadata.js";

/** Spoken characters per second. Used only to compare translation length with the original scene. */
const CHARS_PER_SEC: Record<string, number> = {
  vi: 14,
  en: 13,
  ja: 7,
  ko: 8,
  zh: 4,
  th: 12,
  fr: 13,
  es: 14,
  de: 12,
};

export function charsPerSec(language: string): number {
  const key = language.trim().toLowerCase().slice(0, 2);
  return CHARS_PER_SEC[key] ?? 13;
}

export function estimateSpeechSec(text: string, language: string): number {
  const chars = text.replace(/\s+/g, " ").trim().length;
  if (chars === 0) return 0;
  return chars / charsPerSec(language);
}

/** Longer than the original by more than 15% needs one shorten pass. */
export function sceneNeedsShorten(originalSec: number, translatedText: string, language: string): boolean {
  if (originalSec <= 0) return false;
  return estimateSpeechSec(translatedText, language) > originalSec * 1.15;
}

export type TranslationScene = {
  id: string;
  narration: string;
};

export function keepSceneIds<T extends { id: string }>(original: readonly { id: string }[], translated: readonly T[]): T[] {
  const byId = new Map(translated.map((scene) => [scene.id, scene]));
  return original.map((scene) => {
    const next = byId.get(scene.id);
    if (!next) throw new Error(`Translated scene missing id ${scene.id}`);
    return next;
  });
}

export function sceneDurationsFromVoices(scenes: readonly {
  id: string;
  order: number;
  voiceDurationSec: number;
}[]): Record<string, number> {
  const built = buildTimeline({
    aspectRatio: "16:9",
    musicEnabled: false,
    music: null,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      order: scene.order,
      label: scene.id,
      noVisual: true,
      durationOverrideSec: null,
      estDurationSec: null,
      voice: { trackId: scene.id, path: "voice.wav", durationSec: scene.voiceDurationSec },
      visuals: [],
    })),
  });
  return Object.fromEntries(built.scenes.map((scene) => [scene.sceneId, scene.durationSec]));
}

export function voicePaddingSec(): number {
  return VOICE_LEAD_SEC + VOICE_TAIL_SEC;
}

export type VoiceChoice = { path: string; durationSec: number; reusedOriginal: boolean };

/** subtitles_only keeps the parent voice file. dub uses the newly synthesized file. */
export function chooseVoice(input: {
  mode: "dub" | "subtitles_only";
  original: { path: string; durationSec: number } | null;
  synthesized: { path: string; durationSec: number } | null;
}): VoiceChoice {
  if (input.mode === "subtitles_only") {
    if (!input.original) throw new Error("Original voice is required for subtitles_only");
    return { path: input.original.path, durationSec: input.original.durationSec, reusedOriginal: true };
  }
  if (!input.synthesized) throw new Error("Synthesized voice is required for dub");
  return { path: input.synthesized.path, durationSec: input.synthesized.durationSec, reusedOriginal: false };
}

export function translationNeedsReview(automationEnabled: boolean): boolean {
  return !automationEnabled;
}

export const TRANSLATION_REVIEW_MESSAGE = "Duyệt bản dịch";

export function trimMetadata(draft: {
  titles: string[];
  description: string;
  tags: string[];
  hashtags: string[];
  thumbnailText: string[];
}, limits?: { title?: number; description?: number; tags?: number; hashtags?: number; thumbnailText?: number }): VideoMetadataDraft {
  const titleMax = limits?.title ?? 100;
  const descriptionMax = limits?.description ?? 1500;
  const tagCount = limits?.tags ?? 15;
  const hashtagCount = limits?.hashtags ?? 5;
  const thumbMax = limits?.thumbnailText ?? 32;
  const titles = draft.titles.map((title) => title.trim()).filter(Boolean).slice(0, 3).map((title) => title.slice(0, titleMax));
  return {
    titles: titles.length > 0 ? titles : ["Video"],
    description: draft.description.trim().slice(0, descriptionMax),
    tags: draft.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, tagCount).map((tag) => tag.slice(0, 30)),
    hashtags: draft.hashtags.map((tag) => tag.trim()).filter(Boolean).slice(0, hashtagCount).map((tag) => tag.slice(0, 40)),
    thumbnailText: draft.thumbnailText.map((text) => text.trim()).filter(Boolean).slice(0, 2).map((text) => text.slice(0, thumbMax)),
  };
}

export const YOUTUBE_LOCALIZATION_HINT =
  "Cần quyền youtube đầy đủ để cập nhật tiêu đề và mô tả đa ngôn ngữ trên cùng video.";
export const YOUTUBE_CAPTION_HINT =
  "Cần quyền youtube.force-ssl (bật Quản lý bình luận rồi kết nối lại) để tải phụ đề lên YouTube.";

export function youtubeLanguageExtras(scopes: readonly string[]): {
  updateLocalizations: boolean;
  insertCaptions: boolean;
  hints: string[];
} {
  const updateLocalizations = scopes.includes(YOUTUBE_FULL_SCOPE);
  const insertCaptions = scopes.includes(YOUTUBE_FORCE_SSL_SCOPE);
  const hints: string[] = [];
  if (!updateLocalizations) hints.push(YOUTUBE_LOCALIZATION_HINT);
  if (!insertCaptions) hints.push(YOUTUBE_CAPTION_HINT);
  return { updateLocalizations, insertCaptions, hints };
}

export function buildTranslateScriptPrompt(input: {
  language: string;
  mode: "translate" | "shorten";
  scenes: Array<{ id: string; narration: string; durationSec: number }>;
}): { system: string; prompt: string } {
  return {
    system: input.mode === "shorten"
      ? "Shorten each scene so the spoken duration stays within 15% of durationSec. Keep the same scene ids, proper nouns, and a natural spoken style. Reply with JSON only."
      : "Translate each scene into the target language for spoken narration. Keep the same scene ids and proper nouns. Natural spoken style, not a literal gloss. Do not invent facts. Reply with JSON only.",
    prompt: JSON.stringify({
      mode: input.mode,
      language: input.language,
      scenes: input.scenes,
    }),
  };
}
