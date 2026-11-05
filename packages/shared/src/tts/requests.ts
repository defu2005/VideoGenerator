export const GOOGLE_TTS_BASE = "https://texttospeech.googleapis.com/v1beta1";
export const GEMINI_TTS_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
export const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
export const FPT_TTS_URL = "https://api.fpt.ai/hmi/tts/v5";
export const VIETTEL_TTS_URL = "https://viettelgroup.ai/voice/api/tts/v1/rest/syn";

export const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
export const DEFAULT_ELEVEN_MODEL = "eleven_multilingual_v2";
export const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

export type HttpRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
};

export type StaticVoice = {
  language: string;
  gender?: "female" | "male" | "neutral" | "unknown";
  name: string;
  multilingual?: boolean;
};

function languageFromVoiceName(voice: string, fallback: string): string {
  const match = voice.match(/^([a-z]{2}-[A-Z]{2})/);
  return match?.[1] ?? fallback;
}

export function ratePercent(rate: string): number {
  const match = /^([+-]?\d{1,3})%$/.exec(rate.trim());
  return match ? Number(match[1]) : 0;
}

export function escapeSsml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildMarkedSsml(text: string, rate: string): { ssml: string; words: string[] } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const body = words.map((word, index) => `<mark name="w${index}"/>${escapeSsml(word)}`).join(" ");
  const safeRate = /^[+-]\d{1,3}%$/.test(rate) ? rate : "+0%";
  return { ssml: `<speak><prosody rate="${safeRate}">${body}</prosody></speak>`, words };
}

export function buildGoogleSynthesizeRequest(input: {
  apiKey: string;
  text: string;
  voice: string;
  rate: string;
}): HttpRequest & { words: string[] } {
  const marked = buildMarkedSsml(input.text, input.rate);
  return {
    url: `${GOOGLE_TTS_BASE}/text:synthesize`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": input.apiKey,
    },
    body: JSON.stringify({
      input: { ssml: marked.ssml },
      voice: { languageCode: languageFromVoiceName(input.voice, "vi-VN"), name: input.voice },
      audioConfig: { audioEncoding: "MP3" },
      enableTimePointing: ["SSML_MARK"],
    }),
    words: marked.words,
  };
}

export function buildGoogleVoicesRequest(apiKey: string, languageCode = "vi-VN"): HttpRequest {
  const url = new URL(`${GOOGLE_TTS_BASE}/voices`);
  url.searchParams.set("languageCode", languageCode);
  return {
    url: url.toString(),
    method: "GET",
    headers: { "X-Goog-Api-Key": apiKey },
  };
}

export function wordsFromGoogleTimepoints(
  words: string[],
  timepoints: Array<{ markName?: string; timeSeconds?: number }>,
  durationSec: number,
): Array<{ startSec: number; endSec: number; text: string }> {
  const starts = new Map<string, number>();
  for (const point of timepoints) {
    if (point.markName && typeof point.timeSeconds === "number") starts.set(point.markName, point.timeSeconds);
  }
  const timed: Array<{ startSec: number; endSec: number; text: string }> = [];
  for (let index = 0; index < words.length; index += 1) {
    const start = starts.get(`w${index}`);
    if (start === undefined) continue;
    let end = durationSec;
    for (let next = index + 1; next < words.length; next += 1) {
      const nextStart = starts.get(`w${next}`);
      if (nextStart !== undefined) {
        end = nextStart;
        break;
      }
    }
    timed.push({ startSec: start, endSec: Math.max(start, end), text: words[index]! });
  }
  return timed;
}

const GOOGLE_VOICE_FAMILY = /Neural2|Wavenet|Standard|Chirp3-HD/i;

export function parseGoogleVoices(payload: unknown): StaticVoice[] {
  const voices = (payload as { voices?: Array<{ name?: string; languageCodes?: string[]; ssmlGender?: string }> })?.voices ?? [];
  return voices
    .filter((voice) => voice.name && GOOGLE_VOICE_FAMILY.test(voice.name))
    .map((voice) => ({
      name: voice.name!,
      language: voice.languageCodes?.[0] ?? "und",
      gender: googleGender(voice.ssmlGender),
      multilingual: /Chirp3-HD/i.test(voice.name!),
    }));
}

function googleGender(value: string | undefined): StaticVoice["gender"] {
  if (value === "FEMALE") return "female";
  if (value === "MALE") return "male";
  if (value === "NEUTRAL") return "neutral";
  return "unknown";
}

export const GOOGLE_STATIC_VI_VOICES: StaticVoice[] = [
  { language: "vi-VN", gender: "female", name: "vi-VN-Neural2-A" },
  { language: "vi-VN", gender: "male", name: "vi-VN-Neural2-D" },
  { language: "vi-VN", gender: "female", name: "vi-VN-Wavenet-A" },
  { language: "vi-VN", gender: "male", name: "vi-VN-Wavenet-B" },
  { language: "vi-VN", gender: "female", name: "vi-VN-Standard-A" },
  { language: "vi-VN", gender: "male", name: "vi-VN-Standard-B" },
];

export function buildGeminiTtsRequest(input: {
  apiKey: string;
  text: string;
  voice: string;
  model?: string;
  style?: string;
}): HttpRequest {
  const model = input.model?.trim() || DEFAULT_GEMINI_TTS_MODEL;
  const part: Record<string, unknown> = { text: input.text };
  if (input.style?.trim()) part.speechMetadata = { style: input.style.trim() };
  return {
    url: `${GEMINI_TTS_BASE}/models/${encodeURIComponent(model)}:generateContent`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": input.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [part] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { voice: input.voice } },
      },
    }),
  };
}

export function geminiAudioBase64(payload: unknown): string {
  const parts = (payload as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  })?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData?.data;
    if (data) return data;
  }
  throw new Error("Gemini TTS không trả về audio.");
}

export function wrapPcmAsWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  if (pcm.length >= 12 && pcm.subarray(0, 4).toString("ascii") === "RIFF") return pcm;
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export const GEMINI_STATIC_VOICES: StaticVoice[] = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
  "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((name) => ({ language: "multi", name, gender: "unknown" as const, multilingual: true }));

export function buildElevenSynthesizeRequest(input: {
  apiKey: string;
  text: string;
  voice: string;
  model?: string;
}): HttpRequest {
  return {
    url: `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(input.voice)}/with-timestamps`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "xi-api-key": input.apiKey,
    },
    body: JSON.stringify({
      text: input.text,
      model_id: input.model?.trim() || DEFAULT_ELEVEN_MODEL,
    }),
  };
}

export function buildElevenVoicesRequest(apiKey: string): HttpRequest {
  return {
    url: `${ELEVENLABS_BASE}/voices`,
    method: "GET",
    headers: { "xi-api-key": apiKey },
  };
}

export function buildElevenSubscriptionRequest(apiKey: string): HttpRequest {
  return {
    url: `${ELEVENLABS_BASE}/user/subscription`,
    method: "GET",
    headers: { "xi-api-key": apiKey },
  };
}

export function wordsFromCharacterAlignment(alignment: {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}): Array<{ startSec: number; endSec: number; text: string }> {
  const characters = alignment.characters ?? [];
  const starts = alignment.character_start_times_seconds ?? [];
  const ends = alignment.character_end_times_seconds ?? [];
  const words: Array<{ startSec: number; endSec: number; text: string }> = [];
  let text = "";
  let start = 0;
  let end = 0;
  let open = false;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] ?? "";
    if (/\s/u.test(character)) {
      if (open && text) words.push({ startSec: start, endSec: end, text });
      text = "";
      open = false;
      continue;
    }
    if (!open) {
      open = true;
      start = starts[index] ?? 0;
      text = character;
    } else {
      text += character;
    }
    end = ends[index] ?? start;
  }
  if (open && text) words.push({ startSec: start, endSec: end, text });
  return words;
}

export function parseElevenVoices(payload: unknown): StaticVoice[] {
  const voices = (payload as { voices?: Array<{ voice_id?: string; name?: string; labels?: { gender?: string; language?: string } }> })?.voices ?? [];
  return voices.flatMap((voice) => {
    const name = voice.voice_id || voice.name;
    if (!name) return [];
    return [{
      name,
      language: voice.labels?.language || "multi",
      gender: elevenGender(voice.labels?.gender),
      multilingual: true,
    }];
  });
}

function elevenGender(value: string | undefined): StaticVoice["gender"] {
  const folded = value?.toLowerCase() ?? "";
  if (folded.startsWith("f")) return "female";
  if (folded.startsWith("m")) return "male";
  if (folded.startsWith("n")) return "neutral";
  return "unknown";
}

export function parseElevenSubscription(payload: unknown): { charactersUsed: number; characterLimit: number } | null {
  const record = payload as { character_count?: number; character_limit?: number };
  if (typeof record?.character_count !== "number" || typeof record.character_limit !== "number") return null;
  return { charactersUsed: record.character_count, characterLimit: record.character_limit };
}

export const OPENAI_STATIC_VOICES: StaticVoice[] = [
  { language: "multi", gender: "neutral", name: "alloy", multilingual: true },
  { language: "multi", gender: "male", name: "ash", multilingual: true },
  { language: "multi", gender: "female", name: "ballad", multilingual: true },
  { language: "multi", gender: "female", name: "coral", multilingual: true },
  { language: "multi", gender: "male", name: "echo", multilingual: true },
  { language: "multi", gender: "male", name: "fable", multilingual: true },
  { language: "multi", gender: "female", name: "nova", multilingual: true },
  { language: "multi", gender: "male", name: "onyx", multilingual: true },
  { language: "multi", gender: "female", name: "sage", multilingual: true },
  { language: "multi", gender: "female", name: "shimmer", multilingual: true },
  { language: "multi", gender: "male", name: "verse", multilingual: true },
];

export function buildOpenAiSpeechRequest(input: {
  apiKey: string;
  text: string;
  voice: string;
  rate: string;
  model?: string;
  style?: string;
}): HttpRequest {
  const speed = Math.min(4, Math.max(0.25, 1 + ratePercent(input.rate) / 100));
  const body: Record<string, unknown> = {
    model: input.model?.trim() || DEFAULT_OPENAI_TTS_MODEL,
    voice: input.voice,
    input: input.text,
    response_format: "mp3",
  };
  if (Math.abs(speed - 1) > 0.001) body.speed = speed;
  if (input.style?.trim()) body.instructions = input.style.trim();
  return {
    url: OPENAI_SPEECH_URL,
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

export const FPT_STATIC_VOICES: StaticVoice[] = [
  { language: "vi", gender: "female", name: "banmai" },
  { language: "vi", gender: "female", name: "lannhi" },
  { language: "vi", gender: "male", name: "leminh" },
  { language: "vi", gender: "female", name: "myan" },
  { language: "vi", gender: "female", name: "thuminh" },
  { language: "vi", gender: "male", name: "giahuy" },
  { language: "vi", gender: "female", name: "linhsan" },
];

export function fptSpeedHeader(rate: string): string {
  const speed = Math.min(3, Math.max(-3, Math.round(ratePercent(rate) / 10)));
  return speed > 0 ? `+${speed}` : String(speed);
}

export function buildFptRequest(input: { apiKey: string; text: string; voice: string; rate: string }): HttpRequest {
  return {
    url: FPT_TTS_URL,
    method: "POST",
    headers: {
      api_key: input.apiKey,
      "api-key": input.apiKey,
      voice: input.voice,
      speed: fptSpeedHeader(input.rate),
      format: "mp3",
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: input.text,
  };
}

export function parseFptCreateResponse(payload: unknown): string {
  const record = payload as { error?: number; async?: string; message?: string };
  if (!record || record.error !== 0 || !record.async) {
    throw new Error(record?.message || "FPT.AI không trả về link âm thanh.");
  }
  return record.async;
}

export async function pollFptAudio(url: string, deps: {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<Buffer> {
  const intervalMs = deps.intervalMs ?? 1000;
  const maxMs = deps.maxMs ?? 60_000;
  const now = deps.now ?? Date.now;
  const started = now();
  while (now() - started <= maxMs) {
    if (deps.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const response = await deps.fetchImpl(url, { method: "GET", signal: deps.signal });
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get("content-type") ?? "";
      const json = type.includes("json") || bytes[0] === 0x7b;
      if (!json && bytes.length > 0) return bytes;
    }
    if (now() - started + intervalMs > maxMs) break;
    await deps.sleep(intervalMs);
  }
  throw new Error("FPT.AI chưa trả file âm thanh trong 60 giây.");
}

export const VIETTEL_STATIC_VOICES: StaticVoice[] = [
  { language: "vi", gender: "female", name: "hn-quynhanh" },
  { language: "vi", gender: "female", name: "hcm-diemmy" },
  { language: "vi", gender: "female", name: "hue-maingoc" },
  { language: "vi", gender: "female", name: "hn-phuongtrang" },
  { language: "vi", gender: "male", name: "hn-thanhtung" },
  { language: "vi", gender: "male", name: "hue-baoquoc" },
  { language: "vi", gender: "male", name: "hcm-minhquan" },
  { language: "vi", gender: "female", name: "trinhthiviettrinh" },
  { language: "vi", gender: "female", name: "lethiyen" },
  { language: "vi", gender: "female", name: "nguyenthithuyduyen" },
  { language: "vi", gender: "male", name: "phamtienquan" },
];

export function viettelSpeed(rate: string): number {
  const speed = 1 + ratePercent(rate) / 100;
  return Math.min(1.3, Math.max(0.7, Math.round(speed * 100) / 100));
}

export function buildViettelRequest(input: { apiKey: string; text: string; voice: string; rate: string }): HttpRequest {
  return {
    url: VIETTEL_TTS_URL,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      token: input.apiKey,
    },
    body: JSON.stringify({
      text: input.text,
      voice: input.voice,
      speed: viettelSpeed(input.rate),
      tts_return_option: 3,
      token: input.apiKey,
      without_filter: false,
    }),
  };
}

export function buildPiperArgs(modelPath: string, outPath: string): string[] {
  return ["--model", modelPath, "--output_file", outPath];
}

export function buildVieNeuArgv(template: string, values: { inPath: string; outPath: string; voice: string }): string[] {
  if (!template.includes("{out}")) throw new Error("Lệnh VieNeu phải chứa {out}.");
  const filled = template
    .replaceAll("{in}", values.inPath)
    .replaceAll("{out}", values.outPath)
    .replaceAll("{voice}", values.voice);
  return splitCommand(filled);
}

export function splitCommand(value: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of value.matchAll(pattern)) args.push(match[1] ?? match[2] ?? match[3] ?? "");
  return args.filter(Boolean);
}

export function parseEdgeWordBoundaries(output: string): Array<{ startSec: number; endSec: number; text: string }> {
  const words: Array<{ startSec: number; endSec: number; text: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes("WordBoundary")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { type?: string; offset?: number; duration?: number; text?: string };
      if (parsed.type !== "WordBoundary") continue;
      const text = String(parsed.text ?? "").trim();
      if (!text) continue;
      const startSec = Number(parsed.offset ?? 0) / 10_000_000;
      const endSec = startSec + Number(parsed.duration ?? 0) / 10_000_000;
      words.push({ startSec, endSec, text });
    } catch {
      continue;
    }
  }
  return words;
}

export function audioExtensionFor(providerId: string): "wav" | "mp3" {
  if (providerId === "mock" || providerId === "piper" || providerId === "gemini" || providerId === "vieneu") return "wav";
  return "mp3";
}
