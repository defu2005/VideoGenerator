import { readFileSync } from "node:fs";
import { fetchLlmJson, asRecord, numeric } from "./http.js";
import { LlmError, type LlmProvider, type LlmProviderCapabilities, type LlmRequest, type LlmResponse } from "./types.js";

/** Ollama's own /api/chat, with a bearer token. Used for the remote tunnel, which does not expose /v1. */
export class OllamaNativeProvider implements LlmProvider {
  readonly capabilities: LlmProviderCapabilities;

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly baseUrl: string,
    private readonly token: string,
    readonly defaultModel: string | null,
    private readonly timeoutMs: number,
    capabilities: LlmProviderCapabilities = { vision: false, maxImagesPerCall: 0 },
  ) {
    this.capabilities = capabilities;
  }

  async generate(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/api/chat`;
    const result = await fetchLlmJson(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: buildOllamaMessages(req),
        stream: false,
        ...(req.json ? { format: "json" } : {}),
        options: {
          num_predict: req.maxOutputTokens,
          ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        },
      }),
    }, signal, this.timeoutMs);
    const body = asRecord(result);
    const message = asRecord(body.message);
    const text = typeof message.content === "string" ? message.content : "";
    const usage = {
      inputTokens: numeric(body.prompt_eval_count),
      outputTokens: numeric(body.eval_count),
    };
    const doneReason = body.done_reason;
    const finishReason: LlmResponse["finishReason"] = doneReason === "length"
      ? "length"
      : doneReason === "stop" ? "stop" : "other";
    if (!text && finishReason !== "length") {
      throw new LlmError(`${this.label} returned no text content`, "LLM_UNAVAILABLE", true, undefined, {
        llmCalls: 1,
        ...usage,
      });
    }
    return {
      text,
      usage,
      model: typeof body.model === "string" ? body.model : req.model,
      provider: this.id,
      finishReason,
    };
  }
}

export function buildOllamaMessages(req: LlmRequest): unknown[] {
  const messages: unknown[] = [{ role: "system", content: req.system }];
  for (const [index, message] of req.messages.entries()) {
    if (message.role !== "user" || index !== firstUserIndex(req) || !req.images?.length) {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    messages.push({
      role: "user",
      content: `${message.content}\n\nImage labels: ${req.images.map((image) => image.label).join(", ")}`,
      images: req.images.map((image) => readFileSync(image.path).toString("base64")),
    });
  }
  return messages;
}

function firstUserIndex(req: LlmRequest): number {
  return req.messages.findIndex((message) => message.role === "user");
}
