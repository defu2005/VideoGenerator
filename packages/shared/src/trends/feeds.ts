import type { TrendItem } from "../schemas/trends.js";

const META_PREFIXES = [
  "special:",
  "wikipedia:",
  "file:",
  "category:",
  "portal:",
  "help:",
  "template:",
  "draft:",
  "user:",
  "talk:",
  "mediawiki:",
  "project:",
  "module:",
];

const DEFAULT_META_TITLES = new Set([
  "main_page",
  "main page",
  "trang_chính",
  "trang chính",
  "search",
]);

function wikiKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, " ");
}

export function isWikimediaMetaPage(article: string, extra: readonly string[] = []): boolean {
  const raw = article.trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (META_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  const key = wikiKey(raw);
  if (DEFAULT_META_TITLES.has(key) || DEFAULT_META_TITLES.has(lower)) return true;
  return extra.some((page) => wikiKey(page) === key || page.trim().toLowerCase() === lower);
}

export function mapYoutubePopular(payload: unknown): TrendItem[] {
  const items = Array.isArray((payload as { items?: unknown })?.items)
    ? (payload as { items: Array<Record<string, unknown>> }).items
    : [];
  const mapped: TrendItem[] = [];
  for (const item of items) {
    const snippet = item.snippet as { title?: string; publishedAt?: string; categoryId?: string; tags?: string[] } | undefined;
    const title = snippet?.title?.trim();
    if (!title) continue;
    const id = typeof item.id === "string" ? item.id : "";
    const views = Number((item.statistics as { viewCount?: string } | undefined)?.viewCount ?? 0);
    const tags = Array.isArray(snippet?.tags) ? snippet.tags.filter((tag) => typeof tag === "string").slice(0, 30) : undefined;
    mapped.push({
      title: title.slice(0, 500),
      ...(id ? { url: `https://www.youtube.com/watch?v=${id}` } : {}),
      source: "youtube_popular",
      score: Number.isFinite(views) ? views : 0,
      ...(snippet?.publishedAt ? { publishedAt: snippet.publishedAt } : {}),
      ...(snippet?.categoryId ? { category: snippet.categoryId } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
    });
  }
  return mapped;
}

export function mapWikimediaTop(payload: unknown, language: string, extraMeta: readonly string[] = []): TrendItem[] {
  const root = payload as { items?: Array<{ articles?: Array<{ article?: string; views?: number }> }> };
  const articles = root.items?.[0]?.articles ?? [];
  const lang = language.trim().toLowerCase() || "vi";
  const mapped: TrendItem[] = [];
  for (const article of articles) {
    const name = article.article?.trim();
    if (!name || isWikimediaMetaPage(name, extraMeta)) continue;
    mapped.push({
      title: name.replace(/_/g, " ").slice(0, 500),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(name)}`,
      source: "wikimedia_top",
      score: Number(article.views ?? 0),
    });
  }
  return mapped;
}

export function wikimediaTopUrl(language: string, now: Date): string {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lang = (language.trim().toLowerCase() || "en").replace(/[^a-z-]/g, "") || "en";
  const yyyy = String(yesterday.getUTCFullYear());
  const mm = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(yesterday.getUTCDate()).padStart(2, "0");
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${yyyy}/${mm}/${dd}`;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tagInner(block: string, tag: string): string | null {
  const cdata = new RegExp(`<${tag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i").exec(block);
  if (cdata) return cdata[1]!.trim();
  const plain = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (!plain) return null;
  return decodeXmlEntities(plain[1]!.replace(/<[^>]+>/g, "").trim());
}

function feedLink(block: string): string | undefined {
  const text = tagInner(block, "link");
  if (text && /^https?:\/\//i.test(text)) return text;
  const href = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(block);
  const value = href?.[1]?.trim();
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}

/** Small RSS/Atom reader for item/entry title, link and pubDate. No dependency. */
export function parseFeedXml(xml: string, source = "rss"): TrendItem[] {
  const items: TrendItem[] = [];
  const blocks = xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi);
  for (const block of blocks) {
    const body = block[2] ?? "";
    const title = tagInner(body, "title");
    if (!title) continue;
    const published = tagInner(body, "pubDate") ?? tagInner(body, "published") ?? tagInner(body, "updated");
    let publishedAt: string | undefined;
    if (published) {
      const ms = Date.parse(published);
      if (!Number.isNaN(ms)) publishedAt = new Date(ms).toISOString();
    }
    const url = feedLink(body);
    items.push({
      title: title.slice(0, 500),
      ...(url ? { url } : {}),
      source,
      score: 0,
      ...(publishedAt ? { publishedAt } : {}),
    });
    if (items.length >= 50) break;
  }
  return items;
}
