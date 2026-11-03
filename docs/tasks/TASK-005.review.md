# TASK-005 Review (by Architect)

Verdict: **Accepted with fixes.** Verified: typecheck, build, 237/237 tests, `npm audit --omit=dev` = 0, migration `0005_scenes` generated correctly (drizzle-kit reports no changes). Live dev server: text preserved and startSec correct in every run; Scene Board renders.

## Live findings
Mock scripts (no punctuation) — TikTok 3 s scenes: 11 scenes, **8/10 consecutive pairs share the same primary query**; YouTube 7 s: 18 scenes of ~10.8 s, **15/17 consecutive duplicates**.
Real Copilot-written Vietnamese script (fixture `packages/shared/test/fixtures/copilot-merged-story-vi.json`, loaded as a user script, 0 LLM calls) — TikTok 3 s: 29 scenes, natural comma-phrase splits (good), but **12/28 consecutive duplicates** and **one 1.2 s scene** (< 0.5× target); YouTube 7 s: 12 scenes of 4–10.4 s.

## Required fixes (TASK-005-FIX)

### F1 — MUST: visual query variety (no consecutive duplicates)
Consecutive scenes with the same primary query will get the same image in TASK-006.
- Treat query assignment as a rotation over the unit's pool `[primary, ...alternatives]`, and continue the rotation across a hook → first-section boundary (the hook currently takes the first section's queries and the section then starts again from `primary`). Same for last section → outro.
- When the pool is exhausted, derive deterministic variants: `${base} ${modifier}` cycling modifiers `["close-up", "wide shot", "archival photo", "detail", "portrait", "illustration"]` (English), set `visualQueries.alternatives` to the remaining pool, and add `queryVariant: true` on the scene (schema field, default false; not a DB migration if stored in an existing JSON column, otherwise generate the migration with drizzle-kit).
- Invariant + property test: **no two consecutive scenes share an identical primary query**.

### F2 — MUST: split long sentences into a part count closest to the target
Word-count splitting currently picks the fewest parts allowed (scenes ≈ 1.5× target). Use `parts = max(ceil(d / (1.6 × t)), round(d / t))` so parts are as close to `t` as possible. Test: one 70 s unpunctuated sentence at t = 7 → 10 parts of ~7 s.

### F3 — SHOULD: no tiny scenes inside a unit
Any scene < 0.5× target (not only the trailing one) is merged into the shorter adjacent scene of the same unit when the result ≤ 1.8× target. Exception: a whole unit shorter than 0.5× target stays a single scene. Test with the real fixture at t = 3 and t = 7: no scene < 0.5× t except whole-unit exceptions.

### F4 — MUST: success message shows the video target
Currently `"29 scenes · total ~95.2s (target 3s)"` uses `sceneDurationSec`. Use `targetDurationSec`: `"29 scenes · total ~95s (target 60s) · ~3s/scene"`.

### F5 — MUST: real-script regression tests
Add shared tests using the real fixture for the TikTok (3 s) and YouTube (7 s) presets asserting: text preserved, no consecutive duplicate primaries, all scenes within bounds (documented exceptions only), deterministic output.

### F6 — SHOULD: bounded client retries
During the session the browser tab issued ~14,000 API requests while the dev server was restarting/hot-reloading (not reproducible with a stable server: a 404 page made 2 requests; 12 s of server downtime made 1). Make the behavior explicit: TanStack Query `retry: (count, error) => count < 2 && !(error is 4xx)`, `retryDelay` exponential capped at 30 s; SSE fallback polling backs off (3 s → 6 s → … max 30 s) while the server is unreachable and resets on reconnect. Add a test for the polling backoff.

## Do not
- Do not touch migrations `0000`–`0005` (generate a new one only if F1 needs a column).
- Do not add dependencies; do not run real `copilot` prompts; do not commit.

## Report
Append `## Fix round 1` to `docs/tasks/TASK-005.report.md` with: files, test counts, and the scene stats for the real fixture at 3 s and 7 s (count, min/max duration, consecutive duplicates = 0). Then create empty `docs/tasks/TASK-005.fix-done`.

## Continuation note (architect, 2026-11-03 01:20 UTC) — previous fix session was interrupted
- The previous Copilot session stopped mid-work (empty model responses), then could not resume ("Auto routing is unavailable"). The user cancelled it.
- `packages/shared/src/scenes/planScenes.ts` was **zeroed by an interrupted write**. The architect restored it from `packages/shared/dist/scenes/planScenes.js` (built one minute earlier, already containing the fix-round query rotation, `round(d/t)` part count and small-scene merge) and re-added types. Review it, but do not rewrite it from scratch.
- Architect fix: clause splitting now only splits at `, ; : —` followed by whitespace (the real fixture has `người—và`; splitting there broke text preservation).
- Current state: typecheck passes; all tests pass **except** `packages/shared/test/planScenes.test.ts` › "preserves and deterministically plans the real Vietnamese fixture at 3s": one scene is 1.2 s (< 0.5 × 3 s). Finish F3 (merge tiny scenes; if the merge would exceed 1.8×, try the other neighbour; document any remaining whole-unit exception in the test) and verify all of F1–F6 are complete (F4 message, F6 retry/backoff files exist: `apps/web/src/services/queryRetry.ts`, `apps/web/src/hooks/pipelinePolling.ts`).

## Fix round 1 — verified (architect, 2026-11-03)
**Accepted.** typecheck, build, 245/245 tests; drizzle-kit: no schema changes; no NUL bytes in changed files.
Real fixture (independently recomputed): 3 s → 30 scenes, 2–4.8 s, 0 consecutive duplicate primaries, text preserved; 7 s → 12 scenes, 4–10.4 s, 0 duplicates.
Live mock runs: TikTok 15 scenes, 0 out of range, 0 duplicates; YouTube 27 scenes, 0 duplicates, only the one-sentence hook/outro (3.2 s) below 0.5× (whole-unit exception). Message shows "(target 180s) · ~7s/scene". Scene Board renders.
Note for TASK-006: at 3 s, 21/30 scenes use derived query variants — image search should still pick distinct candidates per scene.
