import type { LicenseKind, WatermarkStatus } from "../enums.js";

// Relevance first: a sharp but off-topic image must not beat a matching one.
export const RANK_WEIGHTS = {
  keyword: 0.5,
  providerPosition: 0.1,
  resolution: 0.12,
  aspect: 0.1,
  license: 0.1,
  watermark: 0.04,
  fileType: 0.04,
} as const;

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "with",
  "ảnh", "của", "là", "một", "và", "trong", "cho", "với",
]);
const FAN_PHOTO_TERMS = ["cosplay", "convention", "con 20", "fan art", "costume", "marching band"];
export const STOCK_WATERMARK_HOSTS = [
  "shutterstock", "alamy", "gettyimages", "istockphoto", "dreamstime", "123rf", "depositphotos", "adobe stock",
  "bigstockphoto", "canstockphoto", "stock.adobe", "pond5", "vectorstock", "freepik", "agefotostock",
  "superstock", "mediastorehouse", "pixta", "photodune", "storyblocks", "wirestock", "ftcdn.net",
  "media.gettyimages.com", "media.istockphoto.com",
];

export function stockWatermarkSuspected(input: { sourceSite?: string; imageUrl?: string; sourceUrl?: string; sourcePageUrl?: string }): boolean {
  const hosts = [input.sourceSite, input.imageUrl, input.sourceUrl, input.sourcePageUrl].filter(Boolean).join(" ").toLowerCase();
  if (STOCK_WATERMARK_HOSTS.some((domain) => hosts.includes(domain))) return true;
  return /\/comp\/|watermark|wm_|\/preview/i.test(hosts) && STOCK_WATERMARK_HOSTS.some((domain) => hosts.includes(domain.split(".")[0] ?? domain));
}

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
  licenseVerified?: boolean;
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
  reasons?: string[];
  reusedAcrossScenes?: boolean;
  llmRank?: number;
  visionFit?: number;
  invalidSource?: boolean;
};

export function normalizeTerms(value: string): string[] {
  return value.toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/u)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function phrasePresent(text: string, phrase: string): boolean {
  const hay = ` ${normalizeTerms(text).join(" ")} `;
  const needle = normalizeTerms(phrase).join(" ");
  return needle.length > 0 && hay.includes(` ${needle} `);
}

export function scoreCandidate(
  candidate: RankableCandidate,
  options: { queryTerms: string; sceneTerms: string; targetAspect: number; minShortSide?: number; entities?: string[] },
): { score: number; breakdown: ScoreBreakdown } {
  // Score against the scene only. The query that found a candidate is not evidence of relevance:
  // a weak alternative query would otherwise vouch for its own results.
  const terms = new Set([
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
    || stockWatermarkSuspected({ sourceSite: candidate.sourceSite, imageUrl: undefined });
  const watermark = suspected ? 0 : 1;
  const file = candidate.fileType.toLowerCase().replace(/^\./, "");
  const fileType = ["jpg", "jpeg", "png", "webp"].includes(file)
    ? 1
    : file === "svg" ? 0.3 : file === "gif" ? 0.2 : 0;
  const blob = [
    candidate.title,
    candidate.description,
    ...(candidate.tags ?? []),
    candidate.providerItemId,
  ].join(" ");
  const reasons: string[] = [];
  if (keyword < 0.34) reasons.push("keyword");
  const entities = (options.entities ?? []).map((item) => item.trim()).filter(Boolean);
  if (entities.length > 0 && !entities.some((entity) => phrasePresent(blob, entity))) reasons.push("entity");
  const sceneText = `${options.queryTerms} ${options.sceneTerms}`.toLocaleLowerCase();
  if (FAN_PHOTO_TERMS.some((term) => blob.toLocaleLowerCase().includes(term) && !sceneText.includes(term))) {
    reasons.push("fan");
  }
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
      lowRelevance: reasons.length > 0,
      ...(reasons.length ? { reasons } : {}),
    },
  };
}

export function rankCandidates<T extends RankableCandidate>(
  candidates: T[],
  options: { queryTerms: string; sceneTerms: string; targetAspect: number; providerOrder?: string[]; entities?: string[]; copyrightMode?: "off" | "commentary" },
): (T & { relevanceScore: number; scoreBreakdown: ScoreBreakdown; rank: number })[] {
  const providerRank = new Map((options.providerOrder ?? []).map((provider, index) => [provider, index]));
  return candidates
    .map((candidate) => {
      const { score, breakdown } = scoreCandidate(candidate, {
        queryTerms: options.queryTerms,
        sceneTerms: options.sceneTerms,
        targetAspect: options.targetAspect,
        entities: options.entities,
      });
      const commentary = options.copyrightMode === "commentary" && candidate.licenseVerified === false;
      return {
        ...candidate,
        relevanceScore: score,
        scoreBreakdown: commentary ? { ...breakdown, usage: "commentary" } : breakdown,
        rank: 0,
      };
    })
    .map((candidate, _index, all) => {
      if (options.copyrightMode === "commentary" || candidate.licenseVerified !== false) return candidate;
      const licensedRelevant = all.some((item) => item.licenseVerified !== false && item.license.kind !== "UNKNOWN" && item.scoreBreakdown.lowRelevance !== true);
      if (!licensedRelevant) return candidate;
      return { ...candidate, relevanceScore: -1, scoreBreakdown: { ...candidate.scoreBreakdown, lowRelevance: true, reasons: [...(candidate.scoreBreakdown.reasons ?? []), "copyright"] } };
    })
    .sort((left, right) => Number(left.scoreBreakdown.lowRelevance) - Number(right.scoreBreakdown.lowRelevance)
      || right.relevanceScore - left.relevanceScore
      || (providerRank.get(left.provider) ?? Number.MAX_SAFE_INTEGER)
        - (providerRank.get(right.provider) ?? Number.MAX_SAFE_INTEGER)
      || left.providerItemId.localeCompare(right.providerItemId))
    .map((candidate, rank) => ({ ...candidate, rank }));
}
