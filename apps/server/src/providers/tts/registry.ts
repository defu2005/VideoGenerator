import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import {
  audioExtensionFor,
  cuesFromWords,
  fallbackChain,
  resolveVoiceSelection,
  runProviderFallback,
  spreadSentence,
  ttsCatalogEntry,
  ttsCostUsd,
  ttsPricePerMillion,
  buildElevenSubscriptionRequest,
  parseElevenSubscription,
  type JobUsage,
  type Project,
  type TtsAppSettings,
} from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { defaultVoiceFor } from "../../lib/defaultVoice.js";
import { probeDurationSec } from "../../media/ffmpeg.js";
import { StageError } from "../../pipeline/stageExecutor.js";
import type { TokenVault } from "../../publishing/tokenVault.js";
import { getSpeechToTextSettings, transcribeWithSpeechCli } from "../../settings/speechToText.js";
import { readTtsSettings, ttsSecretKey } from "../../settings/tts.js";
import { detectSilenceLog, ensureWordTimings, speechRecognitionEnabled } from "./align.js";
import { synthesizeChunked } from "./chunk.js";
import { sendHttp } from "./http.js";
import type { TtsContext } from "./context.js";
import { emptyTtsSettings } from "./context.js";
import { EdgeTtsProvider } from "./edgeTts.js";
import { ElevenLabsTtsProvider } from "./elevenLabsTts.js";
import { FptAiTtsProvider } from "./fptAiTts.js";
import { GeminiTtsProvider } from "./geminiTts.js";
import { GoogleCloudTtsProvider } from "./googleCloudTts.js";
import { MockTtsProvider } from "./mockTts.js";
import { OpenAiTtsProvider } from "./openaiTts.js";
import { PiperTtsProvider } from "./piperTts.js";
import type { TtsProvider, TtsSynthesisResult, TtsVoice } from "./types.js";
import { ViettelAiTtsProvider } from "./viettelAiTts.js";
import { VieNeuTtsProvider } from "./vieneuTts.js";

export type VoicePlan = {
  provider: string;
  voice?: string;
  rate: string;
  model?: string;
  style?: string;
  blockedPaid: boolean;
  wordTimings: boolean;
};

export class TtsProviderRegistry {
  private readonly providers = new Map<string, TtsProvider>();
  private vault: TokenVault | null = null;
  private sqlite: Database.Database | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly spawnProcess: typeof spawn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly ctx: TtsContext;

  constructor(
    private readonly config: AppConfig,
    deps?: {
      vault?: TokenVault;
      sqlite?: Database.Database;
      fetchImpl?: typeof fetch;
      spawnProcess?: typeof spawn;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.fetchImpl = deps?.fetchImpl ?? fetch;
    this.spawnProcess = deps?.spawnProcess ?? spawn;
    this.sleep = deps?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.vault = deps?.vault ?? null;
    this.sqlite = deps?.sqlite ?? null;
    this.ctx = {
      config,
      secret: (id) => this.vault?.loadSecret(ttsSecretKey(id)) ?? null,
      fetchImpl: this.fetchImpl,
      spawnProcess: this.spawnProcess,
      sleep: this.sleep,
      settings: () => this.readSettings(),
      probeDuration: probeDurationSec,
    };
    this.install();
  }

  bind(vault: TokenVault, sqlite: Database.Database): void {
    this.vault = vault;
    this.sqlite = sqlite;
  }

  get(id: string): TtsProvider | undefined {
    return this.providers.get(id);
  }

  resolve(): TtsProvider {
    const id = this.readSettings().defaultProvider || this.config.TTS_PROVIDER;
    return this.providers.get(id) ?? this.providers.get(this.config.TTS_PROVIDER) ?? this.providers.get("mock")!;
  }

  readSettings(): TtsAppSettings {
    if (!this.sqlite) return emptyTtsSettings(this.config.TTS_PROVIDER);
    return readTtsSettings(this.sqlite, this.config.TTS_PROVIDER);
  }

  configured(id: string): boolean {
    return this.providers.get(id)?.isAvailable() ?? false;
  }

  planVoice(project: Project): VoicePlan {
    const settings = this.readSettings();
    const selection = resolveVoiceSelection({
      project: project.settings.voice,
      profile: this.profileVoice(project.profileId),
      appProvider: settings.defaultProvider || this.config.TTS_PROVIDER,
      appVoice: settings.defaultVoice,
      appRate: settings.defaultRate || this.config.TTS_RATE,
      budgetMode: project.settings.budget.mode,
      edgeAvailable: this.providers.get("edge-tts")?.isAvailable() ?? false,
      piperAvailable: this.providers.get("piper")?.isAvailable() ?? false,
    });
    return {
      ...selection,
      wordTimings: ttsCatalogEntry(selection.provider)?.wordTimings === true,
    };
  }

  async listVoices(providerId?: string): Promise<TtsVoice[]> {
    const provider = providerId ? this.providers.get(providerId) : this.resolve();
    return provider ? provider.listVoices() : [];
  }

  async synthesizeTracked(input: {
    project: Project;
    text: string;
    outPath: string;
    signal?: AbortSignal;
    voice?: string;
    rate?: string;
    onUsage?: (usage: Partial<JobUsage>) => void;
  }): Promise<TtsSynthesisResult & { providerId: string; voice: string; rate: string; audioPath: string }> {
    const plan = this.planVoice(input.project);
    const settings = this.readSettings();
    return this.runChain({
      chain: fallbackChain(plan.provider, settings.defaultProvider || this.config.TTS_PROVIDER),
      text: input.text,
      language: input.project.settings.language,
      outPath: input.outPath,
      signal: input.signal,
      voice: input.voice || plan.voice || "",
      rate: input.rate || plan.rate,
      model: plan.model,
      style: plan.style,
      pinnedProvider: plan.provider,
      onUsage: input.onUsage,
    });
  }

  async synthesizePreview(input: {
    providerId: string;
    voice: string;
    text: string;
    rate?: string;
    style?: string;
    outPath: string;
    signal?: AbortSignal;
    language?: string;
  }): Promise<TtsSynthesisResult & { providerId: string; voice: string; rate: string; audioPath: string }> {
    const settings = this.readSettings();
    return this.runChain({
      chain: fallbackChain(input.providerId, settings.defaultProvider || this.config.TTS_PROVIDER),
      text: input.text,
      language: input.language || "vi",
      outPath: input.outPath,
      signal: input.signal,
      voice: input.voice,
      rate: input.rate || settings.defaultRate || "+0%",
      style: input.style,
      pinnedProvider: input.providerId,
    });
  }

  samplePath(providerId: string, voice: string, text: string, rate: string): { hash: string; path: string } {
    const hash = createHash("sha256").update(`${providerId}\u0000${voice}\u0000${rate}\u0000${text}`).digest("hex");
    const path = join(this.config.DATA_DIR, "tts-samples", `${hash}.${audioExtensionFor(providerId)}`);
    return { hash, path };
  }

  private async runChain(input: {
    chain: string[];
    text: string;
    language: string;
    outPath: string;
    signal?: AbortSignal;
    voice: string;
    rate: string;
    model?: string;
    style?: string;
    pinnedProvider: string;
    onUsage?: (usage: Partial<JobUsage>) => void;
  }): Promise<TtsSynthesisResult & { providerId: string; voice: string; rate: string; audioPath: string }> {
    try {
      const chosen = await runProviderFallback({
        chain: input.chain,
        isAvailable: (id) => this.providers.get(id)?.isAvailable() ?? false,
        run: async (id) => {
          const provider = this.providers.get(id);
          if (!provider) throw new Error(`Thiếu nhà cung cấp ${id}.`);
          const voices = await provider.listVoices();
          const voice = input.voice || defaultVoiceFor(input.language, voices, this.config);
          const ext = audioExtensionFor(id);
          const target = input.outPath.replace(/\.[^.]+$/, `.${ext}`);
          mkdirSync(dirname(target), { recursive: true });
          const spoken = await synthesizeChunked({
            text: input.text,
            language: input.language,
            maxChars: provider.capabilities.maxCharsPerRequest,
            outPath: target,
            synthesizePart: async (text, outPath) => {
              const part = await provider.synthesize({
                text,
                voice,
                rate: input.rate,
                outPath,
                signal: input.signal,
                model: id === input.pinnedProvider ? input.model : undefined,
                style: id === input.pinnedProvider ? input.style : undefined,
              });
              const timed = await ensureWordTimings({
                text,
                language: input.language,
                audioPath: outPath,
                durationSec: part.durationSec,
                words: part.words,
                timingSource: part.timingSource,
                recognize: this.recognizer(input.language),
                detectSilence: (path) => detectSilenceLog(path, input.signal),
              });
              return { ...part, words: timed.words, cues: timed.cues, timingSource: timed.timingSource, characters: text.length };
            },
          });
          return { spoken, voice, audioPath: target, providerId: id };
        },
      });
      const characters = input.text.length;
      const settings = this.readSettings();
      const costUsd = ttsCostUsd(characters, ttsPricePerMillion(chosen.id, settings.pricesPerMillion));
      input.onUsage?.({
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd,
        calls: [{
          task: "tts",
          provider: chosen.id,
          model: chosen.value.voice || ttsCatalogEntry(chosen.id)?.defaultModel || chosen.id,
          inputTokens: 0,
          outputTokens: 0,
          cached: false,
          fallback: chosen.id !== input.pinnedProvider,
          ok: true,
          characters,
          costUsd,
        }],
      });
      const words = chosen.value.spoken.words;
      return {
        ...chosen.value.spoken,
        cues: words && words.length > 0 ? cuesFromWords(words) : chosen.value.spoken.cues,
        costUsd,
        characters,
        providerId: chosen.id,
        voice: chosen.value.voice,
        rate: input.rate,
        audioPath: chosen.value.audioPath,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : "Không tạo được giọng đọc.";
      throw new StageError(message, "TTS_FAILED", true);
    }
  }

  findSample(hash: string): string | undefined {
    const folder = join(this.config.DATA_DIR, "tts-samples");
    for (const extension of ["mp3", "wav"]) {
      const path = join(folder, `${hash}.${extension}`);
      if (existsSync(path) && statSync(path).size > 0) return path;
    }
    return undefined;
  }

  private profileVoice(profileId: string | null | undefined): { provider?: string; voice?: string; rate?: string; model?: string; style?: string } | null {
    if (!this.sqlite || !profileId) return null;
    const row = this.sqlite.prepare("SELECT voice FROM profiles WHERE id = ?").get(profileId) as { voice: string | null } | undefined;
    if (!row?.voice) return null;
    try {
      const parsed = typeof row.voice === "string" ? JSON.parse(row.voice) as unknown : row.voice;
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as { provider?: string; voice?: string; rate?: string; model?: string; style?: string };
    } catch {
      return null;
    }
  }

  async elevenSubscription(): Promise<{ charactersUsed: number; characterLimit: number } | undefined> {
    const key = this.vault?.loadSecret(ttsSecretKey("elevenlabs"));
    if (!key) return undefined;
    try {
      const response = await sendHttp(this.ctx, buildElevenSubscriptionRequest(key), undefined, [key]);
      return parseElevenSubscription(JSON.parse(response.text) as unknown) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private recognizer(language: string): ((audioPath: string) => Promise<Array<{ startSec: number; endSec: number; text: string }>>) | undefined {
    if (!this.sqlite) return undefined;
    const settings = getSpeechToTextSettings(this.sqlite);
    if (!speechRecognitionEnabled(settings)) return undefined;
    return async (audioPath) => {
      const sentences = await transcribeWithSpeechCli(settings, audioPath, dirname(audioPath));
      return sentences.flatMap((sentence) => spreadSentence(sentence.text, sentence.start, sentence.end, language));
    };
  }

  private install(): void {
    const edge = new EdgeTtsProvider(this.config.EDGE_TTS_PATH ?? null, this.config.TTS_TIMEOUT_MS, {
      spawnProcess: this.spawnProcess,
      probeDuration: probeDurationSec,
      sleep: this.sleep,
    });
    const providers: TtsProvider[] = [
      edge,
      new MockTtsProvider(),
      new GoogleCloudTtsProvider(this.ctx),
      new GeminiTtsProvider(this.ctx),
      new ElevenLabsTtsProvider(this.ctx),
      new OpenAiTtsProvider(this.ctx),
      new FptAiTtsProvider(this.ctx),
      new ViettelAiTtsProvider(this.ctx),
      new PiperTtsProvider(this.ctx),
      new VieNeuTtsProvider(this.ctx),
    ];
    for (const provider of providers) this.providers.set(provider.id, provider);
  }
}
