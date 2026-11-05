import { describe, expect, it } from "vitest";
import {
  TREND_USER_AGENT,
  acceptTrendIdeas,
  buildTrendMatchPrompt,
  directionCoversNews,
  isTrendCacheFresh,
  isWikimediaMetaPage,
  keywordPrefilter,
  mapWikimediaTop,
  mapYoutubePopular,
  parseFeedXml,
  pickNextFreePublishSlot,
  planTodaySlot,
  trendUserAgent,
  userAgentHasEmail,
  type TrendItem,
} from "@vg/shared";

const item = (title: string, score = 1): TrendItem => ({
  title,
  source: "rss",
  score,
});

describe("trend sources", () => {
  it("maps YouTube popular titles and tags", () => {
    const mapped = mapYoutubePopular({
      items: [{
        id: "abc",
        snippet: { title: "Đông Sơn", publishedAt: "2026-11-01T00:00:00Z", categoryId: "27", tags: ["khảo cổ", "việt"] },
        statistics: { viewCount: "1200" },
      }],
    });
    expect(mapped).toEqual([{
      title: "Đông Sơn",
      url: "https://www.youtube.com/watch?v=abc",
      source: "youtube_popular",
      score: 1200,
      publishedAt: "2026-11-01T00:00:00Z",
      category: "27",
      tags: ["khảo cổ", "việt"],
    }]);
  });

  it("drops Wikimedia meta pages and keeps articles", () => {
    const mapped = mapWikimediaTop({
      items: [{
        articles: [
          { article: "Main_Page", views: 9 },
          { article: "Special:Search", views: 8 },
          { article: "Đông_Sơn", views: 40 },
          { article: "Trang_Chính", views: 7 },
        ],
      }],
    }, "vi", ["Đông Sơn"]);
    expect(mapped.map((row) => row.title)).toEqual([]);
    expect(isWikimediaMetaPage("Main_Page")).toBe(true);
    const kept = mapWikimediaTop({
      items: [{ articles: [{ article: "Đông_Sơn", views: 40 }, { article: "Wikipedia:About", views: 1 }] }],
    }, "vi");
    expect(kept).toMatchObject([{ title: "Đông Sơn", score: 40, source: "wikimedia_top" }]);
  });

  it("parses RSS and Atom, including CDATA and entities", () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title><![CDATA[Đông Sơn & cổ]]></title>
          <link>https://example.com/a</link>
          <pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate>
        </item>
      </channel></rss>
      <feed>
        <entry>
          <title>Tom &amp; Jerry</title>
          <link href="https://example.com/b" />
          <updated>2026-11-03T00:00:00Z</updated>
        </entry>
      </feed>`;
    const parsed = parseFeedXml(xml);
    expect(parsed.map((row) => row.title)).toEqual(["Đông Sơn & cổ", "Tom & Jerry"]);
    expect(parsed[0]?.url).toBe("https://example.com/a");
    expect(parsed[1]?.url).toBe("https://example.com/b");
    expect(parsed[0]?.publishedAt).toBe("2026-11-02T00:00:00.000Z");
  });

  it("treats a cache younger than 2 hours as fresh", () => {
    const now = new Date("2026-11-05T12:00:00.000Z");
    expect(isTrendCacheFresh("2026-11-05T10:30:00.000Z", now)).toBe(true);
    expect(isTrendCacheFresh("2026-11-05T09:00:00.000Z", now)).toBe(false);
  });
});

describe("trend relevance", () => {
  it("keeps keyword overlap and drops a low fit score", () => {
    const filtered = keywordPrefilter([
      item("thời trang hôm nay", 9),
      item("lịch sử Đông Sơn", 2),
      item("lịch sử gốm", 5),
    ], ["lịch", "sử"]);
    expect(filtered.map((row) => row.title)).toEqual(["lịch sử gốm", "lịch sử Đông Sơn"]);
    const { kept, skipped } = acceptTrendIdeas([
      { title: "Lịch sử", angle: "Góc", whyNow: "Nguồn: Lịch sử", sourceTitles: ["Lịch sử"], urgency: "evergreen", fitScore: 40, sensitive: false },
      { title: "Đông Sơn", angle: "Góc", whyNow: "Nguồn: Đông Sơn", sourceTitles: ["Đông Sơn"], urgency: "today", fitScore: 88, sensitive: false },
    ], false);
    expect(kept.map((idea) => idea.title)).toEqual(["Đông Sơn"]);
    expect(skipped).toEqual([{ title: "Lịch sử", reason: "fit" }]);
  });

  it("skips sensitive ideas unless the direction covers news", () => {
    const idea = {
      title: "Động đất",
      angle: "Góc",
      whyNow: "Nguồn: Động đất",
      sourceTitles: ["Động đất"],
      urgency: "today" as const,
      fitScore: 90,
      sensitive: true,
    };
    expect(acceptTrendIdeas([idea], false).skipped[0]?.reason).toBe("sensitive");
    expect(acceptTrendIdeas([idea], true).kept).toHaveLength(1);
    expect(directionCoversNews("Kênh tin tức tối")).toBe(true);
    expect(directionCoversNews("Kênh lịch sử")).toBe(false);
  });

  it("gives a today idea the earliest taken slot and keeps the other topic", () => {
    const now = new Date("2026-11-05T03:00:00.000Z");
    const automation = {
      enabled: true,
      timezone: "Asia/Ho_Chi_Minh",
      publishTimes: ["19:00"],
      videosPerDay: 1,
    };
    const taken = pickNextFreePublishSlot({
      now,
      automation,
      assignedSlotIsos: [],
      minAheadMs: 60_000,
      daysAhead: 1,
    });
    expect(taken).not.toBeNull();
    const plan = planTodaySlot({
      now,
      automation,
      daysAhead: 1,
      existing: [{ id: "evergreen-1", scheduledFor: taken!.at.toISOString(), urgency: "evergreen" }],
    });
    expect(plan.scheduledFor).toBe(taken!.at.toISOString());
    expect(plan.displaced?.id).toBe("evergreen-1");
    expect(plan.displaced?.id).not.toBe("");
  });

  it("uses a user agent with no email and tells the model not to invent facts", () => {
    expect(trendUserAgent()).toBe(TREND_USER_AGENT);
    expect(TREND_USER_AGENT).toBe("VideoAgent/1.0 (local app)");
    expect(userAgentHasEmail(TREND_USER_AGENT)).toBe(false);
    expect(buildTrendMatchPrompt({ direction: "lịch sử", language: "vi", items: [] }).system).toMatch(/do not invent facts/i);
  });
});
