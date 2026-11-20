import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { TimelineSchema, type Project, type Timeline } from "@vg/shared";
import { runtimeSettings } from "../pipeline/inputVersion.js";

/**
 * Sidecar next to compose-plan.json. It records the fingerprint of every input that decided the plan,
 * so preview can tell whether a saved plan still matches the current timeline (TASK-139).
 */
export const PLAN_INPUTS_FILE = "compose-plan.inputs.json";
const VERSION = 1;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = sortKeys(item);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * Hashes everything that feeds the compose plan: the timeline (its target carries the aspect),
 * the project settings, the scene texts and the voice tracks. Rows are sorted so the order of
 * SQLite results does not change the hash. A change to any of them changes the fingerprint.
 * Runtime-only settings (stage timeouts, knowledge revision, ...) are left out: the executors write
 * them during a run and the planner never reads them, so they must not force a rebuild.
 * The rest of the settings are hashed whole, so an unrelated planner-visible setting rebuilds the plan; that is the safe side.
 */
export function composeInputFingerprint(sqlite: Database.Database, project: Project, timeline: Timeline): string {
  const parsed = TimelineSchema.safeParse(timeline);
  const tl = parsed.success ? parsed.data : timeline;
  const scenes = sqlite.prepare("SELECT id, narration, visual_queries AS visualQueries FROM scenes WHERE project_id = ? ORDER BY id")
    .all(project.id);
  const voices = sqlite.prepare("SELECT scene_id AS sceneId, words, cues, timing_source AS timingSource FROM voice_tracks WHERE project_id = ? ORDER BY scene_id")
    .all(project.id);
  const planSettings = Object.fromEntries(Object.entries(project.settings).filter(([field]) => !runtimeSettings.has(field)));
  const payload = { v: VERSION, timeline: tl, settings: planSettings, scenes, voices };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function writePlanInputs(renderDir: string, fingerprint: string): void {
  mkdirSync(renderDir, { recursive: true });
  writeFileSync(join(renderDir, PLAN_INPUTS_FILE), JSON.stringify({ v: VERSION, fingerprint }));
}

/** Returns the stored fingerprint, or null when the sidecar is missing, unreadable or another version. */
export function readPlanInputs(renderDir: string): string | null {
  const path = join(renderDir, PLAN_INPUTS_FILE);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { v?: unknown; fingerprint?: unknown };
    return data.v === VERSION && typeof data.fingerprint === "string" ? data.fingerprint : null;
  } catch {
    return null;
  }
}

/** Removes the sidecar before a plan is rewritten, so a crash between the two writes leaves no stale fingerprint. */
export function clearPlanInputs(renderDir: string): void {
  const path = join(renderDir, PLAN_INPUTS_FILE);
  if (existsSync(path)) unlinkSync(path);
}
