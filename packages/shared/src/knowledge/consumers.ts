export const KNOWLEDGE_CONSUMERS = {
  "GuidelineService.activeFor": ["guideline.*"],
  "retrieval guideline index": ["guideline.*"],
  "profile market defaults and account availability": ["market.*"],
  "market guidelines, topic ideas and default voice": ["market.*"],
  "guideline prompts and checks": ["guideline.*"],
  "YouTubePublisher.publish": ["youtube.data.videos_insert", "youtube.data.quota", "limit.youtube.publisher", "limit.youtube.shorts_max_sec"],
  "YoutubeQuotaTracker": ["youtube.data.quota", "youtube.data.videos_insert", "youtube.data.search_list"],
  "TikTokPublisher.publish": ["limit.tiktok.caption_max_utf16"],
  "analytics fetchers": ["analytics.scopes.*", "youtube.data.quota"],
  "YouTube comment fetcher": ["youtube.data.quota"],
  "featureMap:external-knowledge": ["*"],
} as const;

export function knowledgeConsumers(id: string): string[] {
  return Object.entries(KNOWLEDGE_CONSUMERS).filter(([, patterns]) => patterns.some((pattern) =>
    pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern)).map(([name]) => name);
}
