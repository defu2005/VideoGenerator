import type { ProjectStatus } from "@vg/shared";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  GENERATING: "Generating",
  REVIEW: "Review",
  RENDERING: "Rendering",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}
