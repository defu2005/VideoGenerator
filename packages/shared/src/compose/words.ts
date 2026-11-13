import { VOICE_LEAD_SEC } from "../timeline/build.js";
import type { TimelineScene } from "../schemas/timeline.js";
import type { VoiceTrack } from "../schemas/voice.js";

export type SceneWord = {
  i: number;
  text: string;
  startSec: number;
  endSec: number;
  sentenceEnd: boolean;
  punct: boolean;
};

export type Cut = { t: number; gapSec: number; sentenceEnd: boolean; punct: boolean };

const SENTENCE = /[.!?…]$/u;
const PUNCT = /[,;:.!?…]$/u;

export function sceneWords(
  scene: Pick<TimelineScene, "durationSec">,
  track: Pick<VoiceTrack, "words" | "cues" | "timingSource"> | null,
): { words: SceneWord[]; source: "provider" | "aligned" | "estimated" | "none" } {
  const duration = scene.durationSec;
  if (track?.words && track.words.length > 0) {
    return {
      source: track.timingSource === "aligned" ? "aligned" : "provider",
      words: track.words.map((word, index) => toWord(index, word.text, word.startSec + VOICE_LEAD_SEC, word.endSec + VOICE_LEAD_SEC, duration)),
    };
  }
  if (track?.cues && track.cues.length > 0) {
    const words: SceneWord[] = [];
    for (const cue of track.cues) {
      const parts = cue.text.split(/\s+/).filter(Boolean);
      if (parts.length === 0) continue;
      const start = cue.startSec + VOICE_LEAD_SEC;
      const end = cue.endSec + VOICE_LEAD_SEC;
      const step = (end - start) / parts.length;
      parts.forEach((text, offset) => {
        words.push(toWord(words.length, text, start + offset * step, start + (offset + 1) * step, duration));
      });
    }
    return { words, source: words.length ? "estimated" : "none" };
  }
  return { words: [], source: "none" };
}

function toWord(i: number, text: string, startSec: number, endSec: number, duration: number): SceneWord {
  const start = clamp(startSec, 0, duration);
  const end = clamp(Math.max(endSec, start), 0, duration);
  return {
    i,
    text,
    startSec: start,
    endSec: end,
    sentenceEnd: SENTENCE.test(text),
    punct: PUNCT.test(text),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cutCandidates(words: SceneWord[], durationSec: number): Cut[] {
  const cuts: Cut[] = [{ t: 0, gapSec: 0, sentenceEnd: false, punct: false }];
  for (let index = 0; index < words.length - 1; index += 1) {
    const left = words[index]!;
    const right = words[index + 1]!;
    const gap = right.startSec - left.endSec;
    cuts.push({
      t: left.endSec + gap / 2,
      gapSec: Math.max(0, gap),
      sentenceEnd: left.sentenceEnd,
      punct: left.punct,
    });
  }
  cuts.push({ t: durationSec, gapSec: 0, sentenceEnd: false, punct: false });
  return cuts;
}
