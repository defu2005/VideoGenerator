import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeTtsProvider } from "../src/providers/tts/edgeTts.js";
import { StageError } from "../src/pipeline/stageExecutor.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakeSpawn(
  run: (args: readonly string[], options: SpawnOptions, attempt: number) => { code: number; stderr?: string },
) {
  let attempts = 0;
  const calls: { args: readonly string[]; options: SpawnOptions }[] = [];
  const spawnProcess = ((...input: Parameters<typeof spawn>) => {
    const [binary, args, options] = input;
    expect(binary).toBe("edge-tts.exe");
    const index = attempts++;
    calls.push({ args: args ?? [], options: options ?? {} });
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      const result = run(args ?? [], options ?? {}, index);
      if (result.stderr) child.stderr.end(result.stderr);
      else child.stderr.end();
      child.stdout.end();
      child.emit("close", result.code);
    });
    return child as unknown as ReturnType<typeof spawn>;
  }) as typeof spawn;
  return { spawnProcess, calls };
}

function pitchOf(args: readonly string[]): string | undefined {
  const index = args.indexOf("--pitch");
  return index >= 0 ? args[index + 1] : undefined;
}

describe("EdgeTtsProvider", () => {
  it("uses a UTF-8 temp file and retries no-audio and empty responses before parsing subtitles", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-edge-tts-"));
    roots.push(root);
    const output = join(root, "voice.mp3");
    const text = "Xin chào, đây là lời thoại có dấu.";
    const fake = fakeSpawn((args, _options, attempt) => {
      const pathAt = args.indexOf("--write-media") + 1;
      if (attempt === 0) return { code: 1, stderr: "NoAudioReceived" };
      if (attempt === 1) return { code: 0 };
      expect(args).toContain("--file");
      const inputFile = args[args.indexOf("--file") + 1];
      expect(readFileSync(inputFile, "utf8")).toBe(text);
      writeFileSync(args[pathAt], Buffer.from("audio"));
      writeFileSync(args[args.indexOf("--write-subtitles") + 1], "1\n00:00:00,000 --> 00:00:01,250\nXin chào bạn.\n");
      return { code: 0 };
    });
    const sleep = vi.fn(async () => undefined);
    const probeDuration = vi.fn(async () => 1.25);
    const provider = new EdgeTtsProvider("edge-tts.exe", 1000, {
      spawnProcess: fake.spawnProcess,
      sleep,
      probeDuration,
    });

    const result = await provider.synthesize({ text, voice: "vi-VN-HoaiMyNeural", rate: "+0%", outPath: output });

    expect(fake.calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([3000, 10000]);
    expect(pitchOf(fake.calls[0]!.args)).toBeUndefined();
    expect(pitchOf(fake.calls[1]!.args)).toBe("+1Hz");
    expect(pitchOf(fake.calls[2]!.args)).toBe("-1Hz");
    expect(result).toEqual({
      durationSec: 1.25,
      cues: [{ startSec: 0, endSec: 1.25, text: "Xin chào bạn." }],
      timingSource: "estimated",
      characters: text.length,
    });
    expect(probeDuration).toHaveBeenCalledWith(output, undefined);
    expect(existsSync(output)).toBe(true);
    const { args, options } = fake.calls[2]!;
    expect(args).toContain("--file");
    expect(args).not.toContain(text);
    expect(options.shell).toBe(false);
    expect(options.windowsHide).toBe(true);
    expect(options.env).toMatchObject({ PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" });
  });

  it("retries NoAudioReceived twice then succeeds with pitch nudges", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-edge-tts-"));
    roots.push(root);
    const output = join(root, "scene-11.mp3");
    const fake = fakeSpawn((args, _options, attempt) => {
      if (attempt < 2) return { code: 1, stderr: "NoAudioReceived" };
      writeFileSync(args[args.indexOf("--write-media") + 1]!, Buffer.from("audio"));
      return { code: 0 };
    });
    const sleep = vi.fn(async () => undefined);
    const provider = new EdgeTtsProvider("edge-tts.exe", 1000, {
      spawnProcess: fake.spawnProcess,
      sleep,
      probeDuration: vi.fn(async () => 0.5),
    });

    await provider.synthesize({
      text: "câu thoại",
      voice: "vi-VN-HoaiMyNeural",
      rate: "+0%",
      outPath: output,
    });

    expect(fake.calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([3000, 10000]);
    expect(pitchOf(fake.calls[0]!.args)).toBeUndefined();
    expect(pitchOf(fake.calls[1]!.args)).toBe("+1Hz");
    expect(pitchOf(fake.calls[2]!.args)).toBe("-1Hz");
  });

  it("exhausts 6 NoAudioReceived attempts then throws TTS_NO_AUDIO", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-edge-tts-"));
    roots.push(root);
    const output = join(root, "voice.mp3");
    const fake = fakeSpawn(() => ({ code: 1, stderr: "NoAudioReceived" }));
    const sleep = vi.fn(async () => undefined);
    const provider = new EdgeTtsProvider("edge-tts.exe", 1000, {
      spawnProcess: fake.spawnProcess,
      sleep,
      probeDuration: vi.fn(async () => 1),
    });

    await expect(provider.synthesize({
      text: "fail",
      voice: "vi-VN-HoaiMyNeural",
      rate: "+0%",
      outPath: output,
    })).rejects.toMatchObject({
      name: "StageError",
      code: "TTS_NO_AUDIO",
      retryable: true,
      message: "edge-tts không trả về âm thanh sau 6 lần thử (dịch vụ Microsoft tạm lỗi). Thử lại bước Giọng đọc sau ít phút.",
    } satisfies Partial<StageError>);

    expect(fake.calls).toHaveLength(6);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([3000, 10000, 20000, 40000, 60000]);
    expect(fake.calls.map((call) => pitchOf(call.args))).toEqual([
      undefined,
      "+1Hz",
      "-1Hz",
      "+2Hz",
      "-1Hz",
      "+1Hz",
    ]);
  });

  it("stops with AbortError when aborted during a backoff wait", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-edge-tts-"));
    roots.push(root);
    const output = join(root, "voice.mp3");
    const controller = new AbortController();
    const fake = fakeSpawn(() => ({ code: 1, stderr: "NoAudioReceived" }));
    const sleep = vi.fn(async () => {
      controller.abort();
    });
    const provider = new EdgeTtsProvider("edge-tts.exe", 1000, {
      spawnProcess: fake.spawnProcess,
      sleep,
      probeDuration: vi.fn(async () => 1),
    });

    await expect(provider.synthesize({
      text: "abort me",
      voice: "vi-VN-HoaiMyNeural",
      rate: "+0%",
      outPath: output,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(fake.calls).toHaveLength(1);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("throws immediately for errors that are not NoAudioReceived", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-edge-tts-"));
    roots.push(root);
    const output = join(root, "voice.mp3");
    const fake = fakeSpawn(() => ({ code: 1, stderr: "Connection reset by peer" }));
    const sleep = vi.fn(async () => undefined);
    const provider = new EdgeTtsProvider("edge-tts.exe", 1000, {
      spawnProcess: fake.spawnProcess,
      sleep,
      probeDuration: vi.fn(async () => 1),
    });

    await expect(provider.synthesize({
      text: "hard fail",
      voice: "vi-VN-HoaiMyNeural",
      rate: "+0%",
      outPath: output,
    })).rejects.toThrow(/Connection reset by peer/);

    expect(fake.calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports a missing binary as a non-retryable stage error", async () => {
    const provider = new EdgeTtsProvider(null, 1000);
    await expect(provider.synthesize({
      text: "hello",
      voice: "en-US-AriaNeural",
      rate: "+0%",
      outPath: join(tmpdir(), "missing-edge-tts.mp3"),
    })).rejects.toMatchObject({
      name: "StageError",
      message: "Chưa cài edge-tts — chạy: pip install edge-tts",
      code: "TTS_BINARY_MISSING",
      retryable: false,
    } satisfies Partial<StageError>);
  });
});
