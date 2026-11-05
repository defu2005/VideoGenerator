export type TtsCue = { startSec: number; endSec: number; text: string };

export type TtsWord = { startSec: number; endSec: number; text: string };

export type TtsTimingSource = "provider" | "aligned" | "estimated";

export type TtsVoice = {
  language: string;
  gender?: "female" | "male" | "neutral" | "unknown";
  name: string;
  multilingual?: boolean;
};

export type TtsSynthesisInput = {
  text: string;
  voice: string;
  rate: string;
  outPath: string;
  signal?: AbortSignal;
  style?: string;
  model?: string;
};

export type TtsCapabilities = {
  wordTimings: boolean;
  ssml: boolean;
  styles?: string[];
  maxCharsPerRequest: number;
  languages: string[];
};

export type TtsSynthesisResult = {
  durationSec: number;
  cues: TtsCue[];
  words?: TtsWord[];
  timingSource: TtsTimingSource;
  costUsd?: number;
  characters: number;
};

export interface TtsProvider {
  id: string;
  label: string;
  capabilities: TtsCapabilities;
  isAvailable(): boolean;
  listVoices(): Promise<TtsVoice[]>;
  synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult>;
}
