import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildElevenSynthesizeRequest,
  buildElevenVoicesRequest,
  cuesFromWords,
  parseElevenVoices,
  ttsCatalogEntry,
  wordsFromCharacterAlignment,
} from "@vg/shared";
import type { TtsProvider, TtsSynthesisInput, TtsSynthesisResult, TtsVoice } from "./types.js";
import type { TtsContext } from "./context.js";
import { sendHttp } from "./http.js";

const entry = ttsCatalogEntry("elevenlabs")!;

export class ElevenLabsTtsProvider implements TtsProvider {
  id = "elevenlabs";
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
    if (!key) return [];
    try {
      const response = await sendHttp(this.ctx, buildElevenVoicesRequest(key), undefined, [key]);
      return parseElevenVoices(JSON.parse(response.text) as unknown);
    } catch {
      return [];
    }
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const key = this.ctx.secret(this.id);
    if (!key) throw new Error("Chưa có API key ElevenLabs.");
    const request = buildElevenSynthesizeRequest({
      apiKey: key,
      text: input.text,
      voice: input.voice,
      model: input.model || this.ctx.settings().elevenModel,
    });
    const response = await sendHttp(this.ctx, request, input.signal, [key]);
    const payload = JSON.parse(response.text) as {
      audio_base64?: string;
      alignment?: { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] };
    };
    if (!payload.audio_base64) throw new Error("ElevenLabs không trả về audio.");
    mkdirSync(dirname(input.outPath), { recursive: true });
    writeFileSync(input.outPath, Buffer.from(payload.audio_base64, "base64"));
    const durationSec = await this.ctx.probeDuration(input.outPath, input.signal);
    const words = payload.alignment ? wordsFromCharacterAlignment(payload.alignment) : [];
    return {
      durationSec,
      cues: words.length > 0 ? cuesFromWords(words) : [],
      ...(words.length > 0 ? { words } : {}),
      timingSource: words.length > 0 ? "provider" : "estimated",
      characters: input.text.length,
    };
  }
}
