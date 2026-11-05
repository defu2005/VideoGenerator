import { createHash } from "node:crypto";
import type { LlmProvider, LlmRequest } from "./types.js";

let assistantChatScriptQueue: unknown[] = [];

/** Test hook: queue structured AssistantChat steps (shifted per LLM call). */
export function setAssistantChatScript(steps: unknown[]): void {
  assistantChatScriptQueue = [...steps];
}

export function clearAssistantChatScript(): void {
  assistantChatScriptQueue = [];
}

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
  readonly capabilities = { vision: true, maxImagesPerCall: 10 } as const;

  async generate(req: LlmRequest, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const prompt = req.messages[0]?.content ?? "";
    const topic = prompt.match(/^Topic:\s*(.+)$/mi)?.[1]?.trim() ?? "the supplied topic";
    const payload = parsePromptObject(prompt);
    if (req.schemaName === "VisionCheck") {
      const labels = req.images?.map((image) => image.label)
        ?? (Array.isArray(payload.images) ? payload.images.map((item) => String((item as { label?: string }).label ?? "img")) : ["img-0"]);
      return response({
        images: labels.map((label) => {
          const fit = mockVisionFit(label);
          return {
            label,
            fit,
            depicts: fit >= 7 ? `A matching documentary image for ${label}` : `Unrelated content for ${label}`,
            issues: fit < 7 ? ["wrong_subject"] : [],
            cropOk: true,
          };
        }),
      }, req.model);
    }
    if (req.schemaName === "VisionResearch") {
      return response({
        queries: [`${topic} archival photograph`, `${topic} documentary still`, `${topic} historical scene`],
        why: "Vision feedback suggested the previous candidates missed the subject.",
      }, req.model);
    }
    if (req.schemaName === "VisionConsistency") {
      return response({ flags: [] }, req.model);
    }
    if (req.schemaName === "ClipPick") {
      const sentences = Array.isArray(payload.sentences)
        ? payload.sentences as Array<{ start: number; end: number; text?: string }>
        : [];
      const count = Math.min(8, Math.max(1, Number(payload.count) || 3));
      const minSec = Number(payload.minSec) || 20;
      const maxSec = Number(payload.maxSec) || 45;
      const clips: Array<{ start: number; end: number; hook: string; title: string; reason: string; score: number }> = [];
      for (let index = 0; index < sentences.length && clips.length < count; index += 1) {
        let endIndex = index;
        while (endIndex < sentences.length - 1 && sentences[endIndex]!.end - sentences[index]!.start < minSec) endIndex += 1;
        const start = sentences[index]!.start;
        const end = sentences[endIndex]!.end;
        const duration = end - start;
        const text = (sentences[index]!.text ?? "Đoạn ngắn").trim();
        if (duration < minSec || duration > maxSec) continue;
        if (/^(và|nhưng|thì|còn)\b/i.test(text)) continue;
        clips.push({
          start,
          end,
          hook: text.slice(0, 40),
          title: text.slice(0, 80) || `Short ${clips.length + 1}`,
          reason: "Đoạn mở ý rõ.",
          score: Math.max(1, 90 - clips.length * 5),
        });
        index = endIndex;
      }
      return response({ clips }, req.model);
    }
    if (req.schemaName === "ThumbnailPick") {
      return response({
        frameIndex: 0,
        text: "Bí ẩn đại dương",
        position: "bottom",
        subjectX: 0.5,
        subjectY: 0.45,
      }, req.model);
    }
    if (req.schemaName === "RenderVision") {
      const frames = Array.isArray(payload.frames)
        ? payload.frames as Array<{ sceneId: string }>
        : (req.images ?? []).map((image) => ({ sceneId: image.label }));
      return response({
        frames: frames.map((frame) => ({
          sceneId: frame.sceneId,
          matchesSelection: true,
          subtitleLegible: true,
          subjectCropOk: true,
          notes: "ok",
        })),
      }, req.model);
    }
    if (req.schemaName === "FactCheck") {
      return response({
        softenedClaims: [],
        notes: ["Claims match the research notes."],
      }, req.model);
    }
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
    if (req.schemaName === "MusicAssist") {
      return response({
        mood: "calm reflective",
        energy: "low",
        queries: ["calm piano ambient", "soft documentary score"],
        avoid: ["vocals", "lyrics"],
        why: `Matches the reflective tone of ${topic}.`,
      }, req.model);
    }
    if (req.schemaName === "VideoMetadataDraft") {
      return response({
        titles: [
          `${topic.slice(0, 60)}: A Clear Overview`,
          `What We Know About ${topic.slice(0, 50)}`,
          `${topic.slice(0, 50)} Explained Carefully`,
        ],
        description: `A careful look at ${topic}, what is known, and what still needs checking.`,
        tags: ["documentary", topic.slice(0, 40), "explainer"].filter(Boolean),
        hashtags: ["#documentary", "#explainer"],
        thumbnailText: ["Key facts", "Still open"],
      }, req.model);
    }
    if (req.schemaName === "ReviewAssistant") {
      const context = payload.brief || payload.scenes
        ? payload
        : parsePromptObject(prompt.includes("## Context") ? prompt.slice(prompt.indexOf("{")) : prompt);
      const scenes = Array.isArray(context.scenes)
        ? context.scenes as Array<{ id?: string }>
        : [];
      const sceneIds = scenes.map((scene) => scene.id).filter((id): id is string => typeof id === "string");
      const first = sceneIds[0];
      const proposals: Array<Record<string, unknown>> = [
        { type: "NOTE", text: `Tighten the opening for ${topic}.` },
        { type: "MUSIC_MIX", volume: 0.18, duckingDb: -14 },
        { type: "MUSIC_QUERY", query: "calm reflective piano" },
        { type: "EDIT_METADATA", title: `${topic.slice(0, 60)} — reviewed`, tags: ["review"] },
      ];
      if (first) {
        proposals.push(
          { type: "EDIT_NARRATION", sceneId: first, text: `A clearer narration about ${topic}.` },
          { type: "EDIT_DURATION", sceneId: first, durationSec: 8 },
          { type: "EDIT_VISUAL_QUERY", sceneId: first, query: `${topic} documentary photograph` },
          {
            type: "SET_MOTION",
            sceneId: first,
            slot: 0,
            motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.08, x: 0.5, y: 0.5 } },
          },
        );
      }
      if (sceneIds.length > 1) {
        proposals.push({ type: "REORDER_SCENES", sceneIds: [...sceneIds].reverse() });
      }
      return response({
        reply: `Đã xem lại dự án về ${topic}. Dưới đây là vài đề xuất trước khi render.`,
        proposals,
      }, req.model);
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
    if (req.schemaName === "TopicSuggest") {
      const count = typeof payload.count === "number" ? Math.min(20, Math.max(1, payload.count)) : 5;
      const hint = typeof payload.hint === "string" && payload.hint.trim() ? payload.hint.trim() : topic;
      const direction = typeof payload.direction === "string" ? payload.direction.slice(0, 80) : "";
      return response({
        topics: Array.from({ length: count }, (_, index) => ({
          topic: `${hint} — góc ${index + 1}${direction ? ` (${direction.slice(0, 40)})` : ""}`.slice(0, 500),
          angle: `One-line angle ${index + 1} for ${hint}`.slice(0, 500),
        })),
      }, req.model);
    }
    if (req.schemaName === "ModelAdvisor") {
      const catalog = Array.isArray(payload.catalog)
        ? payload.catalog as Array<{ provider: string; model: string; vision?: boolean }>
        : [];
      const tasks = Array.isArray(payload.tasks)
        ? payload.tasks as Array<{ id: string; needsVision?: boolean; qualityWeight?: number }>
        : [];
      const strong = catalog.find((row) => !/flash|haiku|mini/i.test(row.model)) ?? catalog[0];
      const fast = catalog.find((row) => /flash|haiku|mini/i.test(row.model)) ?? catalog[0] ?? strong;
      const vision = catalog.find((row) => row.vision) ?? strong;
      const routes: Record<string, { provider: string; model: string; reason: string }> = {};
      for (const task of tasks) {
        const pick = task.needsVision
          ? vision
          : (task.qualityWeight ?? 1) >= 3 ? strong : fast;
        if (!pick) continue;
        routes[task.id] = {
          provider: pick.provider,
          model: pick.model,
          reason: task.needsVision
            ? "Model có vision, phù hợp kiểm tra ảnh."
            : (task.qualityWeight ?? 1) >= 3
              ? "Model mạnh cho tác vụ cần chất lượng cao."
              : "Model nhanh, đủ cho tác vụ phụ.",
        };
      }
      return response({
        routes,
        notes: "Đề xuất mock dựa trên catalog hiện có.",
      }, req.model);
    }
    if (req.schemaName === "AssistantChat") {
      if (assistantChatScriptQueue.length > 0) {
        const step = assistantChatScriptQueue.shift();
        return response(step, req.model);
      }
      return response({ reply: "Đã nhận.", done: true }, req.model);
    }
    if (req.schemaName === "PerformanceInsight") {
      return response({
        summary: "- Video đăng lúc 19:00 có điểm cao hơn.\n- Nên giữ thời lượng vừa phải.\n- Hook ngắn dễ giữ người xem.",
        patterns: [{
          kind: "timing",
          finding: "Khung 19:00 vượt trung vị điểm.",
          evidence: "Nhóm giờ có ít nhất 3 video và điểm trên trung vị.",
          confidence: "high",
        }],
        recommendations: {
          directionAddendum: "Ưu tiên hook ngắn và góc kể chuyện rõ ngay câu đầu.",
          preferredDurationSec: { min: 60, max: 180 },
          publishTimes: ["19:00", "03:00"],
          topicAngles: ["kể một chi tiết cụ thể"],
          avoid: ["tiêu đề giật gân"],
        },
      }, req.model);
    }
    if (req.schemaName === "FinanceInsight") {
      return response({
        bullets: [
          "Doanh thu ổn định so với tháng trước.",
          "Chi phí LLM chiếm phần lớn — cân nhắc ECO cho video phụ.",
          "Top video mang lại biên lợi nhuận tốt nhất.",
        ],
      }, req.model);
    }
    if (req.schemaName === "GuidelineCheck") {
      return response({ findings: [] }, req.model);
    }
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
  const slice = prompt.slice(start);
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = 0; index < slice.length; index += 1) {
      const char = slice[index]!;
      if (inString) {
        if (escape) escape = false;
        else if (char === "\\") escape = true;
        else if (char === "\"") inString = false;
        continue;
      }
      if (char === "\"") inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(slice.slice(0, index + 1)) as Record<string, unknown>;
          } catch {
            return {};
          }
        }
      }
    }
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

/** Deterministic fit from label hash. Labels containing "lowfit" force < 7; "highfit" forces ≥ 7. */
export function mockVisionFit(label: string): number {
  if (/lowfit/i.test(label)) return 3;
  if (/highfit/i.test(label)) return 9;
  const digest = createHash("sha256").update(label).digest();
  return digest[0]! % 11;
}
