import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { constants } from "node:fs";
import { accessSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";
import { LlmError } from "./types.js";

export const CLAUDE_CLI_FLAGS = {
  print: "-p",
  outputFormat: ["--output-format", "json"],
  systemPrompt: "--system-prompt",
  maxTurns: ["--max-turns", "1"],
  tools: ["--tools", ""],
  disallowedMcpTools: ["--disallowedTools", "mcp__*"],
} as const;

type SpawnFunction = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

let processQueue: Promise<void> = Promise.resolve();

export class ClaudeCliProvider implements LlmProvider {
  readonly id = "claude-cli";
  readonly label = "Claude (subscription via Claude Code)";
  readonly defaultModel: string | null;
  readonly configured: boolean;
  readonly hint = "Install Claude Code CLI and run `claude` once to log in";

  constructor(
    readonly binaryPath: string | null,
    private readonly dataDir: string,
    private readonly timeoutMs: number,
    defaultModel: string | null = null,
    private readonly spawnProcess: SpawnFunction = (command, args, options) =>
      spawn(command, args, options) as ChildProcessWithoutNullStreams,
  ) {
    this.defaultModel = defaultModel;
    this.configured = binaryPath !== null;
  }

  generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    if (!this.binaryPath) {
      return Promise.reject(new LlmError(this.hint, "LLM_NOT_CONFIGURED", false));
    }
    return withProcessLock(() => this.run(request, signal));
  }

  private async run(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    if (signal.aborted) {
      throw new LlmError("Claude Code CLI request was aborted.", "LLM_TIMEOUT", true);
    }
    const root = join(this.dataDir, "tmp", "claude-cli");
    mkdirSync(root, { recursive: true });
    const cwd = mkdtempSync(join(root, "run-"));
    try {
      return await new Promise<LlmResponse>((resolvePromise, rejectPromise) => {
        const args = [
          CLAUDE_CLI_FLAGS.print,
          ...CLAUDE_CLI_FLAGS.outputFormat,
          CLAUDE_CLI_FLAGS.systemPrompt,
          request.system,
          ...CLAUDE_CLI_FLAGS.maxTurns,
          ...CLAUDE_CLI_FLAGS.tools,
          ...CLAUDE_CLI_FLAGS.disallowedMcpTools,
          ...(request.model ? ["--model", request.model] : []),
        ];
        let child: ChildProcessWithoutNullStreams;
        try {
          child = this.spawnProcess(this.binaryPath!, args, {
            cwd,
            env: minimalEnvironment(),
            shell: false,
            detached: process.platform !== "win32",
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch (error) {
          rejectPromise(mapSpawnError(error));
          return;
        }

        let stdout = "";
        let stderr = "";
        let settled = false;
        let stoppingWith: LlmError | undefined;
        let killWait: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: LlmError, response?: LlmResponse) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (killWait) clearTimeout(killWait);
          signal.removeEventListener("abort", abort);
          if (error) rejectPromise(error);
          else if (response) resolvePromise(response);
          else rejectPromise(new LlmError("Claude Code CLI returned no response.", "LLM_INVALID_OUTPUT", false));
        };
        const stop = (error: LlmError) => {
          if (settled || stoppingWith) return;
          stoppingWith = error;
          terminateProcessTree(child);
          killWait = setTimeout(() => finish(error), 1_000);
        };
        const abort = () => {
          stop(new LlmError("Claude Code CLI request was aborted.", "LLM_TIMEOUT", true));
        };
        const timeout = setTimeout(
          () => stop(new LlmError("Claude Code CLI request timed out.", "LLM_TIMEOUT", true)),
          this.timeoutMs,
        );
        signal.addEventListener("abort", abort, { once: true });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => { stdout += chunk; });
        child.stderr.on("data", (chunk: string) => { stderr += chunk; });
        child.once("error", (error) => finish(mapSpawnError(error)));
        child.once("close", (code) => {
          if (settled) return;
          if (stoppingWith) {
            finish(stoppingWith);
            return;
          }
          const parsed = parseCliResponse(stdout);
          if (code !== 0) {
            finish(classifyCliFailure(`${parsed?.result ?? ""}\n${stderr}\n${stdout}`.trim()));
            return;
          }
          if (!parsed) {
            finish(new LlmError("Claude Code CLI returned invalid JSON output.", "LLM_INVALID_OUTPUT", false));
            return;
          }
          if (parsed.isError) {
            finish(classifyCliFailure(parsed.result));
            return;
          }
          finish(undefined, {
            text: parsed.result,
            usage: parsed.usage,
            model: parsed.model ?? (request.model || "default"),
            provider: this.id,
            finishReason: "stop",
          });
        });
        const prompt = request.messages
          .map(({ role, content }) => `${role === "assistant" ? "Assistant" : "User"}:\n${content}`)
          .join("\n\n");
        child.stdin.once("error", (error) => {
          if (!settled) finish(new LlmError(`Unable to send prompt to Claude Code CLI: ${error.message}`, "LLM_UNAVAILABLE", true));
        });
        child.stdin.end(prompt);
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
}

export function resolveClaudeCliPath(binary: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const isPath = isAbsolute(binary) || binary.includes("/") || binary.includes("\\");
  if (isPath) return isRunnableFile(resolve(binary)) ? resolve(binary) : null;
  const searchPath = env.PATH ?? env.Path ?? "";
  const extensions = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter((extension) => extension.toLowerCase() !== ".cmd" && extension.toLowerCase() !== ".bat")
    : [""];
  for (const directory of searchPath.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, binary.toLowerCase().endsWith(extension.toLowerCase()) ? binary : `${binary}${extension}`);
      if (isRunnableFile(candidate)) return resolve(candidate);
    }
  }
  return null;
}

function isRunnableFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function minimalEnvironment(): NodeJS.ProcessEnv {
  const names = [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "CLAUDE_CONFIG_DIR",
  ];
  return Object.fromEntries(names.flatMap((name) =>
    process.env[name] === undefined ? [] : [[name, process.env[name]]],
  ));
}

function parseCliResponse(output: string): {
  result: string;
  model: string | undefined;
  usage: { inputTokens: number; outputTokens: number };
  isError: boolean;
} | undefined {
  try {
    const value = JSON.parse(output.trim()) as Record<string, unknown>;
    if (typeof value.result !== "string") return undefined;
    const usage = typeof value.usage === "object" && value.usage !== null
      ? value.usage as Record<string, unknown>
      : {};
    const modelUsage = typeof value.modelUsage === "object" && value.modelUsage !== null
      ? Object.values(value.modelUsage as Record<string, unknown>).find((item) => typeof item === "object" && item !== null) as Record<string, unknown> | undefined
      : undefined;
    const inputTokens = numeric(usage.input_tokens) ?? numeric(modelUsage?.inputTokens) ?? 0;
    const outputTokens = numeric(usage.output_tokens) ?? numeric(modelUsage?.outputTokens) ?? 0;
    return {
      result: value.result,
      model: typeof value.model === "string" ? value.model : undefined,
      usage: { inputTokens, outputTokens },
      isError: value.is_error === true || value.subtype === "error",
    };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function mapSpawnError(error: unknown): LlmError {
  const value = error as NodeJS.ErrnoException;
  return value.code === "ENOENT"
    ? new LlmError("Claude Code CLI was not found. Install Claude Code CLI and set CLAUDE_CLI_PATH if needed.", "LLM_NOT_CONFIGURED", false)
    : new LlmError(value.message ?? "Unable to start Claude Code CLI.", "LLM_UNAVAILABLE", true);
}

function classifyCliFailure(message: string): LlmError {
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

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => { child.kill(); });
    child.kill();
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

async function withProcessLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = processQueue;
  let release: () => void = () => {};
  processQueue = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}
