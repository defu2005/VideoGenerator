import { spawn } from "node:child_process";
import {
  alignScriptWords,
  cuesFromWords,
  estimateWords,
  parseSilenceLog,
  type TimedSpan,
  type TtsTimingSource,
} from "@vg/shared";
import { resolveFfmpegPath } from "../../media/ffmpeg.js";
import type { SpeechToTextSettings } from "@vg/shared";
import { speechToTextConfigured } from "@vg/shared";

export async function ensureWordTimings(input: {
  text: string;
  language: string;
  audioPath: string;
  durationSec: number;
  words?: TimedSpan[];
  timingSource?: TtsTimingSource;
  recognize?: (audioPath: string) => Promise<TimedSpan[]>;
  silenceLog?: string;
  detectSilence?: (audioPath: string) => Promise<string>;
}): Promise<{ words: TimedSpan[]; cues: TimedSpan[]; timingSource: TtsTimingSource }> {
  if (input.words && input.words.length > 0) {
    return {
      words: input.words,
      cues: cuesFromWords(input.words),
      timingSource: input.timingSource === "aligned" || input.timingSource === "estimated" ? input.timingSource : "provider",
    };
  }
  if (input.recognize) {
    try {
      const recognized = await input.recognize(input.audioPath);
      if (recognized.length > 0) {
        const words = alignScriptWords(input.text, recognized, input.durationSec);
        return { words, cues: cuesFromWords(words), timingSource: "aligned" };
      }
    } catch {
      // Fall through to the syllable estimate.
    }
  }
  const log = input.silenceLog ?? (input.detectSilence ? await input.detectSilence(input.audioPath) : "");
  const words = estimateWords({
    text: input.text,
    language: input.language,
    durationSec: input.durationSec,
    segments: parseSilenceLog(log, input.durationSec),
  });
  return { words, cues: cuesFromWords(words), timingSource: "estimated" };
}

export function detectSilenceLog(audioPath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const child = spawn(resolveFfmpegPath(), [
      "-hide_banner",
      "-nostdin",
      "-i",
      audioPath,
      "-af",
      "silencedetect=noise=-35dB:d=0.15",
      "-f",
      "null",
      "-",
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const onAbort = () => child.kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(stderr);
    });
  });
}

export function sttWordsFromJson(text: string): TimedSpan[] {
  try {
    const parsed = JSON.parse(text) as { words?: Array<{ start?: number; end?: number; word?: string; text?: string }> };
    return (parsed.words ?? []).flatMap((word) => {
      const token = (word.word ?? word.text ?? "").trim();
      if (!token || typeof word.start !== "number" || typeof word.end !== "number") return [];
      return [{ startSec: word.start, endSec: word.end, text: token }];
    });
  } catch {
    return [];
  }
}

export function speechRecognitionEnabled(settings: SpeechToTextSettings | null | undefined): boolean {
  return Boolean(settings && speechToTextConfigured(settings));
}
