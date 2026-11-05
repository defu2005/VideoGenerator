import { describe, expect, it } from "vitest";
import {
  applyEconomyPolicy,
  fallbackChain,
  redactHeaders,
  resolveVoiceSelection,
  runProviderFallback,
  ttsCostUsd,
} from "../src/tts/catalog.js";
import {
  alignScriptWords,
  combineChunkTimings,
  coverDuration,
  cuesFromWords,
  estimateWords,
  parseSilenceLog,
  splitNarration,
  spreadSentence,
  syllableWeight,
  timingsCover,
} from "../src/tts/timing.js";
import {
  buildElevenSynthesizeRequest,
  buildFptRequest,
  buildGeminiTtsRequest,
  buildGoogleSynthesizeRequest,
  buildOpenAiSpeechRequest,
  buildPiperArgs,
  buildVieNeuArgv,
  buildViettelRequest,
  geminiAudioBase64,
  parseEdgeWordBoundaries,
  parseElevenSubscription,
  parseFptCreateResponse,
  pollFptAudio,
  wordsFromCharacterAlignment,
  wordsFromGoogleTimepoints,
  wrapPcmAsWav,
} from "../src/tts/requests.js";

const SECRET = "super-secret-tts-key";

function responseOf(status: number, body: Buffer | string, contentType: string) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? contentType : null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("TTS request builders", () => {
  it("builds a Google SSML request and turns timepoints into words without logging the key", () => {
    const request = buildGoogleSynthesizeRequest({
      apiKey: SECRET,
      text: "Xin chào",
      voice: "vi-VN-Neural2-A",
      rate: "+0%",
    });
    expect(request.url).toBe("https://texttospeech.googleapis.com/v1beta1/text:synthesize");
    expect(request.url).not.toContain(SECRET);
    expect(request.headers["X-Goog-Api-Key"]).toBe(SECRET);
    expect(JSON.stringify(redactHeaders(request.headers))).not.toContain(SECRET);
    const body = JSON.parse(request.body ?? "{}") as { input: { ssml: string }; enableTimePointing: string[] };
    expect(body.enableTimePointing).toEqual(["SSML_MARK"]);
    expect(body.input.ssml).toContain("<mark name=\"w0\"/>Xin");
    const escaped = buildGoogleSynthesizeRequest({ apiKey: SECRET, text: "A & B", voice: "vi-VN-Neural2-A", rate: "+0%" });
    const ssml = JSON.parse(escaped.body ?? "{}").input.ssml as string;
    expect(ssml).toContain("&amp;");
    expect(ssml).not.toContain("A & B");
    expect(wordsFromGoogleTimepoints(request.words, [
      { markName: "w0", timeSeconds: 0.1 },
      { markName: "w1", timeSeconds: 0.4 },
    ], 1)).toEqual([
      { startSec: 0.1, endSec: 0.4, text: "Xin" },
      { startSec: 0.4, endSec: 1, text: "chào" },
    ]);
  });

  it("builds a Gemini request and wraps raw PCM in a WAV header", () => {
    const request = buildGeminiTtsRequest({
      apiKey: SECRET,
      text: "Xin chào",
      voice: "Kore",
      style: "đọc giọng kể chuyện, chậm rãi",
    });
    expect(request.url).toContain("/models/gemini-3.8-flash-tts:generateContent");
    expect(request.url).not.toContain(SECRET);
    expect(JSON.stringify(redactHeaders(request.headers))).not.toContain(SECRET);
    const body = JSON.parse(request.body ?? "{}") as {
      generationConfig: { responseModalities: string[]; speechConfig: { voiceConfig: { voice: string } } };
      contents: Array<{ parts: Array<{ speechMetadata?: { style: string } }> }>;
    };
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.generationConfig.speechConfig.voiceConfig.voice).toBe("Kore");
    expect(body.contents[0]?.parts[0]?.speechMetadata?.style).toContain("kể chuyện");
    const encoded = geminiAudioBase64({
      candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([1, 2, 3, 4]).toString("base64") } }] } }],
    });
    const wav = wrapPcmAsWav(Buffer.from(encoded, "base64"));
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.length).toBe(48);
  });

  it("groups ElevenLabs characters into words and keeps the key out of logs", () => {
    const request = buildElevenSynthesizeRequest({ apiKey: SECRET, text: "Xin chào", voice: "voice-1" });
    expect(request.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-1/with-timestamps");
    expect(request.headers["xi-api-key"]).toBe(SECRET);
    expect(JSON.stringify(redactHeaders(request.headers))).not.toContain(SECRET);
    expect(JSON.parse(request.body ?? "{}")).toMatchObject({ model_id: "eleven_multilingual_v2" });
    expect(wordsFromCharacterAlignment({
      characters: ["X", "i", "n", " ", "c", "h"],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.7],
    })).toEqual([
      { startSec: 0, endSec: 0.3, text: "Xin" },
      { startSec: 0.4, endSec: 0.7, text: "ch" },
    ]);
    expect(parseElevenSubscription({ character_count: 10, character_limit: 100 })).toEqual({
      charactersUsed: 10,
      characterLimit: 100,
    });
  });

  it("builds OpenAI, FPT and Viettel requests without putting keys in the URL", () => {
    const openai = buildOpenAiSpeechRequest({
      apiKey: SECRET, text: "Hello", voice: "nova", rate: "+10%", style: "calm",
    });
    expect(openai.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.stringify(redactHeaders(openai.headers))).not.toContain(SECRET);
    expect(JSON.parse(openai.body ?? "{}")).toMatchObject({
      model: "gpt-4o-mini-tts", voice: "nova", instructions: "calm", speed: 1.1,
    });

    const fpt = buildFptRequest({ apiKey: SECRET, text: "Xin chào bạn", voice: "banmai", rate: "+10%" });
    expect(fpt.url).toBe("https://api.fpt.ai/hmi/tts/v5");
    expect(fpt.headers.api_key).toBe(SECRET);
    expect(fpt.headers["api-key"]).toBe(SECRET);
    expect(fpt.headers.speed).toBe("+1");
    expect(fpt.body).toBe("Xin chào bạn");
    expect(JSON.stringify(redactHeaders(fpt.headers))).not.toContain(SECRET);
    expect(parseFptCreateResponse({ async: "https://cdn.example/a.mp3", error: 0, request_id: "1" })).toBe("https://cdn.example/a.mp3");

    const viettel = buildViettelRequest({ apiKey: SECRET, text: "Xin chào", voice: "hn-quynhanh", rate: "+0%" });
    expect(viettel.url).toBe("https://viettelgroup.ai/voice/api/tts/v1/rest/syn");
    expect(viettel.headers.token).toBe(SECRET);
    expect(JSON.parse(viettel.body ?? "{}")).toMatchObject({
      token: SECRET, voice: "hn-quynhanh", tts_return_option: 3, speed: 1, without_filter: false,
    });
    expect(JSON.stringify(redactHeaders(viettel.headers))).not.toContain(SECRET);
  });

  it("polls an FPT async URL until the mp3 is ready and times out", async () => {
    const calls: string[] = [];
    let clock = 0;
    const audio = await pollFptAudio("https://cdn.example/a.mp3", {
      intervalMs: 10,
      maxMs: 50,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      fetchImpl: (async () => {
        calls.push("get");
        if (calls.length === 1) return responseOf(404, "", "text/plain");
        return responseOf(200, Buffer.from("mp3-bytes"), "audio/mpeg");
      }) as typeof fetch,
    });
    expect(audio.toString()).toBe("mp3-bytes");
    expect(calls).toHaveLength(2);

    clock = 0;
    await expect(pollFptAudio("https://cdn.example/missing.mp3", {
      intervalMs: 10,
      maxMs: 15,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      fetchImpl: (async () => responseOf(404, "", "text/plain")) as typeof fetch,
    })).rejects.toThrow(/60 giây|chưa trả file/);
  });

  it("validates Piper arguments and VieNeu {out}", () => {
    expect(buildPiperArgs("voices/vi.onnx", "out.wav")).toEqual(["--model", "voices/vi.onnx", "--output_file", "out.wav"]);
    expect(buildVieNeuArgv("python -m vieneu --text-file {in} --voice {voice} --out {out}", {
      inPath: "in.txt", outPath: "out.wav", voice: "default",
    })).toEqual(["python", "-m", "vieneu", "--text-file", "in.txt", "--voice", "default", "--out", "out.wav"]);
    expect(() => buildVieNeuArgv("python -m vieneu --text-file {in}", {
      inPath: "in.txt", outPath: "out.wav", voice: "default",
    })).toThrow(/\{out\}/);
  });

  it("parses edge-tts WordBoundary events", () => {
    const words = parseEdgeWordBoundaries([
      "{\"type\":\"WordBoundary\",\"offset\":1000000,\"duration\":5000000,\"text\":\"Xin\"}",
      "not json",
    ].join("\n"));
    expect(words).toEqual([{ startSec: 0.1, endSec: 0.6, text: "Xin" }]);
  });
});

describe("TTS timings", () => {
  it("splits long narration and offsets words and cues per chunk", () => {
    const parts = splitNarration("Câu một ngắn. Câu hai cũng là một câu.", 16, "vi");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toContain("Câu");
    const combined = combineChunkTimings([
      {
        durationSec: 1,
        words: [{ startSec: 0, endSec: 1, text: "Một" }],
        cues: [{ startSec: 0, endSec: 1, text: "Một." }],
      },
      {
        durationSec: 2,
        words: [{ startSec: 0.2, endSec: 1.5, text: "Hai" }],
        cues: [{ startSec: 0.2, endSec: 1.5, text: "Hai." }],
      },
    ]);
    expect(combined.durationSec).toBe(3);
    expect(combined.words[1]).toEqual({ startSec: 1.2, endSec: 2.5, text: "Hai" });
    expect(combined.cues[1]).toEqual({ startSec: 1.2, endSec: 2.5, text: "Hai." });
  });

  it("keeps the script text when aligning recognized words", () => {
    const words = alignScriptWords("Xin chào bạn", [
      { startSec: 0, endSec: 0.2, text: "xin" },
      { startSec: 0.2, endSec: 0.5, text: "chao" },
      { startSec: 0.5, endSec: 0.9, text: "ban" },
    ], 1);
    expect(words.map((word) => word.text)).toEqual(["Xin", "chào", "bạn"]);
    expect(words[0]?.startSec).toBe(0);
    expect(words[1]?.startSec).toBe(0.2);
    expect(words[2]?.endSec).toBe(1);
    expect(timingsCover(words, 1)).toBe(true);
  });

  it("estimates words from silence segments and syllable weights", () => {
    expect(syllableWeight("một", "vi")).toBe(1);
    expect(syllableWeight("banana", "en")).toBe(3);
    const spread = spreadSentence("banana a", 0, 4, "en");
    expect(spread[0]).toMatchObject({ text: "banana", startSec: 0, endSec: 3 });
    expect(spread[1]).toMatchObject({ text: "a", startSec: 3, endSec: 4 });

    const log = [
      "silence_start: 1.5",
      "silence_end: 2",
    ].join("\n");
    const segments = parseSilenceLog(log, 4);
    expect(segments).toEqual([
      { startSec: 0, endSec: 1.5 },
      { startSec: 2, endSec: 4 },
    ]);
    const words = estimateWords({
      text: "Một hai. Ba",
      language: "vi",
      durationSec: 4,
      segments,
    });
    expect(words.map((word) => word.text)).toEqual(["Một", "hai.", "Ba"]);
    expect(timingsCover(words, 4)).toBe(true);
    expect(cuesFromWords(words).length).toBeGreaterThan(0);
    const covered = coverDuration(words, 4);
    expect(covered[0]?.startSec).toBe(0);
    expect(covered[covered.length - 1]?.endSec).toBe(4);
  });
});

describe("TTS selection", () => {
  it("falls back after one retry and records the provider that worked", async () => {
    const calls: string[] = [];
    const result = await runProviderFallback({
      chain: fallbackChain("elevenlabs", "edge-tts"),
      isAvailable: () => true,
      run: async (id) => {
        calls.push(id);
        if (id === "elevenlabs") throw new Error("fail");
        return { ok: true };
      },
    });
    expect(calls).toEqual(["elevenlabs", "elevenlabs", "edge-tts"]);
    expect(result.id).toBe("edge-tts");
  });

  it("skips a provider with no key and blocks paid providers in economy unless the profile pinned one", async () => {
    const calls: string[] = [];
    const result = await runProviderFallback({
      chain: ["openai", "edge-tts"],
      isAvailable: (id) => id === "edge-tts",
      run: async (id) => {
        calls.push(id);
        return id;
      },
    });
    expect(calls).toEqual(["edge-tts"]);
    expect(result.value).toBe("edge-tts");

    expect(applyEconomyPolicy({
      requested: "openai", budgetMode: "ECO", edgeAvailable: true, piperAvailable: true,
    })).toEqual({ providerId: "edge-tts", blockedPaid: true });
    expect(applyEconomyPolicy({
      requested: "openai", budgetMode: "ECO", profileProvider: "openai", edgeAvailable: true, piperAvailable: false,
    })).toEqual({ providerId: "openai", blockedPaid: false });
    expect(applyEconomyPolicy({
      requested: "piper", budgetMode: "ECO", edgeAvailable: true, piperAvailable: true,
    })).toEqual({ providerId: "piper", blockedPaid: false });
    expect(resolveVoiceSelection({
      project: { provider: "elevenlabs", voice: "rachel" },
      profile: { provider: "edge-tts", voice: "vi-VN-HoaiMyNeural" },
      appProvider: "edge-tts",
      budgetMode: "ECO",
      edgeAvailable: true,
      piperAvailable: true,
    }).provider).toBe("edge-tts");
    expect(ttsCostUsd(1000, 16)).toBeCloseTo(0.016);
  });
});
