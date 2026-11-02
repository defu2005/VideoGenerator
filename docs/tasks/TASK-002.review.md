# TASK-002 Review (by Architect)

Verdict: **Accepted with fixes.** Independently verified: typecheck, build, 31/31 tests (server 19, web 12), `npm audit --omit=dev` = 0. Manual browser test: Dashboard shows live counts; creating a project with Vietnamese text from the UI works and navigates to Overview; list at 375 px has no horizontal scroll.

## Required fixes (TASK-002-FIX)

### F1 — MUST: dialogs are not modal (sidebar covers them)
Root cause: dialogs render as `<dialog open>` (non-modal). They are not in the browser top layer, so `.dialog::backdrop` never renders and the fixed `.sidebar` (`z-index: 3`) paints over the dialog on narrower desktop widths (~800 px); the page behind stays clickable.
- Open every dialog (`CreateProjectDialog`, `EditProjectDialog`, `ConfirmDialog`) with `dialogRef.current.showModal()` in an effect, and close with `.close()`; remove the `open` attribute. Handle the native `cancel` event (Escape) to call `onClose`.
- With native modal behavior, `useDialogFocusTrap` is likely unnecessary; remove it if so (keep initial focus on the first field).
- jsdom does not implement `showModal`; add a small polyfill/mock in `src/test/setup.ts` (`HTMLDialogElement.prototype.showModal/close`) so tests keep passing.
- Acceptance: at 800×450 and 1440×900 the dialog is above the sidebar, backdrop covers the whole page, Escape closes it, background is not clickable.

### F2 — SHOULD: dev-only vulnerabilities
`npm audit` (dev) reports critical `tinypool` and moderate `esbuild`/`@vitest/mocker` through Vitest 3. Upgrade `vitest` (and `@vitest/*`, jsdom if required) to the latest major across `apps/server` and `apps/web`. If the upgrade breaks tests and cannot be fixed within this task, revert it and report why.
- Acceptance: `npm audit` total critical = 0, all tests still pass.

### F3 — COULD: mobile header order
At < 768 px the top nav (Dashboard/Projects) renders above the brand bar. Put the brand bar first, nav second.

## Do not
- Do not change server/shared code or API.
- Do not commit.

## Report
Append `## Fix round 1` to `docs/tasks/TASK-002.report.md` (files changed, `npm audit` summary, typecheck/build/test counts). Then create empty `docs/tasks/TASK-002.fix-done`.
