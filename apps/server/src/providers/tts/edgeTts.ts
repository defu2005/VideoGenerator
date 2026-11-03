import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { StageError } from "../../pipeline/stageExecutor.js";
import { probeDurationSec } from "../../media/ffmpeg.js";
import type { TtsCue, TtsProvider, TtsVoice } from "./types.js";

type EdgeTtsDependencies = {
  spawnProcess: typeof spawn;
  probeDuration: typeof probeDurationSec;
  sleep: (ms: number) => Promise<void>;
};

const defaultDependencies: EdgeTtsDependencies = {
  spawnProcess: spawn,
  probeDuration: probeDurationSec,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const STATIC_VOICES: TtsVoice[] = [
  { language: "vi", gender: "female", name: "vi-VN-HoaiMyNeural" },
  { language: "vi", gender: "male", name: "vi-VN-NamMinhNeural" },
  { language: "en", gender: "female", name: "en-US-AriaNeural" },
  { language: "en", gender: "male", name: "en-US-GuyNeural" },
];

function parseSrt(input: string): TtsCue[] {
  const blocks = input.trim().split(/\r?\n\r?\n+/).filter(Boolean);
  const cues: TtsCue[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 3) continue;
    const timeLine = lines[1] ?? "";
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{1,3})/);
    if (!match) continue;
    const start = parseSrtTimestamp(match[1]);
    const end = parseSrtTimestamp(match[2]);
    const text = lines.slice(2).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    cues.push({ startSec: start, endSec: end, text });
  }
  return cues;
}

function parseSrtTimestamp(value: string): number {
  const [hms, ms] = value.split(/[.,]/);
  const [hours, minutes, seconds] = hms.split(":").map(Number);
  const millis = Number(ms ?? "0");
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export class EdgeTtsProvider implements TtsProvider {
  private listCache: { expiresAt: number; voices: TtsVoice[] } | null = null;

  constructor(
    private readonly binaryPath: string | null,
    private readonly timeoutMs: number,
    private readonly dependencies: EdgeTtsDependencies = defaultDependencies,
  ) {}

  id = "edge-tts";
  label = "Edge TTS";

  isAvailable(): boolean {
    return this.binaryPath !== null;
  }

  async listVoices(): Promise<TtsVoice[]> {
    if (!this.binaryPath) return STATIC_VOICES;
    const now = Date.now();
    if (this.listCache && this.listCache.expiresAt > now) return this.listCache.voices;
    try {
      const output = await this.runCli(["--list-voices"], undefined);
      const parsed: TtsVoice[] = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const columns = line.split(/\s+/);
          const name = columns.find((column) => /^[a-z]{2}-[A-Z]{2}-[\w]+$/.test(column)) ?? "";
          const language = name.slice(0, 5) || "unknown";
          const gender: TtsVoice["gender"] = /female/i.test(line) ? "female" : /\bmale\b/i.test(line) ? "male" : "unknown";
          return { language, name, gender };
        })
        .filter((voice) => voice.name.length > 0);
      this.listCache = { expiresAt: now + 10 * 60_000, voices: parsed.length > 0 ? parsed : STATIC_VOICES };
    } catch {
      this.listCache = { expiresAt: now + 10 * 60_000, voices: STATIC_VOICES };
    }
    return this.listCache.voices;
  }

  async synthesize({ text, voice, rate, outPath, signal }: { text: string; voice: string; rate: string; outPath: string; signal?: AbortSignal }): Promise<{ durationSec: number; cues: TtsCue[] }> {
    if (!this.binaryPath) {
      throw new StageError("Chưa cài edge-tts — chạy: pip install edge-tts", "TTS_BINARY_MISSING", false);
    }
    const fileRoot = dirname(outPath);
    mkdirSync(fileRoot, { recursive: true });
    const textPath = join(fileRoot, `${randomUUID()}.txt`);
    const srtPath = `${outPath}.srt`;
    writeFileSync(textPath, text, "utf8");
    try {
      for (let attempt = 0; attempt <= 3; attempt += 1) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        rmSync(outPath, { force: true });
        rmSync(srtPath, { force: true });
        try {
          const status = await this.runCli([
            "--voice",
            voice,
            "--rate",
            rate,
            "--file",
            textPath,
            "--write-media",
            outPath,
            "--write-subtitles",
            srtPath,
          ], signal);
          const isEmpty = !existsSync(outPath) || statSync(outPath).size === 0;
          const noAudio = status.toLowerCase().includes("noaudioreceived") || status.toLowerCase().includes("no audio received");
          if (!isEmpty && !noAudio) {
            const cues = existsSync(srtPath) ? parseSrt(readFileSync(srtPath, "utf8")) : [];
            return { durationSec: await this.dependencies.probeDuration(outPath, signal), cues };
          }
          if (!noAudio && !isEmpty) throw new Error("edge-tts produced invalid audio.");
        } catch (error) {
          if (signal?.aborted) throw new DOMException("aborted", "AbortError");
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            throw new StageError("Chưa cài edge-tts — chạy: pip install edge-tts", "TTS_BINARY_MISSING", false);
          }
          const message = error instanceof Error ? error.message : String(error);
          const noAudio = /noaudioreceived|no audio received/i.test(message);
          if (!noAudio) throw error;
        }
        if (attempt < 3) {
          await this.dependencies.sleep([2000, 5000, 10000][attempt]);
        }
      }
      throw new StageError("edge-tts did not return audio after 3 retries.", "TTS_NO_AUDIO", true);
    } finally {
      rmSync(textPath, { force: true });
    }
  }

  private async runCli(args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = this.dependencies.spawnProcess(this.binaryPath!, args, {
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const timer = setTimeout(() => child.kill(), this.timeoutMs);
      const onAbort = () => child.kill();
      signal?.addEventListener("abort", onAbort, { once: true });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (code === 0) resolve(`${stdout}\n${stderr}`.trim());
        else reject(new Error(stderr || stdout || `edge-tts exited with code ${code}`));
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      });
    });
  }
}
