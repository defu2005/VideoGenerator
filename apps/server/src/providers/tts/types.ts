export type TtsCue = { startSec: number; endSec: number; text: string };

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
};

export interface TtsProvider {
  id: string;
  label: string;
  isAvailable(): boolean;
  listVoices(): Promise<TtsVoice[]>;
  synthesize(input: TtsSynthesisInput): Promise<{ durationSec: number; cues: TtsCue[] }>;
}
