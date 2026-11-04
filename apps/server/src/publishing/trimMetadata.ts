import type { PublisherLimits } from "./types.js";

export function trimPublishMetadata(
  input: {
    title: string;
    description: string;
    tags: string[];
    hashtags?: string[];
  },
  limits: PublisherLimits,
  options: { mergeHashtags?: boolean } = {},
): { title: string; description: string; tags: string[] } {
  const title = input.title.slice(0, limits.maxTitleChars);
  const description = input.description.slice(0, limits.maxDescriptionChars);
  let tags = [...input.tags];
  if (options.mergeHashtags && input.hashtags?.length) {
    const hashed = input.hashtags.map((tag) => (tag.startsWith("#") ? tag.slice(1) : tag));
    tags = [...tags, ...hashed];
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
    if (unique.length >= limits.maxTags) break;
  }
  return { title, description, tags: unique };
}
