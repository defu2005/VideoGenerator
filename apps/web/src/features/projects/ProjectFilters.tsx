import { PROJECT_STATUSES, type ProjectStatus } from "@vg/shared";

const LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  GENERATING: "Generating",
  REVIEW: "Review",
  RENDERING: "Rendering",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export function ProjectFilters({
  statuses,
  archiveView,
  sort,
  order,
  profileId,
  profiles,
  onStatusesChange,
  onArchiveViewChange,
  onSortChange,
  onOrderToggle,
  onProfileChange,
}: {
  statuses: ProjectStatus[];
  archiveView: "active" | "archived" | "all";
  sort: "updatedAt" | "createdAt" | "title";
  order: "asc" | "desc";
  profileId?: string;
  profiles?: Array<{ id: string; name: string }>;
  onStatusesChange: (statuses: ProjectStatus[]) => void;
  onArchiveViewChange: (view: "active" | "archived" | "all") => void;
  onSortChange: (sort: "updatedAt" | "createdAt" | "title") => void;
  onOrderToggle: () => void;
  onProfileChange?: (profileId: string | undefined) => void;
}) {
  return (
    <div className="filter-toolbar">
      <details className="status-filter">
        <summary>Status{statuses.length > 0 && <span className="filter-count">{statuses.length}</span>}</summary>
        <div className="status-filter-menu">
          {PROJECT_STATUSES.map((status) => (
            <label key={status} className="checkbox-field">
              <input
                type="checkbox"
                checked={statuses.includes(status)}
                onChange={(event) => onStatusesChange(
                  event.target.checked
                    ? [...statuses, status]
                    : statuses.filter((value) => value !== status),
                )}
              />
              {LABELS[status]}
            </label>
          ))}
          {statuses.length > 0 && (
            <button type="button" className="text-button clear-status" onClick={() => onStatusesChange([])}>Clear</button>
          )}
        </div>
      </details>
      {onProfileChange && (
        <label className="filter-select">
          <span>Hồ sơ</span>
          <select
            aria-label="Lọc theo hồ sơ"
            value={profileId ?? ""}
            onChange={(event) => onProfileChange(event.target.value || undefined)}
          >
            <option value="">Tất cả</option>
            {(profiles ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </label>
      )}
      <label className="filter-select">
        <span>Show</span>
        <select value={archiveView} onChange={(event) => onArchiveViewChange(event.target.value as "active" | "archived" | "all")}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </label>
      <label className="filter-select">
        <span>Sort by</span>
        <select value={sort} onChange={(event) => onSortChange(event.target.value as "updatedAt" | "createdAt" | "title")}>
          <option value="updatedAt">Updated</option>
          <option value="createdAt">Created</option>
          <option value="title">Title</option>
        </select>
      </label>
      <button className="button button-secondary order-button" type="button" onClick={onOrderToggle} aria-label={`Sort ${order === "desc" ? "ascending" : "descending"}`}>
        {order === "desc" ? "↓ Newest" : "↑ Oldest"}
      </button>
    </div>
  );
}
