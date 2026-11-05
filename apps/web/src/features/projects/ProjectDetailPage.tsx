import { recommendBrief, type Project } from "@vg/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { useDeleteProject, useDuplicateProject, useProject, useSetProjectArchived } from "../../hooks/useProjects";
import { ApiRequestError } from "../../services/apiClient";
import { getAutoReport } from "../../services/autoReportApi";
import { EditProjectDialog } from "./EditProjectDialog";
import { PipelinePanel } from "../pipeline/PipelinePanel";
import { ScriptTab } from "../script/ScriptTab";
import { SceneBoard } from "../scenes/SceneBoard";
import { VisualReview } from "../visuals/VisualReview";
import { ProjectUsagePanel } from "../usage/ProjectUsagePanel";
import { VoicePanel } from "../voice/VoicePanel";
import { SubtitlePanel } from "../subtitles/SubtitlePanel";
import { MusicPanel } from "../music/MusicPanel";
import { TimelinePanel } from "../timeline/TimelinePanel";
import { RenderPanel } from "../render/RenderPanel";
import { TranslationPanel } from "./TranslationPanel";
import { StageStepper } from "./StageStepper";

const TABS = ["overview", "script", "scenes", "visuals", "voice", "subtitles", "music", "timeline", "render", "usage"] as const;

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ProjectOverview({ project }: { project: Project }) {
  const warnings = recommendBrief({
    topic: project.topic,
    title: project.title,
    description: project.description,
    settings: project.settings,
  }).warnings;
  const duration = project.settings.targetDurationSec >= 60
    ? `${project.settings.targetDurationSec / 60} min`
    : `${project.settings.targetDurationSec} sec`;
  return (
    <div className="overview-grid">
      <section className="panel overview-card">
        <p className="eyebrow">PROJECT BRIEF</p>
        <h2>Topic</h2><p>{project.topic}</p>
        {project.description && <><h2>Description</h2><p>{project.description}</p></>}
        <h2>Video brief</h2>
        <p>
          {project.settings.platform.replaceAll("_", " ")} · {project.settings.aspectRatio} · {duration} ·
          {" "}{project.settings.language} · {project.settings.style}
        </p>
        {warnings.length > 0 && (
          <ul className="brief-warning-list" aria-label="Brief warnings">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}
      </section>
      <section className="panel overview-card">
        <p className="eyebrow">CONFIGURATION</p>
        <h2>Settings</h2>
        <dl className="settings-list">
          <div><dt>Language</dt><dd>{project.settings.language}</dd></div>
          <div><dt>Target duration</dt><dd>{project.settings.targetDurationSec} sec</dd></div>
          <div><dt>Aspect ratio</dt><dd>{project.settings.aspectRatio}</dd></div>
          <div><dt>Style / tone</dt><dd>{project.settings.style} / {project.settings.tone}</dd></div>
          <div><dt>Audience</dt><dd>{project.settings.audience}</dd></div>
          <div><dt>Scene duration</dt><dd>{project.settings.sceneDurationSec} sec</dd></div>
          <div><dt>Auto render</dt><dd>{project.settings.autoRender ? "On" : "Off"}</dd></div>
        </dl>
        <h2>Dates</h2>
        <dl className="settings-list">
          <div><dt>Created</dt><dd>{formatUpdated(project.createdAt)}</dd></div>
          <div><dt>Updated</dt><dd>{formatUpdated(project.updatedAt)}</dd></div>
        </dl>
      </section>
      {project.kind === "clip" ? (
        <section className="panel overview-card">
          <p className="eyebrow">SHORT</p>
          <h2>Đoạn đã cắt</h2>
          <p>Đây là Short đã cắt từ video dài, không cần duyệt kịch bản.</p>
          {project.parentProjectId && <Link to={`/projects/${project.parentProjectId}/render`}>Mở video gốc</Link>}
        </section>
      ) : (
        <>
          <PipelinePanel projectId={project.id} project={project} />
          <TranslationPanel project={project} />
        </>
      )}
    </div>
  );
}

export function ProjectDetailPage() {
  const { id = "", tab = "" } = useParams();
  const navigate = useNavigate();
  const projectQuery = useProject(id);
  const autoReport = useQuery({
    queryKey: ["auto-report", id],
    queryFn: () => getAutoReport(id),
    enabled: Boolean(id),
  });
  const archive = useSetProjectArchived();
  const duplicate = useDuplicateProject();
  const remove = useDeleteProject();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState("");

  if (!TABS.includes(tab as typeof TABS[number])) return <Navigate replace to={`/projects/${id}/overview`} />;
  if (projectQuery.isPending) return <Spinner label="Loading project" />;
  if (projectQuery.isError) {
    if (projectQuery.error instanceof ApiRequestError && projectQuery.error.status === 404) {
      return <section className="state-card not-found-state"><h1>Project not found</h1><p>This project may have been deleted or is no longer available.</p><Link className="button button-secondary" to="/projects">Back to project library</Link></section>;
    }
    return <ErrorState message={projectQuery.error instanceof Error ? projectQuery.error.message : "Unable to load project"} onRetry={() => void projectQuery.refetch()} />;
  }

  const project = projectQuery.data;
  const isClip = project.kind === "clip";
  const tabs = isClip ? (["overview", "render"] as const) : TABS;
  const autoWarnCount = autoReport.data?.warnCount ?? 0;
  async function duplicateCurrent() {
    setActionError("");
    try {
      const copy = await duplicate.mutateAsync(project.id);
      navigate(`/projects/${copy.id}/overview`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to duplicate project");
    }
  }

  async function archiveCurrent() {
    setActionError("");
    try {
      await archive.mutateAsync({ id: project.id, archived: project.archivedAt === null });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update archive status");
    }
  }

  async function deleteCurrent() {
    try {
      await remove.mutateAsync(project.id);
      navigate("/projects");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to delete project");
    }
  }

  if (isClip && tab !== "overview" && tab !== "render") {
    return <Navigate replace to={`/projects/${project.id}/overview`} />;
  }

  return (
    <div className="page-stack">
      <div className="detail-back"><Link to="/projects">← Project library</Link></div>
      <section className="detail-header panel detail-header-sticky">
        <div className="detail-title">
          <div><p className="eyebrow">PROJECT · V{project.version}</p><h1>{project.title}</h1></div>
          <StatusBadge status={project.status} />
        </div>
        <div className="detail-subtitle">
          <span>{project.stage.replaceAll("_", " ")}</span>
          <span>{project.mode}</span>
          {autoWarnCount > 0 && (
            <Link className="auto-warn-badge" to={`/projects/${project.id}/render`} title="Xem báo cáo AUTO">
              AUTO: {autoWarnCount} cảnh báo
            </Link>
          )}
          <span>Updated {formatUpdated(project.updatedAt)}</span>
        </div>
        <StageStepper project={project} />
        <div className="detail-actions">
          <button className="button button-secondary" type="button" onClick={() => setEditing(true)}>Edit</button>
          <button className="button button-secondary" type="button" onClick={() => void duplicateCurrent()}>Duplicate</button>
          <button className="button button-secondary" type="button" onClick={() => void archiveCurrent()}>{project.archivedAt ? "Unarchive" : "Archive"}</button>
          <button className="button button-danger-outline" type="button" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </section>
      {actionError && <p className="request-error" role="alert">{actionError}</p>}
      <nav className="tab-bar" aria-label="Project sections">
        {tabs.map((value) => (
          <NavLink key={value} to={`/projects/${project.id}/${value}`} className={({ isActive }) => isActive ? "active" : ""}>
        {value === "usage" ? "Token" : `${value[0].toUpperCase()}${value.slice(1)}`}
          </NavLink>
        ))}
      </nav>
      {tab === "overview"
        ? <ProjectOverview project={project} />
        : tab === "usage"
          ? <ProjectUsagePanel projectId={project.id} />
        : tab === "script"
          ? <ScriptTab project={project} />
          : tab === "scenes"
            ? <SceneBoard project={project} />
            : tab === "visuals"
              ? <VisualReview project={project} />
              : tab === "voice"
                ? <VoicePanel project={project} />
                : tab === "subtitles"
                  ? <SubtitlePanel project={project} />
                  : tab === "music"
                    ? <MusicPanel project={project} />
                  : tab === "timeline"
                    ? <TimelinePanel project={project} />
                  : tab === "render"
                    ? <RenderPanel project={project} />
                  : <section className="panel coming-soon"><span className="coming-icon">◷</span><p className="eyebrow">{tab.toUpperCase()}</p><h2>Coming in a later task</h2><p>This project workspace will be available in a later task.</p></section>}
      <EditProjectDialog project={project} open={editing} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete project?"
        message={actionError || `“${project.title}” and its local project data will be permanently deleted.`}
        confirmLabel="Delete project"
        busy={remove.isPending}
        onCancel={() => { setConfirmDelete(false); setActionError(""); }}
        onConfirm={() => void deleteCurrent()}
      />
    </div>
  );
}
