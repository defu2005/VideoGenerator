import { dedupeKey, type DedupeCandidate } from "./dedupe.js";

export type SceneRankedCandidates<T extends DedupeCandidate> = {
  sceneId: string;
  order: number;
  candidates: T[];
  lockedCandidate?: T;
};

export type DistinctAssignment<T extends DedupeCandidate> = {
  sceneId: string;
  candidate: T | null;
  reusedAcrossScenes: boolean;
};

export function assignDistinct<T extends DedupeCandidate>(
  scenes: SceneRankedCandidates<T>[],
): DistinctAssignment<T>[] {
  const orderedScenes = [...scenes].sort((a, b) => a.order - b.order);
  const reservedLocked = new Set(orderedScenes.flatMap(({ lockedCandidate }) =>
    lockedCandidate ? [dedupeKey(lockedCandidate)] : []));
  const globallyUsed = new Set<string>();
  let previousKey: string | undefined;
  let previousCandidate: T | undefined;
  return orderedScenes.map(({ sceneId, candidates, lockedCandidate }) => {
    const relevant = candidates.filter(isRelevant);
    const preferred = relevant.length ? relevant : candidates;
    const available = preferred.filter((item) => !globallyUsed.has(dedupeKey(item))
      && !reservedLocked.has(dedupeKey(item)));
    let candidate = lockedCandidate
      ?? available[0]
      ?? preferred.find((item) => dedupeKey(item) !== previousKey)
      ?? preferred[0]
      ?? null;
    if (!lockedCandidate && candidate && previousCandidate && sameSeries(candidate, previousCandidate)) {
      candidate = available.find((item) => !sameSeries(item, previousCandidate!))
        ?? preferred.find((item) => !sameSeries(item, previousCandidate!))
        ?? candidate;
    }
    const key = candidate ? dedupeKey(candidate) : undefined;
    const reusedAcrossScenes = Boolean(key && (globallyUsed.has(key)
      || (!lockedCandidate && reservedLocked.has(key))));
    if (key) globallyUsed.add(key);
    previousKey = key;
    previousCandidate = candidate ?? undefined;
    return { sceneId, candidate, reusedAcrossScenes };
  });
}

function isRelevant(candidate: DedupeCandidate): boolean {
  const keyword = candidate.scoreBreakdown?.keyword;
  return typeof keyword !== "number" || keyword > 0;
}

function sameSeries(left: DedupeCandidate, right: DedupeCandidate): boolean {
  const leftCreator = normalizeSeriesText(left.license?.author ?? "");
  const rightCreator = normalizeSeriesText(right.license?.author ?? "");
  const leftTitle = normalizeSeriesText(left.title ?? "");
  const rightTitle = normalizeSeriesText(right.title ?? "");
  return Boolean(leftCreator && leftTitle && leftCreator === rightCreator && leftTitle === rightTitle);
}

function normalizeSeriesText(value: string): string {
  return value.toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
