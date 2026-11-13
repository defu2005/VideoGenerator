import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { Project } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { projectDir } from "../../storage/paths.js";
import type { TtsProviderRegistry } from "../../providers/tts/registry.js";
import type { TtsCue, TtsTimingSource, TtsWord } from "../../providers/tts/types.js";
import { defaultVoiceFor } from "../../lib/defaultVoice.js";
import { marketVoiceLocale } from "@vg/shared";
import { resolveMarket } from "../../knowledge/markets.js";

function formatDuration(totalSeconds: number): string {
  const roundedSeconds = Math.round(totalSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function inputHash(text: string, voice: string, rate: string, provider: string, model = "", style = ""): string {
  return createHash("sha256").update(`${text}\u0000${voice}\u0000${rate}\u0000${provider}\u0000${model}\u0000${style}`).digest("hex");
}

function narrationHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** One scene a worker node is asked to synthesize (TASK-120). */
export type VoiceWorkScene = { sceneId: string; hash: string; text: string };

/** The plan the control plane made for a VOICE job, plus the scenes that still need audio. */
export type VoiceWork = {
  provider: string;
  voice: string;
  rate: string;
  model?: string;
  style?: string;
  wordTimings: boolean;
  language: string;
  scenes: VoiceWorkScene[];
};

/** What a node made for one scene. `audioPath` is a verified file on the control plane. */
export type RemoteVoiceScene = {
  hash: string;
  audioPath: string;
  provider: string;
  voice: string;
  rate: string;
  durationSec: number;
  cues: TtsCue[];
  words?: TtsWord[];
  timingSource: TtsTimingSource;
  characters: number;
  costUsd?: number;
};

type Mode =
  | { kind: "local" }
  | { kind: "collect"; out: VoiceWork[] }
  | { kind: "remote"; results: Map<string, RemoteVoiceScene> };

export class VoiceExecutor implements StageExecutor {
  readonly stage = "VOICE" as const;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly providers: TtsProviderRegistry,
    private readonly config: AppConfig,
  ) {}

  async run(context: StageContext) {
    return this.execute(context, { kind: "local" });
  }

  /**
   * A dry run: decide which scenes need new audio and with what voice, without writing anything.
   * Used to build the bundle of a remote VOICE job.
   */
  async collectWork(project: Project, logger: StageContext["logger"]): Promise<VoiceWork> {
    const out: VoiceWork[] = [];
    const quiet = {
      project,
      signal: new AbortController().signal,
      reportProgress: () => undefined,
      recordUsage: () => undefined,
      logger,
    } as unknown as StageContext;
    await this.execute(quiet, { kind: "collect", out });
    return out[0]!;
  }

  /** The normal run, but scenes a node already synthesized (found by input hash) use the node's audio. Missing ones fall back to local synthesis. */
  async runWithRemote(context: StageContext, results: Map<string, RemoteVoiceScene>) {
    return this.execute(context, { kind: "remote", results });
  }

  private async execute(context: StageContext, mode: Mode) {
    const project = context.project;
    const planner = this.providers as TtsProviderRegistry;
    const plan = typeof planner.planVoice === "function" ? planner.planVoice(project) : null;
    const provider = plan ? (this.providers.get(plan.provider) ?? this.providers.resolve()) : this.providers.resolve();
    const voices = typeof provider.listVoices === "function"
      ? await provider.listVoices()
      : (typeof this.providers.listVoices === "function" ? await this.providers.listVoices() : []);
    const market = resolveMarket(this.sqlite, project.settings.market);
    const locale = marketVoiceLocale(market?.pack ?? null, project.settings.language);
    const voice = (plan ? plan.voice : project.settings.voice?.voice)
      || defaultVoiceFor(locale, voices, this.config, (message) => context.logger.warn(message), market !== null);
    const rate = plan?.rate || project.settings.voice?.rate || this.config.TTS_RATE;
    const plannedProvider = plan?.provider || provider.id;
    const scenes = this.sqlite.prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY \"order\" ASC").all(project.id) as Array<{ id: string; narration: string; order: number; label: string }>;
    const projectRoot = projectDir(this.config.DATA_DIR, project.id);
    const voiceDir = join(projectRoot, "voice");
    if (mode.kind !== "collect") mkdirSync(voiceDir, { recursive: true });

    const allExisting = this.sqlite.prepare("SELECT * FROM voice_tracks WHERE project_id = ?").all(project.id) as Array<{
      id: string;
      scene_id: string;
      provider: string;
      audio_path: string;
      duration_sec: number;
      input_hash: string;
      narration_hash: string;
      origin: "AGENT" | "USER";
    }>;
    const existingByScene = new Map(allExisting.map((track) => [track.scene_id, track]));
    const narratedSceneIds = new Set<string>();
    const pendingScenes: VoiceWorkScene[] = [];
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
      const hash = inputHash(narrative, voice, rate, plannedProvider, plan?.model ?? "", plan?.style ?? "");
      const currentNarrationHash = narrationHash(narrative);
      const existing = existingByScene.get(scene.id);
      const canReuse = existing
        && existing.input_hash === hash
        && existing.provider === plannedProvider
        && existing.audio_path
        && existsSync(existing.audio_path);
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
      if (mode.kind === "collect") {
        pendingScenes.push({ sceneId: scene.id, hash, text: narrative });
        continue;
      }
      if (existing?.origin === "USER" && existing.narration_hash !== currentNarrationHash) userNarrationChanged += 1;
      const fileName = `${scene.id}-${hash.slice(0, 8)}.${plannedProvider === "mock" ? "wav" : "mp3"}`;
      const outPath = join(voiceDir, fileName);
      const remote = mode.kind === "remote" ? mode.results.get(hash) : undefined;
      let synthesized: { durationSec: number; cues: TtsCue[]; words?: TtsWord[]; timingSource?: TtsTimingSource };
      let usedProvider: string;
      let usedVoice: string;
      let usedRate: string;
      let audioPath: string;
      if (remote) {
        copyFileSync(remote.audioPath, outPath);
        synthesized = remote;
        usedProvider = remote.provider;
        usedVoice = remote.voice;
        usedRate = remote.rate;
        audioPath = outPath;
        if (remote.costUsd) {
          context.recordUsage({
            llmCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: remote.costUsd,
            calls: [{ task: "tts", provider: remote.provider, model: remote.voice || remote.provider, inputTokens: 0, outputTokens: 0, costUsd: remote.costUsd, characters: remote.characters }],
          } as never);
        }
      } else {
        const tracked = typeof planner.synthesizeTracked === "function"
          ? await planner.synthesizeTracked({
            project,
            text: narrative,
            outPath,
            signal: context.signal,
            voice,
            rate,
            onUsage: (usage) => context.recordUsage(usage),
          })
          : null;
        synthesized = tracked ?? await provider.synthesize({ text: narrative, voice, rate, outPath, signal: context.signal });
        usedProvider = tracked?.providerId ?? provider.id;
        usedVoice = tracked?.voice ?? voice;
        usedRate = tracked?.rate ?? rate;
        audioPath = tracked?.audioPath ?? outPath;
      }
      const now = new Date().toISOString();
      if (existing && existing.audio_path && existsSync(existing.audio_path) && existing.audio_path !== audioPath) {
        rmSync(existing.audio_path, { force: true });
      }
      this.sqlite.prepare(
        `INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec, cues, words, timing_source, input_hash, narration_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scene_id) DO UPDATE SET
          provider = excluded.provider,
          voice = excluded.voice,
          rate = excluded.rate,
          origin = excluded.origin,
          audio_path = excluded.audio_path,
          duration_sec = excluded.duration_sec,
          cues = excluded.cues,
          words = excluded.words,
          timing_source = excluded.timing_source,
          input_hash = excluded.input_hash,
          narration_hash = excluded.narration_hash,
          updated_at = excluded.updated_at`,
      ).run(
        randomUUID(),
        project.id,
        scene.id,
        usedProvider,
        usedVoice,
        usedRate,
        "AGENT",
        audioPath,
        synthesized.durationSec,
        JSON.stringify(synthesized.cues),
        JSON.stringify(synthesized.words ?? []),
        synthesized.timingSource ?? "estimated",
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

    if (mode.kind === "collect") {
      mode.out.push({
        provider: plannedProvider,
        voice,
        rate,
        ...(plan?.model ? { model: plan.model } : {}),
        ...(plan?.style ? { style: plan.style } : {}),
        wordTimings: plan?.wordTimings === true,
        language: project.settings.language,
        scenes: pendingScenes,
      });
      return { message: "", outputHash: "" };
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
