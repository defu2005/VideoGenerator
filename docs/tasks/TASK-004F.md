# TASK-004F — Per-task LLM routing (model per task) + richer budget modes

## GOAL
1. Let the user choose a **provider + model for every LLM task** separately (e.g. a strong model for writing the script, a cheap/fast one for image query help). Settings exist app-wide, and each project can override them.
2. **Raise the default LLM usage.** The product owner finds the current defaults too frugal ("dự án đang bị tiết kiệm token quá"). BALANCED becomes a quality-first default. ECO stays the frugal option.

## CONTEXT
- Read `docs/ARCHITECTURE.md` §4 (budget modes, LLM rules) and §7 (providers).
- Today `project.settings.llm` has `default | research | script | sceneplan` (`packages/shared/src/schemas/project.ts`). `LlmProviderRegistry.resolve(stageSel, defaultSel, "research"|"script"|"sceneplan")` (`apps/server/src/providers/llm/registry.ts`) is the only router.
  - Script review reuses `script`.
  - Scene query assist, visual alt queries and visual rerank all reuse `sceneplan`.
- Env: `LLM_DEFAULT_PROVIDER/MODEL`, `LLM_RESEARCH_*`, `LLM_SCRIPT_*`.
- Usage is recorded per job with a single `provider` (`JobUsageSchema`). With per-task routing, one stage can call several providers.
- Budget presets: `packages/shared/src/budget/modes.ts`. Estimates: `estimateBudget`, shown in the pipeline panel.
- Providers: anthropic, gemini, openai-compatible (openai, ollama, openrouter, deepseek, groq, custom), claude-cli, copilot-cli, mock. All support a `model` string.
- **Ordering:** this task starts after the TASK-006 fix round is committed. It touches `visualService.ts` call sites.

## FILES TO INSPECT
- `packages/shared/src/schemas/{llm,project,job}.ts`, `src/budget/modes.ts`
- `apps/server/src/providers/llm/{registry,structured}.ts`, `src/api/llm.ts`, `src/lib/config.ts`
- `apps/server/src/stages/{research,script,scenes}/*`, `src/services/visualService.ts`
- `apps/web/src/features/projects/{ProjectFormFields,EditProjectDialog,CreateProjectDialog}.tsx`, `src/features/pipeline/PipelinePanel.tsx`, `src/App.tsx` (routes/nav)

## REQUIREMENTS

### 1. LLM task catalog (shared)
`LLM_TASKS` with id, label (vi), stage, and purpose:

| id | Label | Stage | Notes |
|---|---|---|---|
| `research` | Nghiên cứu | RESEARCH | also used for the merged research+script call |
| `script` | Viết kịch bản | SCRIPT | |
| `scriptReview` | Biên tập kịch bản | SCRIPT | |
| `sceneQueries` | Từ khóa hình ảnh theo scene | SCENE_PLAN | |
| `visualAltQueries` | Gợi ý từ khóa khi thiếu ảnh | VISUAL_SEARCH | |
| `visualRerank` | Xếp hạng ảnh theo ngữ nghĩa | VISUAL_SEARCH | |
| `visionCheck` | Kiểm tra ảnh bằng vision | VISUAL_REVIEW | catalog entry only; used by a later task |
| `musicAssist` | Chọn mood nhạc | MUSIC_SEARCH | catalog entry only |
| `metadata` | Tiêu đề, mô tả, hashtag | FINAL | catalog entry only; implemented in TASK-012 |

Each task also has a recommended tier: `"strong"` for research, script and scriptReview, `"fast"` for the rest. The UI uses it for hints only.

### 2. Settings shape (backward compatible, no DB change for projects)
- **`LlmRoute`**:
  ```
  { provider: string, model?: string, maxOutputTokens?: int (256–32000), fallback?: { provider, model? } }
  ```
- **`project.settings.llm`**:
  ```
  { default?: LlmRoute, tasks?: Partial<Record<LlmTaskId, LlmRoute>> }
  ```
- **Legacy keys** are mapped with a zod preprocess (read and write the new shape):
  - `research` → `tasks.research`
  - `script` → `tasks.script` + `tasks.scriptReview`
  - `sceneplan` → `tasks.sceneQueries` + `tasks.visualAltQueries` + `tasks.visualRerank`
  - Existing projects keep working. Test it with a stored legacy JSON.
- **App-wide settings:** new table `app_settings (key TEXT PK, value JSON, updated_at)`, key `llmRouting` with the same `{ default, tasks }` shape. **Generate the migration with drizzle-kit only.**
- **Env per task (optional):** `LLM_<TASK>_PROVIDER/MODEL`, with TASK in upper snake case, e.g. `LLM_SCRIPT_REVIEW_PROVIDER`. Existing env names keep working.

### 3. Resolution (server, one function)
`resolveLlmRoute(task, project)` resolves in this order:
1. project `tasks[task]`
2. project `default`
3. app `tasks[task]`
4. app `default`
5. env task vars
6. env `LLM_DEFAULT_*`

It returns `{ provider, model, maxOutputTokens?, fallback?, source: "project-task"|"project-default"|"app-task"|"app-default"|"env" }`.

**Fallback:** if the primary route fails with `LLM_NOT_CONFIGURED`, `LLM_LIMIT_TOO_SMALL`, a provider 5xx or a timeout (after its own retries), call the fallback route **once**. Record both attempts in usage. Never fall back on validation errors.

Replace every `registry.resolve(...)` call site with the task-specific route:
- research and the merged story call → `research`
- the script call → `script`
- the review call → `scriptReview`
- scene query assist → `sceneQueries`
- visual alt queries → `visualAltQueries`
- rerank → `visualRerank`

The LLM cache key must include provider + model, so switching the model is a cache miss.

### 4. Usage per call
- Extend `JobUsage` with `calls: [{ task, provider, model, inputTokens, outputTokens, premiumRequests?, cached, fallback: boolean, ok: boolean }]`.
- Keep the top-level totals. Keep the legacy `provider` field set to the first call's provider.
- The monthly per-provider counter (`/api/llm/providers`) sums over `calls`.

### 5. Richer budget modes (update `modes.ts`, ARCHITECTURE §4, estimates)

| Feature | ECO | BALANCED (default) | QUALITY |
|---|---|---|---|
| storyMode | merged | separate | separate |
| research depth (`keyFacts` target / max) | 6 / 8 | 10 / 12 | 14 / 16 (raise schema max to 16) |
| repairAttempts | 0 | 1 | 2 |
| scriptReview | off | **on** (1 pass) | on (2 passes: review → polish) |
| sceneQueryAssist | off | **on** | on |
| altQueryAssist | off | on | on |
| semanticImageRerank | off | **on** | on |
| musicAssist | off | **on** | on |
| metadata (feature flag, used in TASK-012) | off | on | on |
| visionCheck | off | off (opt-in) | off (opt-in, cost shown) |
| output token headroom | 1.0× | 1.5× | 2.0× (applied to the duration-based `maxOutputTokens`, capped by the provider limit) |

- Calls per video, Generate All:
  - ECO 1
  - BALANCED ≈ 5 (max ≈ 9 with repairs and alt queries)
  - QUALITY ≈ 7 (max ≈ 14)
- Add the feature flags `researchDepth` ("light"|"standard"|"deep"), `scriptReviewPasses` (0|1|2), `metadata`, `outputHeadroom` (1|1.5|2) to `BudgetFeatures`. CUSTOM can toggle each one.
- Prompts use `researchDepth` to ask for the target number of facts. The schema minimums stay valid for ECO.
- `estimateBudget` covers RESEARCH, SCRIPT, SCENE_PLAN and VISUAL_SEARCH (and lists future stages as "later").
- Estimates show **per task: provider/model** from the resolved route and min/max calls. Tokens are shown when known.
- Existing projects that saved `mode: "BALANCED"` simply get the new BALANCED behaviour. Document this in the report.

### 6. API
| Method | Path | Behavior |
|---|---|---|
| GET | `/api/llm/tasks` | catalog (id, label, stage, tier, which budget feature enables it) |
| GET | `/api/settings/llm-routing` | app routing |
| PUT | `/api/settings/llm-routing` | validate: provider must exist; unknown model strings are allowed; 400 on bad shape |
| GET | `/api/llm/providers/:id/models` | model suggestions (see below) |
| GET | `/api/projects/:id/llm-routes` | the resolved route + source for every task (for the UI) |

**Model suggestions:**
- static per-provider list in shared (e.g. anthropic: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`), plus the env default model
- `ollama` / `openai` / `openrouter` / `custom`: also fetch `GET <baseUrl>/models` (5 s timeout, cached 10 min, failures ignored)
- `copilot-cli` / `claude-cli`: static list + free text

### 7. Web UI
- **New page `Cài đặt → Mô hình AI` (`/settings/ai`).** A table with one row per task:
  - task label + stage + tier hint
  - provider select (configured providers enabled; unconfigured ones disabled with a hint)
  - model combobox (suggestions + free text)
  - optional max output tokens
  - optional fallback provider/model
  - "Dùng mặc định" reset
- **Presets on the page:**
  - "Một model cho tất cả" (fills `default` only)
  - "Mạnh cho viết, nhanh cho việc phụ" (strong tier tasks → chosen strong model, fast tier → chosen fast model)
  - Save with PUT.
- **Project edit dialog → section "Mô hình AI":** override per task, collapsed by default. It shows the effective route with its source badge ("Dự án", "Mặc định app", "ENV").
- **Pipeline panel estimate:** per task, "provider · model · N lượt".

### 8. MCP
- `get_llm_routes(projectId)`, read-only.

## LLM calls
This task adds no LLM calls by itself. It changes the presets as in §5. Model listing uses plain HTTP and never calls an LLM.

## DO NOT
- Do not hand-write migrations.
- Do not add dependencies.
- Do not remove legacy settings keys from stored data on read. Map them instead.
- Do not make vision on by default.
- Do not run real `copilot` / `claude` prompts in tests. Tests must not hit the network.
- Do not commit.

## ACCEPTANCE CRITERIA
1. Root typecheck, build and test pass. drizzle-kit reports no changes after the migration. audit = 0.
2. A legacy project (`llm: { default, research, script, sceneplan }`) runs exactly as before (test + live).
3. Live, mock provider with two different mock models per task:
   - every LLM call records the routed task/provider/model in `usage.calls`
   - switching one task's model invalidates only that task's cache
4. Fallback: primary `copilot-cli` disabled → fallback `mock` used once, recorded with `fallback: true`, stage DONE.
5. Budget estimates match §5:
   - BALANCED Generate All on the mock makes the predicted number of calls (report the exact count per stage)
   - ECO stays at 1
6. The `/settings/ai` page works: save, reload, presets. The project override shows the correct source badges.

## TESTS
- Shared: legacy mapping, route schema, presets per mode, estimate per task.
- Server: resolution order (all 6 sources), fallback rules (which errors trigger it), cache key includes the model, usage.calls aggregation and the monthly counter, settings API validation, models endpoint (mocked fetch, timeout, cache).
- Web: AI settings page (rows, presets, save payload), project override + source badges, estimate rendering.
- MCP: `get_llm_routes`.

## DEPENDENCIES
TASK-006 fix round (committed).

## REPORT BACK
Write `docs/tasks/TASK-004F.report.md` with:
- files changed, migration name
- per-stage call counts on the mock for ECO / BALANCED / QUALITY
- fallback demo, deviations, remaining issues

Then create empty `docs/tasks/TASK-004F.done`.
