# TASK-002 Implementation Report

## Files created or changed

- Root: `package.json`, `package-lock.json`, and `README.md`.
- Web workspace configuration: `apps/web/package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `tailwind.config.js`, and `postcss.config.js`.
- Web app shell and styles: `apps/web/src/main.tsx`, `App.tsx`, and `index.css`.
- Data and query layer: `apps/web/src/services/apiClient.ts`, `projectsApi.ts`, `dashboardApi.ts`, `apps/web/src/hooks/useProjects.ts`, and `useDialogFocusTrap.ts`.
- Shared UI components: `apps/web/src/components/ConfirmDialog.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `Spinner.tsx`, `StatusBadge.tsx`, and `layout/AppLayout.tsx`.
- Dashboard: `apps/web/src/features/dashboard/DashboardPage.tsx`.
- Projects: `apps/web/src/features/projects/ProjectFilters.tsx`, `ProjectCard.tsx`, `ProjectFormFields.tsx`, `CreateProjectDialog.tsx`, `EditProjectDialog.tsx`, `ProjectListPage.tsx`, and `ProjectDetailPage.tsx`.
- Test setup and tests: `apps/web/src/test/setup.ts`, `testUtils.tsx`, `services/apiClient.test.ts`, `features/dashboard/DashboardPage.test.tsx`, `features/projects/ProjectListPage.test.tsx`, and `ProjectDetailPage.test.tsx`.
- Completion marker: `docs/tasks/TASK-002.done`.

No server or shared-package source or schema files were changed.

## Verification

| Command | Result |
|---|---|
| `npm install` | Passed. npm reported 7 dependency vulnerabilities (5 moderate, 2 critical). |
| `npm run typecheck` | Passed for shared, server, and web workspaces. |
| `npm run build` | Passed for shared, server, and web workspaces. Rollup emitted non-fatal annotation warnings from the shared Zod dependency. |
| `npm test` | Passed: 7 test files, 31 tests total (server: 3 files / 19 tests; web: 4 files / 12 tests). |
| `npm run dev` | Started both apps. The web page and direct and proxied `/api/health` checks returned HTTP 200 after startup. The dev processes were stopped after verification. |

## Deviations and API needs

- The existing project update API deep-merges `settings.stageExecutors` and has no way to remove an existing executor override. The edit form therefore prevents clearing an explicitly configured executor and explains the limitation instead of presenting a successful but ineffective update.
- No other API additions were needed for the requested dashboard, project CRUD/actions, filters, or detail shell. `recentErrors` is currently empty from the server; the dashboard section is rendered only when it contains entries, as specified.

## Remaining issues

- npm reported 7 dependency-tree vulnerabilities during installation; dependency remediation was outside this task's scope.
- The production build succeeds despite the non-fatal Rollup warnings from Zod.

## Fix round 1

### Fixes applied

- Opened the create, edit, and confirmation dialogs as native modal dialogs with `showModal()`, close cleanup, and Escape handling through the native `cancel` event. Removed the custom focus-trap hook and added jsdom dialog-method polyfills; the project forms retain initial title-field focus.
- Upgraded Vitest to 5.1.0 in both workspaces. Upgraded the server's dev-only Drizzle Kit to 1.0.0-rc.5 to remove its vulnerable legacy esbuild loader from the dependency tree.
- Moved the mobile brand bar above the primary navigation.

### Files changed

- `apps/server/package.json`, `apps/web/package.json`, and `package-lock.json`
- `apps/web/src/components/ConfirmDialog.tsx`
- `apps/web/src/components/layout/AppLayout.tsx`
- `apps/web/src/features/projects/CreateProjectDialog.tsx`
- `apps/web/src/features/projects/EditProjectDialog.tsx`
- `apps/web/src/features/projects/ProjectListPage.test.tsx`
- `apps/web/src/hooks/useDialogFocusTrap.ts` (removed)
- `apps/web/src/index.css`
- `apps/web/src/test/setup.ts`

### Verification

| Command | Result |
|---|---|
| `npm audit` | Passed: 0 vulnerabilities. |
| `npm run typecheck` | Passed for shared, server, and web workspaces. |
| `npm run build` | Passed for shared, server, and web workspaces; existing non-fatal Zod annotation warnings remain. |
| `npm test` | Passed: 7 test files, 32 tests total (server: 3 files / 19 tests; web: 4 files / 13 tests). |

## Architect note (post fix round 1)
- Reverted `drizzle-kit` from `1.0.0-rc.5` to stable `0.31.11`: the RC requires drizzle-orm 1.x and `drizzle-kit generate` crashed with MODULE_NOT_FOUND. Verified `generate` reports "No schema changes".
- Accepted risk: 1 moderate dev-only advisory (old esbuild inside drizzle-kit's loader, GHSA-67mh-4wv8-2f99). It only runs during manual migration generation and does not start a dev server. Revisit when drizzle-kit 1.0 is stable.
- Browser re-check: dialog is modal above sidebar at 800x450, backdrop covers page, Escape closes.
