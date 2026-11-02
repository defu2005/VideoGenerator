import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { constants } from "node:fs";
import { accessSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import type { LlmProvider, LlmProviderLimits, LlmRequest, LlmResponse } from "./types.js";
import { LlmError } from "./types.js";

export type ParsedCliResponse = {
  result: string;
  model?: string;
  usage: { inputTokens: number; outputTokens: number; tokensUnknown?: boolean };
  isError: boolean;
};

type SpawnFunction = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

export type CliProviderOptions = {
  id: string;
  label: string;
  binaryPath: string | null;
  dataDir: string;
  timeoutMs: number;
  defaultModel: string | null;
  hint: string;
  limits?: LlmProviderLimits;
  command?: string;
  argsPrefix?: string[];
  args(request: LlmRequest, cwd: string): string[];
  formatPrompt(request: LlmRequest): string;
  parseResponse(output: string): ParsedCliResponse | undefined;
  classifyFailure(message: string): LlmError;
  mapSpawnError(error: unknown): LlmError;
  spawnProcess?: SpawnFunction;
};

let processQueue: Promise<void> = Promise.resolve();

export class CliProviderBase implements LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly defaultModel: string | null;
  readonly configured: boolean;
  readonly hint: string;
  readonly limits?: LlmProviderLimits;

  constructor(private readonly options: CliProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.defaultModel = options.defaultModel;
    this.configured = options.binaryPath !== null;
    this.hint = options.hint;
    this.limits = options.limits;
  }

  generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    if (!this.options.binaryPath) {
      return Promise.reject(new LlmError(this.hint, "LLM_NOT_CONFIGURED", false));
    }
    return withProcessLock(() => this.run(request, signal));
  }

  private async run(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    if (signal.aborted) {
      throw new LlmError(`${this.label} request was aborted.`, "LLM_TIMEOUT", true);
    }
    const root = join(this.options.dataDir, "tmp", this.id);
    mkdirSync(root, { recursive: true });
    const cwd = mkdtempSync(join(root, "run-"));
    try {
      return await new Promise<LlmResponse>((resolvePromise, rejectPromise) => {
        const args = [
          ...(this.options.argsPrefix ?? []),
          ...this.options.args(request, cwd),
        ];
        let child: ChildProcessWithoutNullStreams;
        try {
          child = (this.options.spawnProcess ?? ((command, childArgs, spawnOptions) =>
            spawn(command, childArgs, spawnOptions) as ChildProcessWithoutNullStreams))(
            this.options.command ?? this.options.binaryPath!,
            args,
            {
              cwd,
              env: minimalCliEnvironment(),
              shell: false,
              detached: process.platform !== "win32",
              windowsHide: true,
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
        } catch (error) {
          rejectPromise(this.options.mapSpawnError(error));
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
          else rejectPromise(new LlmError(`${this.label} returned no response.`, "LLM_INVALID_OUTPUT", false));
        };
        const stop = (error: LlmError) => {
          if (settled || stoppingWith) return;
          stoppingWith = error;
          terminateProcessTree(child);
          killWait = setTimeout(() => finish(error), 1_000);
        };
        const abort = () => {
          stop(new LlmError(`${this.label} request was aborted.`, "LLM_TIMEOUT", true));
        };
        const timeout = setTimeout(
          () => stop(new LlmError(`${this.label} request timed out.`, "LLM_TIMEOUT", true)),
          this.options.timeoutMs,
        );
        signal.addEventListener("abort", abort, { once: true });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => { stdout += chunk; });
        child.stderr.on("data", (chunk: string) => { stderr += chunk; });
        child.once("error", (error) => finish(this.options.mapSpawnError(error)));
        child.once("close", (code) => {
          if (settled) return;
          if (stoppingWith) {
            finish(stoppingWith);
            return;
          }
          const parsed = this.options.parseResponse(stdout);
          if (code !== 0) {
            finish(this.options.classifyFailure(`${parsed?.result ?? ""}\n${stderr}\n${stdout}`.trim()));
            return;
          }
          if (!parsed) {
            finish(new LlmError(`${this.label} returned invalid output.`, "LLM_INVALID_OUTPUT", false));
            return;
          }
          if (parsed.isError) {
            finish(this.options.classifyFailure(parsed.result));
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
        child.stdin.once("error", (error) => {
          if (!settled) finish(new LlmError(`Unable to send prompt to ${this.label}: ${error.message}`, "LLM_UNAVAILABLE", true));
        });
        child.stdin.end(this.options.formatPrompt(request));
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
}

export function resolveCliPath(binary: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const isPath = isAbsolute(binary) || binary.includes("/") || binary.includes("\\");
  if (isPath) return isRunnableFile(resolve(binary)) ? resolve(binary) : null;
  const searchPath = env.PATH ?? env.Path ?? "";
  // On Windows, npm also installs an extension-less POSIX shell shim next to the .cmd/.ps1
  // wrappers; it cannot be spawned without a shell, so only real executables count here.
  const extensions = process.platform === "win32" ? [".EXE"] : [""];
  for (const directory of searchPath.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, binary.toLowerCase().endsWith(extension.toLowerCase()) ? binary : `${binary}${extension}`);
      if (isRunnableFile(candidate)) return resolve(candidate);
    }
  }
  return null;
}

export function resolveCopilotCliLaunch(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; argsPrefix: string[]; binaryPath: string } | null {
  const direct = resolveCliPath(binary, env);
  if (direct && !/\.(?:cmd|bat|ps1)$/i.test(direct)) {
    return { command: direct, argsPrefix: [], binaryPath: direct };
  }

  const hasPath = isAbsolute(binary) || binary.includes("/") || binary.includes("\\");
  const searchPath = env.PATH ?? env.Path ?? "";
  const candidates = hasPath
    ? [resolve(binary)]
    : searchPath.split(delimiter).filter(Boolean).map((directory) => join(directory, binary));
  for (const candidate of candidates) {
    const wrappers = process.platform === "win32" ? [candidate, `${candidate}.cmd`, `${candidate}.ps1`] : [];
    for (const wrapper of wrappers) {
      if (!existsSync(wrapper)) continue;
      const loader = join(dirname(wrapper), "node_modules", "@github", "copilot", "npm-loader.js");
      if (existsSync(loader)) {
        return { command: process.execPath, argsPrefix: [loader], binaryPath: loader };
      }
    }
  }
  return null;
}

export function minimalCliEnvironment(): NodeJS.ProcessEnv {
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

export function parseJsonCliResponse(output: string): ParsedCliResponse | undefined {
  try {
    const value = JSON.parse(output.trim()) as Record<string, unknown>;
    if (typeof value.result !== "string") return undefined;
    const usage = record(value.usage);
    const modelUsage = Object.values(record(value.modelUsage)).find(isRecord);
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

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
