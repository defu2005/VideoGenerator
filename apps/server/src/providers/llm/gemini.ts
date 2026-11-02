import { fetchLlmJson, asRecord, numeric } from "./http.js";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.js";

export class GeminiProvider implements LlmProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini";

  constructor(
    private readonly apiKey: string,
    readonly defaultModel: string | null,
    private readonly timeoutMs: number,
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  async generate(req: LlmRequest, signal: AbortSignal) {
    const contents = req.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
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
