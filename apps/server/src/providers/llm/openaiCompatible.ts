import { readFileSync } from "node:fs";
import { fetchLlmJson, asRecord, numeric } from "./http.js";
import { LlmError, type LlmProvider, type LlmProviderCapabilities, type LlmRequest, type LlmResponse } from "./types.js";

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly capabilities: LlmProviderCapabilities;

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly defaultModel: string | null,
    private readonly timeoutMs: number,
    private readonly supportsJsonMode = true,
    capabilities: LlmProviderCapabilities = { vision: false, maxImagesPerCall: 0 },
  ) {
    this.capabilities = { ...capabilities, embeddings: capabilities.embeddings ?? ["openai", "ollama", "omniroute"].includes(id), ...(id === "openai" ? { nativeFunctions: true } : {}) };
  }

  async embed(req: { model: string; texts: string[] }, signal: AbortSignal) {
    if (!this.capabilities.embeddings) throw new LlmError("Embedding unavailable", "LLM_BAD_REQUEST", false);
    const result = asRecord(await fetchLlmJson(this.baseUrl.replace(/\/+$/, "") + "/embeddings", {
      method: "POST", headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: "Bearer " + this.apiKey } : {}) },
      body: JSON.stringify({ model: req.model, input: req.texts, encoding_format: "float" }),
    }, signal, this.timeoutMs));
    const rows = (Array.isArray(result.data) ? result.data : []).map(asRecord).sort((a,b) => numeric(a.index)-numeric(b.index));
    const vectors = rows.map(row => row.embedding as number[]);
    if (vectors.length !== req.texts.length || vectors.some(v => !Array.isArray(v) || !v.length || v.some(n => !Number.isFinite(n)))) throw new LlmError("Invalid embedding response", "LLM_INVALID_OUTPUT", false);
    return { vectors, usage: { inputTokens: numeric(asRecord(result.usage).prompt_tokens) } };
  }

  async generate(req: LlmRequest, signal: AbortSignal) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const result = await fetchLlmJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: buildOpenAiMessages(req),
        ...(req.functions?.length ? { max_completion_tokens: req.maxOutputTokens } : { max_tokens: req.maxOutputTokens }),
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        ...(req.json && this.supportsJsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(req.functions?.length ? {
          tools: req.functions.map((fn) => ({ type: "function", function: fn })),
          parallel_tool_calls: false,
        } : {}),
      }),
    }, signal, this.timeoutMs);
    const body = asRecord(result);
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const choice = asRecord(choices[0]);
    const message = asRecord(choice.message);
    const content = message.content;
    const contentText = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => asRecord(part).text).filter((part): part is string => typeof part === "string").join("")
        : "";
    const usage = asRecord(body.usage);
    const responseUsage = { inputTokens: numeric(usage.prompt_tokens), outputTokens: numeric(usage.completion_tokens) };
    const finishReason: LlmResponse["finishReason"] = choice.finish_reason === "length"
      ? "length"
      : choice.finish_reason === "stop" ? "stop" : "other";
    const text = req.functions?.length && finishReason !== "length"
      ? serializeFunctionStep(contentText, message.tool_calls)
      : contentText;
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

function serializeFunctionStep(reply: string, rawCalls: unknown): string {
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) return JSON.stringify({ reply, done: true });
  try {
    const calls = rawCalls.map((entry) => {
      const call = asRecord(entry);
      const fn = asRecord(call.function);
      if (call.type !== "function" || typeof fn.name !== "string" || typeof fn.arguments !== "string") {
        throw new Error("Malformed function call");
      }
      return { tool: fn.name, args: JSON.parse(fn.arguments) };
    });
    return JSON.stringify({ reply, calls, done: false });
  } catch {
    // Trigger the existing bounded structured-output repair without forwarding malformed arguments.
    return JSON.stringify({ invalidFunctionCall: true });
  }
}

export function buildOpenAiMessages(req: LlmRequest): unknown[] {
  const messages: unknown[] = [{ role: "system", content: req.system }];
  for (const [index, message] of req.messages.entries()) {
    if (message.role !== "user" || index !== firstUserIndex(req) || !req.images?.length) {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    messages.push({
      role: "user",
      content: [
        { type: "text", text: `${message.content}\n\nImage labels: ${req.images.map((image) => image.label).join(", ")}` },
        ...req.images.map((image) => ({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${readFileSync(image.path).toString("base64")}` },
        })),
      ],
    });
  }
  return messages;
}

function firstUserIndex(req: LlmRequest): number {
  return req.messages.findIndex((message) => message.role === "user");
}
