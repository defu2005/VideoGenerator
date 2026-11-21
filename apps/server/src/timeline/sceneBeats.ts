import type Database from "better-sqlite3";
import { BeatPurposeSchema, type BeatMark } from "@vg/shared";

export type SectionVisualBeat = { visualIntent?: string; beatPurpose?: BeatMark["purpose"] };

/**
 * TASK-146 slice 2 commit B: visualIntent and beatPurpose per script section id. Invalid purposes and blank
 * intents are dropped. Hook and outro scenes have no section id, so they get nothing. A translated child's
 * section_id holds the parent scene id, which matches no section in the child script, so it gets nothing too.
 */
export function sectionVisualBeats(sqlite: Database.Database, projectId: string): Map<string, SectionVisualBeat> {
  const beats = new Map<string, SectionVisualBeat>();
  const script = sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(projectId) as { data: string } | undefined;
  if (!script) return beats;
  const parsed = JSON.parse(script.data) as { sections?: Array<{ id?: string; beatPurpose?: unknown; visualIntent?: unknown }> };
  for (const section of parsed.sections ?? []) {
    if (!section.id) continue;
    const beat: SectionVisualBeat = {};
    const intent = typeof section.visualIntent === "string" ? section.visualIntent.trim() : "";
    if (intent) beat.visualIntent = intent;
    const purpose = BeatPurposeSchema.safeParse(section.beatPurpose);
    if (purpose.success) beat.beatPurpose = purpose.data;
    if (beat.visualIntent || beat.beatPurpose) beats.set(section.id, beat);
  }
  return beats;
}

export function sceneVisualBeat(beats: Map<string, SectionVisualBeat>, sectionId: string | null): SectionVisualBeat | undefined {
  return sectionId ? beats.get(sectionId) : undefined;
}

/**
 * Beat per scene from its script section's beatPurpose. Only the section's first scene starts the beat.
 * Used for the parent project only. Translated children have no beat source of their own: their
 * section_id holds the parent scene id, so the translation service resolves beats through the parent.
 */
export function sceneBeatMarks(
  sqlite: Database.Database,
  projectId: string,
  scenes: Array<{ id: string; section_id: string | null }>,
): Map<string, BeatMark> {
  const script = sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(projectId) as { data: string } | undefined;
  const purposeBySection = new Map<string, BeatMark["purpose"]>();
  if (script) {
    const parsed = JSON.parse(script.data) as { sections?: Array<{ id?: string; beatPurpose?: unknown }> };
    for (const section of parsed.sections ?? []) {
      const purpose = BeatPurposeSchema.safeParse(section.beatPurpose);
      if (section.id && purpose.success) purposeBySection.set(section.id, purpose.data);
    }
  }
  const firstScene = new Map<string, string>();
  for (const scene of scenes) {
    if (scene.section_id && !firstScene.has(scene.section_id)) firstScene.set(scene.section_id, scene.id);
  }
  const beats = new Map<string, BeatMark>();
  for (const scene of scenes) {
    const sectionId = scene.section_id;
    const purpose = sectionId ? purposeBySection.get(sectionId) : undefined;
    if (sectionId && purpose) beats.set(scene.id, { purpose, start: firstScene.get(sectionId) === scene.id });
  }
  return beats;
}
