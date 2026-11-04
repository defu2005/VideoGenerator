import type { AutoReportCode, AutoReportEntry, Project } from "@vg/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getAutoReport } from "../../services/autoReportApi";

const CODE_LABEL: Record<AutoReportCode, string> = {
  MUST_FINDING_OPEN: "MUST còn mở",
  VISUAL_LOW_FIT: "Ảnh fit thấp",
  VISUAL_UNVERIFIED_LICENSE: "License chưa xác minh",
  VISUAL_REUSED_NEIGHBOUR: "Tái sử dụng scene lân cận",
  VISUAL_SKIPPED: "Bỏ qua scene",
  MUSIC_AUTO_PICKED: "Tự chọn nhạc",
  MUSIC_NONE: "Không dùng nhạc",
  RENDER_VISION_ISSUE: "Lỗi vision sau render",
};

function sceneLink(projectId: string, entry: AutoReportEntry) {
  if (!entry.sceneId) return null;
  const tab = entry.code.startsWith("MUSIC_") ? "music"
    : entry.code === "MUST_FINDING_OPEN" ? "script"
      : "visuals";
  const to = tab === "visuals"
    ? `/projects/${projectId}?tab=visuals&scene=${entry.sceneId}`
    : `/projects/${projectId}/${tab}`;
  return <Link to={to}>Sửa scene này</Link>;
}

export function AutoReportPanel({ project }: { project: Project }) {
  const report = useQuery({
    queryKey: ["auto-report", project.id],
    queryFn: () => getAutoReport(project.id),
  });

  const groups = report.data?.groups ?? [];
  const hasEntries = groups.some((group) => group.entries.length > 0);
  if (project.mode !== "AUTO" && !hasEntries) return null;
  if (report.isPending) return null;
  if (report.isError) {
    return (
      <section className="panel auto-report" aria-label="Báo cáo AUTO">
        <h3>Báo cáo AUTO</h3>
        <p className="field-error">Không tải được báo cáo AUTO.</p>
      </section>
    );
  }
  if (!hasEntries) {
    return (
      <section className="panel auto-report" aria-label="Báo cáo AUTO">
        <h3>Báo cáo AUTO</h3>
        <p className="field-hint">Chưa có quyết định tự động nào được ghi lại.</p>
      </section>
    );
  }

  return (
    <section className="panel auto-report" aria-label="Báo cáo AUTO">
      <h3>
        Báo cáo AUTO
        {report.data && report.data.warnCount > 0 ? ` · ${report.data.warnCount} cảnh báo` : ""}
      </h3>
      {groups.map((group) => (
        <div key={group.stage} className="auto-report-stage">
          <h4>{group.stage.replaceAll("_", " ")}</h4>
          <ul>
            {group.entries.map((entry) => (
              <li key={entry.id} className={entry.severity === "WARN" ? "warn" : "info"}>
                <strong>{CODE_LABEL[entry.code] ?? entry.code}</strong> {entry.message}
                {entry.severity === "WARN" && entry.sceneId && (
                  <>
                    {" · "}
                    {sceneLink(project.id, entry)}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
