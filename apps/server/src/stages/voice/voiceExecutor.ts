import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { projectDir } from "../../storage/paths.js";
import type { TtsProviderRegistry } from "../../providers/tts/registry.js";

function formatDuration(totalSeconds: number): string {
  const roundedSeconds = Math.round(totalSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function inputHash(text: string, voice: string, rate: string, provider: string): string {
  return createHash("sha256").update(`${text}\u0000${voice}\u0000${rate}\u0000${provider}`).digest("hex");
}

function narrationHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class VoiceExecutor implements StageExecutor {
  readonly stage = "VOICE" as const;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly providers: TtsProviderRegistry,
    private readonly config: AppConfig,
  ) {}

  async run(context: StageContext) {
    const project = context.project;
    const provider = this.providers.resolve();
    const voice = project.settings.voice?.voice || (project.settings.language.toLowerCase().startsWith("vi") ? this.config.TTS_VOICE_VI : this.config.TTS_VOICE_EN);
    const rate = project.settings.voice?.rate || this.config.TTS_RATE;
    const scenes = this.sqlite.prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY \"order\" ASC").all(project.id) as Array<{ id: string; narration: string; order: number; label: string }>;
    const projectRoot = projectDir(this.config.DATA_DIR, project.id);
    const voiceDir = join(projectRoot, "voice");
    mkdirSync(voiceDir, { recursive: true });

    const allExisting = this.sqlite.prepare("SELECT * FROM voice_tracks WHERE project_id = ?").all(project.id) as Array<{
      id: string;
      scene_id: string;
      audio_path: string;
      duration_sec: number;
      input_hash: string;
      narration_hash: string;
      origin: "AGENT" | "USER";
    }>;
    const existingByScene = new Map(allExisting.map((track) => [track.scene_id, track]));
    const narratedSceneIds = new Set<string>();
    let created = 0;
    let reused = 0;
    let totalDurationSec = 0;
    let userNarrationChanged = 0;
    const output = createHash("sha256");

    for (let i = 0; i < scenes.length; i += 1) {
      const scene = scenes[i];
      const narrative = scene.narration?.trim();
      if (!narrative) {
        context.reportProgress(Math.round(((i + 1) / Math.max(scenes.length, 1)) * 100), `Skipped scene ${i + 1}/${scenes.length}`);
        continue;
      }
      narratedSceneIds.add(scene.id);
      const hash = inputHash(narrative, voice, rate, provider.id);
      const currentNarrationHash = narrationHash(narrative);
      const existing = existingByScene.get(scene.id);
      const canReuse = existing && existing.input_hash === hash && existing.audio_path && existsSync(existing.audio_path);
      if (canReuse) {
        reused += 1;
        totalDurationSec += Number(existing.duration_sec ?? 0);
        output.update(`${scene.id}\u0000${existing.input_hash}\u0000`);
        context.reportProgress(Math.round(((i + 1) / Math.max(scenes.length, 1)) * 100), `Reusing scene ${i + 1}/${scenes.length}`);
        continue;
      }
      const currentTrack = existing && existing.origin === "USER" && existing.narration_hash === currentNarrationHash;
      if (currentTrack && existing.audio_path && existsSync(existing.audio_path)) {
        reused += 1;
        totalDurationSec += Number(existing.duration_sec ?? 0);
        output.update(`${scene.id}\u0000${existing.input_hash}\u0000`);
        context.reportProgress(Math.round(((i + 1) / Math.max(scenes.length, 1)) * 100), `Reusing your voice for scene ${i + 1}/${scenes.length}`);
        continue;
      }
      if (existing?.origin === "USER" && existing.narration_hash !== currentNarrationHash) userNarrationChanged += 1;
      const fileName = `${scene.id}-${hash.slice(0, 8)}.${provider.id === "mock" ? "wav" : "mp3"}`;
      const outPath = join(voiceDir, fileName);
      const synthesized = await provider.synthesize({ text: narrative, voice, rate, outPath, signal: context.signal });
      const now = new Date().toISOString();
      if (existing && existing.audio_path && existsSync(existing.audio_path) && existing.audio_path !== outPath) {
        rmSync(existing.audio_path, { force: true });
      }
      this.sqlite.prepare(
        `INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec, cues, input_hash, narration_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scene_id) DO UPDATE SET
          provider = excluded.provider,
          voice = excluded.voice,
          rate = excluded.rate,
          origin = excluded.origin,
          audio_path = excluded.audio_path,
          duration_sec = excluded.duration_sec,
          cues = excluded.cues,
          input_hash = excluded.input_hash,
          narration_hash = excluded.narration_hash,
          updated_at = excluded.updated_at`,
      ).run(
        randomUUID(),
        project.id,
        scene.id,
        provider.id,
        voice,
        rate,
        "AGENT",
        outPath,
        synthesized.durationSec,
        JSON.stringify(synthesized.cues),
        hash,
        currentNarrationHash,
        now,
        now,
      );
      created += 1;
      totalDurationSec += Number(synthesized.durationSec ?? 0);
      output.update(`${scene.id}\u0000${hash}\u0000`);
      context.reportProgress(Math.round(((i + 1) / Math.max(scenes.length, 1)) * 100), `Synthesizing scene ${i + 1}/${scenes.length}`);
    }

    for (const existing of allExisting) {
      if (!narratedSceneIds.has(existing.scene_id)) {
        if (existsSync(existing.audio_path)) rmSync(existing.audio_path, { force: true });
        this.sqlite.prepare("DELETE FROM voice_tracks WHERE id = ?").run(existing.id);
      }
    }

    const stageMessage = `${narratedSceneIds.size} cảnh · tổng ${formatDuration(totalDurationSec)} · ${created} tạo mới, ${reused} dùng lại${userNarrationChanged ? ` · ${userNarrationChanged} giọng của bạn được tạo lại vì lời thoại đổi` : ""}`;
    return { message: stageMessage, outputHash: output.digest("hex") };
  }
}
