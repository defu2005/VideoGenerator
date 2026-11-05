import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TtsProvider, TtsCue, TtsVoice, TtsWord } from "./types.js";
import { spreadSentence, ttsCatalogEntry } from "@vg/shared";

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wavHeader(samples: number): Buffer {
  const sampleRate = 22050;
  const bitsPerSample = 16;
  const blockAlign = (bitsPerSample / 8) * 1;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * blockAlign;
  const buffer = Buffer.alloc(44);
  buffer.write("RIFF", 0, 4, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, 4, "ascii");
  buffer.write("fmt ", 12, 4, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, 4, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

export class MockTtsProvider implements TtsProvider {
  id = "mock";
  label = "Mock TTS";
  readonly capabilities = {
    wordTimings: false,
    ssml: false,
    maxCharsPerRequest: ttsCatalogEntry("mock")!.maxCharsPerRequest,
    languages: ["*"],
  };

  isAvailable(): boolean {
    return true;
  }

  async listVoices(): Promise<TtsVoice[]> {
    return [
      { language: "vi", name: "vi-VN-HoaiMyNeural", gender: "female", multilingual: false },
      { language: "en", name: "en-US-AriaNeural", gender: "female", multilingual: false },
      { language: "vi", name: "vi-VN-NamMinhNeural", gender: "male", multilingual: false },
      { language: "ja", name: "ja-JP-NanamiNeural", gender: "female", multilingual: false },
      { language: "pt-BR", name: "pt-BR-FernandaNeural", gender: "female", multilingual: false },
      { language: "en", name: "en-US-JennyMultilingualNeural", gender: "neutral", multilingual: true },
      { language: "ja", name: "ja-JP-KeitaMultilingualNeural", gender: "neutral", multilingual: true },
    ];
  }

  async synthesize({ text, outPath }: { text: string; voice: string; rate: string; outPath: string; signal?: AbortSignal }): Promise<{ durationSec: number; cues: TtsCue[]; words: TtsWord[]; timingSource: "estimated"; characters: number }> {
    const trimmed = text.trim();
    const sentences = splitSentences(trimmed) || [trimmed || " "];
    const secondsPerChar = 1 / 14;
    const durationSec = Math.max(0.3, trimmed.length * secondsPerChar);
    const totalSamples = Math.max(1, Math.ceil(durationSec * 22050));
    mkdirSync(dirname(outPath), { recursive: true });
    const wave = Buffer.concat([wavHeader(totalSamples), Buffer.alloc(totalSamples * 2, 0)]);
    writeFileSync(outPath, wave);

    let elapsed = 0;
    const cues: TtsCue[] = sentences.map((sentence) => {
      const startSec = elapsed;
      const length = sentence.length || 1;
      const sentenceSeconds = Math.max(0.2, length * secondsPerChar);
      elapsed += sentenceSeconds;
      return {
        startSec,
        endSec: elapsed,
        text: sentence,
      };
    });
    const words: TtsWord[] = cues.flatMap((cue) => spreadSentence(cue.text, cue.startSec, cue.endSec, "vi"));
    return { durationSec, cues, words, timingSource: "estimated", characters: trimmed.length };
  }
}
