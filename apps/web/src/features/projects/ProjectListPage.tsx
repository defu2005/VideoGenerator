import {
  ProjectListQuerySchema,
  ProjectStatusSchema,
  type Project,
  type ProjectListQuery,
  type ProjectStatus,
} from "@vg/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../../services/apiClient";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { useDeleteProject, useDuplicateProject, useProjects, useSetProjectArchived } from "../../hooks/useProjects";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { EditProjectDialog } from "./EditProjectDialog";
import { ProjectCard } from "./ProjectCard";
import { ProjectFilters } from "./ProjectFilters";

const DEFAULT_PAGE_SIZE = 12;

function queryFromParams(params: URLSearchParams): ProjectListQuery {
  const rawStatuses = params.get("status")?.split(",").filter(Boolean);
  const validStatuses = rawStatuses?.filter((status): status is ProjectStatus => ProjectStatusSchema.safeParse(status).success);
  const archiveView = params.get("archivedOnly") === "true"
    ? { archivedOnly: true, includeArchived: false }
    : params.get("includeArchived") === "true"
      ? { archivedOnly: false, includeArchived: true }
      : { archivedOnly: false, includeArchived: false };
  const parsed = ProjectListQuerySchema.safeParse({
    q: params.get("q") || undefined,
    status: validStatuses?.length ? validStatuses : undefined,
    ...archiveView,
    sort: params.get("sort") || undefined,
    order: params.get("order") || undefined,
    page: params.get("page") || undefined,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  if (parsed.success) return parsed.data;
  return ProjectListQuerySchema.parse({ pageSize: DEFAULT_PAGE_SIZE });
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError || error instanceof Error ? error.message : "The request failed";
}

export function ProjectListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = useMemo(() => queryFromParams(searchParams), [searchParams]);
  const firstSearchEffect = useRef(true);
  const [searchText, setSearchText] = useState(query.q ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [actionError, setActionError] = useState("");
  const projects = useProjects(query);
  const duplicate = useDuplicateProject();
  const archive = useSetProjectArchived();
  const remove = useDeleteProject();

  useEffect(() => {
    setSearchText(query.q ?? "");
  }, [query.q]);

  useEffect(() => {
    if (firstSearchEffect.current) {
      firstSearchEffect.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (searchText.trim()) next.set("q", searchText.trim());
        else next.delete("q");
        next.delete("page");
        return next;
      }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText, setSearchParams]);

  function updateParams(updates: Record<string, string | undefined>) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  }

  function setStatuses(statuses: ProjectStatus[]) {
    updateParams({ status: statuses.length ? statuses.join(",") : undefined, page: undefined });
  }

  function setArchiveView(view: "active" | "archived" | "all") {
    updateParams({
      archivedOnly: view === "archived" ? "true" : undefined,
      includeArchived: view === "all" ? "true" : undefined,
      page: undefined,
    });
  }

  async function duplicateProject(project: Project) {
    setActionError("");
    try {
      const copy = await duplicate.mutateAsync(project.id);
      navigate(`/projects/${copy.id}/overview`);
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  async function archiveProject(project: Project) {
    setActionError("");
    try {
      await archive.mutateAsync({ id: project.id, archived: project.archivedAt === null });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  async function deleteProject() {
    if (!deleting) return;
    setDeleteError("");
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
    }
  }

  const pageCount = projects.data ? Math.max(1, Math.ceil(projects.data.total / projects.data.pageSize)) : 1;
  const archiveView = query.archivedOnly ? "archived" : query.includeArchived ? "all" : "active";

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><p className="eyebrow">WORKSPACE</p><h1>Project library</h1><p className="page-subtitle">Find and manage your video projects.</p></div>
        <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}>＋ New project</button>
      </div>
      <section className="panel list-panel">
        <div className="list-toolbar">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search projects"
              placeholder="Search projects…"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            {searchText && <button type="button" aria-label="Clear search" onClick={() => setSearchText("")}>×</button>}
          </label>
          <ProjectFilters
            statuses={query.status ?? []}
            archiveView={archiveView}
            sort={query.sort}
            order={query.order}
            onStatusesChange={setStatuses}
            onArchiveViewChange={setArchiveView}
            onSortChange={(sort) => updateParams({ sort, page: undefined })}
            onOrderToggle={() => updateParams({ order: query.order === "desc" ? "asc" : "desc" })}
          />
        </div>
        {actionError && <p className="request-error action-error" role="alert">{actionError}</p>}
        {projects.isPending ? (
          <Spinner label="Loading projects" />
        ) : projects.isError ? (
          <ErrorState message={getErrorMessage(projects.error)} onRetry={() => void projects.refetch()} />
        ) : projects.data.items.length === 0 ? (
          <EmptyState
            title={query.q || query.status?.length || query.archivedOnly ? "No matching projects" : "No projects yet"}
            description={query.q || query.status?.length || query.archivedOnly ? "Try changing your search or filters." : "Create a project to get started."}
            onCreate={!query.q && !query.status?.length && !query.archivedOnly ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <>
            <div className="project-list" aria-label="Projects">
              {projects.data.items.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onEdit={() => setEditing(project)}
                  onDuplicate={() => void duplicateProject(project)}
                  onArchive={() => void archiveProject(project)}
                  onDelete={() => { setDeleteError(""); setDeleting(project); }}
                />
              ))}
            </div>
            <div className="pagination">
              <span>{projects.data.total} {projects.data.total === 1 ? "project" : "projects"}</span>
              <div>
                <button className="button button-secondary" type="button" disabled={query.page <= 1} onClick={() => updateParams({ page: String(query.page - 1) })}>Previous</button>
                <span>Page {query.page} of {pageCount}</span>
                <button className="button button-secondary" type="button" disabled={query.page >= pageCount} onClick={() => updateParams({ page: String(query.page + 1) })}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>
      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editing && <EditProjectDialog project={editing} open onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete project?"
        message={deleteError || `“${deleting?.title ?? ""}” and its local project data will be permanently deleted.`}
        confirmLabel="Delete project"
        busy={remove.isPending}
        onCancel={() => { setDeleting(null); setDeleteError(""); }}
        onConfirm={() => void deleteProject()}
      />
    </div>
  );
}
