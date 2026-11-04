import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import type { LlmRequest, LlmResponse } from "./types.js";
import {
  CliProviderBase,
  parseJsonCliResponse,
  resolveCliPath,
  type CliProviderOptions,
} from "./cliProvider.js";
import { LlmError } from "./types.js";
import { safeImageFileName } from "./visionImages.js";

export const CLAUDE_CLI_FLAGS = {
  print: "-p",
  outputFormat: ["--output-format", "json"],
  systemPrompt: "--system-prompt",
  maxTurns: ["--max-turns", "1"],
  tools: ["--tools", ""],
  disallowedMcpTools: ["--disallowedTools", "mcp__*"],
  addDir: "--add-dir",
  allowedTools: ["--allowedTools", "Read"],
} as const;

export class ClaudeCliProvider extends CliProviderBase {
  readonly capabilities = { vision: true, maxImagesPerCall: 5 } as const;

  constructor(
    binaryPath: string | null,
    private readonly dataDir: string,
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
      args: (request, cwd) => buildClaudeArgs(request, cwd),
      formatPrompt: formatClaudePrompt,
      parseResponse: parseJsonCliResponse,
      classifyFailure: classifyClaudeFailure,
      mapSpawnError: mapClaudeSpawnError,
      spawnProcess,
    });
  }

  override async generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    if (!request.images?.length) return super.generate(request, signal);
    const imageRoot = join(this.dataDir, "tmp", "claude-cli-vision");
    mkdirSync(imageRoot, { recursive: true });
    const imageDir = mkdtempSync(join(imageRoot, "img-"));
    try {
      const copied = request.images.map((image, index) => {
        const name = safeImageFileName(image.label, index);
        const dest = join(imageDir, name);
        copyFileSync(image.path, dest);
        return { ...image, path: dest };
      });
      return await super.generate({
        ...request,
        images: copied,
        messages: annotateClaudeImagePaths(request.messages, copied, imageDir),
      }, signal);
    } finally {
      rmSync(imageDir, { recursive: true, force: true });
    }
  }
}

/**
 * Windows limits a command line to ~32k chars. Long system prompts (the assistant's tool
 * catalog, for example) go through a file in the run folder instead.
 */
export const CLAUDE_SYSTEM_PROMPT_ARG_LIMIT = 6000;

export function buildClaudeArgs(request: LlmRequest, cwd?: string): string[] {
  const hasImages = Boolean(request.images?.length);
  const imageDir = hasImages ? dirname(request.images![0]!.path) : null;
  let systemArgs = [CLAUDE_CLI_FLAGS.systemPrompt, request.system];
  if (cwd && request.system.length > CLAUDE_SYSTEM_PROMPT_ARG_LIMIT) {
    const file = join(cwd, "system-prompt.md");
    writeFileSync(file, request.system, "utf8");
    systemArgs = ["--system-prompt-file", file];
  }
  return [
    CLAUDE_CLI_FLAGS.print,
    ...CLAUDE_CLI_FLAGS.outputFormat,
    ...systemArgs,
    // Reading images needs one tool turn per image plus the final answer.
    ...(hasImages ? ["--max-turns", String(request.images!.length + 2)] : CLAUDE_CLI_FLAGS.maxTurns),
    ...(hasImages
      ? ["--tools", "Read", ...CLAUDE_CLI_FLAGS.allowedTools, CLAUDE_CLI_FLAGS.addDir, imageDir!]
      : CLAUDE_CLI_FLAGS.tools),
    ...CLAUDE_CLI_FLAGS.disallowedMcpTools,
    ...(request.model ? ["--model", request.model] : []),
  ];
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

function annotateClaudeImagePaths(
  messages: LlmRequest["messages"],
  images: NonNullable<LlmRequest["images"]>,
  imageDir: string,
): LlmRequest["messages"] {
  const listing = [
    `Images are available under ${imageDir}. Use the Read tool on these paths:`,
    ...images.map((image) => `- ${image.label}: ${image.path}`),
  ].join("\n");
  let annotated = false;
  return messages.map((message) => {
    if (annotated || message.role !== "user") return message;
    annotated = true;
    return { ...message, content: `${message.content}\n\n${listing}` };
  });
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
