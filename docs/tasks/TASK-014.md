# TASK-014 — Model picker in the new-project Advanced settings

## Goal
When creating (and editing) a project, Advanced settings should let the user **pick a model
from the provider's full list**, the same way Settings → Mô hình AI does, instead of typing
a model name blind. Per-task model routes should also be choosable at creation time.

## Current state
- `apps/web/src/features/projects/ProjectFormFields.tsx`
  - "AI provider" is a `<select>`; "Model (optional)" is a plain text `<input>` (`draft.llmModel`).
  - The per-task section "Mô hình AI theo tác vụ" only renders when `projectId && onLlmTasksChange`
    (edit dialog only). Its per-task model is also a plain text input.
- `apps/web/src/features/settings/AiSettingsPage.tsx` has a private `ModelField`
  component: a `<select>` with every model from `getProviderModels(provider)`
  (react-query key `["llm-models", provider]`) plus a text box for any other name.
- `CreateProjectDialog.tsx` renders `<ProjectFormFields advancedOnly … />` and builds
  `settings` itself; `settingsFromDraft` maps `llmProvider`/`llmModel` to `settings.llm.default`.
- Shared schema already allows `settings.llm = { default?, tasks? }` on create
  (`packages/shared/src/schemas/llm.ts`). No server change should be needed — verify.

## Changes
1. **Extract `ModelField`** from `AiSettingsPage.tsx` into a shared component, e.g.
   `apps/web/src/features/llm/ModelField.tsx` (export it; keep the exact behaviour, labels
   and aria-labels so existing `AiSettingsPage` tests keep passing). Use it in `AiSettingsPage`.
2. **Project default model**: in `ProjectFormFields`, replace the "Model (optional)" text
   input with `ModelField` bound to `draft.llmProvider` / `draft.llmModel`. Label stays
   "Model (optional)". It is disabled until a provider is chosen (as ModelField already does);
   show a hint "Chọn nhà cung cấp trước để xem danh sách model" when no provider is selected.
   When the provider changes, clear `llmModel` if it is not in the new provider's list
   (keep it if the list hasn't loaded yet — don't lose user input on a slow fetch).
3. **Per-task routes at creation**: render the "Mô hình AI theo tác vụ" section whenever
   `onLlmTasksChange` is given (drop the `projectId` requirement). Without a `projectId`,
   skip the resolved-routes query and the "source · provider / model" line. Replace the
   per-task model `<input>` with `ModelField` (provider = that task's route provider;
   keep the existing aria-label `${task.label} — model của dự án` on the text box).
4. **CreateProjectDialog**: hold `llmTasks` state (like `EditProjectDialog`), pass
   `llmTasks` / `onLlmTasksChange` to `ProjectFormFields`, and on submit include
   `settings.llm.tasks` when non-empty — merged with `settings.llm.default` if a project
   provider was chosen; send `settings.llm = { tasks }` alone if only tasks are set.

## Tests (Vitest + Testing Library, mock `getProviderModels`/`getLlmProviders`)
- `ProjectFormFields.test.tsx`: picking a provider shows its models in the model select;
  choosing one sets `llmModel`; typing a custom name still works; model select is disabled
  with no provider.
- Create dialog test (existing file or new): choosing a per-task provider + model is sent in
  the create request as `settings.llm.tasks.<task>`; with nothing chosen, no `llm` key is sent.
- Existing `AiSettingsPage.test.tsx` and `EditProjectDialog` tests must still pass unchanged
  (adjust only if an aria-label genuinely had to move, and say so in the report).

## Rules
- No new dependencies, no migrations, no `git commit`/`push`.
- Do not run real copilot/claude/agy CLIs. UI text in Vietnamese where the surrounding UI is.
- Run `npm run typecheck`, `npm test`, `npm run build` — all must pass.

## Done
Write `docs/tasks/TASK-014.report.md` (files changed, test results, anything left) and create
an empty `docs/tasks/TASK-014.done`.
