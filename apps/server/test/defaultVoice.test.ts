import { describe, expect, it } from "vitest";
import { defaultVoiceFor } from "../src/lib/defaultVoice.js";

describe("defaultVoiceFor", () => {
  const config = { TTS_VOICE_VI: "vi-VN-HoaiMyNeural", TTS_VOICE_EN: "en-US-AriaNeural" };

  it("prefers the exact locale before the same-language fallback", () => {
    const voices = [
      { language: "pt-PT", name: "pt-PT-RaquelNeural", gender: "female" },
      { language: "pt-BR", name: "pt-BR-FernandaNeural", gender: "female" },
    ];
    expect(defaultVoiceFor("pt-BR", voices, config)).toBe("pt-BR-FernandaNeural");
  });

  it("uses a multilingual voice for unknown languages and falls back to English on list failure", () => {
    const multilingual = [
      { language: "ja", name: "ja-JP-KeitaMultilingualNeural", gender: "neutral", multilingual: true },
    ];
    expect(defaultVoiceFor("zh-CN", multilingual, config)).toBe("ja-JP-KeitaMultilingualNeural");
    expect(defaultVoiceFor("zh-CN", [], config, () => undefined)).toBe("en-US-AriaNeural");
  });
});
