import type { LlmProvider, LlmRequest } from "./types.js";

const researchFixture = {
  summary: "A concise, unverified overview prepared from model knowledge.",
  keyFacts: Array.from({ length: 5 }, (_, index) => ({
    fact: `Unverified sample fact ${index + 1}`,
    confidence: "medium" as const,
    sourceHint: null,
  })),
  timeline: [{ date: "Unknown", event: "Verify chronology with reliable sources." }],
  angles: ["Separate established facts from uncertainty."],
  outline: [
    { section: "Opening", purpose: "Introduce the topic", points: ["Set context"] },
    { section: "Background", purpose: "Explain the background", points: ["Describe key details"] },
    { section: "Conclusion", purpose: "Summarize carefully", points: ["Note what needs verification"] },
  ],
  cautions: ["Confirm factual claims before publication."],
};

export class MockLlmProvider implements LlmProvider {
  readonly id = "mock";
  readonly label = "Mock (development)";
  readonly defaultModel = "mock-v1";

  async generate(req: LlmRequest, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const prompt = req.messages[0]?.content ?? "";
    if (/image-search query editor/i.test(req.system)) {
      const input = JSON.parse(prompt.slice(prompt.indexOf("{"))) as {
        scenes: Array<{ index: number; label: string; currentPrimary: string }>;
      };
      return {
        text: JSON.stringify({
          scenes: input.scenes.map(({ index, label, currentPrimary }) => ({
            index,
            primary: `${label} ${currentPrimary || "visual"}`,
            alternatives: [],
          })),
        }),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: req.model,
        provider: this.id,
        finishReason: "stop" as const,
      };
    }
    const targetSeconds = Number(prompt.match(/Target duration:\s*(\d+)/i)?.[1] ?? 180);
    const wordsPerMinute = Number(req.messages[0]?.content.match(/Speaking pace:\s*(\d+)/i)?.[1] ?? 150);
    const fixedNarrationWords = 18;
    const targetWordCount = Math.max(20, Math.round(targetSeconds * wordsPerMinute / 60) - fixedNarrationWords);
    const narration = Array.from({ length: targetWordCount }, (_, index) => `sample${index + 1}`).join(" ");
    const scriptFixture = {
      title: "A Carefully Told Story",
      hook: "What do we know, and what remains uncertain?",
      sections: [{
        id: "opening",
        heading: "Opening",
        narration,
        visualQueries: { primary: "thoughtful documentary opening", alternatives: ["documentary archive"] },
        visualNotes: "A thoughtful opening image",
        musicMood: "reflective",
        energy: "medium",
        estDurationSec: 0,
      }],
      outro: "Check reliable sources, and keep asking good questions.",
      music: { mood: "reflective", energy: "medium", keywords: ["documentary", "piano"] },
    };
    const merged = /merged story/i.test(req.system)
      ? { research: researchFixture, script: scriptFixture }
      : /script/i.test(req.system) ? scriptFixture : researchFixture;
    const result = /script editor/i.test(req.system)
      ? {
        revisedScript: { ...scriptFixture, title: "A Carefully Reviewed Story" },
        notes: ["Tightened the opening for clarity."],
      }
      : merged;
    return {
      text: JSON.stringify(result),
      usage: { inputTokens: 10, outputTokens: 20 },
      model: req.model,
      provider: this.id,
      finishReason: "stop" as const,
    };
  }
}
