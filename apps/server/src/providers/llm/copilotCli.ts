import type { LlmRequest } from "./types.js";
import {
  CliProviderBase,
  type CliProviderOptions,
  type ParsedCliResponse,
} from "./cliProvider.js";
import { LlmError } from "./types.js";

// Verified against GitHub Copilot CLI 1.0.105 on 2026-11-03: `-p` requires the prompt as an
// argument, so the prompt is piped on stdin with no `-p` (piped stdin runs non-interactively).
// Built-in MCP servers (GitHub MCP, 18 tools) load by default and are not covered by
// --available-tools, so they are disabled explicitly.
export const COPILOT_CLI_FLAGS = {
  silent: "-s",
  disableBuiltinMcps: "--disable-builtin-mcps",
  outputFormat: ["--output-format", "json"],
  disableTelemetry: "--disable-client-telemetry",
  model: "--model",
  availableTools: "--available-tools",
  disallowTempDir: "--disallow-temp-dir",
  logDir: "--log-dir",
  logLevel: ["--log-level", "none"],
} as const;

export class CopilotCliProvider extends CliProviderBase {
  constructor(
    binaryPath: string | null,
    dataDir: string,
    timeoutMs: number,
    defaultModel: string | null = null,
    spawnProcess?: CliProviderOptions["spawnProcess"],
    launch?: { command: string; argsPrefix: string[] },
    limits?: CliProviderOptions["limits"],
  ) {
    super({
      id: "copilot-cli",
      label: "GitHub Copilot CLI",
      binaryPath,
      command: launch?.command,
      argsPrefix: launch?.argsPrefix,
      dataDir,
      timeoutMs,
      defaultModel,
      hint: "Install GitHub Copilot CLI and sign in once",
      limits,
      args: (request, cwd) => [
        COPILOT_CLI_FLAGS.silent,
        ...COPILOT_CLI_FLAGS.outputFormat,
        COPILOT_CLI_FLAGS.disableTelemetry,
        COPILOT_CLI_FLAGS.availableTools,
        COPILOT_CLI_FLAGS.disableBuiltinMcps,
        COPILOT_CLI_FLAGS.disallowTempDir,
        COPILOT_CLI_FLAGS.logDir,
        cwd,
        ...COPILOT_CLI_FLAGS.logLevel,
        ...(request.model ? [COPILOT_CLI_FLAGS.model, request.model] : []),
      ],
      formatPrompt: formatCopilotPrompt,
      parseResponse: parseCopilotResponse,
      classifyFailure: classifyCopilotFailure,
      mapSpawnError: mapCopilotSpawnError,
      spawnProcess,
    });
  }
}

function formatCopilotPrompt(request: LlmRequest): string {
  return [
    `System instructions:\n${request.system}`,
    ...request.messages.map(({ role, content }) => `${role === "assistant" ? "Assistant" : "User"}:\n${content}`),
  ].join("\n\n");
}

function parseCopilotResponse(output: string): ParsedCliResponse | undefined {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const events: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const event = asRecord(JSON.parse(line) as unknown);
      events.push(event);
      const data = asRecord(event.data);
      if (Object.keys(data).length) events.push({ type: event.type, ...data });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }

  let result = "";
  let finalAnswer: string | undefined;
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let isError = false;
  for (const event of events) {
    const type = typeof event.type === "string" ? event.type.toLowerCase() : "";
    const content = typeof event.content === "string"
      ? event.content
      : Array.isArray(event.content)
        ? event.content.map((part) => {
          const block = asRecord(part);
          return typeof block.text === "string" ? block.text : "";
        }).join("")
        : undefined;
    const messageObject = asRecord(event.message);
    const message = typeof event.message === "string"
      ? event.message
      : typeof messageObject.content === "string"
        ? messageObject.content
        : Array.isArray(messageObject.content)
          ? messageObject.content.map((part) => {
            const block = asRecord(part);
            return typeof block.text === "string" ? block.text : "";
          }).join("")
          : undefined;
    // Real 1.0.105 JSONL: the answer is `assistant.message` with phase "final_answer";
    // other events (e.g. model.call_final_result) carry status strings like "success".
    const isAssistantMessage = type === "assistant.message" || type === "assistant_message";
    if (isAssistantMessage && event.phase === "final_answer" && (content ?? message) !== undefined) {
      finalAnswer = content ?? message;
    }
    const candidate = isAssistantMessage ? content ?? message
      : type === "result" && typeof event.result === "string" ? event.result
        : undefined;
    if (candidate !== undefined && candidate.length >= result.length) result = candidate;
    if (typeof event.model === "string") model = event.model;
    const usage = asRecord(event.usage);
    inputTokens = numeric(usage.input_tokens) ?? numeric(usage.inputTokens) ?? inputTokens;
    outputTokens = numeric(usage.output_tokens) ?? numeric(usage.outputTokens) ?? outputTokens;
    if (event.is_error === true || event.isError === true || type.includes("error")) isError = true;
    if (!result && typeof event.error === "string") result = event.error;
  }

  const isJsonLinesProtocol = events.some((event) => typeof event.type === "string");
  if (!isJsonLinesProtocol) {
    const plainText = output.trim();
    return plainText ? {
      result: plainText,
      usage: { inputTokens: 0, outputTokens: 0, tokensUnknown: true },
      isError: false,
    } : undefined;
  }
  if (finalAnswer !== undefined) result = finalAnswer;
  if (!result) return undefined;
  return {
    result,
    model,
    usage: {
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      ...((inputTokens === undefined || outputTokens === undefined) ? { tokensUnknown: true } : {}),
    },
    isError,
  };
}

function classifyCopilotFailure(message: string): LlmError {
  const normalized = message.toLowerCase();
  if (/quota|limit reached|usage limit|credits? (?:are )?(?:exhausted|depleted)|premium requests? (?:are )?(?:exhausted|used up)/.test(normalized)) {
    return new LlmError("GitHub Copilot usage quota has been exhausted.", "LLM_QUOTA_EXHAUSTED", false);
  }
  if (/not signed in|not licensed to use copilot|no copilot access|not authenticated|authentication required|unauthorized|\b401\b|\b403\b|run.*login/.test(normalized)) {
    return new LlmError("Copilot CLI is not signed in or this account has no Copilot access", "LLM_AUTH", false);
  }
  // CLI argument/usage errors are rejected locally before any request is sent.
  if (/for more information, try '--help'|unexpected argument|a value is required for/.test(normalized)) {
    return new LlmError(`GitHub Copilot CLI rejected its arguments: ${message.slice(0, 300)}`, "LLM_NOT_CONFIGURED", false);
  }
  if (/rate.?limit|too many requests|overloaded/.test(normalized)) {
    return new LlmError("GitHub Copilot CLI rate limit reached.", "LLM_RATE_LIMIT", true);
  }
  if (!message) return new LlmError("GitHub Copilot CLI returned invalid output.", "LLM_INVALID_OUTPUT", false);
  return new LlmError(`GitHub Copilot CLI failed: ${message.slice(0, 500)}`, "LLM_UNAVAILABLE", true);
}

function mapCopilotSpawnError(error: unknown): LlmError {
  const value = error as NodeJS.ErrnoException;
  return value.code === "ENOENT"
    ? new LlmError("GitHub Copilot CLI was not found. Install it and set COPILOT_CLI_PATH if needed.", "LLM_NOT_CONFIGURED", false)
    : new LlmError(value.message ?? "Unable to start GitHub Copilot CLI.", "LLM_UNAVAILABLE", true);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
