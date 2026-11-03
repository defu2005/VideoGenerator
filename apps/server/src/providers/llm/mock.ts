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
    const topic = prompt.match(/^Topic:\s*(.+)$/mi)?.[1]?.trim() ?? "the supplied topic";
    const payload = parsePromptObject(prompt);
    if (req.schemaName === "visual-rerank") {
      const scenes = payload.scenes as Array<{ sceneId: string; candidates: Array<{ candidateIndex: number }> }> ?? [];
      return response({ scenes: scenes.map(({ sceneId, candidates }) => ({
        sceneId,
        order: candidates.map(({ candidateIndex }) => candidateIndex),
      })) }, req.model);
    }
    if (req.schemaName === "visual-alt-queries") {
      const scenes = payload.scenes as Array<{ sceneId: string; visualNotes?: string; narration?: string }> ?? [];
      return response({ scenes: scenes.map(({ sceneId, visualNotes, narration }) => ({
        sceneId,
        queries: [`${(visualNotes || narration || topic).slice(0, 100)} documentary photograph`],
      })) }, req.model);
    }
    if (req.schemaName === "SceneQueryAssist") {
      const scenes = payload.scenes as Array<{ index: number; label: string; currentPrimary: string }> ?? [];
      return response({ scenes: scenes.map(({ index, label, currentPrimary }) => ({
        index,
        visualDescription: `A documentary view of ${label} related to ${topic}.`,
        primary: currentPrimary || `${label} ${topic}`,
        alternatives: [`${label} archival photograph`],
      })) }, req.model);
    }
    if (/image-search query editor/i.test(req.system)) {
      const input = payload as {
        scenes: Array<{ index: number; label: string; currentPrimary: string }>;
      };
      return response({
        scenes: (input.scenes ?? []).map(({ index, label, currentPrimary }) => ({
            index,
            visualDescription: `A concrete view of ${label.toLowerCase()} and its setting.`,
            primary: `${label} ${currentPrimary || "visual"}`,
            alternatives: [],
        })),
      }, req.model);
    }
    const targetSeconds = Number(prompt.match(/Target duration:\s*(\d+)/i)?.[1] ?? 180);
    const wordsPerMinute = Number(prompt.match(/Speaking pace:\s*(\d+)/i)?.[1] ?? 150);
    const fixedNarrationWords = 18;
    const targetWordCount = Math.max(20, Math.round(targetSeconds * wordsPerMinute / 60) - fixedNarrationWords);
    const narration = Array.from({ length: targetWordCount }, (_, index) => `sample${index + 1}`).join(" ");
    const scriptFixture = {
      title: `${topic.slice(0, 80)}: A Carefully Told Story`,
      hook: `What do we know about ${topic}, and what remains uncertain?`,
      sections: [{
        id: "opening",
        heading: "Opening",
        narration,
        visualQueries: { primary: `${topic} documentary opening`, alternatives: ["documentary archive"] },
        visualNotes: "A thoughtful opening image",
        musicMood: "reflective",
        energy: "medium",
        estDurationSec: 0,
      }],
      outro: `Check reliable sources about ${topic}, and keep asking good questions.`,
      music: { mood: "reflective", energy: "medium", keywords: ["documentary", "piano"] },
    };
    const research = {
      ...researchFixture,
      summary: `${topic}: a concise, unverified overview prepared from model knowledge.`,
      keyFacts: researchFixture.keyFacts.map((item) => ({ ...item, fact: `${item.fact} about ${topic}.` })),
      timeline: [{ date: "Unknown", event: `Verify the chronology of ${topic} with reliable sources.` }],
      angles: [`Separate established facts about ${topic} from uncertainty.`],
    };
    if (req.schemaName === "ResearchNotes") return response(research, req.model);
    if (req.schemaName === "MergedStory") return response({ research, script: scriptFixture }, req.model);
    if (req.schemaName === "Script") return response(scriptFixture, req.model);
    if (req.schemaName === "ScriptReview") {
      const sourceScript = prompt.match(/^Script:\s*(\{.*\})\s*$/mi)?.[1];
      const revisedScript = sourceScript ? JSON.parse(sourceScript) as { title?: string } : scriptFixture;
      const titleTopic = revisedScript.title?.replace(/: A Carefully (?:Told|Reviewed) Story$/, "") ?? topic;
      revisedScript.title = `${titleTopic}: A Carefully Reviewed Story`;
      return response({ revisedScript, notes: ["Tightened the opening for clarity."] }, req.model);
    }
    const result = /script editor|polishing a reviewed video script/i.test(req.system)
      ? { revisedScript: scriptFixture, notes: [`Clarified the narrative about ${topic}.`] }
      : /script/i.test(req.system) ? scriptFixture : research;
    return response(result, req.model);
  }
}

function parsePromptObject(prompt: string): Record<string, unknown> {
  const start = prompt.indexOf("{");
  if (start < 0) return {};
  try {
    return JSON.parse(prompt.slice(start)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function response(value: unknown, model: string) {
  return {
    text: JSON.stringify(value),
    usage: { inputTokens: 10, outputTokens: 20 },
    model,
    provider: "mock",
    finishReason: "stop" as const,
  };
}
