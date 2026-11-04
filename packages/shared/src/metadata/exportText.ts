import { appendDescriptionExtras } from "./draft.js";
import { DEFAULT_AI_DISCLOSURE } from "../schemas/metadata.js";

/** Plain-text `metadata.txt` for a render export zip. */
export function buildMetadataText(input: {
  titles: readonly string[];
  description: string;
  tags?: readonly string[];
  hashtags?: readonly string[];
  chaptersText?: string;
  creditsText?: string;
  disclosure?: string;
}): string {
  const disclosure = (input.disclosure ?? DEFAULT_AI_DISCLOSURE).trim();
  const description = appendDescriptionExtras({
    description: input.description,
    chaptersText: input.chaptersText,
    creditsText: input.creditsText,
    disclosure,
  });
  const titles = input.titles.map((title) => title.trim()).filter(Boolean);
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const hashtags = (input.hashtags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const lines = [
    "Tiêu đề:",
    ...(titles.length ? titles.map((title) => `- ${title}`) : ["- (không có)"]),
    "",
    "Mô tả:",
    description || "(trống)",
    "",
    "Tags:",
    tags.length ? tags.join(", ") : "(không có)",
    "",
    "Hashtags:",
    hashtags.length ? hashtags.join(" ") : "(không có)",
    "",
    "AI disclosure:",
    disclosure,
  ];
  return `${lines.join("\n").trim()}\n`;
}
