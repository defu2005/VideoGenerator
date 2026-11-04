import { Link } from "react-router-dom";

export function EmptyState({
  title = "No projects yet",
  description = "Create a project to get started.",
  onCreate,
  createLabel = "Create project",
}: {
  title?: string;
  description?: string;
  onCreate?: () => void;
  createLabel?: string;
}) {
  return (
    <section className="state-card empty-state">
      <span className="empty-icon" aria-hidden="true">＋</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {onCreate
        ? <button className="button button-primary" type="button" onClick={onCreate}>{createLabel}</button>
        : <Link className="button button-primary" to="/projects">Browse projects</Link>}
    </section>
  );
}
