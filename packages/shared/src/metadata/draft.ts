import {
  DEFAULT_AI_DISCLOSURE,
  VideoMetadataDraftSchema,
  type VideoMetadataDraft,
} from "../schemas/metadata.js";
import { cleanupTagsAndHashtags } from "./tags.js";

/** Trim lengths, dedupe tags/hashtags, drop empties — always run after LLM or code draft. */
export function normalizeMetadataDraft(draft: {
  titles?: readonly string[];
  description?: string;
  tags?: readonly string[];
  hashtags?: readonly string[];
  thumbnailText?: readonly string[];
}): VideoMetadataDraft {
  const titles = (draft.titles ?? [])
    .map((title) => title.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 3);
  const { tags, hashtags } = cleanupTagsAndHashtags({
    tags: draft.tags,
    hashtags: draft.hashtags,
  });
  const thumbnailText = (draft.thumbnailText ?? [])
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 2);
  return VideoMetadataDraftSchema.parse({
    titles: titles.length ? titles : ["Untitled"],
    description: (draft.description ?? "").trim().slice(0, 1500),
    tags,
    hashtags,
    thumbnailText,
  });
}

/** Plain draft when the metadata budget feature is off (0 LLM). */
export function codeMetadataDraft(input: {
  title: string;
  hook: string;
  keywords?: readonly string[];
}): VideoMetadataDraft {
  const title = input.title.trim().slice(0, 100) || "Untitled";
  return normalizeMetadataDraft({
    titles: [title],
    description: input.hook.trim().slice(0, 1500),
    tags: input.keywords ?? [],
    hashtags: [],
    thumbnailText: [],
  });
}

export function appendDescriptionExtras(input: {
  description: string;
  chaptersText?: string;
  creditsText?: string;
  includeChapters?: boolean;
  includeCredits?: boolean;
  includeDisclosure?: boolean;
  disclosure?: string;
}): string {
  const parts = [input.description.trim()].filter(Boolean);
  if (input.includeChapters !== false && input.chaptersText?.trim()) {
    parts.push("", input.chaptersText.trim());
  }
  if (input.includeCredits !== false && input.creditsText?.trim()) {
    parts.push("", input.creditsText.trim());
  }
  if (input.includeDisclosure !== false) {
    parts.push("", (input.disclosure ?? DEFAULT_AI_DISCLOSURE).trim());
  }
  return parts.join("\n").trim();
}
