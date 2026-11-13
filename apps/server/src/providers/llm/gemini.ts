import { OpenAiCompatibleProvider } from "./openaiCompatible.js";
import { readFileSync } from "node:fs";
import { fetchLlmJson, asRecord, numeric } from "./http.js";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.js";

export class GeminiProvider implements LlmProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini";
  readonly capabilities = { embeddings: true, vision: true, maxImagesPerCall: 10 } as const;

  constructor(
    private readonly apiKey: string,
    readonly defaultModel: string | null,
    private readonly timeoutMs: number,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async embed(req: { model: string; texts: string[] }, signal: AbortSignal) {
    return new OpenAiCompatibleProvider("gemini",this.label,this.baseUrl+"/openai",this.apiKey,this.defaultModel,this.timeoutMs,true,{...this.capabilities}).embed(req,signal);
  }
  async generate(req: LlmRequest, signal: AbortSignal) {
    const contents = buildGeminiContents(req);
    const result = await fetchLlmJson(
      `${this.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents,
          generationConfig: {
            maxOutputTokens: req.maxOutputTokens,
            ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
            ...(req.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
      signal,
      this.timeoutMs,
    );
    const body = asRecord(result);
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const candidate = asRecord(candidates[0]);
    const candidateContent = asRecord(candidate.content);
    const parts = Array.isArray(candidateContent.parts) ? candidateContent.parts : [];
    const text = parts.map((part) => asRecord(part).text).filter((part): part is string => typeof part === "string").join("");
    const usage = asRecord(body.usageMetadata);
    const responseUsage = { inputTokens: numeric(usage.promptTokenCount), outputTokens: numeric(usage.candidatesTokenCount) };
    const finishReason: LlmResponse["finishReason"] = candidate.finishReason === "MAX_TOKENS"
      ? "length"
      : candidate.finishReason === "STOP" ? "stop" : "other";
    if (!text && finishReason !== "length") {
      throw new LlmError("Gemini returned no text content", "LLM_UNAVAILABLE", true, undefined, {
        llmCalls: 1,
        ...responseUsage,
      });
    }
    return {
      text,
      usage: responseUsage,
      model: req.model,
      provider: this.id,
      finishReason,
    };
  }
}

export function buildGeminiContents(req: LlmRequest): unknown[] {
  return req.messages.map((message, index) => {
    const role = message.role === "assistant" ? "model" : "user";
    if (message.role !== "user" || index !== firstUserIndex(req) || !req.images?.length) {
      return { role, parts: [{ text: message.content }] };
    }
    return {
      role,
      parts: [
        ...req.images.map((image) => ({
          inlineData: {
            mimeType: "image/jpeg",
            data: readFileSync(image.path).toString("base64"),
          },
        })),
        { text: `${message.content}\n\nImage labels: ${req.images.map((image) => image.label).join(", ")}` },
      ],
    };
  });
}

function firstUserIndex(req: LlmRequest): number {
  return req.messages.findIndex((message) => message.role === "user");
}
