import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AntgravityCliProvider,
  parseAgyResponse,
  classifyAgyFailure,
  mapAgySpawnError,
  resolveAgyPath,
  resolveAgyPathWithRetry,
  AGY_STATIC_MODELS,
  AGY_ARG_PROMPT_LIMIT,
} from "../src/providers/llm/antigravityCli.js";
import type { LlmRequest } from "../src/providers/llm/types.js";

let root: string;
let fakeScript: string;

const request = (prompt = "test prompt", system = "test system", model = ""): LlmRequest => ({
  model,
  system,
  messages: [{ role: "user", content: prompt }],
  maxOutputTokens: 200,
  json: false,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vg-agy-test-"));
  fakeScript = join(root, "fake-agy.js");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Write a fake agy.js script and return a spawnProcess function that runs it. */
function makeFakeSpawn(source: string): CliProviderOptions["spawnProcess"] {
  writeFileSync(fakeScript, source);
  return (_command: string, args: string[], opts: SpawnOptions) =>
    spawn(process.execPath, [fakeScript, ...args], opts) as ChildProcessWithoutNullStreams;
}

type CliProviderOptions = { spawnProcess?: (c: string, a: string[], o: SpawnOptions) => ChildProcessWithoutNullStreams };

function provider(options: { timeout?: number; spawnProcess?: CliProviderOptions["spawnProcess"]; model?: string | null; effort?: string } = {}): AntgravityCliProvider {
  return new AntgravityCliProvider(
    "fake-agy",
    root,
    options.timeout ?? 5_000,
    options.model ?? null,
    options.effort ?? "medium",
    options.spawnProcess,
  );
}

// ---------------------------------------------------------------------------
// 1. Parse JSON response and verify usage mapping
// ---------------------------------------------------------------------------
describe("parseAgyResponse", () => {
  it("maps input_tokens + cache_read_tokens → inputTokens, output_tokens + thinking_tokens → outputTokens", () => {
    const json = JSON.stringify({
      conversation_id: "c1",
      status: "SUCCESS",
      response: "Hello world",
      usage: {
        input_tokens: 7641,
        output_tokens: 452,
        thinking_tokens: 447,
        cache_read_tokens: 100,
        total_tokens: 8640,
      },
      denied_actions: [],
    });
    const parsed = parseAgyResponse(json);
    expect(parsed).toBeDefined();
    expect(parsed!.isError).toBe(false);
    expect(parsed!.result).toBe("Hello world");
    expect(parsed!.usage.inputTokens).toBe(7641 + 100); // input + cache_read
    expect(parsed!.usage.outputTokens).toBe(452 + 447); // output + thinking
  });

  it("returns isError=true when status != SUCCESS", () => {
    const json = JSON.stringify({ status: "FAILED", response: "something went wrong", usage: {}, denied_actions: [] });
    const parsed = parseAgyResponse(json);
    expect(parsed).toBeDefined();
    expect(parsed!.isError).toBe(true);
  });

  it("returns denied_actions signal when denied_actions non-empty and response empty", () => {
    const json = JSON.stringify({
      status: "SUCCESS",
      response: "",
      usage: {},
      denied_actions: [{ action: "command", display_name: "RunCommand" }],
    });
    const parsed = parseAgyResponse(json);
    expect(parsed).toBeDefined();
    expect(parsed!.result).toBe("denied_actions");
    expect(parsed!.isError).toBe(true);
  });

  it("returns undefined for non-JSON input", () => {
    expect(parseAgyResponse("not-json")).toBeUndefined();
  });

  it("strips code fences from response", () => {
    const json = JSON.stringify({
      status: "SUCCESS",
      response: "```json\n{\"key\": \"value\"}\n```",
      usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0 },
      denied_actions: [],
    });
    const parsed = parseAgyResponse(json);
    expect(parsed!.result).toBe('{"key": "value"}');
  });
});

// ---------------------------------------------------------------------------
// 2. classifyAgyFailure tests
// ---------------------------------------------------------------------------
describe("classifyAgyFailure", () => {
  it("maps denied_actions signal → LLM_INVALID_OUTPUT, not retryable", () => {
    const err = classifyAgyFailure("denied_actions");
    expect(err.code).toBe("LLM_INVALID_OUTPUT");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("công cụ");
  });

  it("maps not eligible → LLM_NOT_CONFIGURED, not retryable", () => {
    const err = classifyAgyFailure("user not eligible for this feature");
    expect(err.code).toBe("LLM_NOT_CONFIGURED");
    expect(err.retryable).toBe(false);
  });

  it("maps sign in → LLM_NOT_CONFIGURED", () => {
    const err = classifyAgyFailure("Please sign in to continue");
    expect(err.code).toBe("LLM_NOT_CONFIGURED");
  });

  it("maps IneligibleTier → LLM_NOT_CONFIGURED", () => {
    const err = classifyAgyFailure("IneligibleTier: account not eligible");
    expect(err.code).toBe("LLM_NOT_CONFIGURED");
  });

  it("maps quota → LLM_QUOTA_EXHAUSTED, not retryable", () => {
    const err = classifyAgyFailure("quota exceeded");
    expect(err.code).toBe("LLM_QUOTA_EXHAUSTED");
    expect(err.retryable).toBe(false);
  });

  it("maps RESOURCE_EXHAUSTED → LLM_QUOTA_EXHAUSTED, not retryable", () => {
    const err = classifyAgyFailure("RESOURCE_EXHAUSTED: quota hit");
    expect(err.code).toBe("LLM_QUOTA_EXHAUSTED");
    expect(err.retryable).toBe(false);
  });

  it("maps 429 → LLM_RATE_LIMIT", () => {
    const err = classifyAgyFailure("HTTP 429 rate limit");
    expect(err.code).toBe("LLM_RATE_LIMIT");
  });

  it("maps unknown model → LLM_NOT_CONFIGURED", () => {
    const err = classifyAgyFailure("unknown model: gemini-99-super");
    expect(err.code).toBe("LLM_NOT_CONFIGURED");
  });

  it("maps empty message → LLM_INVALID_OUTPUT, not retryable", () => {
    const err = classifyAgyFailure("");
    expect(err.code).toBe("LLM_INVALID_OUTPUT");
    expect(err.retryable).toBe(false);
  });

  it("maps unknown error → LLM_UNAVAILABLE, retryable", () => {
    const err = classifyAgyFailure("some unexpected error");
    expect(err.code).toBe("LLM_UNAVAILABLE");
    expect(err.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. mapAgySpawnError tests
// ---------------------------------------------------------------------------
describe("mapAgySpawnError", () => {
  it("maps ENOENT → LLM_NOT_CONFIGURED, not retryable", () => {
    const err = mapAgySpawnError(Object.assign(new Error("not found"), { code: "ENOENT" }));
    expect(err.code).toBe("LLM_NOT_CONFIGURED");
    expect(err.retryable).toBe(false);
  });

  it("maps other spawn errors → LLM_UNAVAILABLE, retryable", () => {
    const err = mapAgySpawnError(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    expect(err.code).toBe("LLM_UNAVAILABLE");
    expect(err.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Args format: --print=<prompt>, --mode plan, --output-format json
// ---------------------------------------------------------------------------
describe("Antigravity CLI provider args and integration", () => {
  it("sends prompt via --print= flag (not stdin), with --mode plan and --output-format json", async () => {
    let capturedArgs: string[] = [];
    let capturedStdin = "";

    const source = `
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => stdin += chunk);
process.stdin.on("end", () => {
  // Write stdin content to stderr so test can detect it
  if (stdin) process.stderr.write("STDIN:" + stdin);
  const printArg = process.argv.find(a => a.startsWith("--print="));
  const prompt = printArg ? printArg.slice("--print=".length) : "";
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: "OK: " + prompt.slice(0, 20),
    usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2, cache_read_tokens: 0 },
    denied_actions: [],
  }));
});
`;
    const spawnFn = makeFakeSpawn(source);

    const cli = new AntgravityCliProvider(
      "fake-agy",
      root,
      5_000,
      null,
      "medium",
      (_cmd, args, opts) => {
        capturedArgs = args;
        return spawnFn(_cmd, args, opts)!;
      },
    );

    await cli.generate(request("hello world", "sys"), new AbortController().signal);

    // Must contain --print=... (with = syntax)
    const printArg = capturedArgs.find((a) => a.startsWith("--print="));
    expect(printArg).toBeDefined();
    expect(printArg).toContain("sys");
    expect(printArg).toContain("hello world");

    // Must NOT have --print as separate arg (separate is claude style)
    const printIndex = capturedArgs.indexOf("--print");
    expect(printIndex).toBe(-1);

    // Must have --mode plan
    const modeIndex = capturedArgs.indexOf("--mode");
    expect(modeIndex).toBeGreaterThan(-1);
    expect(capturedArgs[modeIndex + 1]).toBe("plan");

    // Must have --output-format json
    const fmtIndex = capturedArgs.indexOf("--output-format");
    expect(fmtIndex).toBeGreaterThan(-1);
    expect(capturedArgs[fmtIndex + 1]).toBe("json");

    // Must have --print-timeout
    const toIndex = capturedArgs.indexOf("--print-timeout");
    expect(toIndex).toBeGreaterThan(-1);
    expect(capturedArgs[toIndex + 1]).toMatch(/^\d+s$/);
  });

  it("includes --model and --effort when provided", async () => {
    let capturedArgs: string[] = [];
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: "answer",
    usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0 },
    denied_actions: [],
  }));
});
`;
    const spawnFn = makeFakeSpawn(source);
    const cli = new AntgravityCliProvider(
      "fake-agy",
      root,
      5_000,
      null,
      "high",
      (_cmd, args, opts) => {
        capturedArgs = args;
        return spawnFn(_cmd, args, opts)!;
      },
    );

    await cli.generate(request("prompt", "sys", "claude-sonnet-4-6"), new AbortController().signal);

    expect(capturedArgs).toContain("--model");
    expect(capturedArgs[capturedArgs.indexOf("--model") + 1]).toBe("claude-sonnet-4-6");
    expect(capturedArgs).toContain("--effort");
    expect(capturedArgs[capturedArgs.indexOf("--effort") + 1]).toBe("high");
  });

  it("omits --effort when no effort is set (agy rejects it for claude-sonnet-4-6)", async () => {
    let capturedArgs: string[] = [];
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: "answer",
    usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0 },
    denied_actions: [],
  }));
});
`;
    const spawnFn = makeFakeSpawn(source);
    const cli = new AntgravityCliProvider("fake-agy", root, 5_000, null, "", (_cmd, args, opts) => {
      capturedArgs = args;
      return spawnFn(_cmd, args, opts)!;
    });

    await cli.generate(request("prompt", "sys", "claude-sonnet-4-6"), new AbortController().signal);

    expect(capturedArgs).not.toContain("--effort");
  });

  it("does not pass --json-schema for structured requests", async () => {
    let capturedArgs: string[] = [];
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: "ok",
    usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0 },
    denied_actions: [],
  }));
});
`;
    const spawnFn = makeFakeSpawn(source);
    const cli = new AntgravityCliProvider(
      "fake-agy",
      root,
      5_000,
      null,
      "medium",
      (_cmd, args, opts) => {
        capturedArgs = args;
        return spawnFn(_cmd, args, opts)!;
      },
    );
    const response = await cli.generate({
      ...request("structured", "sys"),
      json: true,
      schemaName: "ExampleResponse",
      jsonSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    }, new AbortController().signal);
    expect(response.text).toBe("ok");
    expect(capturedArgs).not.toContain("--json-schema");
  });

  it("parses success JSON, returns correct usage (input+cache, output+thinking)", async () => {
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: "The answer",
    usage: { input_tokens: 7641, output_tokens: 452, thinking_tokens: 447, cache_read_tokens: 100 },
    denied_actions: [],
  }));
});
`;
    const cli = provider({ spawnProcess: makeFakeSpawn(source) });
    const response = await cli.generate(request("q"), new AbortController().signal);
    expect(response.text).toBe("The answer");
    expect(response.usage.inputTokens).toBe(7641 + 100);
    expect(response.usage.outputTokens).toBe(452 + 447);
    expect(response.provider).toBe("antigravity-cli");
    expect(response.finishReason).toBe("stop");
  });

  it("handles non-SUCCESS status as error", async () => {
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    status: "QUOTA_EXCEEDED",
    response: "quota exceeded",
    usage: {},
    denied_actions: [],
  }));
  process.exitCode = 1;
});
`;
    const cli = provider({ spawnProcess: makeFakeSpawn(source) });
    await expect(cli.generate(request("q"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_QUOTA_EXHAUSTED", retryable: false });
  });

  it("raises LLM_INVALID_OUTPUT for denied_actions with empty response", async () => {
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: "",
    usage: { input_tokens: 1, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0 },
    denied_actions: [{ action: "command", display_name: "RunCommand" }],
  }));
});
`;
    const cli = provider({ spawnProcess: makeFakeSpawn(source) });
    await expect(cli.generate(request("q"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT", retryable: false });
  });

  it("stderr warnings don't cause failure when exit code is 0", async () => {
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stderr.write("Warning: --mode auto is not recommended for non-interactive use.");
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: "fine",
    usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0 },
    denied_actions: [],
  }));
});
`;
    const cli = provider({ spawnProcess: makeFakeSpawn(source) });
    const response = await cli.generate(request("q"), new AbortController().signal);
    expect(response.text).toBe("fine");
  });

  it("raises LLM_NOT_CONFIGURED when binary ENOENT", async () => {
    const cli = provider({
      spawnProcess: () => {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      },
    });
    await expect(cli.generate(request("q"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED", retryable: false });
  });

  it("raises LLM_UNAVAILABLE for generic spawn errors", async () => {
    const cli = provider({
      spawnProcess: () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });
    await expect(cli.generate(request("q"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_UNAVAILABLE", retryable: true });
  });

  it("raises LLM_NOT_CONFIGURED when not signed in", async () => {
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.stderr.write("Error: not eligible for this model tier");
  process.exitCode = 1;
});
`;
    const cli = provider({ spawnProcess: makeFakeSpawn(source) });
    await expect(cli.generate(request("q"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED", retryable: false });
  });

  it("raises LLM_TIMEOUT on abort and provider timeout", async () => {
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => { setInterval(() => {}, 1000); });
`;
    const abortController = new AbortController();
    const cli = provider({ spawnProcess: makeFakeSpawn(source) });
    const promise = cli.generate(request("q"), abortController.signal);
    setTimeout(() => abortController.abort(), 50);
    await expect(promise).rejects.toMatchObject({ code: "LLM_TIMEOUT", retryable: true });

    const timedCli = provider({ spawnProcess: makeFakeSpawn(source), timeout: 100 });
    await expect(timedCli.generate(request("q"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_TIMEOUT", retryable: true });
  }, 10_000);

  it("handles prompts with special characters (quotes, backslashes, newlines) in --print=", async () => {
    let printArg = "";
    const source = `
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  const a = process.argv.find(x => x.startsWith("--print="));
  const content = a ? a.slice("--print=".length) : "";
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: content.includes("quote") && content.includes("newline") ? "ok" : "missing",
    usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0 },
    denied_actions: [],
  }));
});
`;
    const cli = provider({ spawnProcess: makeFakeSpawn(source) });
    const response = await cli.generate(
      request('prompt with "quote" and\nnewline and \\backslash'),
      new AbortController().signal,
    );
    expect(response.text).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 5. Model listing
// ---------------------------------------------------------------------------
describe("AntgravityCliProvider.listModels", () => {
  it("parses tab-delimited model output and returns ids", async () => {
    const source = `
process.stdout.write("gemini-3.8-flash-high\tGemini 3.8 Flash High\ngemini-3.8-flash-low\tGemini 3.8 Flash Low\nclaude-sonnet-4-6\tClaude Sonnet 4.6\n");
`;
    writeFileSync(fakeScript, source);
    const spawnFn = (_cmd: string, args: string[], opts: SpawnOptions) =>
      spawn(process.execPath, [fakeScript, ...args], opts) as ChildProcessWithoutNullStreams;

    const cli = provider();
    const models = await cli.listModels(spawnFn);
    expect(models).toContain("gemini-3.8-flash-high");
    expect(models).toContain("gemini-3.8-flash-low");
    expect(models).toContain("claude-sonnet-4-6");
  });

  it("falls back to static model list when binary unavailable", async () => {
    const cli = new AntgravityCliProvider(null, root, 5_000);
    const models = await cli.listModels();
    expect(models).toEqual(AGY_STATIC_MODELS);
  });

  it("falls back to static models when spawn throws", async () => {
    const cli = provider();
    const models = await cli.listModels(() => {
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    });
    expect(models).toEqual(AGY_STATIC_MODELS);
  });
});

// ---------------------------------------------------------------------------
// 6. resolveAgyPath tests (no retry needed — just path logic)
// ---------------------------------------------------------------------------
describe("resolveAgyPath", () => {
  it("returns null when binary not found and no configured path", () => {
    const result = resolveAgyPath("", {
      PATH: "",
      LOCALAPPDATA: "",
      HOME: "/tmp/nonexistent-home-dir",
    });
    expect(result).toBeNull();
  });

  it("uses configured path when provided and non-empty", () => {
    // Should try the configured value (may return null if file doesn't exist — that's fine)
    const result = resolveAgyPath("/nonexistent/agy", { PATH: "" });
    expect(result).toBeNull(); // file doesn't exist
  });
});

describe("resolveAgyPathWithRetry", () => {
  it("returns null quickly when binary never found and maxRetryMs is small", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const promise = resolveAgyPathWithRetry("", { PATH: "", LOCALAPPDATA: "", HOME: "" }, 100);
      await vi.runAllTimersAsync();
      const result = await promise;
      const elapsed = Date.now() - start;
      expect(result).toBeNull();
      expect(elapsed).toBeLessThan(5000);
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);
});

// ---------------------------------------------------------------------------
// 7. Provider not configured (binaryPath null)
// ---------------------------------------------------------------------------
describe("AntgravityCliProvider not configured", () => {
  it("rejects immediately with LLM_NOT_CONFIGURED when binaryPath is null", async () => {
    const cli = new AntgravityCliProvider(null, root, 5_000);
    await expect(cli.generate(request("q"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_NOT_CONFIGURED", retryable: false });
  });

  it("is not configured when binaryPath is null", () => {
    const cli = new AntgravityCliProvider(null, root, 5_000);
    expect(cli.configured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Static model list completeness
// ---------------------------------------------------------------------------
describe("AGY_STATIC_MODELS", () => {
  it("contains all expected preset models", () => {
    expect(AGY_STATIC_MODELS).toContain("gemini-3.8-flash-low");
    expect(AGY_STATIC_MODELS).toContain("gemini-3.8-flash-medium");
    expect(AGY_STATIC_MODELS).toContain("gemini-3.8-flash-high");
    expect(AGY_STATIC_MODELS).toContain("claude-sonnet-4-6");
    expect(AGY_STATIC_MODELS).toContain("claude-opus-4-6-thinking");
    expect(AGY_STATIC_MODELS).toContain("gpt-oss-120b-medium");
  });
});

// ---------------------------------------------------------------------------
// Model tries tools instead of answering
// ---------------------------------------------------------------------------
describe("Antigravity CLI tool-only replies", () => {
  // Fake agy: the first `toolOnlyTurns` runs reply with a blocked tool and no text.
  const toolThenAnswer = (toolOnlyTurns: number) => `
const fs = require("node:fs");
const counter = ${JSON.stringify(join(root, "count"))};
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(n + 1));
  const prompt = (process.argv.find(a => a.startsWith("--print=")) ?? "").slice(8);
  fs.writeFileSync(counter + "." + n, prompt);
  const denied = n < ${toolOnlyTurns};
  process.stdout.write(JSON.stringify({
    status: "SUCCESS",
    response: denied ? "" : "final answer",
    usage: { input_tokens: 1, output_tokens: 1 },
    denied_actions: denied ? [{ action: "command", display_name: "RunCommand" }] : [],
  }));
});
`;
  let counter: string;
  beforeEach(() => { counter = join(root, "count"); });

  it("tells the model up front not to use tools and disables slash commands", async () => {
    let args: string[] = [];
    const spawnFn = makeFakeSpawn(toolThenAnswer(0))!;
    const cli = provider({ spawnProcess: (c, a, o) => { args = a; return spawnFn(c, a, o); } });
    await cli.generate(request("q"), new AbortController().signal);
    const prompt = args.find((a) => a.startsWith("--print="))!;
    expect(prompt).toMatch(/^--print=Answer directly/);
    expect(prompt).toContain("Do not use any tools");
    expect(args).toContain("--disable-slash-commands");
  });

  it("retries once with a stronger reminder when the model only tried tools", async () => {
    const cli = provider({ spawnProcess: makeFakeSpawn(toolThenAnswer(1)) });
    const response = await cli.generate(request("q"), new AbortController().signal);
    expect(response.text).toBe("final answer");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(counter, "utf8")).toBe("2");
    expect(readFileSync(`${counter}.0`, "utf8")).not.toContain("previous attempt tried to use a tool");
    expect(readFileSync(`${counter}.1`, "utf8")).toContain("previous attempt tried to use a tool");
  });

  it("gives up after the retry and reports the tool error", async () => {
    const cli = provider({ spawnProcess: makeFakeSpawn(toolThenAnswer(5)) });
    await expect(cli.generate(request("q"), new AbortController().signal))
      .rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT", message: "Model cố dùng công cụ thay vì trả lời" });
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(counter, "utf8")).toBe("2");
  });
});

describe("Antigravity CLI long prompts", () => {
  it("parses the final result event of stream-json output", () => {
    const output = [
      JSON.stringify({ event: "init", init: { model: "m" } }),
      JSON.stringify({ event: "step_update", step_update: { text_delta: "PO" } }),
      JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "PONG\n", usage: { input_tokens: 7, output_tokens: 2 } } }),
    ].join("\n");
    const parsed = parseAgyResponse(output);
    expect(parsed?.isError).toBe(false);
    expect(parsed?.result.trim()).toBe("PONG");
    expect(parsed?.usage).toEqual({ inputTokens: 7, outputTokens: 2 });
  });

  it("reports the error text of a failed stream-json result", () => {
    const output = JSON.stringify({ event: "result", result: { status: "ERROR", response: "", error: "boom" } });
    expect(parseAgyResponse(output)).toMatchObject({ isError: true, result: "boom" });
  });

  it("sends a prompt over the limit on stdin as stream-json instead of in --print=", async () => {
    let capturedArgs: string[] = [];
    const source = `
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => stdin += chunk);
process.stdin.on("end", () => {
  const msg = JSON.parse(stdin.trim());
  const ok = msg.event === "user" && typeof msg.message.content === "string";
  process.stdout.write(JSON.stringify({ event: "init" }) + "\\n");
  process.stdout.write(JSON.stringify({ event: "result", result: {
    status: ok ? "SUCCESS" : "ERROR",
    response: ok ? "LEN:" + msg.message.content.length : "",
    usage: { input_tokens: 1, output_tokens: 1 },
  } }) + "\\n");
});
`;
    const spawnFn = makeFakeSpawn(source);
    const cli = provider({
      spawnProcess: (cmd, args, opts) => {
        capturedArgs = args;
        return spawnFn!(cmd, args, opts);
      },
    });
    const longText = "x".repeat(AGY_ARG_PROMPT_LIMIT + 10);
    const res = await cli.generate(request(longText, "sys"), new AbortController().signal);

    expect(capturedArgs).toContain("--print=");
    expect(capturedArgs.some((a) => a.includes(longText))).toBe(false);
    const inIdx = capturedArgs.indexOf("--input-format");
    expect(capturedArgs[inIdx + 1]).toBe("stream-json");
    const outIdx = capturedArgs.indexOf("--output-format");
    expect(capturedArgs[outIdx + 1]).toBe("stream-json");
    expect(res.text).toMatch(/^LEN:\d+$/);
    expect(Number(res.text.slice(4))).toBeGreaterThan(AGY_ARG_PROMPT_LIMIT);
  });
});
