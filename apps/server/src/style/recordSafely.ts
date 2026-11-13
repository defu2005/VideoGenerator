import type Database from "better-sqlite3";
import { frameHashesFromThumbs } from "./frames.js";
import { StyleService, type RecordLookInput } from "./service.js";

function warnStyle(projectId: string, kind: "frame hash" | "record look", error: unknown): void {
  const raw = error instanceof Error ? error.message : "unknown";
  const message = raw.split("\n")[0]?.slice(0, 300) ?? "unknown";
  console.warn(`[style] ${kind} failed projectId=${projectId} ${message}`);
}

/** A thrown record must not fail the render. Same shape as `recheckOriginalitySafely`. */
export async function recordFinishedLookSafely(
  sqlite: Database.Database,
  input: Omit<RecordLookInput, "frameHashes"> & { thumbsDir: string; thumbnailIds: string[] },
  now?: () => Date,
): Promise<void> {
  let frameHashes: string[] = [];
  try {
    frameHashes = await frameHashesFromThumbs(input.thumbsDir, input.thumbnailIds);
  } catch (error) {
    warnStyle(input.projectId, "frame hash", error);
  }
  try {
    new StyleService(sqlite, now).recordLook({ ...input, frameHashes });
  } catch (error) {
    warnStyle(input.projectId, "record look", error);
  }
}
