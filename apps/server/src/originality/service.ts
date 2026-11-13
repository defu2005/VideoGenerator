import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  compareOriginality, GuidelineFindingSchema, OriginalityReportSchema, OriginalitySettingsSchema,
  originalityIssues, ScriptSchema, SourceManifestSchema, TimelineSchema,
  type OriginalityReport, type SourceAsset, type ComposePlan,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { buildSourceManifest, type ManifestCandidate, type ManifestScene, type ManifestVoice } from "./manifest.js";

type ManifestRow = { manifest: string; scores: string; render_id: string | null; updated_at: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const origWhere = "source = 'CODE' AND stage = 'TIMELINE' AND rule_id GLOB 'ORIG_*'";

export class OriginalityService {
  constructor(private readonly sqlite: Database.Database) {}

  settings(projectId: string) {
    const row = this.sqlite.prepare(`SELECT p.id, f.guidelines FROM projects p LEFT JOIN profiles f ON f.id = p.profile_id WHERE p.id = ?`)
      .get(projectId) as { id: string; guidelines: string | null } | undefined;
    if (!row) throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án.");
    const guidelines = row.guidelines ? JSON.parse(row.guidelines) as { originality?: unknown } : {};
    return OriginalitySettingsSchema.parse(guidelines.originality ?? {});
  }

  get(projectId: string): OriginalityReport {
    const settings = this.settings(projectId);
    const row = this.row(projectId);
    const findings = this.sqlite.prepare(`SELECT * FROM guideline_findings WHERE project_id = ? AND ${origWhere} ORDER BY created_at, id`)
      .all(projectId) as Array<Record<string, unknown>>;
    const parsed = findings.map((f) => GuidelineFindingSchema.parse({
      id: f.id, projectId: f.project_id, stage: f.stage, source: f.source, ruleId: f.rule_id,
      severity: f.severity, sceneId: f.scene_id, text: f.text, quote: f.quote, suggestion: f.suggestion,
      status: f.status, dismissedBy: f.dismissed_by, createdAt: f.created_at, updatedAt: f.updated_at,
    }));
    return OriginalityReportSchema.parse({ projectId, renderId: row?.render_id ?? null,
      manifest: row ? JSON.parse(row.manifest) : null, scores: row ? JSON.parse(row.scores) : null,
      verdict: !row || parsed.some((f) => f.status === "OPEN" && f.severity === "MUST") ? "REVIEW" : "OK",
      settings, findings: parsed, updatedAt: row?.updated_at ?? null });
  }

  recheck(projectId: string, render?: { id: string; plan: ComposePlan | null }): OriginalityReport {
    return this.sqlite.transaction(() => this.check(projectId, render))();
  }

  private check(projectId: string, render?: { id: string; plan: ComposePlan | null }): OriginalityReport {
    const settings = this.settings(projectId);
    const old = this.row(projectId);
    const previous = old ? SourceManifestSchema.parse(JSON.parse(old.manifest)) : null;
    const input = this.input(projectId);
    if (!input.timeline) {
      const now = new Date().toISOString();
      const profile = this.sqlite.prepare("SELECT profile_id FROM projects WHERE id = ?").get(projectId) as { profile_id: string | null };
      this.sqlite.prepare(`DELETE FROM guideline_findings WHERE project_id = ? AND ${origWhere} AND status = 'OPEN'`).run(projectId);
      this.sqlite.prepare("DELETE FROM source_manifests WHERE project_id = ?").run(projectId);
      this.syncAttention(projectId, profile.profile_id, 0, now);
      return this.get(projectId);
    }
    const manifest = buildSourceManifest({ ...input, history: previous?.history ?? [],
      renderTimelineHash: render ? input.timelineHash : previous?.renderTimelineHash ?? null,
      ...(render ? { composePlan: render.plan } : { renderedAssets: previous?.timelineHash === input.timelineHash ? previous.renderedAssets : null }),
    });
    const project = this.sqlite.prepare("SELECT profile_id, title FROM projects WHERE id = ?").get(projectId) as { profile_id: string | null; title: string };
    // DONE render / PUBLISHED publication is the stored equivalent of a rendered/published project.
    const earlier = project.profile_id ? this.sqlite.prepare(`SELECT p.id, p.title FROM projects p
      WHERE p.profile_id = ? AND p.id <> ? AND
        (EXISTS (SELECT 1 FROM renders r WHERE r.project_id = p.id AND r.status = 'DONE' AND r.deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM publications u WHERE u.project_id = p.id AND u.status = 'PUBLISHED'))
      ORDER BY COALESCE((SELECT MAX(r.created_at) FROM renders r WHERE r.project_id = p.id AND r.status = 'DONE'), p.updated_at) DESC, p.id
      LIMIT ?`).all(project.profile_id, projectId, settings.previousVideoLimit) as Array<{ id: string; title: string }> : [];
    const narration = (script: typeof input.script) => script ? [script.hook, ...script.sections.map((s) => s.narration), script.outro].join(" ") : "";
    const scores = compareOriginality(narration(input.script), this.title(projectId, project.title), manifest.assets,
      earlier.map((p) => {
        const priorInput = this.input(p.id);
        const stored = this.row(p.id);
        const priorManifest = stored ? SourceManifestSchema.parse(JSON.parse(stored.manifest)) : buildSourceManifest(priorInput);
        return { projectId: p.id, title: this.title(p.id, p.title), script: narration(priorInput.script), assets: priorManifest.assets };
      }));
    // Omit history/timestamps: recording a dismissal must not change its own evidence fingerprint.
    const evidenceHash = digest({ manifest: { ...manifest, history: [], renderedAssets: null, renderTimelineHash: null }, scores, settings });
    const now = new Date().toISOString();
    const dismissed = this.sqlite.prepare(`SELECT id, rule_id, dismissed_by, updated_at, quote FROM guideline_findings
      WHERE project_id = ? AND ${origWhere} AND status = 'DISMISSED'`).all(projectId) as
      Array<{ id: string; rule_id: string; dismissed_by: string; updated_at: string; quote: string }>;
    for (const item of dismissed) if (!manifest.history.some((h) => h.findingId === item.id)) manifest.history.push({
      findingId: item.id, ruleId: item.rule_id, reason: item.dismissed_by, at: item.updated_at, evidenceHash: item.quote,
    });
    this.sqlite.prepare(`DELETE FROM guideline_findings WHERE project_id = ? AND ${origWhere} AND status = 'OPEN'`).run(projectId);
    const insert = this.sqlite.prepare(`INSERT INTO guideline_findings
      (id, project_id, stage, source, rule_id, severity, scene_id, text, quote, suggestion, status, dismissed_by, created_at, updated_at)
      VALUES (?, ?, 'TIMELINE', 'CODE', ?, 'MUST', NULL, ?, ?, ?, 'OPEN', NULL, ?, ?)`);
    let open = 0;
    for (const issue of originalityIssues(manifest, scores, settings)) {
      if (dismissed.some((d) => d.rule_id === issue.ruleId && d.quote === evidenceHash)) continue;
      insert.run(randomUUID(), projectId, issue.ruleId, issue.text, evidenceHash,
        "Kiểm tra nguồn và đóng góp riêng; sửa nội dung hoặc bỏ qua kèm lý do sau khi tự duyệt.", now, now);
      open++;
    }
    this.sqlite.prepare(`INSERT INTO source_manifests (id, project_id, render_id, manifest, scores, verdict, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET
      render_id = excluded.render_id, manifest = excluded.manifest, scores = excluded.scores, verdict = excluded.verdict, updated_at = excluded.updated_at`)
      .run(randomUUID(), projectId, render?.id ?? old?.render_id ?? null, JSON.stringify(manifest), JSON.stringify(scores), open ? "REVIEW" : "OK", now, now);
    this.syncAttention(projectId, project.profile_id, open, now);
    return this.get(projectId);
  }

  /** Called inside the finding dismissal transaction, so the reason is durable immediately. */
  recordDismissal(projectId: string): void {
    this.recheck(projectId);
  }

  private input(projectId: string) {
    const read = (table: "scripts" | "research_notes" | "timelines") => {
      const row = this.sqlite.prepare(`SELECT data FROM ${table} WHERE project_id = ?`).get(projectId) as { data: string } | undefined;
      return row ? JSON.parse(row.data) as unknown : null;
    };
    const script = read("scripts"); const timeline = read("timelines");
    return {
      script: script === null ? null : ScriptSchema.parse(script),
      research: read("research_notes") as { keyFacts?: Array<{ sourceHint?: string | null }> } | null,
      timeline: timeline === null ? null : TimelineSchema.parse(timeline), timelineHash: digest(timeline),
      candidates: this.sqlite.prepare("SELECT id, origin, provider, source_url, source_page_url, license, license_verified, phash FROM visual_candidates WHERE project_id = ?").all(projectId) as ManifestCandidate[],
      scenes: this.sqlite.prepare('SELECT id, section_id, narration FROM scenes WHERE project_id = ? ORDER BY "order"').all(projectId) as ManifestScene[],
      voices: this.sqlite.prepare("SELECT id, scene_id, provider, voice FROM voice_tracks WHERE project_id = ?").all(projectId) as ManifestVoice[],
    };
  }

  private title(projectId: string, fallback: string): string {
    const row = this.sqlite.prepare("SELECT edited, draft FROM video_metadata WHERE project_id = ?").get(projectId) as { edited: string | null; draft: string } | undefined;
    const data = row ? JSON.parse(row.edited ?? row.draft) as { titles?: string[] } : null;
    return data?.titles?.[0] ?? fallback;
  }
  private row(projectId: string): ManifestRow | undefined {
    return this.sqlite.prepare("SELECT manifest, scores, render_id, updated_at FROM source_manifests WHERE project_id = ?").get(projectId) as ManifestRow | undefined;
  }
  private syncAttention(projectId: string, profileId: string | null, count: number, now: string): void {
    const key = `originality:${projectId}`;
    this.sqlite.prepare("DELETE FROM auto_report_entries WHERE project_id = ? AND code = 'ORIGINALITY_NEEDS_USER'").run(projectId);
    if (!count) {
      this.sqlite.prepare("UPDATE operator_requests SET status = 'done', resolved_at = ? WHERE dedupe_key = ? AND status = 'open'").run(now, key);
      return;
    }
    const message = `Nguồn & tính nguyên bản: ${count} cảnh báo MUST cần bạn xử lý trước khi đăng công khai.`;
    this.sqlite.prepare(`INSERT INTO auto_report_entries (id, project_id, stage, scene_id, code, severity, message, data, created_at)
      VALUES (?, ?, 'TIMELINE', NULL, 'ORIGINALITY_NEEDS_USER', 'WARN', ?, ?, ?)`)
      .run(randomUUID(), projectId, message, JSON.stringify({ count }), now);
    const existing = this.sqlite.prepare("SELECT id FROM operator_requests WHERE dedupe_key = ? AND status = 'open'").get(key);
    // This is a deterministic pending approval, not an LLM question; never spends the daily info-question allowance.
    if (!existing) this.sqlite.prepare(`INSERT INTO operator_requests
      (id, profile_id, kind, title, why_vi, action_url, dedupe_key, status, created_at, check_kind, check_args)
      VALUES (?, ?, 'approve', 'Kiểm tra nguồn & tính nguyên bản', ?, ?, ?, 'open', ?, 'originality', ?)`)
      .run(randomUUID(), profileId, message, `/projects/${projectId}/render`, key, now, JSON.stringify({ projectId }));
  }
}
