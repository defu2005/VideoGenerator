import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  GOOGLE_STATIC_VI_VOICES,
  buildGoogleSynthesizeRequest,
  buildGoogleVoicesRequest,
  parseGoogleVoices,
  ttsCatalogEntry,
  wordsFromGoogleTimepoints,
  type TtsTimingSource,
} from "@vg/shared";
import type { TtsProvider, TtsSynthesisInput, TtsSynthesisResult, TtsVoice } from "./types.js";
import type { TtsContext } from "./context.js";
import { sendHttp } from "./http.js";

const entry = ttsCatalogEntry("google_cloud")!;

export class GoogleCloudTtsProvider implements TtsProvider {
  id = "google_cloud";
  label = entry.label;
  capabilities = {
    wordTimings: entry.wordTimings,
    ssml: entry.ssml,
    maxCharsPerRequest: entry.maxCharsPerRequest,
    languages: entry.languages,
  };

  constructor(private readonly ctx: TtsContext) {}

  isAvailable(): boolean {
    return Boolean(this.ctx.secret(this.id));
  }

  async listVoices(): Promise<TtsVoice[]> {
    const key = this.ctx.secret(this.id);
    if (!key) return GOOGLE_STATIC_VI_VOICES;
    try {
      const request = buildGoogleVoicesRequest(key);
      const response = await sendHttp(this.ctx, request, undefined, [key]);
      const parsed = parseGoogleVoices(JSON.parse(response.text) as unknown);
      return parsed.length > 0 ? parsed : GOOGLE_STATIC_VI_VOICES;
    } catch {
      return GOOGLE_STATIC_VI_VOICES;
    }
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const key = this.ctx.secret(this.id);
    if (!key) throw new Error("Chưa có API key Google Cloud TTS.");
    const request = buildGoogleSynthesizeRequest({
      apiKey: key,
      text: input.text,
      voice: input.voice,
      rate: input.rate,
    });
    const response = await sendHttp(this.ctx, request, input.signal, [key]);
    const payload = JSON.parse(response.text) as { audioContent?: string; timepoints?: Array<{ markName?: string; timeSeconds?: number }> };
    if (!payload.audioContent) throw new Error("Google Cloud TTS không trả về audio.");
    const audio = Buffer.from(payload.audioContent, "base64");
    mkdirSync(dirname(input.outPath), { recursive: true });
    writeFileSync(input.outPath, audio);
    const durationSec = await this.ctx.probeDuration(input.outPath, input.signal);
    const words = wordsFromGoogleTimepoints(request.words, payload.timepoints ?? [], durationSec);
    const timingSource: TtsTimingSource = words.length > 0 ? "provider" : "estimated";
    return {
      durationSec: words.length > 0 ? Math.max(durationSec, words[words.length - 1]!.endSec) : durationSec,
      cues: [],
      ...(words.length > 0 ? { words } : {}),
      timingSource,
      characters: input.text.length,
    };
  }
}
