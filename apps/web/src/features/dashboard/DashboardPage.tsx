import { PROJECT_STATUSES, type ProjectStatus } from "@vg/shared";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { useDashboardStats } from "../../hooks/useProjects";
import { useSetAutomationPaused } from "../../hooks/useAutomation";
import { useState } from "react";
import { CreateProjectDialog } from "../projects/CreateProjectDialog";

const STATUS_TITLES: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  GENERATING: "Generating",
  REVIEW: "Review",
  RENDERING: "Rendering",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DashboardPage() {
  const navigate = useNavigate();
  const stats = useDashboardStats();
  const pauseAutomation = useSetAutomationPaused();
  const [createOpen, setCreateOpen] = useState(false);

  if (stats.isPending) return <Spinner label="Loading dashboard" />;
  if (stats.isError) {
    return <ErrorState message={stats.error instanceof Error ? stats.error.message : "Unable to load dashboard"} onRetry={() => void stats.refetch()} />;
  }

  const data = stats.data;
  const automation = data.automation;
  return (
    <div className="page-stack">
      <div className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Dashboard</h1>
          <p className="page-subtitle">A snapshot of your video projects and production pipeline.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>＋ New project</button>
      </div>

      {data.trendsToday && data.trendsToday.length > 0 && (
        <section className="panel" aria-label="Xu hướng hôm nay">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TRENDS</p>
              <h2>Xu hướng hôm nay</h2>
            </div>
          </div>
          <ul>
            {data.trendsToday.map((idea) => (
              <li key={`${idea.profileId}-${idea.title}`}>
                <strong>{idea.title}</strong>
                <span> · {idea.profileName} · {idea.urgency} · {idea.fitScore}</span>
                <p>{idea.angle}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {automation && (
        <section className="panel automation-dash-card" aria-label="Tự động hóa">
          <div className="section-heading">
            <div>
              <p className="eyebrow">AUTOMATION</p>
              <h2>Tự động hóa</h2>
            </div>
            <button
              className="button"
              type="button"
              disabled={pauseAutomation.isPending}
              onClick={() => void pauseAutomation.mutateAsync(!automation.paused).then(() => stats.refetch())}
            >
              {automation.paused ? "Tiếp tục tất cả" : "Tạm dừng tất cả"}
            </button>
          </div>
          <div className="automation-dash-grid">
            <div>
              <span className="stat-label">Đang chạy</span>
              <strong>{automation.runningProfileName ?? "—"}</strong>
            </div>
            <div>
              <span className="stat-label">Sản xuất tới</span>
              <strong>
                {automation.nextProductionAt
                  ? new Date(automation.nextProductionAt).toLocaleString("vi-VN")
                  : "—"}
              </strong>
            </div>
            <div>
              <span className="stat-label">Hôm nay</span>
              <strong>{automation.todayCount}</strong>
            </div>
            <div>
              <span className="stat-label">Trạng thái</span>
              <strong>{automation.paused ? "Tạm dừng" : "Đang bật"}</strong>
            </div>
          </div>
          {automation.recentErrors.length > 0 && (
            <ul className="recent-error-list">
              {automation.recentErrors.map((error) => (
                <li key={error.id}>
                  <p>{error.message}</p>
                  <time dateTime={error.at}>{new Date(error.at).toLocaleString("vi-VN")}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="stats-grid" aria-label="Project statistics">
        <button className="stat-tile total-tile" type="button" onClick={() => navigate("/projects")}>
          <span className="stat-label">Projects</span><strong>{data.total}</strong><span className="stat-foot">Active projects</span>
        </button>
        {PROJECT_STATUSES.map((status) => (
          <button
            className={`stat-tile stat-${status.toLowerCase()}`}
            type="button"
            key={status}
            onClick={() => navigate(`/projects?status=${status}`)}
          >
            <span className="stat-label">{STATUS_TITLES[status]}</span>
            <strong>{data.byStatus[status]}</strong>
            <span className="stat-foot">View projects <span aria-hidden="true">↗</span></span>
          </button>
        ))}
        <button className="stat-tile stat-archived" type="button" onClick={() => navigate("/projects?archivedOnly=true")}>
          <span className="stat-label">Archived</span><strong>{data.archived}</strong><span className="stat-foot">View archived <span aria-hidden="true">↗</span></span>
        </button>
      </section>

      {data.recent.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to start building a video."
          onCreate={() => setCreateOpen(true)}
        />
      ) : (
        <section className="panel recent-panel">
          <div className="section-heading">
            <div><p className="eyebrow">WORKSPACE</p><h2>Recent projects</h2></div>
            <Link to="/projects" className="text-button">View all projects <span aria-hidden="true">→</span></Link>
          </div>
          <div className="recent-list">
            {data.recent.map((project) => (
              <Link className="recent-project" key={project.id} to={`/projects/${project.id}/overview`}>
                <span className="project-avatar" aria-hidden="true">{project.title.trim().charAt(0).toUpperCase() || "P"}</span>
                <span className="recent-project-name"><strong>{project.title}</strong><small>{project.topic}</small></span>
                <StatusBadge status={project.status} />
                <time dateTime={project.updatedAt}>{formatUpdated(project.updatedAt)}</time>
                <span className="row-chevron" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.recentErrors.length > 0 && (
        <section className="panel recent-errors" aria-label="Recent errors">
          <div className="section-heading"><div><p className="eyebrow">ATTENTION</p><h2>Recent errors</h2></div></div>
          <ul className="recent-error-list">{data.recentErrors.map((error) => (
            <li key={error.jobId}>
              <Link to={`/projects/${error.projectId}/overview`}><strong>{error.projectTitle}</strong></Link>
              <span>{error.stage.replaceAll("_", " ")}</span>
              <p>{error.message}</p>
              <time dateTime={error.at}>{formatUpdated(error.at)}</time>
            </li>
          ))}</ul>
        </section>
      )}
      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
