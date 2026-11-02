import { fetchLlmJson, asRecord, numeric } from "./http.js";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.js";

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly defaultModel: string | null,
    private readonly timeoutMs: number,
    private readonly supportsJsonMode = true,
  ) {}

  async generate(req: LlmRequest, signal: AbortSignal) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const result = await fetchLlmJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: [{ role: "system", content: req.system }, ...req.messages],
        max_tokens: req.maxOutputTokens,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        ...(req.json && this.supportsJsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    }, signal, this.timeoutMs);
    const body = asRecord(result);
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const choice = asRecord(choices[0]);
    const message = asRecord(choice.message);
    const content = message.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => asRecord(part).text).filter((part): part is string => typeof part === "string").join("")
        : "";
    const usage = asRecord(body.usage);
    const responseUsage = { inputTokens: numeric(usage.prompt_tokens), outputTokens: numeric(usage.completion_tokens) };
    const finishReason: LlmResponse["finishReason"] = choice.finish_reason === "length"
      ? "length"
      : choice.finish_reason === "stop" ? "stop" : "other";
    if (!text && finishReason !== "length") {
      throw new LlmError(`${this.label} returned no text content`, "LLM_UNAVAILABLE", true, undefined, {
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
