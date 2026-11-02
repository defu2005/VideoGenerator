import { PIPELINE_STAGES, type Project } from "@vg/shared";
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { StatusBadge } from "../../components/StatusBadge";
import { useDeleteProject, useDuplicateProject, useProject, useSetProjectArchived } from "../../hooks/useProjects";
import { ApiRequestError } from "../../services/apiClient";
import { EditProjectDialog } from "./EditProjectDialog";

const TABS = ["overview", "script", "scenes", "visuals", "voice", "music", "timeline", "render"] as const;
const STAGE_LABELS = PIPELINE_STAGES.map((stage) => stage.replaceAll("_", " "));

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ProjectOverview({ project }: { project: Project }) {
  const currentIndex = PIPELINE_STAGES.indexOf(project.stage);
  return (
    <div className="overview-grid">
      <section className="panel overview-card">
        <p className="eyebrow">PROJECT BRIEF</p>
        <h2>Topic</h2><p>{project.topic}</p>
        {project.description && <><h2>Description</h2><p>{project.description}</p></>}
      </section>
      <section className="panel overview-card">
        <p className="eyebrow">CONFIGURATION</p>
        <h2>Settings</h2>
        <dl className="settings-list">
          <div><dt>Language</dt><dd>{project.settings.language}</dd></div>
          <div><dt>Target duration</dt><dd>{project.settings.targetDurationSec} sec</dd></div>
          <div><dt>Aspect ratio</dt><dd>{project.settings.aspectRatio}</dd></div>
          <div><dt>Auto render</dt><dd>{project.settings.autoRender ? "On" : "Off"}</dd></div>
        </dl>
        <h2>Dates</h2>
        <dl className="settings-list">
          <div><dt>Created</dt><dd>{formatUpdated(project.createdAt)}</dd></div>
          <div><dt>Updated</dt><dd>{formatUpdated(project.updatedAt)}</dd></div>
        </dl>
      </section>
      <section className="panel pipeline-card">
        <p className="eyebrow">PIPELINE</p><h2>Production stages</h2>
        <ol className="pipeline-list">
          {PIPELINE_STAGES.map((stage, index) => (
            <li className={index === currentIndex ? "current-stage" : index < currentIndex ? "completed-stage" : ""} key={stage}>
              <span className="pipeline-marker">{index < currentIndex ? "✓" : index + 1}</span>
              <span>{STAGE_LABELS[index]}</span>
              {index === currentIndex && <span className="current-label">Current</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function ProjectDetailPage() {
  const { id = "", tab = "" } = useParams();
  const navigate = useNavigate();
  const projectQuery = useProject(id);
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

  return (
    <div className="page-stack">
      <div className="detail-back"><Link to="/projects">← Project library</Link></div>
      <section className="detail-header panel">
        <div className="detail-title">
          <div><p className="eyebrow">PROJECT · V{project.version}</p><h1>{project.title}</h1></div>
          <StatusBadge status={project.status} />
        </div>
        <div className="detail-subtitle">
          <span>{project.stage.replaceAll("_", " ")}</span><span>{project.mode}</span><span>Updated {formatUpdated(project.updatedAt)}</span>
        </div>
        <div className="detail-actions">
          <button className="button button-secondary" type="button" onClick={() => setEditing(true)}>Edit</button>
          <button className="button button-secondary" type="button" onClick={() => void duplicateCurrent()}>Duplicate</button>
          <button className="button button-secondary" type="button" onClick={() => void archiveCurrent()}>{project.archivedAt ? "Unarchive" : "Archive"}</button>
          <button className="button button-danger-outline" type="button" onClick={() => setConfirmDelete(true)}>Delete</button>
        </div>
      </section>
      {actionError && <p className="request-error" role="alert">{actionError}</p>}
      <nav className="tab-bar" aria-label="Project sections">
        {TABS.map((value) => (
          <NavLink key={value} to={`/projects/${project.id}/${value}`} className={({ isActive }) => isActive ? "active" : ""}>
            {value[0].toUpperCase()}{value.slice(1)}
          </NavLink>
        ))}
      </nav>
      {tab === "overview"
        ? <ProjectOverview project={project} />
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
