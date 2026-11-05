import type { TrendItem } from "@vg/shared";
import { mapWikimediaTop, mapYoutubePopular, parseFeedXml, trendUserAgent, wikimediaTopUrl } from "@vg/shared";

export type TrendHttpResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

export type TrendHttp = (url: string, init: RequestInit) => Promise<TrendHttpResponse>;

export const YOUTUBE_API_KEY_SECRET = "trends.youtubeApiKey";

function headers(): HeadersInit {
  return {
    Accept: "application/json, application/xml, text/xml, */*",
    "User-Agent": trendUserAgent(),
  };
}

export async function fetchYoutubePopular(input: {
  region: string;
  categoryId: string;
  accessToken?: string | null;
  apiKey?: string | null;
  fetchImpl: TrendHttp;
  signal: AbortSignal;
}): Promise<TrendItem[]> {
  if (!input.accessToken && !input.apiKey) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", input.region || "VN");
  url.searchParams.set("maxResults", "50");
  if (input.categoryId) url.searchParams.set("videoCategoryId", input.categoryId);
  if (input.apiKey && !input.accessToken) url.searchParams.set("key", input.apiKey);
  const response = await input.fetchImpl(url.toString(), {
    signal: input.signal,
    headers: {
      ...headers(),
      ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
    },
  });
  if (!response.ok) return [];
  return mapYoutubePopular(await response.json());
}

export async function fetchWikimediaTop(input: {
  language: string;
  metaPages: string[];
  now: Date;
  fetchImpl: TrendHttp;
  signal: AbortSignal;
}): Promise<TrendItem[]> {
  const response = await input.fetchImpl(wikimediaTopUrl(input.language, input.now), {
    signal: input.signal,
    headers: headers(),
  });
  if (!response.ok) return [];
  return mapWikimediaTop(await response.json(), input.language, input.metaPages);
}

export async function fetchRssFeed(input: {
  feedUrl: string;
  fetchImpl: TrendHttp;
  signal: AbortSignal;
}): Promise<TrendItem[]> {
  const response = await input.fetchImpl(input.feedUrl, {
    signal: input.signal,
    headers: { ...headers(), Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
  });
  if (!response.ok) return [];
  return parseFeedXml(await response.text(), "rss");
}
