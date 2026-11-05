import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_SPEECH_SETTINGS,
  SpeechToTextSettingsSchema,
  speechToTextConfigured,
  parseTranscriptFile,
  type SpeechToTextSettings,
  type TranscriptSentence,
} from "@vg/shared";
import type Database from "better-sqlite3";

const SETTINGS_KEY = "speechToText";

export function getSpeechToTextSettings(sqlite: Database.Database): SpeechToTextSettings {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_SPEECH_SETTINGS;
  const raw = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  const parsed = SpeechToTextSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SPEECH_SETTINGS;
}

export function saveSpeechToTextSettings(sqlite: Database.Database, value: SpeechToTextSettings): SpeechToTextSettings {
  const parsed = SpeechToTextSettingsSchema.parse(value);
  sqlite.prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(SETTINGS_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

export function probeSpeechCli(path: string, extraArgs: string, timeoutMs = 8000): Promise<{ ok: boolean; message: string }> {
  const binary = path.trim();
  if (!binary) return Promise.resolve({ ok: false, message: "Chưa có đường dẫn công cụ." });
  return new Promise((resolve) => {
    const args = [...extraArgs.split(/\s+/).filter(Boolean), "--help"];
    let output = "";
    let settled = false;
    const finish = (result: { ok: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(binary, args, { windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: output.length > 0, message: output.slice(0, 180) || "Công cụ không phản hồi." });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, message: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        ok: code === 0 || output.length > 0,
        message: code === 0 ? "Đã nhận diện công cụ." : (output.slice(0, 180) || `Mã thoát ${code}`),
      });
    });
  });
}

function speechArgs(settings: SpeechToTextSettings, videoPath: string, srtPath: string): string[] {
  const template = settings.args.trim();
  if (template.includes("{input}") || template.includes("{output}")) {
    return template.split(/\s+/).filter(Boolean).map((part) =>
      part.replaceAll("{input}", videoPath).replaceAll("{output}", srtPath));
  }
  const extra = template.split(/\s+/).filter(Boolean);
  return [...extra, videoPath];
}

/** Run the configured local speech CLI. Tests never call this. */
export async function transcribeWithSpeechCli(
  settings: SpeechToTextSettings,
  videoPath: string,
  workDir: string,
): Promise<TranscriptSentence[]> {
  if (!speechToTextConfigured(settings)) return [];
  mkdirSync(workDir, { recursive: true });
  const srtPath = join(workDir, "speech.srt");
  const args = speechArgs(settings, videoPath, srtPath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(settings.path.trim(), args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(0, 400) || `Công cụ nhận dạng thoát mã ${code}`));
    });
  });
  let text = "";
  try {
    text = readFileSync(srtPath, "utf8");
  } catch {
    text = "";
  }
  if (!text.trim()) {
    const stdoutPath = join(dirname(srtPath), "speech.txt");
    try { text = readFileSync(stdoutPath, "utf8"); } catch { /* stdout file is optional */ }
  }
  if (!text.includes("-->") && text.trim()) {
    writeFileSync(srtPath, text, "utf8");
  }
  return parseTranscriptFile(text);
}
