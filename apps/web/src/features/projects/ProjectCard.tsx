import type { Project } from "@vg/shared";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/StatusBadge";

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ProjectCard({
  project,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  project: Project;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const archived = project.archivedAt !== null;
  return (
    <article className="project-card">
      <div className="project-card-main">
        <div className="project-card-title">
          <Link to={`/projects/${project.id}/overview`}><h2>{project.title}</h2></Link>
          <StatusBadge status={project.status} />
        </div>
        <p className="project-topic" title={project.topic}>{project.topic}</p>
        <div className="project-meta">
          <span><b>Stage</b> {project.stage.replaceAll("_", " ")}</span>
          <span><b>Mode</b> {project.mode}</span>
          <time dateTime={project.updatedAt}>Updated {formatUpdated(project.updatedAt)}</time>
        </div>
      </div>
      <details className="project-actions">
        <summary aria-label={`Actions for ${project.title}`}>•••</summary>
        <div className="actions-menu">
          <Link to={`/projects/${project.id}/overview`}>Open</Link>
          <button type="button" onClick={onEdit}>Edit</button>
          <button type="button" onClick={onDuplicate}>Duplicate</button>
          <button type="button" onClick={onArchive}>{archived ? "Unarchive" : "Archive"}</button>
          <button className="menu-danger" type="button" onClick={onDelete}>Delete</button>
        </div>
      </details>
    </article>
  );
}
