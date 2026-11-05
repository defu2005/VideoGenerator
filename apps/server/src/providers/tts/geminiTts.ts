import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  GEMINI_STATIC_VOICES,
  buildGeminiTtsRequest,
  geminiAudioBase64,
  ttsCatalogEntry,
  wrapPcmAsWav,
} from "@vg/shared";
import type { TtsProvider, TtsSynthesisInput, TtsSynthesisResult, TtsVoice } from "./types.js";
import type { TtsContext } from "./context.js";
import { sendHttp } from "./http.js";

const entry = ttsCatalogEntry("gemini")!;

export class GeminiTtsProvider implements TtsProvider {
  id = "gemini";
  label = entry.label;
  capabilities = {
    wordTimings: entry.wordTimings,
    ssml: entry.ssml,
    styles: entry.styles,
    maxCharsPerRequest: entry.maxCharsPerRequest,
    languages: entry.languages,
  };

  constructor(private readonly ctx: TtsContext) {}

  isAvailable(): boolean {
    return Boolean(this.ctx.secret(this.id));
  }

  async listVoices(): Promise<TtsVoice[]> {
    return GEMINI_STATIC_VOICES;
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const key = this.ctx.secret(this.id);
    if (!key) throw new Error("Chưa có API key Gemini TTS.");
    const request = buildGeminiTtsRequest({
      apiKey: key,
      text: input.text,
      voice: input.voice,
      model: input.model || this.ctx.settings().geminiModel,
      style: input.style,
    });
    const response = await sendHttp(this.ctx, request, input.signal, [key]);
    const audio = wrapPcmAsWav(Buffer.from(geminiAudioBase64(JSON.parse(response.text) as unknown), "base64"));
    mkdirSync(dirname(input.outPath), { recursive: true });
    writeFileSync(input.outPath, audio);
    return {
      durationSec: await this.ctx.probeDuration(input.outPath, input.signal),
      cues: [],
      timingSource: "estimated",
      characters: input.text.length,
    };
  }
}
