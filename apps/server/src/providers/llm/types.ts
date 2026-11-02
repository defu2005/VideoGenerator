export type LlmErrorCode =
  | "LLM_AUTH"
  | "LLM_RATE_LIMIT"
  | "LLM_UNAVAILABLE"
  | "LLM_TIMEOUT"
  | "LLM_BAD_REQUEST"
  | "LLM_INVALID_OUTPUT"
  | "LLM_OUTPUT_TRUNCATED"
  | "LLM_NOT_CONFIGURED";

export type LlmRequest = {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxOutputTokens: number;
  temperature?: number;
  json: boolean;
};

export type LlmResponse = {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  provider: string;
  finishReason: "stop" | "length" | "other";
};

export interface LlmProvider {
  id: string;
  label: string;
  defaultModel: string | null;
  generate(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: LlmErrorCode,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly usage?: { llmCalls: number; inputTokens: number; outputTokens: number },
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type ProviderDefinition = LlmProvider & { configured: true };
