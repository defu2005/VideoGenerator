import type { LlmCallUsage } from "@vg/shared";

export type LlmErrorCode =
  | "LLM_AUTH"
  | "LLM_RATE_LIMIT"
  | "LLM_UNAVAILABLE"
  | "LLM_TIMEOUT"
  | "LLM_BAD_REQUEST"
  | "LLM_INVALID_OUTPUT"
  | "LLM_OUTPUT_TRUNCATED"
  | "LLM_NOT_CONFIGURED"
  | "LLM_LIMIT_TOO_SMALL"
  | "LLM_QUOTA_EXHAUSTED"
  | "VISION_PROVIDER_REQUIRED"
  | "FFMPEG_MISSING";

export type LlmProviderLimits = {
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

export type LlmProviderCapabilities = {
  vision: boolean;
  maxImagesPerCall: number;
};

export type LlmImageAttachment = {
  path: string;
  label: string;
};

export type LlmRequest = {
  schemaName?: string;
  jsonSchema?: Record<string, unknown>;
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxOutputTokens: number;
  temperature?: number;
  json: boolean;
  /** Request-level image attachments (resized locally before send). */
  images?: LlmImageAttachment[];
};

export type LlmResponse = {
  text: string;
  usage: { inputTokens: number; outputTokens: number; tokensUnknown?: boolean };
  model: string;
  provider: string;
  finishReason: "stop" | "length" | "other";
};

export interface LlmProvider {
  id: string;
  label: string;
  defaultModel: string | null;
  limits?: LlmProviderLimits;
  capabilities?: LlmProviderCapabilities;
  configured?: boolean;
  hint?: string;
  generate(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: LlmErrorCode,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly usage?: {
      llmCalls: number;
      inputTokens: number;
      outputTokens: number;
      tokensUnknown?: boolean;
      calls?: LlmCallUsage[];
    },
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type ProviderDefinition = LlmProvider & { configured: true };
