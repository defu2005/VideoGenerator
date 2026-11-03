import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmRequest } from "./types.js";
import {
  CliProviderBase,
  resolveCliPath,
  type CliProviderOptions,
  type ParsedCliResponse,
} from "./cliProvider.js";
import { LlmError } from "./types.js";

export const AGY_STATIC_MODELS = [
  "gemini-3.8-flash-low",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-high",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
];

// Module-level cache for model list (10 min TTL)
let modelCache: { expiresAt: number; models: string[] } | undefined;

export function resolveAgyPath(
  configured: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (configured) {
    return resolveCliPath(configured, env);
  }
  if (process.platform === "win32") {
    const localAppData = env["LOCALAPPDATA"];
    if (localAppData) {
      const candidate = join(localAppData, "agy", "bin", "agy.exe");
      const resolved = resolveCliPath(candidate, env);
      if (resolved) return resolved;
    }
  } else {
    const home = env["HOME"];
    if (home) {
      const candidate = join(home, ".local", "bin", "agy");
      const resolved = resolveCliPath(candidate, env);
      if (resolved) return resolved;
    }
  }
  return resolveCliPath("agy", env);
}

export async function resolveAgyPathWithRetry(
  configured: string,
  env: NodeJS.ProcessEnv = process.env,
  maxRetryMs = 60_000,
): Promise<string | null> {
  const start = Date.now();
  while (true) {
    const path = resolveAgyPath(configured, env);
    if (path) return path;
    if (Date.now() - start >= maxRetryMs) return null;
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }
}

export class AntgravityCliProvider extends CliProviderBase {
  private readonly binaryPathValue: string | null;
  private readonly effortValue: string;

  constructor(
    binaryPath: string | null,
    dataDir: string,
    timeoutMs: number,
    defaultModel: string | null = null,
    effort = "",
    spawnProcess?: CliProviderOptions["spawnProcess"],
  ) {
    super({
      id: "antigravity-cli",
      label: "Antigravity CLI (tài khoản Google)",
      binaryPath,
      dataDir,
      timeoutMs,
      defaultModel,
      hint: "Cài agy và chạy `agy` một lần để đăng nhập Google",
      args: (request, cwd) => {
        const prompt = formatAgyFullPrompt(request);
        const timeoutSec = Math.ceil(timeoutMs / 1000);
        const args: string[] = [
          `--print=${prompt}`,
          "--output-format", "json",
          "--mode", "plan",
          "--print-timeout", `${timeoutSec}s`,
          ...(request.model ? ["--model", request.model] : []),
          ...(effort ? ["--effort", effort] : []),
        ];
        // JSON schema for structured output
        if (request.json && (request.jsonSchema || request.schemaName)) {
          const schemaPath = join(cwd, "schema.json");
          writeFileSync(schemaPath, JSON.stringify(request.jsonSchema ?? { type: "object", title: request.schemaName ?? "response" }));
          args.push("--json-schema", schemaPath);
        }
        return args;
      },
      // Prompt is embedded in --print=<prompt> arg; stdin gets empty string.
      formatPrompt: () => "",
      parseResponse: parseAgyResponse,
      classifyFailure: classifyAgyFailure,
      mapSpawnError: mapAgySpawnError,
      spawnProcess,
    });
    this.binaryPathValue = binaryPath;
    this.effortValue = effort;
  }

  async listModels(
    spawnFn: (
      command: string,
      args: string[],
      options: SpawnOptions,
    ) => ChildProcessWithoutNullStreams = (command, args, options) =>
      spawn(command, args, options) as ChildProcessWithoutNullStreams,
  ): Promise<string[]> {
    if (modelCache && modelCache.expiresAt > Date.now()) {
      return modelCache.models;
    }
    if (!this.binaryPathValue) return AGY_STATIC_MODELS;
    return new Promise<string[]>((resolveModels) => {
      const timeout = setTimeout(() => {
        resolveModels(modelCache?.models ?? AGY_STATIC_MODELS);
      }, 5_000);
      let stdout = "";
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnFn(this.binaryPathValue!, ["models"], {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        clearTimeout(timeout);
        resolveModels(AGY_STATIC_MODELS);
        return;
      }
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.once("close", () => {
        clearTimeout(timeout);
        const models = parseAgyModels(stdout);
        const result = models.length > 0 ? models : AGY_STATIC_MODELS;
        modelCache = { expiresAt: Date.now() + 10 * 60_000, models: result };
        resolveModels(result);
      });
      child.once("error", () => {
        clearTimeout(timeout);
        resolveModels(modelCache?.models ?? AGY_STATIC_MODELS);
      });
    });
  }
}

function formatAgyFullPrompt(request: LlmRequest): string {
  return [
    `System instructions:\n${request.system}`,
    ...request.messages.map(({ role, content }) =>
      `${role === "assistant" ? "Assistant" : "User"}:\n${content}`,
    ),
  ].join("\n\n");
}

function parseAgyModels(output: string): string[] {
  const models: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "<id>\t<label>" — take only the id (first tab-delimited column)
    const id = trimmed.split("\t")[0]?.trim();
    if (id) models.push(id);
  }
  return models;
}

function stripCodeFences(text: string): string {
  // Strip leading/trailing code fences (``` ... ```)
  const stripped = text.replace(/^```[^\n]*\n([\s\S]*?)```\s*$/m, "$1").trim();
  return stripped || text.trim();
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseAgyResponse(output: string): ParsedCliResponse | undefined {
  try {
    const value = JSON.parse(output.trim()) as Record<string, unknown>;
    // status must be SUCCESS
    if (value["status"] !== "SUCCESS") {
      const msg = typeof value["response"] === "string"
        ? value["response"]
        : String(value["status"] ?? "FAILED");
      return { result: msg || "FAILED", usage: { inputTokens: 0, outputTokens: 0 }, isError: true };
    }
    const response = typeof value["response"] === "string" ? value["response"] : "";
    // denied_actions: if non-empty and response is empty → special signal
    const deniedActions = Array.isArray(value["denied_actions"]) ? value["denied_actions"] : [];
    if (deniedActions.length > 0 && !response) {
      return { result: "denied_actions", usage: { inputTokens: 0, outputTokens: 0 }, isError: true };
    }
    if (!response) {
      return { result: "", usage: { inputTokens: 0, outputTokens: 0 }, isError: true };
    }
    // Strip code fences from response
    const text = stripCodeFences(response);
    // Usage mapping: inputTokens = input_tokens + cache_read_tokens; outputTokens = output_tokens + thinking_tokens
    const usage = typeof value["usage"] === "object" && value["usage"] !== null
      ? value["usage"] as Record<string, unknown>
      : {};
    const inputTokens = (numeric(usage["input_tokens"]) ?? 0) + (numeric(usage["cache_read_tokens"]) ?? 0);
    const outputTokens = (numeric(usage["output_tokens"]) ?? 0) + (numeric(usage["thinking_tokens"]) ?? 0);
    return { result: text, usage: { inputTokens, outputTokens }, isError: false };
  } catch {
    return undefined;
  }
}

export function classifyAgyFailure(message: string): LlmError {
  const normalized = message.toLowerCase();
  // denied_actions signal from parseAgyResponse
  if (message === "denied_actions") {
    return new LlmError("Model cố dùng công cụ thay vì trả lời", "LLM_INVALID_OUTPUT", false);
  }
  // Empty message → invalid output
  if (!message) {
    return new LlmError("Antigravity CLI returned invalid output.", "LLM_INVALID_OUTPUT", false);
  }
  // Not signed in / ineligible account
  if (/not eligible|sign in|login|ineligibletier/.test(normalized)) {
    return new LlmError("Chạy `agy` một lần để đăng nhập Google", "LLM_NOT_CONFIGURED", false);
  }
  // Quota / rate limit
  if (/quota|resource_exhausted|rate limit|429/.test(normalized)) {
    return new LlmError("Antigravity CLI rate limit hoặc quota exhausted.", "LLM_RATE_LIMIT", true);
  }
  // Unknown / invalid model
  if (/unknown model|model not found|invalid model/.test(normalized)) {
    return new LlmError("Model không có trong `agy models`", "LLM_NOT_CONFIGURED", false);
  }
  return new LlmError(`Antigravity CLI failed: ${message.slice(0, 500)}`, "LLM_UNAVAILABLE", true);
}

export function mapAgySpawnError(error: unknown): LlmError {
  const value = error as NodeJS.ErrnoException;
  return value.code === "ENOENT"
    ? new LlmError(
        "Antigravity CLI (agy) không tìm thấy. Cài agy và set ANTIGRAVITY_CLI_PATH nếu cần.",
        "LLM_NOT_CONFIGURED",
        false,
      )
    : new LlmError(
        value.message ?? "Không thể khởi động Antigravity CLI.",
        "LLM_UNAVAILABLE",
        true,
      );
}

// Ensure mkdirSync is used for image dir creation in vision scenarios
export { mkdirSync };
