import { fetchLlmJson, asRecord, numeric } from "./http.js";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.js";

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic";

  constructor(
    private readonly apiKey: string,
    readonly defaultModel: string | null,
    private readonly timeoutMs: number,
    private readonly baseUrl = "https://api.anthropic.com",
  ) {}

  async generate(req: LlmRequest, signal: AbortSignal) {
    const result = await fetchLlmJson(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        system: req.system,
        messages: req.messages,
        max_tokens: req.maxOutputTokens,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      }),
    }, signal, this.timeoutMs);
    const body = asRecord(result);
    const content = Array.isArray(body.content) ? body.content : [];
    const text = content.map((item) => asRecord(item).text).filter((part): part is string => typeof part === "string").join("");
    const usage = asRecord(body.usage);
    const responseUsage = { inputTokens: numeric(usage.input_tokens), outputTokens: numeric(usage.output_tokens) };
    const finishReason: LlmResponse["finishReason"] = body.stop_reason === "max_tokens"
      ? "length"
      : body.stop_reason === "end_turn" || body.stop_reason === "stop_sequence" ? "stop" : "other";
    if (!text && finishReason !== "length") {
      throw new LlmError("Anthropic returned no text content", "LLM_UNAVAILABLE", true, undefined, {
        llmCalls: 1,
        ...responseUsage,
      });
    }
    return {
      text,
      usage: responseUsage,
      model: typeof body.model === "string" ? body.model : req.model,
      provider: this.id,
      finishReason,
    };
  }
}
