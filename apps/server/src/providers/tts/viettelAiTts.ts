import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { VIETTEL_STATIC_VOICES, buildViettelRequest, ttsCatalogEntry } from "@vg/shared";
import type { TtsProvider, TtsSynthesisInput, TtsSynthesisResult, TtsVoice } from "./types.js";
import type { TtsContext } from "./context.js";
import { sendHttp } from "./http.js";

const entry = ttsCatalogEntry("viettel_ai")!;

export class ViettelAiTtsProvider implements TtsProvider {
  id = "viettel_ai";
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
    return VIETTEL_STATIC_VOICES;
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const key = this.ctx.secret(this.id);
    if (!key) throw new Error("Chưa có token Viettel AI.");
    const request = buildViettelRequest({ apiKey: key, text: input.text, voice: input.voice, rate: input.rate });
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
