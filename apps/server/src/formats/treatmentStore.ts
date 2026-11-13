import type Database from "better-sqlite3";
import { buildTreatment, estimateBudget, resolveFormat, type Project, type Script } from "@vg/shared";
import { AutoReportService } from "../services/autoReportService.js";

export function rememberTreatment(sqlite: Database.Database, project: Project, script: Script): void {
  const resolved = resolveFormat({
    topic: project.topic,
    aspectRatio: project.settings.aspectRatio,
    targetDurationSec: project.settings.targetDurationSec,
    format: project.settings.format,
  });
  const narration = script.sections.map((section) => section.narration).join(" ");
  const estimate = estimateBudget(project, undefined, [
    { stage: "RESEARCH", state: "DONE" },
    { stage: "SCRIPT", state: "DONE" },
  ]);
  const card = buildTreatment({
    title: script.title,
    recipe: resolved.recipe,
    hook: script.hook,
    sections: script.sections.map((section) => ({
      key: section.sectionKey,
      heading: section.heading,
      estDurationSec: section.estDurationSec,
    })),
    cost: {
      inputTokens: estimate.tokens?.input ?? narration.length,
      outputTokens: estimate.tokens?.output ?? estimate.total.max * 200,
      ttsCharacters: narration.length,
      usd: null,
    },
  });
  const settings = { ...project.settings, treatment: card };
  sqlite.prepare("UPDATE projects SET settings = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(settings), new Date().toISOString(), project.id);
  new AutoReportService(sqlite).add(project.id, {
    stage: "SCRIPT",
    code: "FORMAT_CHOSEN",
    severity: "INFO",
    message: `${card.formatNameVi}: ${card.angle}`,
    data: { formatId: card.formatId },
  });
}
