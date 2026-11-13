export type TtsProviderKind = "http" | "cli" | "mock";

export type TtsCatalogEntry = {
  id: string;
  label: string;
  kind: TtsProviderKind;
  paid: boolean;
  wordTimings: boolean;
  ssml: boolean;
  styles?: string[];
  maxCharsPerRequest: number;
  languages: string[];
  defaultModel?: string;
};

/** Editable defaults. Official prices change; the settings table overrides these. */
export const DEFAULT_TTS_PRICE_PER_MILLION: Record<string, number> = {
  google_cloud: 16,
  gemini: 10,
  elevenlabs: 30,
  openai: 15,
  fpt_ai: 8.5,
  viettel_ai: 0,
  piper: 0,
  vieneu: 0,
  "edge-tts": 0,
  mock: 0,
};

export const TTS_CATALOG: TtsCatalogEntry[] = [
  {
    id: "google_cloud",
    label: "Google Cloud",
    kind: "http",
    paid: true,
    wordTimings: true,
    ssml: true,
    maxCharsPerRequest: 4500,
    languages: ["vi", "en", "ja", "pt"],
  },
  {
    id: "gemini",
    label: "Gemini",
    kind: "http",
    paid: true,
    wordTimings: false,
    ssml: false,
    styles: ["prompt"],
    maxCharsPerRequest: 4000,
    languages: ["*"],
    defaultModel: "gemini-3.8-flash-tts",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    kind: "http",
    paid: true,
    wordTimings: true,
    ssml: false,
    maxCharsPerRequest: 4500,
    languages: ["*"],
    defaultModel: "eleven_multilingual_v2",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "http",
    paid: true,
    wordTimings: false,
    ssml: false,
    styles: ["prompt"],
    maxCharsPerRequest: 4000,
    languages: ["*"],
    defaultModel: "gpt-4o-mini-tts",
  },
  {
    id: "fpt_ai",
    label: "FPT.AI",
    kind: "http",
    paid: true,
    wordTimings: false,
    ssml: false,
    maxCharsPerRequest: 5000,
    languages: ["vi"],
  },
  {
    id: "viettel_ai",
    label: "Viettel AI",
    kind: "http",
    paid: true,
    wordTimings: false,
    ssml: false,
    maxCharsPerRequest: 450,
    languages: ["vi"],
  },
  {
    id: "piper",
    label: "Piper",
    kind: "cli",
    paid: false,
    wordTimings: false,
    ssml: false,
    maxCharsPerRequest: 4000,
    languages: ["*"],
  },
  {
    id: "vieneu",
    label: "VieNeu",
    kind: "cli",
    paid: false,
    wordTimings: false,
    ssml: false,
    maxCharsPerRequest: 2000,
    languages: ["vi"],
  },
  {
    id: "edge-tts",
    label: "Edge TTS",
    kind: "cli",
    paid: false,
    wordTimings: true,
    ssml: false,
    maxCharsPerRequest: 3000,
    languages: ["*"],
  },
  {
    id: "mock",
    label: "Mock",
    kind: "mock",
    paid: false,
    wordTimings: false,
    ssml: false,
    maxCharsPerRequest: 100_000,
    languages: ["*"],
  },
];

const BY_ID = new Map(TTS_CATALOG.map((entry) => [entry.id, entry]));

export function ttsCatalogEntry(id: string): TtsCatalogEntry | undefined {
  return BY_ID.get(id);
}

export function ttsPricePerMillion(id: string, overrides?: Record<string, number>): number {
  const override = overrides?.[id];
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) return override;
  return DEFAULT_TTS_PRICE_PER_MILLION[id] ?? 0;
}

export function ttsCostUsd(characters: number, pricePerMillion: number): number {
  if (characters <= 0 || pricePerMillion <= 0) return 0;
  return (characters / 1_000_000) * pricePerMillion;
}

export function isPaidTtsProvider(id: string): boolean {
  return ttsCatalogEntry(id)?.paid === true;
}

export type TtsVoiceChoice = {
  provider?: string;
  voice?: string;
  rate?: string;
  model?: string;
  style?: string;
};

export function applyEconomyPolicy(input: {
  requested: string;
  budgetMode: string;
  profileProvider?: string;
  edgeAvailable: boolean;
  piperAvailable: boolean;
}): { providerId: string; blockedPaid: boolean } {
  const pinned = Boolean(
    input.profileProvider
    && isPaidTtsProvider(input.profileProvider)
    && input.requested === input.profileProvider,
  );
  if (input.budgetMode === "ECO" && isPaidTtsProvider(input.requested) && !pinned) {
    if (input.edgeAvailable) return { providerId: "edge-tts", blockedPaid: true };
    if (input.piperAvailable) return { providerId: "piper", blockedPaid: true };
    return { providerId: "edge-tts", blockedPaid: true };
  }
  return { providerId: input.requested, blockedPaid: false };
}

export function resolveVoiceSelection(input: {
  project?: TtsVoiceChoice | null;
  profile?: TtsVoiceChoice | null;
  appProvider: string;
  appVoice?: string;
  appRate?: string;
  budgetMode: string;
  edgeAvailable: boolean;
  piperAvailable: boolean;
}): TtsVoiceChoice & { provider: string; rate: string; blockedPaid: boolean } {
  const project = input.project ?? {};
  const profile = input.profile ?? {};
  const requested = project.provider || profile.provider || input.appProvider || "edge-tts";
  const economy = applyEconomyPolicy({
    requested,
    budgetMode: input.budgetMode,
    profileProvider: profile.provider,
    edgeAvailable: input.edgeAvailable,
    piperAvailable: input.piperAvailable,
  });
  const voice = economy.blockedPaid ? "" : (project.voice || profile.voice || input.appVoice || "");
  const rate = project.rate || profile.rate || input.appRate || "+0%";
  const model = economy.blockedPaid ? undefined : (project.model || profile.model || undefined);
  const style = economy.blockedPaid ? undefined : (project.style || profile.style || undefined);
  return {
    provider: economy.providerId,
    ...(voice ? { voice } : {}),
    rate,
    ...(model ? { model } : {}),
    ...(style ? { style } : {}),
    blockedPaid: economy.blockedPaid,
  };
}

export function fallbackChain(chosen: string, appDefault: string): string[] {
  const chain = [chosen, appDefault, "edge-tts"].filter((id) => id.trim().length > 0);
  return [...new Set(chain)];
}

export function ttsFailureMessage(tried: string[]): string {
  const list = tried.length > 0 ? tried.join(" → ") : "không có nhà cung cấp";
  return `Không tạo được giọng đọc. Đã thử: ${list}. Kiểm tra key hoặc công cụ ở trang Giọng đọc (TTS).`;
}

export async function runProviderFallback<T>(input: {
  chain: string[];
  attempts?: number;
  isAvailable: (id: string) => boolean;
  run: (id: string) => Promise<T>;
}): Promise<{ id: string; value: T }> {
  const attempts = input.attempts ?? 2;
  const tried: string[] = [];
  const failureCodes: string[] = [];
  let lastError: unknown;
  for (const id of input.chain) {
    if (!input.isAvailable(id)) {
      tried.push(`${id} (chưa cấu hình)`);
      continue;
    }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const value = await input.run(id);
        return { id, value };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        lastError = error;
        failureCodes.push(error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "OTHER");
        tried.push(attempt === 0 ? id : `${id} lần ${attempt + 1}`);
      }
    }
  }
  const message = ttsFailureMessage(tried);
  const lastCode = failureCodes.at(-1) ?? "";
  if (failureCodes.length > 0 && failureCodes.every((code) => code === "TTS_NETWORK") && lastError instanceof Error) throw lastError;
  if (lastError instanceof Error && lastError.message && !lastError.message.includes("Không tạo được giọng đọc")) {
    const lastId = tried.at(-1)?.split(" ")[0] ?? "tts";
    throw new Error(`${message} (${lastId}: ${lastCode || "TTS_FAILED"}) ${stripSecrets(lastError.message)}`);
  }
  throw new Error(message);
}

const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "xi-api-key",
  "api-key",
  "api_key",
  "x-goog-api-key",
  "token",
]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SECRET_HEADER_NAMES.has(key.toLowerCase()) ? "***" : value;
  }
  return redacted;
}

export function stripSecrets(message: string, secrets: string[] = []): string {
  let next = message;
  for (const secret of secrets) {
    if (secret) next = next.split(secret).join("***");
  }
  return next.replace(/\b(sk-|xi-|AIza)[A-Za-z0-9_\-]{8,}/g, "***");
}
