import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { looksLoggedOut, mergeStreamText, parseStreamLine } from "./parser.js";
import { restoreOutsideNotes, snapshotOutsideNotes } from "./writeGuard.js";

export type Spawned = {
  stdout: Readable | null;
  stderr: Readable | null;
  pid?: number;
  kill: (signal?: NodeJS.Signals) => boolean;
  on: (event: string, listener: (...args: any[]) => void) => void;
};

export type SpawnFn = (command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) => Spawned;

export const defaultSpawn: SpawnFn = (command, args, options) => {
  const child = spawn(command, args, { ...options, windowsHide: true });
  return child as unknown as Spawned;
};

export type CursorRunResult = {
  chatId: string | null;
  text: string;
  tools: string[];
  loggedOut: boolean;
  timedOut: boolean;
  exitCode: number | null;
  writeViolations: string[];
  stderr: string;
};

export async function runCursorProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  spawnImpl?: SpawnFn;
  onDelta?: (text: string) => void;
  onTool?: (name: string) => void;
  shouldStop?: () => boolean;
}): Promise<CursorRunResult> {
  const spawnImpl = input.spawnImpl ?? defaultSpawn;
  const before = snapshotOutsideNotes(input.cwd);
  const child = spawnImpl(input.command, input.args, { cwd: input.cwd, env: input.env });
  let text = "";
  const tools: string[] = [];
  let chatId: string | null = null;
  let stderr = "";
  let timedOut = false;
  let settled = false;

  const done = new Promise<{ code: number | null }>((resolve) => {
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code });
    };
    child.on("exit", ((code: number | null) => finish(code)) as (...args: any[]) => void);
    child.on("error", ((error: Error) => {
      stderr += `${error.message}\n`;
      finish(1);
    }) as (...args: any[]) => void);
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
      try {
        child.kill("SIGTERM");
      } catch {
        // The process may already be gone.
      }
    }, input.timeoutMs);
    const stopTimer = setInterval(() => {
      if (!input.shouldStop?.()) return;
      clearInterval(stopTimer);
      timedOut = true;
      killProcessTree(child.pid);
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }, 200);
    child.on("exit", (() => clearInterval(stopTimer)) as (...args: any[]) => void);
  });

  const stdoutDone = collect(child.stdout, (line) => {
    const event = parseStreamLine(line);
    if (event.type === "init") chatId = event.chatId;
    if (event.type === "delta") {
      text = mergeStreamText(text, event.text);
      input.onDelta?.(text);
    }
    if (event.type === "tool") {
      tools.push(event.name);
      input.onTool?.(event.name);
    }
    if (event.type === "result" && event.text) text = mergeStreamText(text, event.text);
  });
  const stderrDone = collect(child.stderr, (line) => {
    stderr += `${line}\n`;
  });

  const exit = await done;
  // stderr often arrives just after exit ("Authentication required…").
  // Destroying immediately drops it. A killed mock may never end its pipes,
  // so close those after a short wait.
  if (!streamSettled(child.stdout) || !streamSettled(child.stderr)) {
    await Promise.race([
      Promise.all([stdoutDone, stderrDone]),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  }
  if (!streamSettled(child.stdout)) child.stdout?.destroy();
  if (!streamSettled(child.stderr)) child.stderr?.destroy();
  await Promise.all([stdoutDone, stderrDone]);
  const writeViolations = restoreOutsideNotes(input.cwd, before);
  const combined = `${text}\n${stderr}`;
  return {
    chatId,
    text,
    tools,
    loggedOut: looksLoggedOut(combined),
    timedOut,
    exitCode: exit.code,
    writeViolations,
    stderr,
  };
}

function streamSettled(stream: Readable | null): boolean {
  if (!stream) return true;
  return stream.readableEnded || stream.destroyed;
}

function collect(stream: Readable | null, onLine: (line: string) => void): Promise<void> {
  if (!stream) return Promise.resolve();
  return new Promise((resolve) => {
    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    });
    const finish = () => {
      if (buffer.trim()) onLine(buffer);
      buffer = "";
      resolve();
    };
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
  });
}

export function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      // The mock process has no OS pid.
    }
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already exited
  }
}

export function scriptedProcess(script: {
  stdout?: string[];
  stderr?: string[];
  exitCode?: number;
  hang?: boolean;
}): SpawnFn {
  return () => {
    const emitter = new EventEmitter();
    let killed = false;
    const stdout = Readable.from((script.stdout ?? []).map((line) => `${line}\n`));
    const stderr = Readable.from((script.stderr ?? []).map((line) => `${line}\n`));
    const child: Spawned = {
      stdout,
      stderr,
      kill: () => {
        if (!killed) {
          killed = true;
          queueMicrotask(() => emitter.emit("exit", null, "SIGTERM"));
        }
        return true;
      },
      on: (event, listener) => {
        emitter.on(event, listener);
      },
    };
    if (!script.hang) {
      queueMicrotask(() => {
        if (!killed) emitter.emit("exit", script.exitCode ?? 0, null);
      });
    }
    return child;
  };
}

export type { ChildProcess };
