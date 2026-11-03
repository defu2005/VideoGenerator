import type { LicenseKind, WatermarkStatus } from "../enums.js";

export const RANK_WEIGHTS = {
  keyword: 0.35,
  providerPosition: 0.15,
  resolution: 0.15,
  aspect: 0.15,
  license: 0.1,
  watermark: 0.05,
  fileType: 0.05,
} as const;

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "with",
  "ảnh", "của", "là", "một", "và", "trong", "cho", "với",
]);
const WATERMARK_DOMAINS = [
  "shutterstock", "alamy", "gettyimages", "istockphoto", "dreamstime", "123rf", "depositphotos", "adobe stock",
];

export type RankableCandidate = {
  title: string;
  description: string;
  tags?: string[];
  width: number;
  height: number;
  aspectRatio?: number;
  fileType: string;
  watermark: WatermarkStatus;
  license: { kind: LicenseKind };
  provider: string;
  providerItemId: string;
  sourceSite?: string;
  searchQuery?: string;
  providerPosition?: number;
};

export type ScoreBreakdown = {
  keyword: number;
  providerPosition: number;
  resolution: number;
  aspect: number;
  license: number;
  watermark: number;
  fileType: number;
  total: number;
  lowRelevance: boolean;
  reusedAcrossScenes?: boolean;
};

export function normalizeTerms(value: string): string[] {
  return value.toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

export function scoreCandidate(
  candidate: RankableCandidate,
  options: { queryTerms: string; sceneTerms: string; targetAspect: number; minShortSide?: number },
): { score: number; breakdown: ScoreBreakdown } {
  const terms = new Set([
    ...normalizeTerms(candidate.searchQuery ?? ""),
    ...normalizeTerms(options.queryTerms),
    ...normalizeTerms(options.sceneTerms),
  ]);
  const content = new Set(normalizeTerms([
    candidate.title,
    candidate.description,
    ...(candidate.tags ?? []),
  ].join(" ")));
  const keyword = terms.size ? [...terms].filter((term) => content.has(term)).length / terms.size : 0;
  const providerPosition = Math.max(0, Math.min(1, candidate.providerPosition ?? 0));
  const shortSide = Math.min(candidate.width, candidate.height);
  const minSide = options.minShortSide ?? 320;
  const resolution = Math.max(0, Math.min(1, (shortSide - minSide) / (1080 - minSide)));
  const actualAspect = candidate.aspectRatio ?? candidate.width / candidate.height;
  const aspect = 1 - Math.min(1, Math.abs(Math.log(actualAspect / options.targetAspect)) / Math.log(3));
  const nonCommercial = candidate.license.kind.includes("NC")
    || candidate.license.kind === "ALL_RIGHTS_RESERVED";
  const license = candidate.license.kind === "UNKNOWN" || nonCommercial ? 0 : 1;
  const suspected = candidate.watermark === "SUSPECTED"
    || WATERMARK_DOMAINS.some((domain) => candidate.sourceSite?.toLowerCase().includes(domain));
  const watermark = suspected ? 0 : 1;
  const file = candidate.fileType.toLowerCase().replace(/^\./, "");
  const fileType = ["jpg", "jpeg", "png", "webp"].includes(file)
    ? 1
    : file === "svg" ? 0.3 : file === "gif" ? 0.2 : 0;
  const score = keyword * RANK_WEIGHTS.keyword
    + providerPosition * RANK_WEIGHTS.providerPosition
    + resolution * RANK_WEIGHTS.resolution
    + aspect * RANK_WEIGHTS.aspect
    + license * RANK_WEIGHTS.license
    + watermark * RANK_WEIGHTS.watermark
    + fileType * RANK_WEIGHTS.fileType;
  return {
    score,
    breakdown: {
      keyword,
      providerPosition,
      resolution,
      aspect,
      license,
      watermark,
      fileType,
      total: score,
      lowRelevance: keyword === 0,
    },
  };
}

export function rankCandidates<T extends RankableCandidate>(
  candidates: T[],
  options: { queryTerms: string; sceneTerms: string; targetAspect: number; providerOrder?: string[] },
): (T & { relevanceScore: number; scoreBreakdown: ScoreBreakdown; rank: number })[] {
  const providerRank = new Map((options.providerOrder ?? []).map((provider, index) => [provider, index]));
  return candidates
    .map((candidate) => {
      const { score, breakdown } = scoreCandidate(candidate, options);
      return { ...candidate, relevanceScore: score, scoreBreakdown: breakdown, rank: 0 };
    })
    .sort((left, right) => Number(left.scoreBreakdown.lowRelevance) - Number(right.scoreBreakdown.lowRelevance)
      || right.relevanceScore - left.relevanceScore
      || (providerRank.get(left.provider) ?? Number.MAX_SAFE_INTEGER)
        - (providerRank.get(right.provider) ?? Number.MAX_SAFE_INTEGER)
      || left.providerItemId.localeCompare(right.providerItemId))
    .map((candidate, rank) => ({ ...candidate, rank }));
}
