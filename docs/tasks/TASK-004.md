# TASK-004 — Multi-provider LLM Layer + Research & Script Stages + Script Editor

## GOAL
Replace the fake RESEARCH and SCRIPT executors with real ones backed by a **provider-agnostic LLM layer** (Anthropic, Google Gemini, and any OpenAI-compatible API: OpenAI, Ollama, OpenRouter, DeepSeek, Groq…), selectable per project. Add a Script editor in the Script tab, and a zero-token "write it yourself" path (hybrid mode).

## CONTEXT
- Read `docs/ARCHITECTURE.md` §4 (hybrid modes, cost tiers) and §7 (providers), and `docs/tasks/TASK-003.md` (executor contract).
- Engine is done: `apps/server/src/pipeline/*` (orchestrator, `StageExecutor`, `executorRegistry`, `markStaleFrom`), `jobs/*` (worker with timeout/retry, `StageError` retryable flag, `recordUsage`).
- Cost rule: exactly **one LLM call per stage** in the normal path (RESEARCH = 1 call, SCRIPT = 1 call), cached by input hash, usage recorded on the job. No vision, no web search in this task.
- Other stages keep the fake executor.

## FILES TO INSPECT
- `apps/server/src/pipeline/stageExecutor.ts`, `executorRegistry.ts`, `fakeExecutor.ts`, `orchestrator.ts`, `invalidation.ts`
- `apps/server/src/jobs/worker.ts`, `src/lib/config.ts`, `src/db/schema.ts`, `src/app.ts`
- `packages/shared/src/schemas/project.ts`, `src/enums.ts`, `src/pipeline.ts`
- `apps/web/src/features/projects/ProjectDetailPage.tsx`, `ProjectFormFields.tsx`, `src/hooks/usePipeline.ts`

## FILES TO CREATE/MODIFY (guide)
```
packages/shared/src/schemas/llm.ts            # LlmProviderInfo, LlmSelection
packages/shared/src/schemas/script.ts         # ResearchNotes, Script, ScriptSection, SaveScriptInput
packages/shared/src/schemas/project.ts        # settings.llm, stageExecutors.script
apps/server/src/providers/llm/types.ts        # LlmProvider interface, LlmRequest/Response, LlmError
apps/server/src/providers/llm/anthropic.ts
apps/server/src/providers/llm/gemini.ts
apps/server/src/providers/llm/openaiCompatible.ts   # used by openai, ollama, openrouter, deepseek, groq, custom
apps/server/src/providers/llm/mock.ts               # deterministic, for tests/dev without keys
apps/server/src/providers/llm/registry.ts           # builds available providers from env
apps/server/src/providers/llm/structured.ts         # generateStructured(): JSON + zod validate + 1 repair attempt
apps/server/src/providers/llm/cache.ts              # llm_cache table access
apps/server/src/providers/llm/pricing.ts            # optional cost estimate from env
apps/server/src/stages/research/researchExecutor.ts + prompt.ts
apps/server/src/stages/script/scriptExecutor.ts + prompt.ts
apps/server/src/services/scriptService.ts
apps/server/src/api/llm.ts                    # GET /api/llm/providers
apps/server/src/api/script.ts
apps/server/src/db/schema.ts + drizzle/0002_*.sql   # research_notes, scripts, llm_cache
apps/server/src/pipeline/orchestrator.ts      # completeByUser()
apps/server/test/llmProviders.test.ts, structured.test.ts, researchScript.test.ts, scriptApi.test.ts
apps/web/src/features/script/ScriptTab.tsx, ScriptEditor.tsx, ResearchPanel.tsx, *.test.tsx
apps/web/src/services/scriptApi.ts, llmApi.ts
apps/web/src/features/projects/ProjectFormFields.tsx   # LLM provider/model + script executor
.env.example, README.md, docs/ARCHITECTURE.md (§7 LLM row only)
```

## REQUIREMENTS

### 1. LLM provider layer
```ts
interface LlmProvider {
  id: string;                 // "anthropic" | "gemini" | "openai" | "ollama" | "openrouter" | "deepseek" | "groq" | "custom" | "mock"
  label: string;
  defaultModel: string | null;
  generate(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}
type LlmRequest = { model: string; system: string; messages: { role: "user" | "assistant"; content: string }[];
                    maxOutputTokens: number; temperature?: number; json: boolean };
type LlmResponse = { text: string; usage: { inputTokens: number; outputTokens: number }; model: string; provider: string };
class LlmError extends Error { code: "LLM_AUTH" | "LLM_RATE_LIMIT" | "LLM_UNAVAILABLE" | "LLM_TIMEOUT" | "LLM_BAD_REQUEST" | "LLM_INVALID_OUTPUT"; retryable: boolean; status?: number }
```
- Implement with plain `fetch` (no vendor SDKs) to keep dependencies minimal:
  - **anthropic**: Messages API (`POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`). JSON mode via instruction + prefill is NOT required; rely on prompt + validation.
  - **gemini**: `generateContent` REST endpoint; JSON via `responseMimeType: "application/json"` when `json: true`.
  - **openaiCompatible**: `POST {baseUrl}/chat/completions`, `response_format: {type:"json_object"}` when `json` and the provider supports it (configurable flag; Ollama/others may ignore it). One implementation, instantiated per configured vendor with its own base URL / key / default model.
  - **mock**: returns fixtures valid for the research/script schemas; usage numbers fixed.
- Error mapping: 401/403 → `LLM_AUTH` (non-retryable); 429 → `LLM_RATE_LIMIT` (retryable); 5xx/network → `LLM_UNAVAILABLE` (retryable); abort/timeout → `LLM_TIMEOUT` (retryable); 400 → `LLM_BAD_REQUEST` (non-retryable). Executors convert `LlmError` to `StageError` with the same code/retryable.
- Never log or return API keys or full prompts at info level (debug only, truncated).
- `registry` reads env and exposes only **configured** providers (key present, or base URL for Ollama/custom). `mock` is available only when `LLM_ENABLE_MOCK=true` (default true in development and tests, false in production).

### 2. Provider/model selection (flexible)
- Resolution order per stage: `project.settings.llm.<stage>` → `project.settings.llm.default` → env `LLM_<STAGE>_PROVIDER/_MODEL` → env `LLM_DEFAULT_PROVIDER/_MODEL` → the provider's `defaultModel`. If nothing resolves → non-retryable `LLM_NOT_CONFIGURED` with a message telling the user what to set.
- Shared schema: `settings.llm?: { default?: LlmSelection; research?: LlmSelection; script?: LlmSelection; sceneplan?: LlmSelection }`, `LlmSelection = { provider: string; model?: string }`. Keep it optional and backward compatible.
- `GET /api/llm/providers` → `[{ id, label, configured, defaultModel }]` (never keys).
- UI: in Create/Edit project "Advanced": "AI provider" select (configured providers) + optional model text input, applied as `settings.llm.default`; a hint shows when no provider is configured.

### 3. Structured generation helper
`generateStructured({ provider, model, system, prompt, schema (zod), maxOutputTokens, signal, cacheKeyExtra })`:
1. Build cache key = sha256(provider, model, system, prompt, schema name/version, cacheKeyExtra). If `LLM_CACHE_ENABLED` and hit → return cached parsed value with `cached: true` and zero usage.
2. Call provider with `json: true`. Extract the JSON object (strip code fences / leading text).
3. Validate with zod. On failure do **one** repair call that sends the validation issues and asks for corrected JSON only. Second failure → `LLM_INVALID_OUTPUT` (non-retryable, include a short preview of the bad output in logs, not in the API).
4. Return `{ value, usage, provider, model, cached }`. The executor calls `ctx.recordUsage({ llmCalls, inputTokens, outputTokens, costUsd })`.
- `llm_cache` table: `key` PK, `provider`, `model`, `response_text`, `created_at`. No TTL in MVP.
- `pricing.ts`: optional env `LLM_PRICES_JSON` = `{"<provider>:<model>": {"inputPerMTok": n, "outputPerMTok": n}}`; cost = 0 when unknown. Do not hard-code prices.

### 4. Research stage (1 call)
Input: project topic, description, language, targetDurationSec.
Output schema `ResearchNotes`:
```
{ summary: string,
  keyFacts: { fact: string, confidence: "high"|"medium"|"low", sourceHint: string|null }[],   // 5–20
  timeline: { date: string, event: string }[],
  angles: string[],          // storytelling angles / hooks
  outline: { section: string, purpose: string, points: string[] }[],   // 3–10
  cautions: string[] }       // claims to double-check, sensitive points
```
- Prompt must state that facts are from model knowledge, not verified, and must mark uncertainty; no invented URLs (`sourceHint` is a free-text hint like "Wikipedia: Deep Blue" or null).
- Stored in `research_notes` (one row per project; `input_hash`, `provider`, `model`, `created_at`, JSON `data`). Re-run replaces it.

### 5. Script stage (1 call)
Input: project fields + latest `ResearchNotes` (if present; if RESEARCH was SKIPPED, use topic only).
Output schema `Script`:
```
{ title: string, hook: string,
  sections: { id: string, heading: string, narration: string, visualIdeas: string[], estDurationSec: number }[],
  outro: string }
```
- Narration in `settings.language`, spoken style (storytelling/documentary), total estimated duration within ±20% of `targetDurationSec`. Compute `estDurationSec` server-side too from word count with `SPEECH_WORDS_PER_MINUTE` (default 150) and store both; the UI shows the computed value.
- Stored in `scripts` (one current row per project): `data` JSON, `origin` (`AGENT`|`USER`), `input_hash`, `version` (int, +1 on each save/regenerate), `provider`, `model`, `updated_at`.

### 6. Hybrid / zero-token path
- `settings.stageExecutors.script: "AGENT" | "USER"` (add `script` key to the shared schema).
- When `script` executor is `USER`: `runAll` must not call the LLM for RESEARCH/SCRIPT. Implement this in the orchestrator (not in the executors):
  - `orchestrator.completeByUser(projectId, stage, options?)`: marks the stage `DONE` (message "Provided by user"), marks earlier non-DONE stages listed in `options.skip` as `SKIPPED`, calls `markStaleFrom(stage)`, recalculates status. Allowed only when no job is active.
  - When `runAll` reaches RESEARCH or SCRIPT and the project's script executor is `USER` and no user script exists yet, set that stage to `WAITING_USER` with message "Write or paste your script in the Script tab" and stop (status `REVIEW`). Saving a user script (below) completes it and, if `runMode=ALL`, continues the pipeline.
- `PUT /api/projects/:id/script` (SaveScriptInput = Script without ids required) saves a user-edited or user-written script:
  - validates with zod; stores `origin=USER` if the previous origin was USER or none, else keeps `AGENT` but marks `edited: true`;
  - if content hash changed: `version+1`, `markStaleFrom(SCRIPT)` (scene plan etc. become STALE); if SCRIPT was not DONE, call `completeByUser(SCRIPT, { skip: ["RESEARCH"] })`.
  - 409 when a job is active.
- `GET /api/projects/:id/script` → `{ script|null, research|null, origin, version, stale: boolean }`.

### 7. Script tab UI
- Research panel (collapsible): summary, key facts with confidence badges, timeline, cautions. Read-only. Show provider/model and "cached" badge if applicable.
- Script editor: title, hook, sections (heading, narration textarea, visual ideas as tags, computed duration), outro; add/remove/reorder sections (up/down buttons are enough). Total word count and estimated duration vs target.
- Buttons: **Save** (PUT), **Generate script** / **Regenerate script** (runs SCRIPT via pipeline `runStage`; disabled when earlier stages not DONE, with reason), **Generate research** (runs RESEARCH). Unsaved-changes warning when leaving the tab.
- Empty state: two choices — "Let the AI write it" (Generate All / run RESEARCH) and "Write my own script" (opens empty editor; saving completes the stage with zero tokens).
- Live updates: when the pipeline finishes RESEARCH/SCRIPT (SSE stage.updated DONE), refetch script data.
- Show job usage (tokens, cost if known) for the last RESEARCH/SCRIPT job in the panel footer.

### 8. Config (`.env.example`, documented in README)
```
LLM_DEFAULT_PROVIDER=          # anthropic | gemini | openai | ollama | openrouter | deepseek | groq | custom | mock
LLM_DEFAULT_MODEL=
LLM_RESEARCH_PROVIDER= / LLM_RESEARCH_MODEL= / LLM_SCRIPT_PROVIDER= / LLM_SCRIPT_MODEL=   (optional)
ANTHROPIC_API_KEY=     ANTHROPIC_MODEL=claude-haiku-5-5
GEMINI_API_KEY=        GEMINI_MODEL=
OPENAI_API_KEY=        OPENAI_BASE_URL=https://api.openai.com/v1   OPENAI_MODEL=
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1   OLLAMA_MODEL=
OPENROUTER_API_KEY=    OPENROUTER_MODEL=        (base https://openrouter.ai/api/v1)
DEEPSEEK_API_KEY=      DEEPSEEK_MODEL=          (base https://api.deepseek.com/v1)
GROQ_API_KEY=          GROQ_MODEL=              (base https://api.groq.com/openai/v1)
CUSTOM_LLM_BASE_URL=   CUSTOM_LLM_API_KEY=   CUSTOM_LLM_MODEL=
LLM_TIMEOUT_MS=120000  LLM_CACHE_ENABLED=true  LLM_ENABLE_MOCK=true  LLM_PRICES_JSON=
SPEECH_WORDS_PER_MINUTE=150
```
Do not guess model ids for providers other than Anthropic; leave them empty and require the user to set them (the UI/model field and error message explain this).

## IMPLEMENTATION NOTES
- Keep prompts in `prompt.ts` files as pure functions (easy to test and tweak). Include the target language and duration; ask for JSON only, matching the schema description.
- Pass `ctx.signal` to `fetch`. Use `LLM_TIMEOUT_MS` per call (smaller than `STAGE_TIMEOUT_MS`).
- Report progress: 10% building prompt, 20% calling model, 80% validating, 100% saved.
- Executors must be idempotent: re-running replaces the stored output.
- Tests must never hit the network: mock `fetch` for adapter tests; use `mock` provider for stage tests.

## DO NOT
- Do not add vendor SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`) — plain fetch only.
- Do not implement scene planning, image search, TTS or anything beyond RESEARCH/SCRIPT.
- Do not store API keys in the DB or send them to the frontend.
- Do not change existing API shapes except the additive settings fields.
- Do not upgrade unrelated dependencies; do not upgrade drizzle.
- Do not commit.

## ACCEPTANCE CRITERIA
1. Root typecheck/build/test pass; all previous 55 tests still pass.
2. With `LLM_DEFAULT_PROVIDER=mock`: Generate All runs real RESEARCH and SCRIPT executors (mock content visible in the Script tab), then continues with fake stages to VISUAL_REVIEW.
3. With a real key configured (e.g. Anthropic or OpenAI-compatible), RESEARCH + SCRIPT produce Vietnamese content for a Vietnamese topic, each stage making 1 LLM call; usage tokens appear in the UI. Running Generate All again on an unchanged project uses the cache (0 tokens).
4. Switching provider per project in Edit → Advanced takes effect on the next run.
5. Missing key → stage FAILED with `LLM_NOT_CONFIGURED`/`LLM_AUTH` and a clear message; no retry loop on auth errors.
6. Script executor = USER: Generate All stops at RESEARCH/SCRIPT with "Write or paste your script"; saving a script completes it (RESEARCH SKIPPED) and the pipeline continues; 0 LLM calls recorded.
7. Editing and saving the script after SCENE_PLAN is DONE marks SCENE_PLAN and later stages STALE.

## TESTS
Server: each adapter maps request/response and errors correctly (mocked fetch: 200, 401, 429, 500, timeout, malformed JSON); `generateStructured` (code-fence stripping, repair success, repair failure, cache hit = 0 usage); provider/model resolution order; RESEARCH/SCRIPT executors with mock provider store data and record usage; USER mode flow (`completeByUser`, skip, continue in ALL); PUT script → version bump, STALE propagation, 409 when job active; `/api/llm/providers` hides keys and unconfigured providers.
Web: ScriptTab empty state choices; editor add/remove/reorder + save payload; duration calculation; regenerate button disabled reason; research panel renders confidence badges.

## EXPECTED RESULT
The first real AI stages are live and cost-aware: any supported LLM can write research + script in one call each, results are cached and editable, and users can skip the AI entirely by writing their own script.

## DEPENDENCIES
TASK-003 (done).

## REPORT BACK
Write `docs/tasks/TASK-004.report.md` (files, migration name, command results with test counts, deviations, remaining issues, and which real provider — if any — you were able to test). Then create empty `docs/tasks/TASK-004.done`.
