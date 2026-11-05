import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OPENAI_STATIC_VOICES, buildOpenAiSpeechRequest, ttsCatalogEntry } from "@vg/shared";
import type { TtsProvider, TtsSynthesisInput, TtsSynthesisResult, TtsVoice } from "./types.js";
import type { TtsContext } from "./context.js";
import { sendHttp } from "./http.js";

const entry = ttsCatalogEntry("openai")!;

export class OpenAiTtsProvider implements TtsProvider {
  id = "openai";
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
    return OPENAI_STATIC_VOICES;
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const key = this.ctx.secret(this.id);
    if (!key) throw new Error("Chưa có API key OpenAI TTS.");
    const request = buildOpenAiSpeechRequest({
      apiKey: key,
      text: input.text,
      voice: input.voice,
      rate: input.rate,
      model: input.model || this.ctx.settings().openaiModel,
      style: input.style,
    });
    const response = await sendHttp(this.ctx, request, input.signal, [key]);
    mkdirSync(dirname(input.outPath), { recursive: true });
    writeFileSync(input.outPath, response.bytes);
    return {
      durationSec: await this.ctx.probeDuration(input.outPath, input.signal),
      cues: [],
      timingSource: "estimated",
      characters: input.text.length,
    };
  }
}
