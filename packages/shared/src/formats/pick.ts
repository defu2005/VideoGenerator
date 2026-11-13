import { FORMAT_RECIPES, formatRecipe, type FormatRecipe, type FormatRecipeId } from "./recipes.js";

const LISTICLE_TOPIC = /\b\d+\s+(điều|cách|lý do|sự thật|bí mật)/i;

export function fallbackFormat(input: {
  topic: string;
  aspectRatio: string;
  targetDurationSec: number;
}): { id: FormatRecipeId; reason: string } {
  if (input.aspectRatio === "9:16" && input.targetDurationSec < 60) {
    return { id: "short_hook", reason: "Video dọc dưới 60 giây dùng mẫu video ngắn." };
  }
  if (LISTICLE_TOPIC.test(input.topic)) {
    return { id: "listicle", reason: "Chủ đề có dạng danh sách đánh số." };
  }
  return { id: "explainer", reason: "Mặc định là mẫu giải thích." };
}

export function resolveFormat(input: {
  topic: string;
  aspectRatio: string;
  targetDurationSec: number;
  format?: string | null;
}): { recipe: FormatRecipe; reason: string; source: "chosen" | "fallback" } {
  const chosen = formatRecipe(input.format);
  if (chosen) return { recipe: chosen, reason: "Đã chọn trên hồ sơ hoặc dự án.", source: "chosen" };
  const picked = fallbackFormat(input);
  return { recipe: FORMAT_RECIPES[picked.id], reason: picked.reason, source: "fallback" };
}

export function missingRequiredSections(recipe: FormatRecipe, sectionKeys: Array<string | undefined>): string[] {
  const present = new Set(sectionKeys.filter((key): key is string => Boolean(key)));
  return recipe.script.structure.filter((section) => section.required && !present.has(section.key)).map((section) => section.key);
}
