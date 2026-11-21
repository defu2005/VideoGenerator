import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineService } from "../src/services/timelineService.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-146 slice 3: a script section with beatPurpose sets the camera move on the first scene of that beat.
// Scenes 0 and 1 share section "reveal" (punch_in at scene 0); scenes 2 and 3 have no section and keep the cycle.

type Harness = ReturnType<typeof createPipelineHarness>;
const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function makeHarness(): Harness {
  const harness = createPipelineHarness();
  harnesses.push(harness);
  const current = JSON.parse((harness.sqlite.prepare("SELECT settings FROM projects WHERE id = ?").get(harness.projectId) as { settings: string }).settings);
  harness.sqlite.prepare("UPDATE projects SET settings = ? WHERE id = ?").run(
    JSON.stringify({ ...current, subtitles: { enabled: false, maxCharsPerLine: 42 }, music: { enabled: false, volume: 0.1 } }),
    harness.projectId,
  );
  const dir = projectDir(harness.config.DATA_DIR, harness.projectId);
  mkdirSync(join(dir, "visuals"), { recursive: true });
  mkdirSync(join(dir, "music"), { recursive: true });
  return harness;
}

const now = () => new Date().toISOString();

function addScene(harness: Harness, order: number, sectionId: string | null): string {
  const id = randomUUID();
  harness.sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, no_visual, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', ?, ?, ?, '', 0, ?, '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'test', ?, ?)`,
  ).run(id, harness.projectId, order, sectionId, `Scene ${order + 1}`, `Narration ${order}.`,
    JSON.stringify({ primary: "", alternatives: [] }), now(), now());
  return id;
}

function addVoice(harness: Harness, sceneId: string): void {
  const path = join(projectDir(harness.config.DATA_DIR, harness.projectId), `voice-${sceneId}.mp3`);
  writeFileSync(path, "audio");
  harness.sqlite.prepare(
    `INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec,
      cues, input_hash, narration_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'mock', 'v', '+0%', 'AGENT', ?, 3, '[]', 'h', 'n', ?, ?)`,
  ).run(randomUUID(), harness.projectId, sceneId, path, now(), now());
}

function addScript(harness: Harness, sections: Array<{ id: string; sectionKey: string; beatPurpose?: string }>): void {
  harness.sqlite.prepare(
    `INSERT INTO scripts (project_id, data, origin, edited, input_hash, version, provider, model, updated_at, merged_call, review_notes)
     VALUES (?, ?, 'AGENT', 0, 'h', 1, 'mock', 'mock-v1', ?, 0, NULL)`,
  ).run(harness.projectId, JSON.stringify({ sections }), now());
}

describe("TASK-146 slice 3: beat purpose sets the camera move", () => {
  it("the first scene of a reveal section gets punch_in; the rest keep the cycle", () => {
    const harness = makeHarness();
    const revealId = "sec-reveal";
    addScript(harness, [{ id: revealId, sectionKey: "reveal", beatPurpose: "reveal" }]);
    const sceneIds = [
      addScene(harness, 0, revealId),
      addScene(harness, 1, revealId),
      addScene(harness, 2, null),
      addScene(harness, 3, null),
    ];
    for (const sceneId of sceneIds) addVoice(harness, sceneId);

    const built = new TimelineService(harness.sqlite, harness.config).build(harness.repository.getProject(harness.projectId)!);
    expect(built.timeline.scenes.map((scene) => scene.visuals[0]?.motionPreset)).toEqual(["punch_in", "pan_left", "pull_out", "pan_right"]);
    expect(built.timeline.scenes[0]?.beat).toEqual({ purpose: "reveal", start: true });
    expect(built.timeline.scenes[1]?.beat).toEqual({ purpose: "reveal", start: false });
    expect(built.timeline.scenes[2]?.beat).toBeUndefined();
  });
});
