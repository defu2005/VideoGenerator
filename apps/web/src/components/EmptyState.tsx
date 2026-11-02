import { Link } from "react-router-dom";

export function EmptyState({
  title = "No projects yet",
  description = "Create a project to get started.",
  onCreate,
}: {
  title?: string;
  description?: string;
  onCreate?: () => void;
}) {
  return (
    <section className="state-card empty-state">
      <span className="empty-icon" aria-hidden="true">＋</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {onCreate
        ? <button className="button button-primary" type="button" onClick={onCreate}>Create project</button>
        : <Link className="button button-primary" to="/projects">Browse projects</Link>}
    </section>
  );
}
