/**
 * Shared narration rules for the script writer, the merged-story prompt and the reviewer.
 * Principles (hook tension, setup/payoff, open loops, show-don't-tell) are our own wording,
 * informed by ideas from jtydhr88/screenwriting-skills (MIT) and danjdewhurst/story-skills (MIT).
 * Nothing is copied verbatim.
 */
export const NARRATION_RULES: readonly string[] = [
  "Hook: open with a tension, a contradiction, a cold-open moment or a real question. Never open with \"Hôm nay chúng ta tìm hiểu…\" or a list of achievements. The hook makes a promise that the script keeps.",
  "Central question: one question runs through the whole video. The outro answers it, or names what is still unknown. The outro is a payoff, not a thank-you.",
  "Show, don't list: build each section around at least one concrete moment (a person, a place, an object or a decision). Dates are context inside the scene, not the subject of the sentence. Never open two consecutive sentences with a year.",
  "Rhythm: mix short and long sentences. Use a rhetorical question at most once per section. End each section except the last with a line that pulls into the next one (an open loop).",
  "Accuracy: no invented quotes, numbers or events beyond the research notes. Separate fact, interpretation and dramatisation (\"có lẽ\", \"theo [nguồn]\").",
  "CTA: only when the format has a cta section, one sentence at most. It never replaces the payoff. No \"like, subscribe\" outros.",
  "TTS: write numbers, years and abbreviations the way they are spoken. Put no stage directions in the narration text.",
];

export function narrationRulesBlock(): string {
  return `Narration rules:\n${NARRATION_RULES.map((rule) => `- ${rule}`).join("\n")}`;
}

export const WRITER_SYSTEM =
  "You are a scriptwriter who tells stories for video, not an encyclopedia reader. Write natural spoken narration in the requested language: scenes, people and turning points, not lists of facts. Do not present uncertain claims as verified facts.";
