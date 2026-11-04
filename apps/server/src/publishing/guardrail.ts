import type Database from "better-sqlite3";

export type GuardrailResult = {
  forcePrivate: boolean;
  reason: string | null;
};

/**
 * Safety: open MUST findings, RENDER_VISION_ISSUE WARN, or failed render check
 * → upload as private and record why.
 */
export function evaluatePublishGuardrail(
  sqlite: Database.Database,
  projectId: string,
  renderId: string,
): GuardrailResult {
  const reasons: string[] = [];

  const mustOpen = sqlite.prepare(
    `SELECT COUNT(*) AS count FROM guideline_findings
     WHERE project_id = ? AND status = 'OPEN' AND severity = 'MUST'`,
  ).get(projectId) as { count: number };
  if (mustOpen.count > 0) {
    reasons.push(`Còn ${mustOpen.count} vi phạm MUST chưa xử lý`);
  }

  const visionWarn = sqlite.prepare(
    `SELECT COUNT(*) AS count FROM auto_report_entries
     WHERE project_id = ? AND code = 'RENDER_VISION_ISSUE' AND severity = 'WARN'`,
  ).get(projectId) as { count: number };
  if (visionWarn.count > 0) {
    reasons.push("Báo cáo AUTO có cảnh báo RENDER_VISION_ISSUE");
  }

  const render = sqlite.prepare(
    "SELECT report FROM renders WHERE id = ? AND project_id = ?",
  ).get(renderId, projectId) as { report: string } | undefined;
  if (render) {
    const report = typeof render.report === "string"
      ? JSON.parse(render.report) as { ok?: boolean }
      : render.report as { ok?: boolean };
    if (report.ok === false) {
      reasons.push("Kiểm tra render thất bại (report.ok = false)");
    }
  }

  if (reasons.length === 0) return { forcePrivate: false, reason: null };
  return {
    forcePrivate: true,
    reason: `Đăng riêng tư vì: ${reasons.join("; ")}. Bạn có thể đăng công khai thủ công sau.`,
  };
}
