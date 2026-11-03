import { existsSync, readFileSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import type { LlmRequest } from "./types.js";
import {
  CliProviderBase,
  parseJsonCliResponse,
  resolveCliPath,
  type CliProviderOptions,
} from "./cliProvider.js";
import { LlmError } from "./types.js";

export const CLAUDE_CLI_FLAGS = {
  print: "-p",
  outputFormat: ["--output-format", "json"],
  systemPrompt: "--system-prompt",
  maxTurns: ["--max-turns", "1"],
  tools: ["--tools", ""],
  disallowedMcpTools: ["--disallowedTools", "mcp__*"],
} as const;

export class ClaudeCliProvider extends CliProviderBase {
  constructor(
    binaryPath: string | null,
    dataDir: string,
    timeoutMs: number,
    defaultModel: string | null = null,
    spawnProcess?: CliProviderOptions["spawnProcess"],
  ) {
    super({
      id: "claude-cli",
      label: "Claude (subscription via Claude Code)",
      binaryPath,
      dataDir,
      timeoutMs,
      defaultModel,
      hint: "Install Claude Code CLI and run `claude` once to log in",
      args: (request) => [
        CLAUDE_CLI_FLAGS.print,
        ...CLAUDE_CLI_FLAGS.outputFormat,
        CLAUDE_CLI_FLAGS.systemPrompt,
        request.system,
        ...CLAUDE_CLI_FLAGS.maxTurns,
        ...CLAUDE_CLI_FLAGS.tools,
        ...CLAUDE_CLI_FLAGS.disallowedMcpTools,
        ...(request.model ? ["--model", request.model] : []),
      ],
      formatPrompt: formatClaudePrompt,
      parseResponse: parseJsonCliResponse,
      classifyFailure: classifyClaudeFailure,
      mapSpawnError: mapClaudeSpawnError,
      spawnProcess,
    });
  }
}

export function resolveClaudeCliPath(binary: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const direct = resolveCliPath(binary, env);
  if (direct) return direct;
  // npm on Windows installs `claude.cmd`/`claude.ps1` wrappers; the real native binary lives in the
  // package (its `bin` field, e.g. bin/claude.exe). Resolve it so no shell is needed.
  if (process.platform !== "win32") return null;
  const hasPath = isAbsolute(binary) || binary.includes("/") || binary.includes("\\");
  const searchPath = env.PATH ?? env.Path ?? "";
  const directories = hasPath ? [dirname(resolve(binary))] : searchPath.split(delimiter).filter(Boolean);
  const name = hasPath ? basename(binary).replace(/\.(?:cmd|ps1)$/i, "") : binary;
  for (const directory of directories) {
    if (!existsSync(join(directory, `${name}.cmd`)) && !existsSync(join(directory, `${name}.ps1`))) continue;
    const packageDir = join(directory, "node_modules", "@anthropic-ai", "claude-code");
    try {
      const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { bin?: string | Record<string, string> };
      const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[name] ?? pkg.bin?.claude;
      if (entry && /\.exe$/i.test(entry) && existsSync(join(packageDir, entry))) return resolve(packageDir, entry);
    } catch {
      continue;
    }
  }
  return null;
}

function formatClaudePrompt(request: LlmRequest): string {
  return request.messages
    .map(({ role, content }) => `${role === "assistant" ? "Assistant" : "User"}:\n${content}`)
    .join("\n\n");
}

function mapClaudeSpawnError(error: unknown): LlmError {
  const value = error as NodeJS.ErrnoException;
  return value.code === "ENOENT"
    ? new LlmError("Claude Code CLI was not found. Install Claude Code CLI and set CLAUDE_CLI_PATH if needed.", "LLM_NOT_CONFIGURED", false)
    : new LlmError(value.message ?? "Unable to start Claude Code CLI.", "LLM_UNAVAILABLE", true);
}

function classifyClaudeFailure(message: string): LlmError {
  const normalized = message.toLowerCase();
  if (/not logged in|not authenticated|authentication required|unauthorized|invalid api key|please run.*login/.test(normalized)) {
    return new LlmError("Claude Code CLI is not logged in. Run `claude` once to authenticate.", "LLM_AUTH", false);
  }
  if (/rate.?limit|usage limit|too many requests|overloaded/.test(normalized)) {
    return new LlmError("Claude Code CLI rate limit reached.", "LLM_RATE_LIMIT", true);
  }
  if (!message) return new LlmError("Claude Code CLI returned invalid JSON output.", "LLM_INVALID_OUTPUT", false);
  return new LlmError(`Claude Code CLI failed: ${message.slice(0, 500)}`, "LLM_UNAVAILABLE", true);
}
