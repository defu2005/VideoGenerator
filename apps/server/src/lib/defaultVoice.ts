import type { AppConfig } from "./config.js";
import type { TtsVoice } from "../providers/tts/types.js";

function normalizeLocale(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function localeMatches(language: string, target: string): boolean {
  const project = normalizeLocale(target);
  const voiceLocale = normalizeLocale(language);
  if (!voiceLocale || !project) return false;
  if (voiceLocale === project) return true;
  if (voiceLocale.startsWith(`${project}-`)) return true;
  if (project.startsWith(`${voiceLocale}-`)) return true;
  const projectBase = project.split("-")[0];
  const voiceBase = voiceLocale.split("-")[0];
  return voiceBase === projectBase && (projectBase.length > 0);
}

function isMultilingualVoice(voice: TtsVoice): boolean {
  return Boolean(voice.multilingual ?? /Multilingual/i.test(voice.name));
}

function voiceRank(voice: TtsVoice): number {
  if (voice.gender === "female") return 0;
  if (voice.gender === "male") return 1;
  return 2;
}

function localePriority(value: string, target: string): number {
  const normalizedValue = normalizeLocale(value);
  const normalizedTarget = normalizeLocale(target);
  if (normalizedValue === normalizedTarget) return 0;
  if (normalizedValue.split("-")[0] === normalizedTarget.split("-")[0]) return 1;
  return 2;
}

export function defaultVoiceFor(
  language: string,
  voices: TtsVoice[] | null | undefined,
  config: Pick<AppConfig, "TTS_VOICE_VI" | "TTS_VOICE_EN">,
  warn?: (message: string) => void,
  preferLocale = false,
): string {
  const normalized = (language ?? "").trim();
  if (!normalized) return config.TTS_VOICE_EN;
  const lower = normalized.toLowerCase();
  if (!preferLocale && lower.startsWith("vi")) return config.TTS_VOICE_VI;
  if (!preferLocale && lower.startsWith("en")) return config.TTS_VOICE_EN;
  const vietnamese = lower.startsWith("vi");
  const fallback = vietnamese ? config.TTS_VOICE_VI : config.TTS_VOICE_EN;
  const fallbackLanguage = vietnamese ? "tiếng Việt" : "tiếng Anh";
  if (!voices || voices.length === 0) {
    warn?.(`Không tải được danh sách giọng đọc — dùng ${fallbackLanguage} mặc định.`);
    return fallback;
  }

  if (preferLocale) {
    const exact = voices.filter((voice) => localePriority(voice.language, normalized) === 0)
      .sort((left, right) => Number(isMultilingualVoice(left)) - Number(isMultilingualVoice(right))
        || voiceRank(left) - voiceRank(right) || left.name.localeCompare(right.name));
    if (exact[0]) return exact[0].name;
  }
  const byLocale = [...voices]
    .filter((voice) => !isMultilingualVoice(voice) && localeMatches(voice.language, normalized))
    .sort((left, right) => {
      const byLocalePriority = localePriority(left.language, normalized) - localePriority(right.language, normalized);
      if (byLocalePriority !== 0) return byLocalePriority;
      const byGender = voiceRank(left) - voiceRank(right);
      if (byGender !== 0) return byGender;
      return left.name.localeCompare(right.name);
    });
  if (byLocale.length > 0) return byLocale[0].name;

  const multilingual = [...voices]
    .filter((voice) => isMultilingualVoice(voice))
    .sort((left, right) => {
      const byGender = voiceRank(left) - voiceRank(right);
      if (byGender !== 0) return byGender;
      return left.name.localeCompare(right.name);
    });
  if (multilingual.length > 0) return multilingual[0].name;

  warn?.(`Không tìm thấy giọng đọc phù hợp với ngôn ngữ này — dùng ${fallbackLanguage} mặc định.`);
  return fallback;
}
