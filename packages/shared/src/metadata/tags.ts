/** Normalize tags and hashtags for publishing: trim, dedupe, strip/add #. */
export function cleanupTagsAndHashtags(input: {
  tags?: readonly string[];
  hashtags?: readonly string[];
}): { tags: string[]; hashtags: string[] } {
  const tags = dedupe(
    (input.tags ?? [])
      .map((tag) => tag.trim().replace(/^#+/, "").trim())
      .filter(Boolean),
  ).slice(0, 15);

  const hashtags = dedupe(
    (input.hashtags ?? [])
      .map((tag) => {
        const bare = tag.trim().replace(/^#+/, "").trim();
        return bare ? `#${bare}` : "";
      })
      .filter(Boolean),
  ).slice(0, 5);

  return { tags, hashtags };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
