import type { AppConfig } from "../../lib/config.js";
import type { TtsAppSettings } from "@vg/shared";
import { TtsAppSettingsSchema } from "@vg/shared";
import type { spawn } from "node:child_process";

export type TtsContext = {
  config: AppConfig;
  secret: (providerId: string) => string | null;
  fetchImpl: typeof fetch;
  spawnProcess: typeof spawn;
  sleep: (ms: number) => Promise<void>;
  settings: () => TtsAppSettings;
  probeDuration: (file: string, signal?: AbortSignal) => Promise<number>;
};

export function emptyTtsSettings(defaultProvider: string): TtsAppSettings {
  return TtsAppSettingsSchema.parse({ defaultProvider });
}
