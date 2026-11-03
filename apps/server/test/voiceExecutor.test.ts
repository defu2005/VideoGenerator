import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockTtsProvider } from "../src/providers/tts/mockTts.js";
import { VoiceExecutor } from "../src/stages/voice/voiceExecutor.js";
import { projectDir } from "../src/storage/paths.js";
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

function addScene(harness: ReturnType<typeof createPipelineHarness>, narration: string, order: number): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  harness.sqlite.prepare(
    `INSERT INTO scenes (id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_queries,
      music_mood, energy, est_duration_sec, duration_override_sec, start_sec, transition_note, origin, edited,
      input_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'section', NULL, ?, ?, '', ?, '', 'medium', 4, NULL, 0, '', 'AGENT', 0, 'test', ?, ?)`,
  ).run(id, harness.projectId, order, `Scene ${order + 1}`, narration, JSON.stringify({ primary: "", alternatives: [], queryVariant: false }), now, now);
  return id;
}

function setupExecutor(harness: ReturnType<typeof createPipelineHarness>) {
  const implementation = new MockTtsProvider();
  const provider = { ...implementation, synthesize: vi.fn(implementation.synthesize.bind(implementation)) };
  const registry = { resolve: () => provider } as ConstructorParameters<typeof VoiceExecutor>[1];
  const executor = new VoiceExecutor(harness.sqlite, registry, harness.config);
  const job = harness.repository.createJob({
    projectId: harness.projectId,
    stage: "VOICE",
    maxAttempts: 3,
    previousState: "PENDING",
  });
  const progress = vi.fn();
  const context = {
    project: harness.repository.getProject(harness.projectId)!,
    job,
    signal: new AbortController().signal,
    reportProgress: progress,
    recordUsage: () => undefined,
    logger: Fastify({ logger: { level: "silent" } }).log,
  };
  return { executor, provider, progress, context };
}

describe("VoiceExecutor", () => {
  it("creates tracks on the migrated database and reuses them without synthesis", async () => {
    const harness = makeHarness();
    const first = addScene(harness, "First narration.", 0);
    addScene(harness, "Second narration.", 1);
    addScene(harness, "   ", 2);
    const { executor, provider, progress, context } = setupExecutor(harness);

    const created = await executor.run(context);
    const outputHash = created.outputHash;
    expect(provider.synthesize).toHaveBeenCalledTimes(2);
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM voice_tracks").get()).toEqual({ count: 2 });
    expect(created.outputHash).toMatch(/^[a-f0-9]{64}$/);

    progress.mockClear();
    const reused = await executor.run(context);
    expect(provider.synthesize).toHaveBeenCalledTimes(2);
    expect(reused.outputHash).toBe(outputHash);
    expect(progress).toHaveBeenCalledTimes(3);

    harness.sqlite.prepare("UPDATE scenes SET narration = ? WHERE id = ?").run("Updated narration.", first);
    await executor.run(context);
    expect(provider.synthesize).toHaveBeenCalledTimes(3);
    expect(harness.sqlite.prepare("SELECT narration_hash FROM voice_tracks WHERE scene_id = ?").get(first)).toMatchObject({
      narration_hash: expect.any(String),
    });
  });

  it("keeps a USER recording when only voice changes, but regenerates it when narration changes", async () => {
    const harness = makeHarness();
    const sceneId = addScene(harness, "Narration stays the same.", 0);
    const { executor, provider, context } = setupExecutor(harness);
    await executor.run(context);
    harness.sqlite.prepare("UPDATE voice_tracks SET origin = 'USER' WHERE scene_id = ?").run(sceneId);
    const updatedProject = {
      ...context.project,
      settings: { ...context.project.settings, voice: { voice: "vi-VN-NamMinhNeural", rate: "+10%" } },
    };
    const contextWithNewVoice = { ...context, project: updatedProject };

    await executor.run(contextWithNewVoice);
    expect(provider.synthesize).toHaveBeenCalledTimes(1);
    expect(harness.sqlite.prepare("SELECT origin FROM voice_tracks WHERE scene_id = ?").get(sceneId)).toEqual({ origin: "USER" });

    harness.sqlite.prepare("UPDATE scenes SET narration = ? WHERE id = ?").run("Narration changed.", sceneId);
    const regenerated = await executor.run(contextWithNewVoice);
    expect(provider.synthesize).toHaveBeenCalledTimes(2);
    expect(harness.sqlite.prepare("SELECT origin FROM voice_tracks WHERE scene_id = ?").get(sceneId)).toEqual({ origin: "AGENT" });
    expect(regenerated.message).toContain("· 1 giọng của bạn được tạo lại vì lời thoại đổi");
  });

  it("removes tracks and audio files when a deleted scene leaves a stale track row", async () => {
    const harness = makeHarness();
    const sceneId = addScene(harness, "Narration.", 0);
    const { executor, context } = setupExecutor(harness);
    await executor.run(context);
    const audioPath = (harness.sqlite.prepare("SELECT audio_path FROM voice_tracks WHERE scene_id = ?").get(sceneId) as { audio_path: string }).audio_path;
    expect(existsSync(audioPath)).toBe(true);

    harness.sqlite.pragma("foreign_keys = OFF");
    harness.sqlite.prepare("DELETE FROM scenes WHERE id = ?").run(sceneId);
    await executor.run(context);

    expect(harness.sqlite.prepare("SELECT id FROM voice_tracks WHERE scene_id = ?").get(sceneId)).toBeUndefined();
    expect(existsSync(audioPath)).toBe(false);
  });
});
