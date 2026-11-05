import { PROJECT_STATUSES, type ProjectStatus } from "@vg/shared";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { RelativeTime } from "../../components/ui/RelativeTime";
import { useToast } from "../../components/ui/Toast";
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

export function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const stats = useDashboardStats();
  const pauseAutomation = useSetAutomationPaused();
  const [createOpen, setCreateOpen] = useState(false);

  if (stats.isPending) return <Spinner label="Đang tải bảng điều khiển" />;
  if (stats.isError) {
    return <ErrorState message={stats.error instanceof Error ? stats.error.message : "Không tải được bảng điều khiển"} onRetry={() => void stats.refetch()} />;
  }

  const data = stats.data;
  const automation = data.automation;
  const reviewCount = data.byStatus.REVIEW ?? 0;
  const failedCount = data.byStatus.FAILED ?? 0;
  const attention = reviewCount + failedCount + data.recentErrors.length + (automation?.recentErrors.length ?? 0);

  async function togglePause() {
    if (!automation) return;
    try {
      await pauseAutomation.mutateAsync(!automation.paused);
      toast.success(automation.paused ? "Đã tiếp tục tự động hoá" : "Đã tạm dừng tự động hoá");
      await stats.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không đổi được trạng thái");
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="TỔNG QUAN"
        title="Bảng điều khiển"
        description="Việc cần xử lý, lịch đăng và các dự án vừa cập nhật."
        actions={<button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>＋ New project</button>}
      />

      <section className="stats-grid kpi-row" aria-label="Project statistics">
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

      <div className="dashboard-columns">
        <Card title="Cần bạn xử lý">
          {attention === 0 ? (
            <p className="page-subtitle">Không có việc đang chờ. Mở dự án khi bạn muốn làm tiếp.</p>
          ) : (
            <ul className="attention-list">
              {reviewCount > 0 && (
                <li><Link to="/projects?status=REVIEW">{reviewCount} dự án đang chờ duyệt</Link></li>
              )}
              {failedCount > 0 && (
                <li><Link to="/projects?status=FAILED">{failedCount} dự án lỗi</Link></li>
              )}
              {data.recentErrors.map((error) => (
                <li key={error.jobId}>
                  <Link to={`/projects/${error.projectId}/overview`}>Xử lý {error.projectTitle}</Link>
                </li>
              ))}
              {automation?.recentErrors.map((error) => (
                <li key={error.id}>
                  <span>{error.message}</span>
                  {" "}
                  <RelativeTime value={error.at} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Sắp đăng" actions={<Link className="text-button" to="/publish/calendar">Mở lịch đăng</Link>}>
          <p className="page-subtitle">Lịch đăng sắp tới nằm ở trang Lịch đăng. Bảng này chưa nhận danh sách bài sắp đăng.</p>
        </Card>
      </div>

      {data.trendsToday && data.trendsToday.length > 0 && (
        <section className="panel" aria-label="Xu hướng hôm nay">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TRENDS</p>
              <h2>Xu hướng hôm nay</h2>
            </div>
          </div>
          <ul className="attention-list">
            {data.trendsToday.map((idea) => (
              <li key={`${idea.profileId}-${idea.title}`}>
                <Link to={`/profiles/${idea.profileId}/topics`}><strong>{idea.title}</strong></Link>
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
            <Button
              variant="secondary"
              loading={pauseAutomation.isPending}
              onClick={() => void togglePause()}
            >
              {automation.paused ? "Tiếp tục tất cả" : "Tạm dừng tất cả"}
            </Button>
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
                  ? <RelativeTime value={automation.nextProductionAt} />
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
        </section>
      )}

      {data.recent.length === 0 ? (
        <EmptyState
          title="Chưa có dự án"
          description="Tạo dự án đầu tiên để bắt đầu một video."
          createLabel="Tạo dự án"
          onCreate={() => setCreateOpen(true)}
        />
      ) : (
        <section className="panel recent-panel">
          <div className="section-heading">
            <div><p className="eyebrow">WORKSPACE</p><h2>Dự án gần đây</h2></div>
            <Link to="/projects" className="text-button">Xem tất cả <span aria-hidden="true">→</span></Link>
          </div>
          <div className="recent-list">
            {data.recent.map((project) => (
              <Link className="recent-project" key={project.id} to={`/projects/${project.id}/overview`}>
                <span className="project-avatar" aria-hidden="true">{project.title.trim().charAt(0).toUpperCase() || "P"}</span>
                <span className="recent-project-name"><strong>{project.title}</strong><small>{project.topic}</small></span>
                <StatusBadge status={project.status} />
                <RelativeTime value={project.updatedAt} />
                <span className="row-chevron" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.recentErrors.length > 0 && (
        <section className="panel recent-errors" aria-label="Recent errors">
          <div className="section-heading"><div><p className="eyebrow">LỖI</p><h2>Lỗi gần đây</h2></div></div>
          <ul className="recent-error-list">{data.recentErrors.map((error) => (
            <li key={error.jobId}>
              <Link to={`/projects/${error.projectId}/overview`}><strong>{error.projectTitle}</strong></Link>
              <span>{error.stage.replaceAll("_", " ")}</span>
              <p>{error.message}</p>
              <RelativeTime value={error.at} />
            </li>
          ))}</ul>
        </section>
      )}
      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
