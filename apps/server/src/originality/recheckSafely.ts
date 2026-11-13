import type Database from "better-sqlite3";
import type { ComposePlan, OriginalityReport } from "@vg/shared";
import { OriginalityService } from "./service.js";

/** Informs the user only. A thrown check must not fail timeline, render, or code guidelines. */
export function recheckOriginalitySafely(
  sqlite: Database.Database,
  projectId: string,
  render?: { id: string; plan: ComposePlan | null },
): OriginalityReport | null {
  try {
    return new OriginalityService(sqlite).recheck(projectId, render);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "unknown";
    const message = raw.split("\n")[0]?.slice(0, 300) ?? "unknown";
    console.warn(`[originality] recheck failed projectId=${projectId} ${message}`);
    return null;
  }
}
