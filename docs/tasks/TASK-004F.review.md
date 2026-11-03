# TASK-004F Review (by Architect)

Verdict: **Fixes required.**

**What passed:**
- Checks: typecheck, build, 312/312 tests, migration `0007` generated with drizzle-kit (no drift), prod audit 0, no new deps.
- Live (mock), call counts:
  - ECO = 1 (research)
  - BALANCED = 5 (research, script, scriptReview, sceneQueries, visualRerank)
  - QUALITY = scriptReview ×2
- Legacy settings (`research/script/sceneplan`) map correctly to `tasks.*` and run (`mock/legacy-research`).
- Per-task models are recorded in `usage.calls` (`mock/strong-1`, `mock/fast-1`).
- `/llm-routes` shows the source of each route.

## Live findings
1. **Fallback did not trigger.**
   - Setup: route `scriptReview = copilot-cli / model "x"`, fallback `mock / fb-1`.
   - Copilot CLI ran for real (1 premium request) and failed with `LLM_UNAVAILABLE`.
   - The fallback was never called. SCRIPT ended "AI review skipped (LLM_UNAVAILABLE)".
   - Cause: the fallback only covers a short list of codes.
2. **The mock provider cannot answer `visual-rerank`** (and very likely `visual-alt-queries`).
   - It returns research-shaped JSON, and validation fails: `Unrecognized keys: "summary", "keyFacts", …`.
   - As a result, every BALANCED/QUALITY mock run has a failed rerank.
3. **Misleading hint.** The rerank failure in a BALANCED project says "Switch to BALANCED to allow one repair attempt".
4. **Cache hits are invisible.** A cached sceneQueries call (QUALITY, same mock script) left `calls: []`, so the user cannot see that the task ran from cache.
5. **Provider list and model suggestions are incomplete.**
   - `/api/llm/providers` and the selects only list `ollama, copilot-cli, mock`. The spec requires every provider: unconfigured ones shown disabled with a hint.
   - Model suggestions:
     - `anthropic: []`, `claude-cli: []`. The spec required `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.
     - `copilot-cli: ["auto", "claude-sonnet-4.5", "gpt-5"]`. `auto` is known broken here ("Auto routing is unavailable"); the model actually used is `gpt-6-luna`.
6. **AI settings page is in English and poorly laid out.**
   - The page is English while the app is Vietnamese.
   - There is horizontal overflow at ~540 px.
   - The task column is cramped ("Nghiên cứuRESEARCH · strong" runs together).
   - Tables and selects use unstyled browser defaults.

## Required fixes (TASK-004F-FIX)

### F1 — MUST: fallback on any provider-side failure
- Fall back for **every** `LlmError` **except** structured-output validation failures (`LLM_INVALID_OUTPUT` after repairs) and aborts/cancellation.
- That includes `LLM_NOT_CONFIGURED`, `LLM_LIMIT_TOO_SMALL`, `LLM_UNAVAILABLE`, `LLM_RATE_LIMITED`, timeouts and 5xx.
- Copilot CLI invalid-model output → `LLM_NOT_CONFIGURED` with the hint "Model không hợp lệ cho Copilot CLI". Add a test with that output.
- Test: primary fails with each code → the fallback is called once and recorded `fallback: true`; validation failure → no fallback.

### F2 — MUST: mock answers every task schema
- The mock dispatches on `schemaName`: research, merged story, script, review, SceneQueryAssist, visual-alt-queries, visual-rerank.
- It returns valid, deterministic output **derived from the prompt input**: rerank orders exactly the given candidate indexes; alt queries return one entry per requested sceneId.
- The mock output should also vary with the topic, so different projects do not hit the same cache entry.
- Test: BALANCED and QUALITY Generate All on the mock → every `usage.calls[].ok === true`.

### F3 — MUST: context-aware error hints
Hints are computed from the effective features of the task:
- No "Switch to BALANCED" when the project is already BALANCED or higher.
- No such hint at all for tasks that use `repairAttempts: 0` by design (alt queries, rerank, scene queries). For those, say "Bỏ qua bước AI, giữ kết quả bằng code".

### F4 — SHOULD: record cache hits
- Cached responses add a `usage.calls` entry: `cached: true`, tokens 0, `ok: true`.
- The monthly provider counter excludes cached entries.
- UI estimate/usage shows "từ cache".

### F5 — MUST: full provider list and useful model suggestions
- **`/api/llm/providers`** returns **all** provider ids from `LlmProviderIdSchema`, each with `configured` + `hint`. Selects show unconfigured providers disabled, with the hint as a tooltip or help text.
- **Suggestions** = configured default model + **models that previously succeeded for that provider** (distinct `usage.calls` with `ok: true`, most recent first) + static list + free text. Static lists:
  - anthropic + claude-cli: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`
  - copilot-cli: no `auto`; keep the observed working `gpt-6-luna` as an example
  - gemini (API): `gemini-2.5-pro`, `gemini-2.5-flash`
  - openai-compatible: fetched `/models` as already implemented
- Mark static lists "có thể đã cũ — gõ tên model gói của bạn hỗ trợ".

### F6 — MUST: AI settings page in Vietnamese, responsive, styled like the rest of the app
- **Vietnamese labels.** Title "Mô hình AI", nav item "Mô hình AI", presets "Một model cho tất cả" / "Mạnh cho viết, nhanh cho việc phụ", column/field names, "Dùng mặc định", source badges "Dự án" / "Mặc định app" / "ENV".
- **Layout:**
  - ≥ 1024 px: a table with fixed column widths (task 28%, provider, model, max output, fallback, reset).
  - < 1024 px: one card per task (label, stage chip, tier chip on their own line; fields stacked).
  - **No horizontal page scroll at 375, 768 and 1280 px.**
- Reuse the existing form/select/button styles (`index.css` / components used by the project dialogs). No unstyled defaults.
- The project edit dialog section "Mô hình AI" follows the same rules.
- Web tests for both layouts (class/structure) and the Vietnamese labels.

### F7 — MUST: live check in the report
- Mock, BALANCED and QUALITY Generate All up to VISUAL_REVIEW: a table of `usage.calls` per stage/task (provider/model/ok/cached/fallback). All `ok`.
- Fallback demo with a mock primary forced to fail (no real CLI).
- Screenshots or DOM-width evidence for the settings page at 375 / 1280 px.

## Do not
- Do not touch migrations `0000`–`0007`. Generate a new one with drizzle-kit only if needed.
- Do not add dependencies. Do not run real `copilot` / `claude` prompts. Do not commit.

## Report
Append `## Fix round 1` to `docs/tasks/TASK-004F.report.md`, then create empty `docs/tasks/TASK-004F.fix-done`.

## Continuation note (architect, 2026-11-03) — previous fix session hit the Copilot monthly quota
- The previous session stopped with `402 quota_exceeded` after ~85 tool runs. Its partial edits are in the working tree (e.g. `structured.ts` +150 lines, `schemas/llm.ts` +78, `mock.ts`). Typecheck passes and 312/312 tests pass on this partial state.
- **Do not discard or rewrite this work.** Inspect the current diff, decide per item which of F1–F7 are done, complete the rest, and add the tests listed for each item.
- List per item in the report: done before the interruption / completed now.

## Fix round 1 — verified (architect, 2026-11-03)
**Accepted.** Completed by the architect (Copilot quota exhausted; Antigravity CLI headless runs stopped at the first denied shell command). Evidence in `TASK-004F.report.md` › Fix round 1.
