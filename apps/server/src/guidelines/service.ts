import { randomUUID } from "node:crypto";
import {
  ScriptSchema,
  TimelineSchema,
  activeGuidelines,
  checkScriptGuidelines,
  checkTimelineGuidelines,
  guidelinePromptBlock,
  resolveGuidelineStrictness,
  type ActiveGuidelines,
  type GuidelineFinding,
  type GuidelineFindingDraft,
  type GuidelineFindingsResponse,
  type GuidelineTarget,
  type Project,
} from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { getGuidelinePacks } from "./settings.js";

type FindingRow = {
  id: string;
  project_id: string;
  stage: "SCRIPT" | "TIMELINE";
  source: "CODE" | "LLM";
  rule_id: string;
  severity: "MUST" | "SHOULD" | "TIP";
  scene_id: string | null;
  text: string;
  quote: string | null;
  suggestion: string | null;
  status: "OPEN" | "FIXED" | "DISMISSED";
  dismissed_by: string | null;
  created_at: string;
  updated_at: string;
};

export class GuidelineService {
  constructor(private readonly sqlite: Database.Database) {}

  activeFor(project: Project): ActiveGuidelines {
    return activeGuidelines(project, getGuidelinePacks(this.sqlite));
  }

  guidanceFor(project: Project, targets: readonly GuidelineTarget[]): string {
    return guidelinePromptBlock(this.activeFor(project), targets);
  }

  listFindings(projectId: string): GuidelineFinding[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM guideline_findings WHERE project_id = ? ORDER BY created_at ASC",
    ).all(projectId) as FindingRow[];
    return rows.map(toFinding);
  }

  responseFor(project: Project): GuidelineFindingsResponse {
    const active = this.activeFor(project);
    const findings = this.listFindings(project.id);
    return {
      findings,
      strictness: active.strictness,
      activePacks: active.packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        kind: pack.kind,
        reviewedAt: pack.reviewedAt,
      })),
      needsAttentionSceneIds: [...new Set(findings.flatMap((finding) => (
        finding.status === "OPEN" && finding.severity === "MUST" && finding.sceneId ? [finding.sceneId] : []
      )))],
    };
  }

  dismiss(projectId: string, findingId: string, reason?: string): GuidelineFinding {
    const now = new Date().toISOString();
    const updated = this.sqlite.prepare(
      `UPDATE guideline_findings
       SET status = 'DISMISSED', dismissed_by = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).run(reason?.trim() || "user", now, findingId, projectId);
    if (updated.changes === 0) throw new AppError(404, "FINDING_NOT_FOUND", "Guideline finding not found");
    const row = this.sqlite.prepare("SELECT * FROM guideline_findings WHERE id = ?").get(findingId) as FindingRow;
    return toFinding(row);
  }

  /** Marks previous OPEN findings for this stage and source as FIXED, then inserts the new drafts. */
  replaceFindings(
    projectId: string,
    stage: "SCRIPT" | "TIMELINE",
    source: "CODE" | "LLM",
    drafts: GuidelineFindingDraft[],
  ): void {
    const now = new Date().toISOString();
    const insert = this.sqlite.prepare(
      `INSERT INTO guideline_findings
        (id, project_id, stage, source, rule_id, severity, scene_id, text, quote, suggestion, status, dismissed_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, ?, ?)`,
    );
    this.sqlite.transaction(() => {
      this.sqlite.prepare(
        `UPDATE guideline_findings SET status = 'FIXED', updated_at = ?
         WHERE project_id = ? AND stage = ? AND source = ? AND status = 'OPEN'`,
      ).run(now, projectId, stage, source);
      for (const draft of drafts) {
        insert.run(
          randomUUID(),
          projectId,
          stage,
          source,
          draft.ruleId,
          draft.severity,
          draft.sceneId,
          draft.text,
          draft.quote,
          draft.suggestion,
          now,
          now,
        );
      }
    })();
  }

  /** Deterministic checks. No-ops when the stage output is missing. */
  runCodeChecks(project: Project, stage: "SCRIPT" | "TIMELINE"): GuidelineFindingDraft[] {
    const active = this.activeFor(project);
    if (stage === "SCRIPT") {
      const script = this.readScript(project.id);
      if (!script) return [];
      const drafts = checkScriptGuidelines(active, script, {
        wordsPerMinute: project.settings.wordsPerMinute ?? 150,
        aspectRatio: project.settings.aspectRatio,
      });
      this.replaceFindings(project.id, "SCRIPT", "CODE", drafts);
      return drafts;
    }
    const timeline = this.readTimeline(project.id);
    if (!timeline) return [];
    const drafts = checkTimelineGuidelines(active, timeline, { aspectRatio: project.settings.aspectRatio });
    this.replaceFindings(project.id, "TIMELINE", "CODE", drafts);
    return drafts;
  }

  openMustCount(projectId: string): number {
    const row = this.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM guideline_findings WHERE project_id = ? AND status = 'OPEN' AND severity = 'MUST'",
    ).get(projectId) as { count: number };
    return row.count;
  }

  readScript(projectId: string) {
    const row = this.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(projectId) as { data: string } | undefined;
    if (!row) return undefined;
    return ScriptSchema.parse(JSON.parse(row.data) as unknown);
  }

  readTimeline(projectId: string) {
    const row = this.sqlite.prepare("SELECT data FROM timelines WHERE project_id = ?").get(projectId) as { data: string | Record<string, unknown> } | undefined;
    if (!row) return undefined;
    const data = typeof row.data === "string" ? JSON.parse(row.data) as unknown : row.data;
    return TimelineSchema.parse(data);
  }

  strictness(project: Project) {
    return resolveGuidelineStrictness(project);
  }
}

function toFinding(row: FindingRow): GuidelineFinding {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    source: row.source,
    ruleId: row.rule_id,
    severity: row.severity,
    sceneId: row.scene_id,
    text: row.text,
    quote: row.quote,
    suggestion: row.suggestion,
    status: row.status,
    dismissedBy: row.dismissed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
