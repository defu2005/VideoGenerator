import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_CLI_FLAGS, ClaudeCliProvider } from "../src/providers/llm/claudeCli.js";
import { parseJsonCliResponse } from "../src/providers/llm/cliProvider.js";
import type { LlmRequest } from "../src/providers/llm/types.js";

let root: string;
let fakeScript: string;

const request = (system = "test system", prompt = "test prompt", model = "claude-test"): LlmRequest => ({
  model,
  system,
  messages: [{ role: "user", content: prompt }],
  maxOutputTokens: 200,
  json: false,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vg-claude-cli-test-"));
  fakeScript = join(root, "fake-cli.js");
  writeFileSync(fakeScript, fakeCliSource());
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeCliSource(): string {
  return `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const flagIndex = process.argv.indexOf("--system-prompt");
  const mode = process.argv[flagIndex + 1];
  if (mode === "hang") { setInterval(() => {}, 1000); return; }
  if (mode === "invalid") { process.stdout.write("not-json"); return; }
  if (mode === "auth") { process.stdout.write("not logged in"); process.exitCode = 1; return; }
  if (mode === "rate") { process.stdout.write("rate limit reached"); process.exitCode = 1; return; }
  process.stdout.write(JSON.stringify({
    result: mode === "length" ? String(input.length) : input,
    model: "claude-test",
    usage: { input_tokens: 17, output_tokens: 23 },
    total_cost_usd: 2.5
  }));
});
`;
}

function provider(options: {
  timeout?: number;
  spawnProcess?: (
    command: string,
    args: string[],
    spawnOptions: SpawnOptions,
  ) => ChildProcessWithoutNullStreams;
} = {}): ClaudeCliProvider {
  return new ClaudeCliProvider(
    "fake-claude",
    root,
    options.timeout ?? 5_000,
    null,
    options.spawnProcess ?? ((_command, args, spawnOptions) =>
      spawn(process.execPath, [fakeScript, ...args], spawnOptions) as ChildProcessWithoutNullStreams),
  );
}

describe("Claude Code CLI provider", () => {
  it("sends a large prompt over stdin and parses JSON text and token usage", async () => {
    let capturedOptions: SpawnOptions | undefined;
    let capturedArgs: string[] = [];
    const cli = provider({
      spawnProcess: (_command, args, options) => {
        capturedOptions = options;
        capturedArgs = args;
        return spawn(process.execPath, [fakeScript, ...args], options) as ChildProcessWithoutNullStreams;
      },
    });
    const prompt = "x".repeat(45_000);
    const response = await cli.generate(request("length", prompt), new AbortController().signal);
    expect(response).toMatchObject({
      text: String("User:\n".length + prompt.length),
      model: "claude-test",
      provider: "claude-cli",
      usage: { inputTokens: 17, outputTokens: 23 },
      finishReason: "stop",
    });
    expect(capturedOptions).toMatchObject({ shell: false, cwd: expect.stringContaining(join(root, "tmp", "claude-cli")) });
    expect(capturedArgs).toContain(CLAUDE_CLI_FLAGS.print);
    expect(capturedArgs).toContain("--output-format");
    expect(capturedArgs).toContain("--system-prompt");
    expect(capturedArgs).toContain("--max-turns");
    expect(capturedArgs).toContain("--tools");
    expect(capturedArgs).toContain("--disallowedTools");
    expect(capturedArgs).toContain("mcp__*");
    expect(Object.keys(capturedOptions?.env ?? {}).sort()).toEqual(expect.arrayContaining(["HOME", "PATH", "USERPROFILE"].filter((key) => process.env[key] !== undefined)));
  });

  it("maps authentication, rate limit, malformed output, and missing-binary errors", async () => {
    const cli = provider();
    await expect(cli.generate(request("auth"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_AUTH", retryable: false });
    await expect(cli.generate(request("rate"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_RATE_LIMIT", retryable: true });
    await expect(cli.generate(request("invalid"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT", retryable: false });

    const missing = provider({
      spawnProcess: () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    });
    await expect(missing.generate(request(), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED", retryable: false });
  });

  it("kills the CLI process on abort and timeout", async () => {
    let child: ChildProcessWithoutNullStreams | undefined;
    const abortController = new AbortController();
    const aborting = provider({
      spawnProcess: (_command, args, options) => {
        child = spawn(process.execPath, [fakeScript, ...args], options) as ChildProcessWithoutNullStreams;
        return child;
      },
    }).generate(request("hang"), abortController.signal);
    setTimeout(() => abortController.abort(), 50);
    await expect(aborting).rejects.toMatchObject({ code: "LLM_TIMEOUT", retryable: true });
    expect(child?.killed).toBe(true);

    const timed = provider({ timeout: 50 });
    await expect(timed.generate(request("hang"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_TIMEOUT", retryable: true });
  });

  it("serializes concurrent provider calls", async () => {
    const lockFile = join(root, "running");
    const script = `
const fs = require("node:fs");
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (fs.existsSync(${JSON.stringify(lockFile)})) process.exit(9);
  fs.writeFileSync(${JSON.stringify(lockFile)}, "1");
  setTimeout(() => {
    fs.unlinkSync(${JSON.stringify(lockFile)});
    process.stdout.write(JSON.stringify({ result: input, usage: { input_tokens: 1, output_tokens: 1 } }));
  }, 100);
});
`;
    writeFileSync(fakeScript, script);
    const cli = provider();
    const results = await Promise.all([
      cli.generate(request(), new AbortController().signal),
      cli.generate(request(), new AbortController().signal),
    ]);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.text)).toEqual(["User:\ntest prompt", "User:\ntest prompt"]);
  });

  it("aborts before spawning when the signal is already cancelled", async () => {
    const spawnProcess = vi.fn();
    const cli = provider({ spawnProcess });
    const controller = new AbortController();
    controller.abort();
    await expect(cli.generate(request(), controller.signal)).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});

describe("Claude CLI token usage", () => {
  it("counts cached prompt tokens as input", () => {
    const parsed = parseJsonCliResponse(JSON.stringify({
      result: "ok",
      usage: { input_tokens: 2, cache_creation_input_tokens: 1500, cache_read_input_tokens: 9000, output_tokens: 40 },
    }));
    expect(parsed?.usage).toEqual({ inputTokens: 10502, outputTokens: 40 });
  });
});
