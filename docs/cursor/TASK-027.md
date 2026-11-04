# TASK-027 — Cursor guide (LLM model advisor)

Read `docs/cursor/README.md` first, and `docs/ARCHITECTURE.md` §4. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
Picking a model per task (research, script, rerank, vision…) is hard for the user. Add a **model advisor**: one LLM call that sees the models actually available and proposes a route for every `LlmTaskId`, fitting the budget mode. The user can apply the proposal to the app routing, a profile, or a project. In AUTO, the automation (TASK-028) uses the profile's applied routes.

## Inputs (built in code)
- The **catalog** of usable models: every configured provider (`/api/llm/providers`), its model list, OmniRoute catalog (TASK-026), vision capability, known pricing, and whether it is a CLI subscription (no per-token cost) or a paid API.
- **Recent health:** per provider/model, from the usage table: success rate, average latency, structured-output parse failures over the last 7 days.
- The **task table** from `LLM_TASKS`: id, description, needs vision, needs long context, typical input/output tokens (from the budget estimator), and how much quality matters (add a `qualityWeight` 1–3 to each `LLM_TASKS` entry: script/scriptReview/factCheck/visionCheck = 3; sceneQueries/metadata = 2; music, alt queries = 1).
- The **budget mode** (ECO/BALANCED/QUALITY/MAX) and the language of the content.

## The call
- New `LlmTaskId` `modelAdvisor` (with an `LLM_TASKS` entry, a budget feature that is on in every mode, a mock answer). It runs on the app's default route.
- Output schema: `{ routes: { [taskId]: { provider, model, reason } }, notes: string }`. `reason` is one short Vietnamese sentence.
- **Validate in code:** every chosen provider/model must exist in the catalog; vision tasks must get a vision model; otherwise replace that entry with the current route and mark it "giữ nguyên (đề xuất không hợp lệ)". Never let the advisor pick the `mock` provider unless it is the only one.
- **Cache** the proposal by a hash of (catalog, budget mode, language, health buckets) for 24 h.

## Applying
- `POST /api/llm/advisor/propose` body `{ scope: "app" | "profile" | "project", id?, budgetMode? }` → the proposal plus a diff against the current routes.
- `POST /api/llm/advisor/apply` body `{ scope, id?, proposalId, taskIds? }` → writes the routes (app routing setting, `profiles.llm` from TASK-022, or `projects.settings.llm`).
- Profiles get a toggle **"Tự chọn model"** (`autoModel`, default true). When on, the automation re-runs the advisor at most once a day for that profile and applies it before creating a project.

## UI
In "Cài đặt LLM" and on the profile "Brief mặc định" tab: a **"Gợi ý model bằng AI"** button. Show a table: task, current route, proposed route, reason. Per-row checkboxes and an "Áp dụng" button.

## Tests (no network, mock LLM)
- Catalog/health building; validation replaces invalid and non-vision picks; mock excluded; cache hit.
- Apply to each scope; partial apply by taskIds.
- Web: the table renders and applies selected rows.

## Steps
1. Shared: task id, `qualityWeight`, schemas, budget feature.
2. Server: inputs, call, validation, cache, routes, tests.
3. Web + tests.
4. Done checklist. Write `docs/tasks/TASK-027.report.md` and `docs/tasks/TASK-027.done`.
