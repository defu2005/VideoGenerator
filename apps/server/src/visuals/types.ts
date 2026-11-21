import type { Project, Scene, VisionCheck } from "@vg/shared";
import { userOwnsVisualSelection } from "@vg/shared";
import type { ImageOrientation, NormalizedImageResult } from "../providers/images/types.js";

export type SceneRow = {
  id: string;
  project_id: string;
  order: number;
  narration: string;
  visual_notes: string;
  visual_description: string;
  no_visual: number;
  visual_queries: string;
};

export type CacheRow = { response: string; created_at: string };

export type SearchStats = {
  requests: number;
  requestsByProvider: Record<string, number>;
  cacheHits: number;
  failures: number;
  unavailableFailures: number;
  /** Providers skipped for the rest of this stage run (Cloudflare / repeated 403). */
  blockedProviders: Set<string>;
  blockedReasons: Record<string, string>;
  consecutive403ByProvider: Record<string, number>;
  checkpointHits: number;
};

export type SceneSearchData = {
  scene: Scene;
  queries: string[];
  candidates: NormalizedImageResult[];
  searchHash: string;
  /** Fully skipped this run (TASK-126: false for a reused scene that still needs vision). */
  unchanged: boolean;
  /** Stored candidates were reused instead of searching providers. */
  reused: boolean;
  /** Stored vision results, kept for reused scenes that run through the vision pass. */
  storedChecks?: Map<string, VisionCheck>;
  protectedSelection: boolean;
};

export const VISUAL_CHECKPOINT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Short, non-sensitive view of a candidate for stage feedback (TASK-148a). */
export function visualFeedbackSummary(candidate: { provider: string; providerItemId: string; title: string } | null | undefined): { provider: string; id: string; title: string } | null {
  return candidate ? { provider: candidate.provider, id: candidate.providerItemId, title: candidate.title } : null;
}

export function isProtectedSelection(selection: { selectedBy?: string; status?: string } | null | undefined): boolean {
  return userOwnsVisualSelection(selection);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T | null) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error("Invalid JSON stored in visual search data", { cause: error });
  }
}

export function aspectNumber(aspectRatio: Project["settings"]["aspectRatio"]): number {
  if (aspectRatio === "9:16") return 9 / 16;
  if (aspectRatio === "1:1") return 1;
  return 16 / 9;
}

export function orientationFor(aspectRatio: Project["settings"]["aspectRatio"]): ImageOrientation {
  return aspectRatio === "9:16" ? "portrait" : aspectRatio === "1:1" ? "square" : "landscape";
}

export function createSearchStats(): SearchStats {
  return {
    requests: 0,
    requestsByProvider: {},
    cacheHits: 0,
    failures: 0,
    unavailableFailures: 0,
    blockedProviders: new Set(),
    blockedReasons: {},
    consecutive403ByProvider: {},
    checkpointHits: 0,
  };
}

export function parseCheckpoint<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
