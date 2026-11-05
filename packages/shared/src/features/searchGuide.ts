export type GuideSection = {
  page: string;
  anchor: string;
  title: string;
  text: string;
};

export type GuideSearchHit = GuideSection & {
  href: string;
};

export function foldGuideText(value: string): string {
  return value
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function slugifyHeading(title: string): string {
  return foldGuideText(title)
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Pull `{#anchor}` off a heading, otherwise slugify the title. */
export function parseHeadingAnchor(raw: string): { title: string; anchor: string } {
  const match = raw.match(/^(.*?)\s*\{#([A-Za-z0-9-]+)\}\s*$/);
  if (match) return { title: match[1].trim(), anchor: match[2] };
  const title = raw.trim();
  return { title, anchor: slugifyHeading(title) };
}

export function anchorsInMarkdown(markdown: string): Set<string> {
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match) continue;
    anchors.add(parseHeadingAnchor(match[2]).anchor);
  }
  return anchors;
}

export function splitGuideSections(page: string, markdown: string): GuideSection[] {
  const sections: GuideSection[] = [];
  let current: { anchor: string; title: string; lines: string[] } | null = null;
  let inFence = false;
  const push = () => {
    if (!current) return;
    sections.push({
      page,
      anchor: current.anchor,
      title: current.title,
      text: current.lines.join("\n").trim(),
    });
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      current?.lines.push(line);
      continue;
    }
    if (!inFence) {
      const match = /^(#{1,6})\s+(.+)$/.exec(line);
      if (match) {
        push();
        const parsed = parseHeadingAnchor(match[2]);
        current = { anchor: parsed.anchor, title: parsed.title, lines: [] };
        continue;
      }
    }
    current?.lines.push(line);
  }
  push();
  return sections;
}

function termHits(haystack: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(term, from);
    if (at < 0) break;
    count += 1;
    from = at + term.length;
    if (count >= 8) break;
  }
  return count;
}

/** Rank guide sections. Title matches outrank body-only matches. */
export function searchUserGuide(sections: readonly GuideSection[], query: string, limit = 5): GuideSearchHit[] {
  const phrase = foldGuideText(query).trim();
  const terms = phrase.split(/\s+/).filter((term) => term.length > 1);
  if (!phrase || terms.length === 0) return [];
  const ranked = sections
    .map((section) => {
      const title = foldGuideText(section.title);
      const body = foldGuideText(`${section.title}\n${section.text}`);
      let score = 0;
      if (title.includes(phrase)) score += 50;
      if (body.includes(phrase)) score += 20;
      for (const term of terms) {
        if (title.includes(term)) score += 10;
        score += termHits(body, term);
      }
      return { section, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.section.title.localeCompare(b.section.title, "vi"));
  return ranked.slice(0, limit).map(({ section }) => ({
    ...section,
    href: `/help/${section.page}#${section.anchor}`,
  }));
}
