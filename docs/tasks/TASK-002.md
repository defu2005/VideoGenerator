# TASK-002 — Web UI: App Shell, Dashboard, Project Management

## GOAL
Create `apps/web`, the Control Panel frontend, with Dashboard, Project Library (search/filter/sort/paginate), and project actions (create, rename/edit, duplicate, archive/unarchive, delete), plus a Project Detail shell with tabs that later tasks will fill.

## CONTEXT
- Read `docs/ARCHITECTURE.md` (sections 2, 3, 9) and `docs/tasks/TASK-001.md`.
- Backend from TASK-001 is done and verified: `apps/server`, API under `/api` on `127.0.0.1:3001`, schemas and types in `@vg/shared` (`Project`, `ProjectListQuery`, `ProjectListResponse`, `CreateProjectInput`, `UpdateProjectInput`, `DashboardStats`, `ApiError`, enums).
- Desktop first. Tablet/mobile must still allow viewing the list, viewing status, and basic management.
- UI labels are in English for now. Keep all user-facing strings in components (no i18n library yet).

## FILES TO INSPECT
- `packages/shared/src/**` (types and schemas to reuse; do not redefine them)
- `apps/server/src/api/projects.ts`, `apps/server/src/api/dashboard.ts` (exact API contract)
- root `package.json` (workspace scripts)

## FILES TO CREATE/MODIFY
```
apps/web/package.json                 # name "@vg/web"
apps/web/index.html
apps/web/vite.config.ts               # dev proxy /api -> http://127.0.0.1:3001 (configurable by env VITE_API_PROXY_TARGET)
apps/web/tsconfig.json
apps/web/vitest.config.ts             # jsdom
apps/web/src/main.tsx
apps/web/src/App.tsx                  # router + QueryClientProvider
apps/web/src/index.css                # Tailwind
apps/web/src/services/apiClient.ts    # fetch wrapper, parses ApiError into ApiRequestError
apps/web/src/services/projectsApi.ts
apps/web/src/services/dashboardApi.ts
apps/web/src/hooks/useProjects.ts     # TanStack Query hooks + mutations with invalidation
apps/web/src/components/layout/AppLayout.tsx   # sidebar: Dashboard, Projects; header
apps/web/src/components/StatusBadge.tsx        # ProjectStatus -> color + label
apps/web/src/components/ConfirmDialog.tsx
apps/web/src/components/ErrorState.tsx  EmptyState.tsx  Spinner.tsx
apps/web/src/features/dashboard/DashboardPage.tsx
apps/web/src/features/projects/ProjectListPage.tsx
apps/web/src/features/projects/ProjectFilters.tsx
apps/web/src/features/projects/ProjectCard.tsx (or ProjectRow.tsx)
apps/web/src/features/projects/CreateProjectDialog.tsx
apps/web/src/features/projects/EditProjectDialog.tsx
apps/web/src/features/projects/ProjectDetailPage.tsx
apps/web/src/test/setup.ts
apps/web/src/**/*.test.tsx
root package.json                      # dev runs server + web together
README.md                              # add web instructions
```

## REQUIREMENTS

### Stack
React 18+, Vite, TypeScript strict, React Router (v6/v7 data-less `BrowserRouter` is fine), TanStack Query v5, Tailwind CSS. Testing: Vitest + @testing-library/react + jsdom. No other UI or state libraries (no Redux/Zustand, no component kit) unless it is a tiny headless dependency you justify in the report.

### Routes
| Path | Page |
|---|---|
| `/` | Dashboard |
| `/projects` | Project Library |
| `/projects/:id` | Project Detail (redirects to `/projects/:id/overview`) |
| `/projects/:id/:tab` | tabs: `overview, script, scenes, visuals, voice, music, timeline, render` |
| `*` | Not found |

### Dashboard (`GET /api/dashboard/stats`)
- Stat tiles: Projects (total), Draft, Generating, Review, Completed, Failed, plus Archived count.
- Clicking a tile opens `/projects?status=<STATUS>`.
- Recent projects list (from `recent`) with status badge and updated time; click → project detail.
- "New Project" button opens CreateProjectDialog.
- `recentErrors` section shown only when non-empty (placeholder for TASK-003).

### Project Library (`GET /api/projects`)
- Filter state lives in the URL query string (`q, status, includeArchived/archivedOnly, sort, order, page`), so refresh and back/forward keep filters.
- Search box debounced (300 ms).
- Status multi-select filter, "Show: Active / Archived / All", sort (Updated, Created, Title) + order toggle, pagination (prev/next + "page X of Y").
- Each row/card: title, topic (truncated), status badge, stage, mode, updated time, actions menu: Open, Edit, Duplicate, Archive/Unarchive, Delete.
- Delete asks for confirmation. On 409 `PROJECT_BUSY`, show the error message from the API.
- Loading, empty ("No projects yet → Create"), and error states (with Retry).

### Create / Edit
- CreateProjectDialog: title, topic (textarea), description, mode (AUTO / ASSISTED / MANUAL with one-line explanation each), settings: language, targetDurationSec, aspectRatio. Advanced (collapsed): stageExecutors for visuals/voice/music (AGENT/USER) and autoRender.
- Validate on the client with the shared zod schema (`CreateProjectInputSchema`); show field errors. Also show server `VALIDATION_ERROR` details if returned.
- On success → navigate to the new project's overview.
- EditProjectDialog uses `UpdateProjectInputSchema`; sends only changed fields.

### Project Detail
- Header: title, status badge, stage, mode, version, updated time; actions: Edit, Duplicate, Archive, Delete.
- Tab bar with the 8 tabs. Only **Overview** has content now: topic, description, settings summary, created/updated, and a static pipeline stage list (from `PipelineStage` enum) highlighting the current stage. Other tabs show "Coming in a later task" placeholders.
- 404 from API → "Project not found" with link back to the library.

### Data layer
- `apiClient`: base URL `/api`; JSON in/out; on non-2xx, parse `ApiError` and throw `ApiRequestError { status, code, message, details }`. Handle 204 (no body).
- Query keys: `['projects', query]`, `['project', id]`, `['dashboard']`. Every mutation invalidates the affected keys (list, detail, dashboard).
- Import types and schemas from `@vg/shared`; never redefine them.

### Dev workflow
- Root `npm run dev` starts server and web together (use `concurrently` as a root devDependency or npm workspaces with `--workspaces`; keep it simple).
- Root `build`, `typecheck`, `test` include the web app.

### UX
- Clean, dense desktop layout: left sidebar (collapsible on narrow screens), max content width, readable status colors (DRAFT gray, GENERATING blue, REVIEW amber, RENDERING violet, COMPLETED green, FAILED red).
- Keyboard accessible dialogs (focus trap or native `<dialog>`), buttons have labels.
- Responsive: at < 768 px the list becomes single-column cards and the sidebar becomes a top menu.

## IMPLEMENTATION NOTES
- `@vg/shared` is ESM built to `dist`; make sure Vite resolves it (workspace link + root `build -w @vg/shared` before web build/dev, as the server already does).
- `@vg/shared` imports `zod`; the web bundle may include it, which is expected.
- Keep components small; feature folders own their components.

## DO NOT
- Do not change the server API or shared schemas. If something is missing, list it in the report instead of changing it.
- Do not implement pipeline actions, job progress, SSE, or the content of other tabs.
- Do not add authentication.
- Do not hard-code `http://127.0.0.1:3001` inside app code (only in Vite proxy default).
- Do not commit.

## ACCEPTANCE CRITERIA
1. `npm install`, `npm run typecheck`, `npm run build`, `npm test` pass from the root (server tests still pass).
2. `npm run dev` starts both; `http://localhost:5173` shows the Dashboard with live counts from the API.
3. User can create, open, edit, duplicate, archive, unarchive, and delete a project entirely from the UI; Dashboard and list update without a manual refresh.
4. Filters/sort/page survive page reload (URL state).
5. API errors (validation, 404, 409) are shown to the user and never crash the page.
6. Usable at 375 px width for list/status/basic actions.

## TESTS (Vitest + Testing Library, mock `fetch`)
- `apiClient`: parses ApiError into ApiRequestError; handles 204.
- DashboardPage: renders counts from mocked stats; tile click navigates with status filter.
- ProjectListPage: renders items; typing in search updates URL `q` after debounce; empty state; error state with Retry.
- CreateProjectDialog: client validation blocks empty title; successful submit calls POST with correct body and navigates.
- Delete flow: confirm → DELETE called; 409 shows API message.
- ProjectDetailPage: shows header data; unknown tab → redirect to overview or not found; 404 state.

## EXPECTED RESULT
A working Control Panel where a user can manage projects end-to-end without touching the terminal, ready for pipeline features in later tasks.

## DEPENDENCIES
TASK-001 (done).

## REPORT BACK
Write `docs/tasks/TASK-002.report.md`: files created/changed, command results (typecheck/build/test with counts), any deviations and why, missing API needs, remaining issues. Then create an empty file `docs/tasks/TASK-002.done` as the completion marker.
