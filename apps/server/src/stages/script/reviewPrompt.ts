import type { Project, ResearchNotes, Script } from "@vg/shared";

export function scriptReviewPrompt(
  project: Project,
  research: ResearchNotes | undefined,
  script: Script,
  wordsPerMinute = 150,
  pass = 1,
  priorNotes: string[] = [],
): { system: string; prompt: string } {
  const pace = project.settings.wordsPerMinute ?? wordsPerMinute;
  return {
    system: pass === 1
      ? "You are a concise script editor. Return only valid JSON with revisedScript and notes."
      : "You are polishing a reviewed video script. Return only valid JSON with revisedScript and notes.",
    prompt: [
      `${pass === 1 ? "Review and revise" : "Polish"} this ${project.settings.language} narration for a ${project.settings.targetDurationSec}-second video.`,
      `Target duration: ${project.settings.targetDurationSec} seconds`,
      `Speaking pace: ${pace} words per minute`,
      "Keep its language, target duration, every section id in the same order, and the Script schema including visualQueries.",
      "Make only meaningful improvements. Return at most 8 concise review notes.",
      ...(priorNotes.length ? [`Previous review notes: ${JSON.stringify(priorNotes)}`] : []),
      `Research summary: ${research?.summary ?? "No research summary available."}`,
      `Script: ${JSON.stringify(script)}`,
      'Output: {"revisedScript": <Script>, "notes": ["..."]}',
    ].join("\n"),
  };
}
