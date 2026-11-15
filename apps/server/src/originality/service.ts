import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  compareOriginality, GuidelineFindingSchema, OriginalityReportSchema, OriginalitySettingsSchema,
  originalityIssues, ScriptSchema, SourceManifestSchema, TimelineSchema,
  compareVisualSameness, visualSamenessIssues, visualSameness, comboSimilarity, frameSimilarity,
  VideoLookSchema, type VideoLook, type VisualSamenessSignal, type VisualSamenessSettings,
  type OriginalityReport, type OriginalityScores, type SourceAsset, type ComposePlan,
  type GuidelineSeverity,
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
    const scores = row ? JSON.parse(row.scores) as OriginalityScores : null;
    const project = this.sqlite.prepare("SELECT profile_id FROM projects WHERE id = ?").get(projectId) as { profile_id: string | null } | undefined;
    return OriginalityReportSchema.parse({ projectId, renderId: row?.render_id ?? null,
      manifest: row ? JSON.parse(row.manifest) : null, scores,
      visualSameness: scores?.visualSameness ?? null,
      verdict: !row || parsed.some((f) => f.status === "OPEN" && f.severity === "MUST") ? "REVIEW" : "OK",
      settings, findings: parsed, updatedAt: row?.updated_at ?? null,
      profileId: project?.profile_id ?? null });
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
    const baseScores = compareOriginality(narration(input.script), this.title(projectId, project.title), manifest.assets,
      earlier.map((p) => {
        const priorInput = this.input(p.id);
        const stored = this.row(p.id);
        const priorManifest = stored ? SourceManifestSchema.parse(JSON.parse(stored.manifest)) : buildSourceManifest(priorInput);
        return { projectId: p.id, title: this.title(p.id, p.title), script: narration(priorInput.script), assets: priorManifest.assets };
      }));
    const samenessResult = this.computeVisualSameness(projectId, project.profile_id, render?.id, settings.visualSameness);
    const scores: OriginalityScores = {
      ...baseScores,
      visualSameness: samenessResult.signal,
    };
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
      VALUES (?, ?, 'TIMELINE', 'CODE', ?, ?, NULL, ?, ?, ?, 'OPEN', NULL, ?, ?)`);
    let open = 0;
    const samenessSeverity: GuidelineSeverity = settings.visualSameness?.level === "block" ? "MUST" : "SHOULD";
    const allIssues = [
      ...originalityIssues(manifest, scores, settings).map((issue) => ({ ...issue, severity: "MUST" as GuidelineSeverity })),
      ...samenessResult.issues.map((issue) => ({ ...issue, severity: samenessSeverity })),
    ];
    for (const issue of allIssues) {
      if (dismissed.some((d) => d.rule_id === issue.ruleId && d.quote === evidenceHash)) continue;
      insert.run(randomUUID(), projectId, issue.ruleId, issue.severity, issue.text, evidenceHash,
        "Kiểm tra nguồn và đóng góp riêng; sửa nội dung hoặc bỏ qua kèm lý do sau khi tự duyệt.", now, now);
      if (issue.severity === "MUST") open++;
    }
    this.sqlite.prepare(`INSERT INTO source_manifests (id, project_id, render_id, manifest, scores, verdict, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET
      render_id = excluded.render_id, manifest = excluded.manifest, scores = excluded.scores, verdict = excluded.verdict, updated_at = excluded.updated_at`)
      .run(randomUUID(), projectId, render?.id ?? old?.render_id ?? null, JSON.stringify(manifest), JSON.stringify(scores), open ? "REVIEW" : "OK", now, now);
    this.syncAttention(projectId, project.profile_id, open, now);
    return this.get(projectId);
  }

  private computeVisualSameness(
    projectId: string,
    profileId: string | null,
    renderId: string | undefined,
    settings: VisualSamenessSettings,
  ): { signal: VisualSamenessSignal | null; issues: Array<{ ruleId: string; text: string }> } {
    try {
      let currentLookRow: { id: string; look: string; render_id: string; project_id: string } | undefined;
      if (renderId) {
        currentLookRow = this.sqlite.prepare(
          "SELECT id, look, render_id, project_id FROM video_looks WHERE render_id = ? ORDER BY created_at DESC LIMIT 1",
        ).get(renderId) as typeof currentLookRow;
      }
      if (!currentLookRow) {
        currentLookRow = this.sqlite.prepare(
          "SELECT id, look, render_id, project_id FROM video_looks WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
        ).get(projectId) as typeof currentLookRow;
      }
      if (!currentLookRow) {
        return { signal: null, issues: [] };
      }

      const currentLook = VideoLookSchema.parse(
        typeof currentLookRow.look === "string" ? JSON.parse(currentLookRow.look) : currentLookRow.look,
      );

      const windowLimit = settings.window;
      const ownRows = profileId
        ? (this.sqlite.prepare(
            `SELECT id, project_id, render_id, profile_id, look FROM video_looks
             WHERE profile_id = ? AND id <> ?
             ORDER BY created_at DESC LIMIT ?`,
          ).all(profileId, currentLookRow.id, windowLimit) as Array<{
            id: string;
            project_id: string;
            render_id: string;
            profile_id: string | null;
            look: string;
          }>)
        : (this.sqlite.prepare(
            `SELECT id, project_id, render_id, profile_id, look FROM video_looks
             WHERE profile_id IS NULL AND id <> ?
             ORDER BY created_at DESC LIMIT ?`,
          ).all(currentLookRow.id, windowLimit) as Array<{
            id: string;
            project_id: string;
            render_id: string;
            profile_id: string | null;
            look: string;
          }>);

      const projRow = this.sqlite.prepare("SELECT workspace_id FROM projects WHERE id = ?").get(projectId) as
        | { workspace_id: string | null }
        | undefined;
      const wsId = projRow?.workspace_id ?? null;

      const crossLimit = Math.max(50, windowLimit * 5);
      const crossRows = wsId
        ? (this.sqlite.prepare(
            `SELECT id, project_id, render_id, profile_id, look FROM video_looks
             WHERE workspace_id = ? AND ((profile_id IS NOT NULL AND profile_id <> ?) OR (profile_id IS NULL AND ? IS NOT NULL)) AND id <> ?
             ORDER BY created_at DESC LIMIT ?`,
          ).all(wsId, profileId ?? "", profileId, currentLookRow.id, crossLimit) as typeof ownRows)
        : (this.sqlite.prepare(
            `SELECT id, project_id, render_id, profile_id, look FROM video_looks
             WHERE ((profile_id IS NOT NULL AND profile_id <> ?) OR (profile_id IS NULL AND ? IS NOT NULL)) AND id <> ?
             ORDER BY created_at DESC LIMIT ?`,
          ).all(profileId ?? "", profileId, currentLookRow.id, crossLimit) as typeof ownRows);

      const rowMap = new Map<string, { projectId: string; renderId: string; look: VideoLook }>();
      const ownLooks: VideoLook[] = [];
      for (const r of ownRows) {
        try {
          const l = VideoLookSchema.parse(typeof r.look === "string" ? JSON.parse(r.look) : r.look);
          ownLooks.push(l);
          rowMap.set(l.videoId, { projectId: r.project_id, renderId: r.render_id, look: l });
        } catch {}
      }

      const crossLooks: VideoLook[] = [];
      for (const r of crossRows) {
        try {
          const l = VideoLookSchema.parse(typeof r.look === "string" ? JSON.parse(r.look) : r.look);
          crossLooks.push(l);
          rowMap.set(l.videoId, { projectId: r.project_id, renderId: r.render_id, look: l });
        } catch {}
      }

      const allEarlier = [...ownLooks, ...crossLooks];
      const scores = compareVisualSameness(currentLook, allEarlier, settings);
      const issues = visualSamenessIssues(scores, settings);

      let closestVideo: VisualSamenessSignal["closestVideo"] = null;
      let parts: VisualSamenessSignal["parts"] = null;
      let drivingPart: string | null = null;

      if (scores.channel) {
        const matchInfo = rowMap.get(scores.channel.videoId);
        if (matchInfo) {
          const pRow = this.sqlite.prepare("SELECT title FROM projects WHERE id = ?").get(matchInfo.projectId) as
            | { title: string }
            | undefined;
          const title = this.title(matchInfo.projectId, pRow?.title ?? "Video");
          closestVideo = {
            projectId: matchInfo.projectId,
            videoId: scores.channel.videoId,
            title,
            similarity: scores.channel.similarity,
          };
          const samenessResult = visualSameness(currentLook, matchInfo.look, "channel");
          parts = samenessResult.parts;
          drivingPart = this.determineDrivingPart(currentLook, ownLooks, samenessResult.parts);
        }
      } else if (scores.crossChannel) {
        const crossMatches = crossLooks.filter((l) => l.channelId === scores.crossChannel?.channelId);
        if (crossMatches.length > 0) {
          let bestLook = crossMatches[0]!;
          let bestScore = -1;
          for (const cl of crossMatches) {
            const s = visualSameness(currentLook, cl, "cross").score;
            if (s > bestScore) {
              bestScore = s;
              bestLook = cl;
            }
          }
          const matchInfo = rowMap.get(bestLook.videoId);
          if (matchInfo) {
            const pRow = this.sqlite.prepare("SELECT title FROM projects WHERE id = ?").get(matchInfo.projectId) as
              | { title: string }
              | undefined;
            const title = this.title(matchInfo.projectId, pRow?.title ?? "Video");
            closestVideo = {
              projectId: matchInfo.projectId,
              videoId: bestLook.videoId,
              title,
              similarity: bestScore,
            };
            const samenessResult = visualSameness(currentLook, bestLook, "cross");
            parts = samenessResult.parts;
            drivingPart = this.determineDrivingPart(currentLook, crossMatches, samenessResult.parts);
          }
        }
      }

      const signal: VisualSamenessSignal = {
        channelScore: scores.channel?.similarity ?? null,
        crossChannelScore: scores.crossChannel?.similarity ?? null,
        parts,
        closestVideo,
        drivingPart,
        comparedVideos: scores.comparedVideos,
      };

      return { signal, issues };
    } catch (error) {
      const raw = error instanceof Error ? error.message : "unknown";
      const message = raw.split("\n")[0]?.slice(0, 300) ?? "unknown";
      console.warn(`[originality] visual sameness computation failed projectId=${projectId} ${message}`);
      return { signal: null, issues: [] };
    }
  }

  private determineDrivingPart(
    current: VideoLook,
    earlierLooks: VideoLook[],
    parts: { combos: number | null; frames: number | null; kinds: number; style: number },
  ): string | null {
    const cScore = (parts.combos ?? 0) * 0.45;
    const fScore = (parts.frames ?? 0) * 0.40;
    const kScore = parts.kinds * 0.15;
    const sScore = parts.style * 0.40;

    if (cScore === 0 && fScore === 0 && kScore === 0 && sScore === 0) return null;

    if (sScore > cScore && sScore > fScore && sScore > kScore) {
      return "cùng bộ phong cách";
    }

    if (cScore >= fScore && cScore >= kScore) {
      if (earlierLooks.length > 1) {
        const cCount = earlierLooks.filter((l) => (comboSimilarity(current, l) ?? 0) >= 0.5).length;
        if (cCount > 0) return `cùng tổ hợp biến thể với ${cCount}/${earlierLooks.length} video gần nhất`;
      }
      return "cùng tổ hợp biến thể với video gần nhất";
    }

    if (fScore >= cScore && fScore >= kScore) {
      if (earlierLooks.length > 1) {
        const fCount = earlierLooks.filter((l) => (frameSimilarity(current, l) ?? 0) >= 0.5).length;
        if (fCount > 0) return `trùng khung hình với ${fCount}/${earlierLooks.length} video gần nhất`;
      }
      return "trùng khung hình với video gần nhất";
    }

    return "cùng tỉ lệ kiểu cảnh với video gần nhất";
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
