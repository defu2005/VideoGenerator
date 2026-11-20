# TASK-074b-3b report: shadow gate, behaviour-eval route, shadow routes, UI

Status: **implemented, not reviewed.** No `.done` file was written (per the 2026-11-18 decisions log and the 2026-11-20 advisor ruling, 074b-2 → 3b → 4 are coded directly in the working tree). Codex review is still needed.

## What changed

### Server (`apps/server`)
- `src/operator/skillBehaviourEval.ts`
  - `baselineFor(db, name)`: active DB row, else builtin skill (`version: null`), else `null`.
  - `shadowGateRefusal({baseline, result})`: refuses with `SKILL_NO_BASELINE`, `SKILL_BEHAVIOUR_NOT_RUN`, or `SKILL_BEHAVIOUR_NOT_PASSED` (not passed, judge not `ok`, baseline kind changed, or active version changed since the eval).
  - `readBehaviourEval(db, name, version)`: reads the stored result from `app_settings`.
- `src/operator/shadow.ts`
  - `shadowProgress(db, name, version, now)`: counts `COUNT(DISTINCT COALESCE(run_id, id))` in the 7-day window from the first row. Returns `dang_thu` (still in window, below N), `du_mau` (N reached, inclusive at +7 days), or `chua_du_mau` (window closed, below N).
  - `SHADOW_MIN_RUNS = 5`, `SHADOW_WINDOW_MS = 7 days`. Constants, not settings (see deviations).
  - `recordShadowRuns` unchanged. The module still imports nothing from the runtime (allowlist test in `operatorShadow.test.ts`).
- `src/operator/skillVersions.ts`: `markShadowVersion` sends a displaced shadow back to `draft`. `clearShadowVersion` returns the change count.
- `src/operator/service.ts`
  - `runSkillBehaviourEval(name, version)`: 404 check, LLM from `registryBehaviourLlm` (503 `BEHAVIOUR_LLM_UNAVAILABLE` if the provider is unconfigured), then `runBehaviourEval`. The budget is consumed before any model call (429 `SELF_IMPROVEMENT_BUDGET_LIMIT`).
  - `setShadowSkill(name, version)`: 404, then the gate (409 with the gate code), then `markShadowVersion`.
  - `clearShadowSkill(name)`.
  - `skillVersions()`: every item gets `behaviour` (or `null`). Shadow items also get `shadow` (progress, `shadowTools`, `baselineTools`).
  - `findSkills(query, runId = null)`: logs routing (no run id), then `recordShadow(query, routed, runId)`. Shadow rows are written only when `operator.shadowEnabled` is on.
  - `overview()` returns `settings` (including `shadowEnabled`), which the Tự cải tiến switch reads.
- `src/operator/hooks.ts`: `findSkills(query, runId?)`.
- `src/assistant/tools.ts`: `find_skills` passes `ctx.runId ?? null`. For operator calls, `runId` is set at `operator/modelRuntime.ts:78`.
- `src/api/operator.ts`: three routes
  - `POST /api/operator/skills/:name/versions/:version/behaviour-eval`
  - `POST /api/operator/skills/:name/versions/:version/shadow`
  - `DELETE /api/operator/skills/:name/shadow`
  Params are validated with zod, using the same regex as the activate route.
- `src/auth/routePermissions.ts`: the three rows, all `operator.use`, placed before the `ANY /api/operator/*` catch-all.
- `src/auth/toolActions.ts`: unchanged (no new tool names).

### Web (`apps/web`)
- `src/features/operator/SkillVersions.tsx`
  - Types for `behaviour` and `shadow`.
  - "Đánh giá hành vi" button with a pending label ("có thể mất vài phút"). The eval is synchronous on the server and can take minutes.
  - Behaviour summary line: passed or not, scores shown on 0..100 (the server returns 0..1; `pct()` converts and is null-safe), baseline kind, and the judge-status note (unavailable / insufficient).
  - "Đặt làm shadow": shown only for `draft`, enabled only when the eval passed and the judge status is `ok`. The server gate is still the authority.
  - "Bỏ shadow": shown on shadow items.
  - Shadow progress: status label, `runs/5`, first-seen time, the note that shadow runs no tool.
  - Tool comparison: shadow tools, baseline tools (or "không có bản nền" / "không khai báo"), and added / removed lists.
  - Server error messages are shown in the existing `role="alert"` slot.
- `src/features/research/ResearchPage.tsx`: `ShadowSetting` card "Ghi nhận lệnh shadow" with a checkbox (`aria-label="Ghi nhận lệnh shadow"`). It reads `GET /api/operator/overview` and saves through `saveOperatorSettings({shadowEnabled})`. Default off. Shown only when the user has `settings.write` **and** `operator.use` (overview and settings routes both need `operator.use`).
- `src/services/operatorApi.ts`: `settings.shadowEnabled?: boolean` on the overview type. The overview already returns the full settings object.
- `src/features/operator/OperatorPage.tsx`: net unchanged from the start of this step. A shadow checkbox was added there during the work and then removed when the switch moved to `ResearchPage.tsx`.

### Tests
- `apps/server/test/operatorShadowGate.test.ts`: 34 tests (new in this step). Covers the gate, baseline rules, budget and 429, 503 for an unconfigured provider, routes, permission rows, counting, progress windows, production run-id wiring through `ASSISTANT_TOOLS`, `skillVersions()` shape, `registryBehaviourLlm` through a stubbed `generateRoutedStructured`, and the shadow switch round-trip (`PUT /api/operator/settings` → `GET /api/operator/overview`, with `runTool` and `runCursorProcess` asserted not called). The round-trip first sets `killed: true` and `maxRunsPerDay: 42`, then asserts that after `{shadowEnabled: true}` every other setting is unchanged (`saveOperatorSettings` merges, so a partial PUT keeps the kill switch).
- `apps/server/test/operatorShadow.test.ts` (3a, updated expectation at line 211) and `operatorBehaviourEval.test.ts` (074b-2, 19 tests) also pass.
- `apps/web/src/features/operator/SkillVersions.shadow.test.tsx` (new): 4 tests. Disabled until a passed eval; enabled with a `ok` judge, 0..100 display, and POST shadow; judge unavailable keeps it disabled; shadow progress, tool diff, and DELETE on "Bỏ shadow".
- `apps/web/src/features/research/ResearchPage.shadow.test.tsx` (new): 1 test. With `settings.write` and `operator.use`, clicking the switch sends `{shadowEnabled:true}`, shows the toast, and reads the checked state back.
- `apps/web/src/features/research/ResearchPage.shadowGate.test.tsx` (new): 1 test. Without `operator.use`, the switch is absent. Kept in its own file because `useCan` caches `/me` at module level.

## Verification (run in this step)
- `apps/server`: `npx tsc -p tsconfig.json --noEmit` → exit 0.
- `apps/server` vitest: `operatorShadowGate` + `operatorShadow` + `operatorBehaviourEval` → 3 files, 62 tests passing. Broader `test/operator`, `test/assistant`, `test/auth` ran earlier in this step: 11 files, 129 passed (before the switch round-trip test was added).
- `apps/web`: `npx tsc -p tsconfig.json --noEmit` → exit 0.
- `apps/web` vitest: research + operator files → 23 passing. Full suite, final run in this step: **93 files, 252 tests, all passing.**
- `apps/web` vitest, an earlier full run had **1 failed test out of 246**. I did not identify which test. One later full run was clean (246/246). Treat this as a flake until someone reproduces it; it is not root-caused.
- `apps/mcp`: `npx tsc -p tsconfig.json --noEmit` → exit 0.
- Mutation checks from earlier in this step (each caught by tests, then reverted): gate removed (6 red), run id leaked to the routing log (1 red), no-baseline branch removed (1 red), runner called on the counting path (1 red), tool run id dropped (1 red), permission rows removed (1 red). Grep shows 0 MUTANT markers in `src`.
- Line endings: each edited file is internally consistent. Existing CRLF files (`tools.ts`, `routePermissions.ts`, `service.ts`, `hooks.ts`, `api/operator.ts`, `skillVersions.ts`, `operatorApi.ts`) are still all CRLF. New and LF files (`skillBehaviourEval.ts`, `shadow.ts`, the server and web test files, `SkillVersions.tsx`, `ResearchPage.tsx`) are all LF.

## Advisor review records
- Earlier in this step (previous context window): four advisor items. They are **not recorded in this report**; the earlier context was summarised and the items were not written down here.
- Latest checkpoint (this window). The list below was reconstructed from the session summary, not from the transcript:
  1. Score display showed `/100` on 0..1 values. Fixed with `pct()` (null-safe).
  2. Shadow switch placed on the Operator page instead of the guide's Tự cải tiến page. Moved to `ResearchPage.tsx` (`ShadowSetting`); removed from `OperatorPage.tsx`.
  3. The switch must be gated by `operator.use` as well as `settings.write`, because the overview and settings routes need it. Gated.
  4. Web tests for the new SkillVersions controls were missing. Added `SkillVersions.shadow.test.tsx`. The first version ran `openAll` before the list loaded; made it async with `findByText`.
  5. Server test for the switch round-trip was missing. Added (`operatorShadowGate.test.ts`). The first version returned 500 because the test fake had no `llmProviders.list()` and the assistant fake had no `ensureCallerConversation`; both fixed in test setup.
- Absence test for the switch: `ResearchPage.shadowGate.test.tsx` is in its own file (module-level `/me` cache) and waits for absence with `waitFor`.

## Deviations from the guide
1. **Baseline is active or builtin only.** A repo-only skill has no baseline the eval covers, so the gate refuses with `SKILL_NO_BASELINE`. The guide said repo skills count as the routing baseline. Not changed; needs a decision.
2. **Run id only goes to `recordShadow`.** `find_skills` passes its run id to shadow rows and never to the routing log. The routing log keeps `run_id` NULL for `findSkills`.
3. **N is a constant (5), not a setting.** A setting would need a schema change. The web repeats `5` as `SHADOW_MIN_RUNS_HINT`, with a comment to keep it in sync.
4. **Re-shadowing does not restart the clock.** Pinned by a test. `firstAt` stays the first row's time.
5. **Legacy rows double-count.** 3a rows with `run_id` NULL are counted per row, so a run that hit both `findSkills` and `suggestion` can count twice. Not backfilled; a backfill needs the user's approval.
6. **Judge route reuses `operatorPlan`.** `LlmTaskId` is a closed enum, so the judge uses the existing task key with `digestProject()`. A dedicated task key would need the user's OK.
7. **`markdown` is never updated in place** on an existing `(name, version)` row. Verified by grep (no `SET markdown` or `markdown =` UPDATE). This is a confirmed negative, not a fix.

## Open / not verified
- The new buttons and the Tự cải tiến switch were not exercised in a running browser preview. Verification is typecheck and unit tests only.
- The real LLM judge was not called (tests use `fakeLlm`). `args: z.unknown()` is untested against a real provider.
- Law (c) of the eval is inert in production, because fixtures default to `{}`. The judge does not see `expect`.
- The repo-skill baseline is not covered by the eval (see deviation 1).
- The eval route is synchronous and can take minutes. The web shows a pending label, but there is no job queue.
- Opening Tự cải tiến now calls `GET /api/operator/overview`, which calls `latestConversation("web")`. When no web operator conversation exists, that call creates one (`createConversation`). This is existing `overview()` behaviour, not changed here; the new page only makes it reachable from Tự cải tiến.
- External blockers from the goal are unchanged (073d, 143, Hermes key, 135b/c, better-auth, 141, 139).

## Files touched
- Server: `src/operator/skillBehaviourEval.ts`, `src/operator/shadow.ts`, `src/operator/skillVersions.ts`, `src/operator/service.ts`, `src/operator/hooks.ts`, `src/assistant/tools.ts`, `src/api/operator.ts`, `src/auth/routePermissions.ts`, `test/operatorShadowGate.test.ts` (new), `test/operatorShadow.test.ts`.
- Web: `src/features/operator/SkillVersions.tsx`, `src/features/operator/SkillVersions.shadow.test.tsx` (new), `src/features/research/ResearchPage.tsx`, `src/features/research/ResearchPage.shadow.test.tsx` (new), `src/features/research/ResearchPage.shadowGate.test.tsx` (new), `src/services/operatorApi.ts`.
- Docs: this report; `docs/cursor/README.md` row `54td`.

## Corrections after advisor review (2026-11-20, TASK-152)

Appended, not rewritten. The points below override the matching lines above.

1. **Chat `runId` (review condition 1): fixed, but NOT by setting `ctx.runId`.** The `find_skills` line above (`ctx.runId ?? null`) meant every chat call logged `run_id` NULL, so one turn could count several times under `COUNT(DISTINCT COALESCE(run_id, id))`. Setting `ctx.runId` on chat would change Computer Use (`computerUse/service.ts` `begin()` keys sessions on `runId ?? "direct"`). So TASK-152 adds `AssistantToolContext.turnId` (one UUID per chat send, set in `assistant/service.ts` `sendMessageInner`), and `find_skills` uses `ctx.runId ?? ctx.turnId ?? null`. Test: `test/assistant.test.ts`, "TASK-152 1". Legacy NULL rows still double count; not migrated.
2. **`readBehaviourEval` (review condition 3): fixed.** A corrupt JSON row now logs a warning and returns `null` (fail closed). Readers treat `null` as no stored eval, so activation is refused. The guide asked for a separate "unreadable" reason text; that was not added. Test: `test/behaviourGateFailClosed.test.ts`.
3. **`allowed` for shadow in the read model (review item 8): fixed.** `skillVersions()` sets `allowed: false` with a reason for `shadow` only. `archived` stays `allowed: true`, so the restore button is not locked. Test: `test/operatorAutoWiring.test.ts`, "TASK-152 4".

Still open: legacy NULL `run_id` double counting; no browser check of the shadow buttons.
