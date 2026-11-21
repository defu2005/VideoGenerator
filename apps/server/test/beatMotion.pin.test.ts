import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineService } from "../src/services/timelineService.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

// TASK-146 slice 3 server pin: a project with NO beat data keeps today's camera-motion cycle,
// and the stored timeline JSON never gains a `beat` key. Must stay green with zero source edits.

type Harness = ReturnType<typeof createPipelineHarness>;
const harnesses: Harness[] = [];
const EXPECTED_CYCLE = ["push_in", "pan_left", "pull_out", "pan_right", "static", "pan_up", "push_in"];

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

function addScene(harness: Harness, order: number): string {
  const id = randomUUID();
  harness.sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, no_visual, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, ?, '', 0, ?, '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'test', ?, ?)`,
  ).run(id, harness.projectId, order, `Scene ${order + 1}`, `Narration ${order}.`,
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

describe("TASK-146 slice 3 server pin: motion without beat data", () => {
  it("a project with no beat data builds the camera-motion cycle and stores no beat key", () => {
    const harness = makeHarness();
    for (let order = 0; order < EXPECTED_CYCLE.length; order += 1) {
      const sceneId = addScene(harness, order);
      addVoice(harness, sceneId);
    }

    const built = new TimelineService(harness.sqlite, harness.config).build(harness.repository.getProject(harness.projectId)!);
    expect(built.timeline.scenes.map((scene) => scene.visuals[0]?.motionPreset)).toEqual(EXPECTED_CYCLE);
    expect(JSON.stringify(built.timeline)).not.toContain('"beat"');
  });
});
