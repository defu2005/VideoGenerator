import { createHash } from "node:crypto";
import { quoteInPage } from "@vg/shared";
import { fetchOfficialPage } from "../../knowledge/officialPage.js";
import { validatePublicHttpUrl, WEB_CRAWL_USER_AGENT, type SafeFetchDependencies } from "../images/webCrawl.js";

export type ResearchPage = { url: string; text: string; hash: string; fetchedAt: string };
export class ResearchPages {
  private readonly cache = new Map<string, ResearchPage>();
  constructor(private readonly deps: SafeFetchDependencies = {}, private readonly now = () => new Date()) {}
  cached(url: string): ResearchPage | undefined {
    const page = this.cache.get(url);
    return page && this.now().getTime() - Date.parse(page.fetchedAt) < 6 * 3_600_000 ? page : undefined;
  }
  checkQuote(url: string, quote: string) { const page = this.cached(url); return { found: !!page && quoteInPage(page.text, quote), hash: page?.hash ?? null }; }
  async fetch(url: string, beforeFetch: () => void): Promise<ResearchPage> {
    const existing = this.cached(url); if (existing) return existing;
    const validateUrl = async (value: string) => {
      const target = new URL(value);
      if (target.protocol !== "https:" || /(?:^|\/)(?:login|signin|sign-in|oauth|authorize|auth)(?:\/|$)/i.test(target.pathname)
        || [...target.searchParams.keys()].some((key) => /token|secret|key|auth|session|cookie|password|email/i.test(key))
        || /[\w.+%-]+@[\w.-]+\.[a-z]{2,}/i.test(value)) throw new Error("RESEARCH_PAGE_URL_REJECTED");
      await validatePublicHttpUrl(value, this.deps.resolveHost);
    };
    const result = await fetchOfficialPage(url, async (value, init) => {
      beforeFetch();
      return (this.deps.fetchImpl ?? fetch)(value, init);
    }, WEB_CRAWL_USER_AGENT, { validateUrl, resolveHost: this.deps.resolveHost });
    if (!result.ok || /<input\b[^>]*type\s*=\s*["']?password/i.test(result.text)) throw new Error("RESEARCH_PAGE_UNAVAILABLE");
    const text = result.text.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ").trim().slice(0, 60_000);
    if (!text) throw new Error("RESEARCH_PAGE_EMPTY");
    const page = { url: result.url, text, hash: createHash("sha256").update(text).digest("hex"), fetchedAt: this.now().toISOString() };
    // Bounded process cache; each workspace/run should own its ResearchPages instance.
    if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(url, page); this.cache.set(page.url, page); return page;
  }
}
