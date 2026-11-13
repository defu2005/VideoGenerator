import {
  ApiContractSchema, YOUTUBE_FULL_SCOPE, YOUTUBE_READONLY_SCOPE, snapshotKnowledge, type PlatformId,
} from "@vg/shared";
import type { KnowledgeService } from "../knowledge/service.js";

const ids = {
  youtube: "analytics.scopes.youtube", tiktok: "analytics.scopes.tiktok",
  facebook_reels: "analytics.scopes.facebook_reels", instagram_reels: "analytics.scopes.instagram_reels",
} as const;

export function analyticsScopes(platform: PlatformId, knowledge?: KnowledgeService): string[] {
  if (platform === "mock") return [];
  const id = ids[platform];
  const fallback = ApiContractSchema.parse(snapshotKnowledge(id)!.value);
  const current = ApiContractSchema.safeParse(knowledge?.value(id, fallback));
  return [...(current.data?.scopes ?? fallback.scopes ?? [])];
}

export const ANALYTICS_REQUIRED_SCOPES: Record<PlatformId, string[]> = {
  youtube: analyticsScopes("youtube"),
  tiktok: analyticsScopes("tiktok"),
  instagram_reels: analyticsScopes("instagram_reels"),
  facebook_reels: analyticsScopes("facebook_reels"),
  mock: [],
};

/** YouTube full scope also satisfies older youtube.readonly grants. */
export function missingScopes(granted: string[], required: string[]): string[] {
  const set = new Set(granted);
  if (set.has(YOUTUBE_FULL_SCOPE)) set.add(YOUTUBE_READONLY_SCOPE);
  return required.filter((scope) => !set.has(scope));
}
