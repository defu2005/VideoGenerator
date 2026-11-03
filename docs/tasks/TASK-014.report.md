# TASK-014 Implementation Report

## 1. Files changed

- `apps/web/src/features/llm/ModelField.tsx` — extracted the shared provider/model picker from the AI settings page.
- `apps/web/src/features/settings/AiSettingsPage.tsx` — switched to the shared `ModelField` without changing the existing labels or aria-labels.
- `apps/web/src/features/projects/ProjectFormFields.tsx` — replaced the plain model input with the shared model picker, added the no-provider hint, and made the per-task route section available whenever `onLlmTasksChange` is supplied.
- `apps/web/src/features/projects/CreateProjectDialog.tsx` — added the `llmTasks` state and merged `settings.llm.default` and `settings.llm.tasks` into the create payload when applicable.
- `apps/web/src/features/projects/ProjectFormFields.test.tsx` — added coverage for the default model picker behavior.
- `apps/web/src/features/projects/ProjectListPage.test.tsx` — added coverage for create payloads with task-level LLM routes and the empty-llm case.

No aria-labels were intentionally changed for the existing `AiSettingsPage` tests; the labels remain compatible with the current selectors.

## 2. Command results

- `npm run typecheck` — succeeded.
- `npm test` — succeeded.
- `npm run build` — succeeded.

## 3. Notes

- Project create payloads now send `settings.llm.default` when a project provider is selected.
- Project create payloads send `settings.llm.tasks` when task-level overrides are chosen.
- No DB migrations, dependency changes, or commit/push operations were performed.

## 4. Remaining issues / TODOs

- None from this task.
