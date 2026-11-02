import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COPILOT_CLI_FLAGS, CopilotCliProvider } from "../src/providers/llm/copilotCli.js";
import { resolveCopilotCliLaunch } from "../src/providers/llm/cliProvider.js";
import type { LlmRequest } from "../src/providers/llm/types.js";

let root: string;
let fakeScript: string;

const request = (system = "test system", prompt = "test prompt", model = "copilot-model"): LlmRequest => ({
  model,
  system,
  messages: [{ role: "user", content: prompt }],
  maxOutputTokens: 200,
  json: true,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vg-copilot-cli-test-"));
  fakeScript = join(root, "fake-copilot.js");
  writeFileSync(fakeScript, fakeCliSource());
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeCliSource(): string {
  return `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (input.includes("COPILOT_HANG")) { setInterval(() => {}, 1000); return; }
  if (input.includes("COPILOT_AUTH")) { process.stdout.write("not licensed to use Copilot"); process.exitCode = 1; return; }
  if (input.includes("COPILOT_QUOTA")) { process.stdout.write("Copilot quota limit reached"); process.exitCode = 1; return; }
  process.stdout.write([
    JSON.stringify({ type: "assistant.message", data: { content: "{\\"ok\\":true}" } }),
    JSON.stringify({ type: "assistant.turn_end", data: { model: "copilot-test", usage: { input_tokens: 4, output_tokens: 6 } } })
  ].join("\\n"));
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
} = {}): CopilotCliProvider {
  return new CopilotCliProvider(
    "fake-copilot",
    root,
    options.timeout ?? 5_000,
    "copilot-model",
    options.spawnProcess ?? ((_command, args, spawnOptions) =>
      spawn(process.execPath, [fakeScript, ...args], spawnOptions) as ChildProcessWithoutNullStreams),
  );
}

describe("GitHub Copilot CLI provider", () => {
  it("resolves the Windows npm command shim to its Node entrypoint without a shell", () => {
    if (process.platform !== "win32") return;
    const bin = join(root, "bin");
    const loader = join(bin, "node_modules", "@github", "copilot", "npm-loader.js");
    mkdirSync(join(bin, "node_modules", "@github", "copilot"), { recursive: true });
    writeFileSync(join(bin, "copilot.cmd"), "@ECHO off");
    writeFileSync(loader, "");
    expect(resolveCopilotCliLaunch("copilot", { PATH: bin })).toEqual({
      command: process.execPath,
      argsPrefix: [loader],
      binaryPath: loader,
    });
  });

  it("ignores npm's extension-less POSIX shim on Windows (real npm layout)", () => {
    if (process.platform !== "win32") return;
    const bin = join(root, "npm-layout");
    const loader = join(bin, "node_modules", "@github", "copilot", "npm-loader.js");
    mkdirSync(join(bin, "node_modules", "@github", "copilot"), { recursive: true });
    writeFileSync(join(bin, "copilot"), "#!/bin/sh\nexec node npm-loader.js \"$@\"\n");
    writeFileSync(join(bin, "copilot.cmd"), "@ECHO off");
    writeFileSync(join(bin, "copilot.ps1"), "#!/usr/bin/env pwsh");
    writeFileSync(loader, "");
    expect(resolveCopilotCliLaunch("copilot", { PATH: bin })).toEqual({
      command: process.execPath,
      argsPrefix: [loader],
      binaryPath: loader,
    });
  });

  it("uses the documented text-only invocation and parses JSONL output", async () => {
    let capturedOptions: SpawnOptions | undefined;
    let capturedArgs: string[] = [];
    const cli = provider({
      spawnProcess: (_command, args, options) => {
        capturedOptions = options;
        capturedArgs = args;
        return spawn(process.execPath, [fakeScript, ...args], options) as ChildProcessWithoutNullStreams;
      },
    });
    const result = await cli.generate(request(), new AbortController().signal);
    expect(result).toMatchObject({
      text: "{\"ok\":true}",
      model: "copilot-test",
      provider: "copilot-cli",
      usage: { inputTokens: 4, outputTokens: 6 },
      finishReason: "stop",
    });
    expect(capturedOptions).toMatchObject({
      shell: false,
      cwd: expect.stringContaining(join(root, "tmp", "copilot-cli")),
    });
    expect(capturedArgs).toEqual(expect.arrayContaining([
      COPILOT_CLI_FLAGS.silent,
      "--output-format",
      "json",
      COPILOT_CLI_FLAGS.availableTools,
      COPILOT_CLI_FLAGS.disableBuiltinMcps,
      COPILOT_CLI_FLAGS.disallowTempDir,
      "--model",
      "copilot-model",
    ]));
    // Prompt goes over stdin; `-p` would require an argument (verified on CLI 1.0.105).
    expect(capturedArgs).not.toContain("-p");
    expect(capturedArgs).not.toContain("--allow-all-tools");
  });

  it("parses real CLI 1.0.105 JSONL: final_answer wins over status strings like 'success'", async () => {
    const realJsonl = readFileSync(fileURLToPath(new URL("./fixtures/copilot-cli-1.0.105.jsonl", import.meta.url)), "utf8");
    writeFileSync(fakeScript, `
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(${JSON.stringify(realJsonl)}));
`);
    const result = await provider().generate(request(), new AbortController().signal);
    expect(result.text).toBe("OK");
    expect(result.usage.tokensUnknown).toBe(true);
  });

  it("treats CLI argument errors as not sent and non-retryable", async () => {
    writeFileSync(fakeScript, `
process.stdin.resume();
process.stdin.on("end", () => { process.stderr.write("error: a value is required for '--prompt <text>' but none was supplied\\n\\nFor more information, try '--help'.\\n"); process.exit(2); });
`);
    await expect(provider().generate(request(), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED", retryable: false });
  });

  it("marks missing token counts and maps auth and quota failures as non-retryable", async () => {
    const cli = provider();
    const success = await cli.generate(request(), new AbortController().signal);
    expect(success.usage.tokensUnknown).toBeUndefined();

    await expect(cli.generate(request("COPILOT_AUTH"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_AUTH", retryable: false });
    await expect(cli.generate(request("COPILOT_QUOTA"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_QUOTA_EXHAUSTED", retryable: false });
  });

  it("marks absent usage as unknown and kills the child process on abort", async () => {
    writeFileSync(fakeScript, `
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write("{\\"ok\\":true}"));
`);
    const noUsage = await provider().generate(request(), new AbortController().signal);
    expect(noUsage).toMatchObject({
      text: "{\"ok\":true}",
      usage: { inputTokens: 0, outputTokens: 0, tokensUnknown: true },
    });

    writeFileSync(fakeScript, `
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => { setInterval(() => {}, 1000); });
`);
    let child: ChildProcessWithoutNullStreams | undefined;
    const abortController = new AbortController();
    const pending = provider({
      spawnProcess: (_command, args, spawnOptions) => {
        child = spawn(process.execPath, [fakeScript, ...args], spawnOptions) as ChildProcessWithoutNullStreams;
        return child;
      },
    }).generate(request(), abortController.signal);
    setTimeout(() => abortController.abort(), 50);
    await expect(pending).rejects.toMatchObject({ code: "LLM_TIMEOUT", retryable: true });
    expect(child?.killed).toBe(true);
  });
});
