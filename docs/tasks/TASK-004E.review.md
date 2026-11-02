# TASK-004E Review (by Architect)

Verdict: **Accepted with fixes.** Verified: typecheck, build, 192/192 tests, `npm audit --omit=dev` = 0. Live server with the mock provider: ECO estimate 1 → actual 1; BALANCED estimate 2–4 → actual 2; per-feature usage recorded. UI: budget mode select with recommendation/reset and live estimate works.

## Already fixed by the architect (do not redo)
- **Migration hygiene violation (again):** `0004_budget_review_notes.sql` was hand-written (round `when` = 1793647200000, no `0004_snapshot.json`). `drizzle-kit generate` then produced a duplicate `0005` adding the same column, which would crash startup. The architect removed both and regenerated `0004_budget_review_notes` with drizzle-kit (with snapshot). **Never write or edit migration files by hand — always `npx drizzle-kit generate --name <name>` from `apps/server`.**

## Required fixes (TASK-004E-FIX)

### F1 — MUST: QUALITY must never be worse than BALANCED (graceful review)
Live repro: QUALITY project, target 60 s, mock provider → review output estimated 122 s → rejected → repair also rejected → **SCRIPT stage FAILED**, although a valid pre-review script existed.
- The review step is an enhancement. If it fails for any reason (invalid output after allowed repairs, duration reject, timeout, rate limit, quota, auth, unavailable), keep the pre-review script, mark SCRIPT **DONE** with message `AI review skipped (<code>): kept the original script`, record the review usage (calls spent), and store `review_notes = null`.
- Only failures of the main script call may fail the stage.
- Test: review provider returns out-of-range duration twice → stage DONE, original script kept, usage.features `{ script: 1, review: 2 }`, message contains "AI review skipped".

### F2 — MUST: mock provider output must follow the target duration
The mock returns fixed-length narration for script/story/review regardless of `targetDurationSec`, so dev-server runs with the mock fail QUALITY at 60 s (tests only passed with the default 180 s).
- Make mock script/story/review narration length derive from the target duration and words per minute found in the prompt (parse `Target duration: N seconds` / `Speaking pace: M words per minute`; fallback 180 s / 150 wpm), within ±10%.
- Test: QUALITY end-to-end with the mock at 60 s and at 180 s → SCRIPT DONE with review notes.

### F3 — MUST: guard against hand-written migrations
Add a server test that reads `drizzle/meta/_journal.json` and asserts: every entry has a matching `drizzle/<tag>.sql` **and** `drizzle/meta/<idx>_snapshot.json`; `when` values strictly increase; no extra `.sql` files outside the journal. Add the rule to README "Development".

### F4 — COULD: clearer zero estimate
When the estimate total is 0 because stages are already done, show "Ước tính: 0 lượt gọi AI (đã có kết quả, dùng cache)" instead of "~0 lượt".

## Do not
- Do not touch migrations `0000`–`0004` (0004 is now correct). No new migration is needed for these fixes.
- Do not add dependencies; do not run real `copilot` prompts; do not commit.

## Report
Append `## Fix round 1` to `docs/tasks/TASK-004E.report.md` (files, test counts). Then create empty `docs/tasks/TASK-004E.fix-done`.
