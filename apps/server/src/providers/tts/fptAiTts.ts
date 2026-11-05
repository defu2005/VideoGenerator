import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FPT_STATIC_VOICES, buildFptRequest, parseFptCreateResponse, pollFptAudio, ttsCatalogEntry } from "@vg/shared";
import type { TtsProvider, TtsSynthesisInput, TtsSynthesisResult, TtsVoice } from "./types.js";
import type { TtsContext } from "./context.js";
import { sendHttp } from "./http.js";

const entry = ttsCatalogEntry("fpt_ai")!;

export class FptAiTtsProvider implements TtsProvider {
  id = "fpt_ai";
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
    return FPT_STATIC_VOICES;
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const key = this.ctx.secret(this.id);
    if (!key) throw new Error("Chưa có API key FPT.AI.");
    const request = buildFptRequest({ apiKey: key, text: input.text, voice: input.voice, rate: input.rate });
    const response = await sendHttp(this.ctx, request, input.signal, [key]);
    const url = parseFptCreateResponse(JSON.parse(response.text) as unknown);
    const audio = await pollFptAudio(url, {
      fetchImpl: this.ctx.fetchImpl,
      sleep: this.ctx.sleep,
      signal: input.signal,
    });
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
