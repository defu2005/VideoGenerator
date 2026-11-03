import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubtitleExecutor } from "../src/stages/subtitle/subtitleExecutor.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];

function makeHarness() {
  const harness = createPipelineHarness();
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

function addScene(harness: ReturnType<typeof createPipelineHarness>, text: string, order: number): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  harness.sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, ?, '', ?, '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'test', ?, ?)`,
  ).run(id, harness.projectId, order, `Scene ${order + 1}`, text, JSON.stringify({ primary: "", alternatives: [], queryVariant: false }), now, now);
  return id;
}

function addTrack(
  harness: ReturnType<typeof createPipelineHarness>,
  sceneId: string,
  durationSec: number,
  cues: Array<{ startSec: number; endSec: number; text: string }>,
  origin: "AGENT" | "USER" = "AGENT",
): void {
  const now = new Date().toISOString();
  harness.sqlite.prepare(
    `INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec,
      cues, input_hash, narration_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'mock', 'test-voice', '+0%', ?, 'mock.wav', ?, ?, 'voice-hash', 'narration-hash', ?, ?)`,
  ).run(randomUUID(), harness.projectId, sceneId, origin, durationSec, JSON.stringify(cues), now, now);
}

function setup(harness: ReturnType<typeof createPipelineHarness>) {
  const executor = new SubtitleExecutor(harness.sqlite, harness.config);
  const job = harness.repository.createJob({
    projectId: harness.projectId,
    stage: "SUBTITLE",
    maxAttempts: 1,
    previousState: "PENDING",
  });
  const context = {
    project: harness.repository.getProject(harness.projectId)!,
    job,
    signal: new AbortController().signal,
    reportProgress: vi.fn(),
    recordUsage: vi.fn(),
    logger: Fastify({ logger: { level: "silent" } }).log,
  };
  return { executor, context };
}

function srtCues(path: string) {
  return readFileSync(path, "utf8").trim().split(/\r?\n\r?\n/).map((block) => {
    const lines = block.split(/\r?\n/);
    const [start, end] = lines[1].split(" --> ");
    const toSeconds = (time: string) => {
      const [hours, minutes, seconds] = time.replace(",", ".").split(":");
      return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    };
    return { startSec: toSeconds(start), endSec: toSeconds(end), text: lines.slice(2).join("\n") };
  });
}

describe("SubtitleExecutor", () => {
  it("builds cues for two scenes and writes SRT and ASS", async () => {
    const harness = makeHarness();
    const first = addScene(harness, "First scene narration.", 0);
    const second = addScene(harness, "Second scene narration.", 1);
    addTrack(harness, first, 3, [{ startSec: 0, endSec: 3, text: "First scene narration." }]);
    addTrack(harness, second, 4, [{ startSec: 0, endSec: 4, text: "Second scene narration." }]);
    const { executor, context } = setup(harness);

    await executor.run(context);

    const row = harness.sqlite.prepare("SELECT cues, srt_path, ass_path FROM subtitle_tracks WHERE project_id = ?").get(harness.projectId) as {
      cues: string; srt_path: string; ass_path: string;
    };
    expect(JSON.parse(row.cues)).toHaveLength(2);
    expect(readFileSync(row.srt_path, "utf8")).toContain("First scene narration.");
    expect(readFileSync(row.ass_path, "utf8")).toContain("Dialogue:");
  });

  it("reuses generated files without changing their modification time", async () => {
    const harness = makeHarness();
    const scene = addScene(harness, "Stable narration.", 0);
    addTrack(harness, scene, 4, [{ startSec: 0, endSec: 4, text: "Stable narration." }]);
    const { executor, context } = setup(harness);
    await executor.run(context);
    const row = harness.sqlite.prepare("SELECT srt_path, ass_path FROM subtitle_tracks WHERE project_id = ?").get(harness.projectId) as {
      srt_path: string; ass_path: string;
    };
    const before = [statSync(row.srt_path).mtimeMs, statSync(row.ass_path).mtimeMs];

    await executor.run(context);

    expect([statSync(row.srt_path).mtimeMs, statSync(row.ass_path).mtimeMs]).toEqual(before);
  });

  it("reports missing voice tracks with the stage error message", async () => {
    const harness = makeHarness();
    addScene(harness, "Narration without voice.", 0);
    const { executor, context } = setup(harness);

    await expect(executor.run(context)).rejects.toMatchObject({
      message: "Thiếu giọng đọc cho 1 cảnh — chạy bước Giọng đọc trước",
      code: "VOICE_TRACK_MISSING",
    });
  });

  it("creates timed cues covering a USER voice track with no cues", async () => {
    const harness = makeHarness();
    const scene = addScene(harness, "An uploaded recording has no timing cues.", 0);
    addTrack(harness, scene, 8, [], "USER");
    const { executor, context } = setup(harness);

    await executor.run(context);

    const row = harness.sqlite.prepare("SELECT cues FROM subtitle_tracks WHERE project_id = ?").get(harness.projectId) as { cues: string };
    const cues = JSON.parse(row.cues) as Array<{ startSec: number; endSec: number; text: string }>;
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0].startSec).toBe(0);
    expect(cues.at(-1)?.endSec).toBe(8);
    expect(cues.map((cue) => cue.text).join(" ")).toContain("An uploaded recording has no timing cues.");
  });

  it("starts the first SRT cue in scene two at scene one's duration", async () => {
    const harness = makeHarness();
    const first = addScene(harness, "Scene one.", 0);
    const second = addScene(harness, "Scene two.", 1);
    addTrack(harness, first, 3, [{ startSec: 0, endSec: 3, text: "Scene one." }]);
    addTrack(harness, second, 4, [{ startSec: 0, endSec: 4, text: "Scene two." }]);
    const { executor, context } = setup(harness);
    await executor.run(context);

    const row = harness.sqlite.prepare("SELECT srt_path FROM subtitle_tracks WHERE project_id = ?").get(harness.projectId) as { srt_path: string };

    expect(srtCues(row.srt_path)[1].startSec).toBe(3);
  });

  it("writes subtitle cues without overlap", async () => {
    const harness = makeHarness();
    const first = addScene(harness, "Scene one.", 0);
    const second = addScene(harness, "Scene two.", 1);
    addTrack(harness, first, 3, [{ startSec: 0, endSec: 3.2, text: "Scene one." }]);
    addTrack(harness, second, 4, [{ startSec: 2.8, endSec: 4, text: "Scene two." }]);
    const { executor, context } = setup(harness);
    await executor.run(context);

    const row = harness.sqlite.prepare("SELECT srt_path FROM subtitle_tracks WHERE project_id = ?").get(harness.projectId) as { srt_path: string };
    const cues = srtCues(row.srt_path);
    expect(cues[0].endSec).toBeLessThanOrEqual(3);
    expect(cues[1].startSec).toBeGreaterThanOrEqual(cues[0].endSec);
  });

  it("wraps SRT cue text to at most two lines within the configured line width", async () => {
    const harness = makeHarness();
    const narration = "In the hyper-engineered universe of global pop, no group has scaled the heights quite like this.";
    const scene = addScene(harness, narration, 0);
    addTrack(harness, scene, 8, [{ startSec: 0, endSec: 8, text: narration }]);
    const { executor, context } = setup(harness);
    await executor.run(context);

    const row = harness.sqlite.prepare("SELECT srt_path, ass_path FROM subtitle_tracks WHERE project_id = ?").get(harness.projectId) as {
      srt_path: string; ass_path: string;
    };
    const maxCharsPerLine = context.project.settings.subtitles.maxCharsPerLine;
    for (const cue of srtCues(row.srt_path)) {
      const lines = cue.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      expect(lines.every((line) => line.length <= maxCharsPerLine)).toBe(true);
    }
    expect(readFileSync(row.ass_path, "utf8")).toContain("\\N");
    expect(readFileSync(row.ass_path, "utf8")).toContain("OutlineColour, BackColour");
    expect(readFileSync(row.ass_path, "utf8")).toContain("&H00000000");
  });
});
