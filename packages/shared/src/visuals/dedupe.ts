import { hamming, hexToHash } from "./phash.js";

export type DedupeCandidate = {
  provider: string;
  providerItemId: string;
  imageUrl: string;
  sourceUrl: string;
  title?: string;
  license?: { evidence: string; kind: string; author?: string | null };
  sourceSite?: string;
  sourceProvider?: string;
  relevanceScore?: number;
  scoreBreakdown?: Record<string, unknown>;
  phash?: string;
  phashCenter?: string;
  width?: number;
  height?: number;
  alsoFoundAt?: Array<{ provider: string; sourceUrl: string }>;
};

export function normalizedImageUrl(input: string): string {
  try {
    const url = new URL(input);
    url.search = "";
    url.hash = "";
    let path = decodeURIComponent(url.pathname);
    path = path.replace(/\/thumb\/(.+?)\/\d+px-[^/]+$/i, "/$1").replace(/\/\d+px-[^/]+$/i, "");
    path = path.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${path}`;
  } catch {
    return input.trim().toLowerCase();
  }
}

export function candidateKey(candidate: DedupeCandidate): string {
  return `${candidate.provider.toLowerCase()}:${candidate.providerItemId}`;
}

export function dedupeKey(candidate: DedupeCandidate): string {
  const itemKey = candidateKey(candidate);
  if (candidate.imageUrl) return `image:${normalizedImageUrl(candidate.imageUrl)}`;
  if (candidate.sourceUrl) return `source:${normalizedImageUrl(candidate.sourceUrl)}`;
  return itemKey;
}

export function dedupeCandidates<T extends DedupeCandidate>(candidates: T[]): T[] {
  const seen = new Map<string, T>();
  for (const candidate of candidates) {
    const keys = new Set([
      candidateKey(candidate),
      `image:${normalizedImageUrl(candidate.imageUrl)}`,
      `source:${normalizedImageUrl(candidate.sourceUrl)}`,
      ...crossProviderFileKeys(candidate),
    ]);
    const hashPrior = candidate.phash
      ? [...seen.values()].find((value) => value.phash && hamming(hexToHash(value.phash), hexToHash(candidate.phash!)) <= 6)
      : undefined;
    const prior = hashPrior ?? [...keys].map((key) => seen.get(key)).find((value) => value !== undefined);
    if (prior) {
      const winner = preferCandidate(candidate, prior);
      const loser = winner === candidate ? prior : candidate;
      winner.alsoFoundAt = [...(winner.alsoFoundAt ?? []), ...(loser.alsoFoundAt ?? []), { provider: loser.provider, sourceUrl: loser.sourceUrl }];
      for (const key of [...keys, ...candidateKeys(prior), ...candidateKeys(candidate)]) seen.set(key, winner);
    } else {
      for (const key of keys) seen.set(key, candidate);
    }
  }
  const results: T[] = [];
  const returned = new Set<T>();
  for (const candidate of seen.values()) {
    if (!returned.has(candidate)) {
      returned.add(candidate);
      results.push(candidate);
    }
  }
  return results;
}

function candidateKeys(candidate: DedupeCandidate): string[] {
  return [
    candidateKey(candidate),
    `image:${normalizedImageUrl(candidate.imageUrl)}`,
    `source:${normalizedImageUrl(candidate.sourceUrl)}`,
    ...crossProviderFileKeys(candidate),
  ];
}

function preferCandidate<T extends DedupeCandidate>(left: T, right: T): T {
  const leftPixels = (left.width ?? 0) * (left.height ?? 0);
  const rightPixels = (right.width ?? 0) * (right.height ?? 0);
  if (leftPixels !== rightPixels) return leftPixels > rightPixels ? left : right;
  return evidenceRank(left) > evidenceRank(right) ? left : right;
}

function evidenceRank(candidate: DedupeCandidate): number {
  return (candidate.license?.evidence === "api" ? 4 : candidate.license?.evidence === "page_meta" ? 3 : 1)
    + (candidate.provider === "wikimedia" ? 1 : 0);
}

function crossProviderFileKeys(candidate: DedupeCandidate): string[] {
  if (candidate.provider !== "wikimedia"
    && (candidate.provider !== "openverse" || candidate.sourceProvider !== "wikimedia")) return [];
  return [...new Set([candidate.imageUrl, candidate.sourceUrl, candidate.title]
    .map((value) => fileTitle(value ?? ""))
    .filter(Boolean))]
    .map((title) => `wikimedia-file:${title}`);
}

function fileTitle(value: string): string {
  try {
    const path = new URL(value).pathname;
    return decodeURIComponent(path.split("/").pop() ?? "").replace(/^(?:\d+px-)/, "").toLowerCase();
  } catch {
    return value.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  }
}
