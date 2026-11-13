import { hashesMatch, hamming, hexToHash, PHASH_NEAR_MAX, PHASH_SAME_MAX } from "./phash.js";
import { dedupeKey, type DedupeCandidate } from "./dedupe.js";
import { assignOptimal } from "./assignOptimal.js";

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
  needsMoreSearch: boolean;
};

const UNASSIGNED_COST = 5;

export function assignDistinct<T extends DedupeCandidate>(
  scenes: SceneRankedCandidates<T>[],
): DistinctAssignment<T>[] {
  const orderedScenes = [...scenes].sort((a, b) => a.order - b.order);
  const lockedByScene = new Map<string, T>();
  for (const scene of orderedScenes) {
    if (scene.lockedCandidate) lockedByScene.set(scene.sceneId, scene.lockedCandidate);
  }
  const columns: T[] = [];
  const columnOf = new Map<string, number>();
  const identityOf = (candidate: T) => imageIdentity(candidate);
  for (const scene of orderedScenes) {
    if (lockedByScene.has(scene.sceneId)) continue;
    for (const candidate of scene.candidates.filter(isRelevant)) {
      const identity = identityOf(candidate);
      if (columnOf.has(identity)) continue;
      if ([...lockedByScene.values()].some((locked) => imageIdentity(locked) === identity)) continue;
      columnOf.set(identity, columns.length);
      columns.push(candidate);
    }
  }
  const freeScenes = orderedScenes.filter((scene) => !lockedByScene.has(scene.sceneId));
  const windowSize = freeScenes.length * Math.max(columns.length, 1) > 60 * 40 ? 20 : freeScenes.length;
  const chosen = new Map<string, T>();
  const usedColumns = new Set<number>();
  for (let start = 0; start < freeScenes.length; start += windowSize) {
    const window = freeScenes.slice(start, start + windowSize);
    const openColumns = columns.map((candidate, index) => ({ candidate, index })).filter((item) => !usedColumns.has(item.index));
    if (window.length === 0) continue;
    const cost = window.map((scene, sceneIndex) => openColumns.map((column) => {
      const rank = scene.candidates.findIndex((item) => imageIdentity(item) === imageIdentity(column.candidate));
      if (rank < 0) return UNASSIGNED_COST;
      const base = rank + rank * 0.001 * (window.length - sceneIndex);
      const near = orderedScenes.some((other) => {
        if (Math.abs(other.order - scene.order) === 0 || Math.abs(other.order - scene.order) > 3) return false;
        const taken = lockedByScene.get(other.sceneId) ?? chosen.get(other.sceneId);
        return Boolean(taken && isNear(taken, column.candidate));
      });
      return base + (near ? 0.25 : 0);
    }));
    const pick = openColumns.length ? assignOptimal(cost) : window.map(() => -1);
    window.forEach((scene, index) => {
      const column = pick[index] === undefined || pick[index] < 0 ? undefined : openColumns[pick[index]];
      const assignedCost = column ? cost[index]?.[pick[index]!] : UNASSIGNED_COST;
      if (!column || assignedCost === undefined || assignedCost >= UNASSIGNED_COST) return;
      chosen.set(scene.sceneId, column.candidate);
      usedColumns.add(column.index);
    });
  }
  repairNearDuplicates(orderedScenes, chosen, lockedByScene, columns, usedColumns);
  return orderedScenes.map((scene) => {
    const locked = lockedByScene.get(scene.sceneId);
    if (locked) {
      const reusedAcrossScenes = orderedScenes.some((other) => {
        if (other.sceneId === scene.sceneId) return false;
        const otherImage = lockedByScene.get(other.sceneId) ?? chosen.get(other.sceneId);
        return Boolean(otherImage && imageIdentity(otherImage) === imageIdentity(locked));
      });
      return { sceneId: scene.sceneId, candidate: locked, reusedAcrossScenes, needsMoreSearch: false };
    }
    const candidate = chosen.get(scene.sceneId) ?? null;
    return {
      sceneId: scene.sceneId,
      candidate,
      reusedAcrossScenes: false,
      needsMoreSearch: candidate === null,
    };
  });
}

function repairNearDuplicates<T extends DedupeCandidate>(
  scenes: SceneRankedCandidates<T>[],
  chosen: Map<string, T>,
  lockedByScene: Map<string, T>,
  columns: T[],
  usedColumns: Set<number>,
): void {
  for (const scene of scenes) {
    const current = chosen.get(scene.sceneId);
    if (!current) continue;
    const nearby = scenes.some((other) => {
      if (other.sceneId === scene.sceneId || Math.abs(other.order - scene.order) > 3 || other.order > scene.order) return false;
      const taken = lockedByScene.get(other.sceneId) ?? chosen.get(other.sceneId);
      return Boolean(taken && isNear(taken, current));
    });
    if (!nearby) continue;
    const alternative = scene.candidates.find((candidate) => {
      if (!isRelevant(candidate) || imageIdentity(candidate) === imageIdentity(current)) return false;
      const index = columns.findIndex((column) => imageIdentity(column) === imageIdentity(candidate));
      return index >= 0 && !usedColumns.has(index);
    });
    if (!alternative) continue;
    const previousIndex = columns.findIndex((column) => imageIdentity(column) === imageIdentity(current));
    if (previousIndex >= 0) usedColumns.delete(previousIndex);
    const nextIndex = columns.findIndex((column) => imageIdentity(column) === imageIdentity(alternative));
    if (nextIndex >= 0) usedColumns.add(nextIndex);
    chosen.set(scene.sceneId, alternative);
  }
}

function isRelevant(candidate: DedupeCandidate): boolean {
  const keyword = candidate.scoreBreakdown?.keyword;
  return typeof keyword !== "number" || keyword > 0;
}

function imageIdentity(candidate: DedupeCandidate): string {
  if (candidate.phash) return `hash:${candidate.phash}`;
  return dedupeKey(candidate);
}

function isNear(left: DedupeCandidate, right: DedupeCandidate): boolean {
  if (sameSeries(left, right)) return true;
  if (!left.phash || !right.phash) return false;
  const distance = hamming(hexToHash(left.phash), hexToHash(right.phash));
  return distance > PHASH_SAME_MAX && distance <= PHASH_NEAR_MAX;
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

export function sameImageHashes(left?: string, right?: string, leftCenter?: string, rightCenter?: string): boolean {
  return hashesMatch(left, right) || hashesMatch(left, rightCenter) || hashesMatch(leftCenter, right) || hashesMatch(leftCenter, rightCenter);
}
