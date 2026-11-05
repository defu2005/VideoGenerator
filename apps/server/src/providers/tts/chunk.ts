import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { combineChunkTimings, splitNarration, type TimedSpan, type TtsTimingSource } from "@vg/shared";
import { runFfmpeg } from "../../media/ffmpeg.js";

export type ChunkResult = {
  durationSec: number;
  cues: TimedSpan[];
  words?: TimedSpan[];
  timingSource: TtsTimingSource;
  characters: number;
};

export async function synthesizeChunked(input: {
  text: string;
  language: string;
  maxChars: number;
  outPath: string;
  synthesizePart: (text: string, outPath: string) => Promise<ChunkResult>;
  concat?: (files: string[], outPath: string) => Promise<void>;
}): Promise<ChunkResult> {
  const parts = splitNarration(input.text, input.maxChars, input.language);
  const pieces = parts.length > 0 ? parts : [input.text];
  if (pieces.length <= 1) return input.synthesizePart(pieces[0] ?? input.text, input.outPath);
  const folder = dirname(input.outPath);
  mkdirSync(folder, { recursive: true });
  const files: string[] = [];
  const timed: Array<{ durationSec: number; words: TimedSpan[]; cues: TimedSpan[] }> = [];
  const sources: TtsTimingSource[] = [];
  try {
    for (let index = 0; index < pieces.length; index += 1) {
      const partPath = join(folder, `${randomUUID()}-${index}.part`);
      const result = await input.synthesizePart(pieces[index]!, partPath);
      files.push(partPath);
      timed.push({ durationSec: result.durationSec, words: result.words ?? [], cues: result.cues });
      sources.push(result.timingSource);
    }
    await (input.concat ?? concatAudioFiles)(files, input.outPath);
  } finally {
    for (const file of files) rmSync(file, { force: true });
  }
  const combined = combineChunkTimings(timed);
  return {
    ...combined,
    timingSource: sources.includes("estimated") ? "estimated" : sources.includes("aligned") ? "aligned" : "provider",
    characters: input.text.length,
  };
}

export async function concatAudioFiles(files: string[], outPath: string): Promise<void> {
  if (files.length === 1) {
    copyFileSync(files[0]!, outPath);
    return;
  }
  const listPath = join(dirname(outPath), `${randomUUID()}.concat.txt`);
  writeFileSync(listPath, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"), "utf8");
  try {
    await runFfmpeg(["-hide_banner", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
  } finally {
    rmSync(listPath, { force: true });
  }
}
