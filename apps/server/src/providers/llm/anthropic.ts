import { readFileSync } from "node:fs";
import { fetchLlmJson, asRecord, numeric } from "./http.js";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types.js";

export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic";
  readonly capabilities = { vision: true, maxImagesPerCall: 10 } as const;

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
        messages: buildAnthropicMessages(req),
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

export function buildAnthropicMessages(req: LlmRequest): unknown[] {
  return req.messages.map((message, index) => {
    if (message.role !== "user" || index !== firstUserIndex(req) || !req.images?.length) {
      return { role: message.role, content: message.content };
    }
    const content: unknown[] = [
      ...req.images.map((image) => ({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: readFileSync(image.path).toString("base64"),
        },
      })),
      { type: "text", text: `${message.content}\n\nImage labels: ${req.images.map((image) => image.label).join(", ")}` },
    ];
    return { role: "user", content };
  });
}

function firstUserIndex(req: LlmRequest): number {
  return req.messages.findIndex((message) => message.role === "user");
}
