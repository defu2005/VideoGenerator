# TASK-004 Review (by Architect)

Verdict: **Accepted with fixes.** Independently verified: typecheck, build, 79/79 tests (server 57, web 22), `npm audit --omit=dev` = 0, no new dependencies, no keys exposed by `/api/llm/providers`. Runtime check with `LLM_DEFAULT_PROVIDER=mock`: Generate All → RESEARCH (1 call) → SCRIPT (1 call) → fake stages → VISUAL_REVIEW; Script tab renders research + script.

Section A was written while TASK-004 was being implemented, after a new hard rule from the user. Section B contains code review findings. Apply **both**.

## A. Architecture change: 1 LLM call per video (MUST)

New rule (see `docs/ARCHITECTURE.md` §4 "Quy tắc LLM"): anything deterministic is code; default budget is **one LLM call per Generate All**. TASK-004 currently makes 2 calls (RESEARCH, SCRIPT), and the old plan added a 3rd for scene planning. Change it so a single call returns everything later stages need.

### A1 — Merged "story" call
- Add `LLM_RESEARCH_MODE = merged | separate | off` (default `merged`; also overridable per project as `settings.researchMode`).
  - `merged`: the RESEARCH executor makes **one** call returning `{ research: ResearchNotes, script: Script }`, stores both (same `input_hash`, `origin=AGENT`). The SCRIPT executor then makes **0 calls**: if a script produced from the current research with the same input hash exists, it validates, recomputes durations and completes with message "Script from merged call (0 tokens)".
  - `separate`: current behavior (2 calls). Used automatically when the user edited/saved research (research hash differs from the merged run), so the script is regenerated from the edited research.
  - `off`: RESEARCH is `SKIPPED` (no call); SCRIPT makes one call from the topic only.
- "Regenerate script" (user click) = one script-only call using current research (allowed, user-initiated).

### A2 — Script output carries everything downstream needs
Extend `ScriptSection` (shared schema, backward compatible defaults):
```
visualQueries: { primary: string, alternatives: string[] /* 0–3 */ }   // English search terms work best for image APIs; keep proper nouns
visualNotes: string            // what the image should show (for the user/reviewer)
musicMood: string              // e.g. "mysterious", "tense", "uplifting"
energy: "low" | "medium" | "high"
```
and top-level `Script.music: { mood: string, energy: "low"|"medium"|"high", keywords: string[] }`.
- Remove the separate `visualIdeas` field or map it to `visualNotes` (keep reading old rows).
- These fields let TASK-005 (scene plan), TASK-006 (image search) and TASK-010 (music) run with **zero** LLM calls.

### A3 — Prompt size discipline
- System prompt + schema description must be compact (no long examples). Keep output limits explicit: `maxOutputTokens` derived from target duration (e.g. ~ words × 2 tokens + overhead), not a fixed large number.
- Research `keyFacts` 5–12, `timeline` ≤ 10, `outline` ≤ 8 to bound output tokens.
- Add a test that asserts the merged path performs exactly 1 provider call for Generate All through SCRIPT, and 0 calls on a cached re-run.

### A4 — UI
- Script tab shows per-section visual query (editable), mood/energy.
- Usage footer shows "LLM calls this run: N" and tokens; show "0 tokens (cached)" when applicable.

## B. Code review findings

### B1 — MUST: tokens spent on failed calls are not recorded
`generateStructured` throws `LLM_INVALID_OUTPUT` after the repair call without returning usage, and any error after a successful provider response loses its usage. Spent tokens must always be visible.
- Attach `usage` (calls, input, output) to `LlmError` (e.g. `error.usage`), and in the executors call `ctx.recordUsage(...)` before rethrowing as `StageError`.
- Test: first response invalid, repair invalid → job FAILED with `usage.llmCalls = 2` and summed tokens.

### B2 — SHOULD: detect truncated output, skip the repair call
If the provider stopped because of the output limit (Anthropic `stop_reason: "max_tokens"`, OpenAI-compatible `finish_reason: "length"`, Gemini `finishReason: "MAX_TOKENS"`), a repair call re-pays the whole prompt and will likely truncate again.
- Add `finishReason: "stop" | "length" | "other"` to `LlmResponse`; on `length` throw `LLM_OUTPUT_TRUNCATED` (non-retryable, message suggests a shorter target duration or a higher limit) without repairing. Record usage (B1).

### B3 — MUST: `.env` and `DATA_DIR` resolve relative to `apps/server`, not the repo root
`npm run dev` runs the server with cwd `apps/server`, so `dotenv/config` reads `apps/server/.env` and `./data` becomes `apps/server/data`, while README/.env.example tell users to put `.env` at the repo root.
- Load `.env` from the repo root (locate the nearest ancestor `package.json` that has `workspaces`), falling back to cwd. Resolve a relative `DATA_DIR` against the repo root too. Update README. Tests keep passing explicit config.

### B4 — SHOULD: migration hygiene
The first `0002` migration had a hand-written `when` timestamp, was applied to a running dev DB, then regenerated; restarting the dev server crashed with "table `llm_cache` already exists".
- Rule from now on: migrations are only produced by `drizzle-kit generate`, never edited after they have been applied. Add this rule to README "Development".
- In `migrateDatabase`, catch the failure and log one clear hint (which migration failed and that the dev DB was likely migrated by an older version of that file; delete `data/app.db` in development) before exiting.

### B5 — COULD: provider "configured" accuracy
`ollama` shows `configured: true` with `defaultModel: null` even when no model is set. Mark it configured only when a model is resolvable (`OLLAMA_MODEL` or `LLM_DEFAULT_MODEL`), otherwise `configured: false` with hint "Set OLLAMA_MODEL".

### B6 — Docs
Update the LLM row in `docs/ARCHITECTURE.md` §7 to describe the merged 1-call default (it currently says one call per stage). Do not modify the "Quy tắc LLM" section.

## Do not
- Do not add dependencies or vendor SDKs; do not upgrade drizzle.
- Do not edit or regenerate already-committed migrations `0000`–`0001`. `0002` is not committed yet: you may regenerate it once for the new columns if needed (document it), or add `0003`.
- Do not commit.

## Report
Append `## Fix round 1` to `docs/tasks/TASK-004.report.md`: files changed, migration changes, LLM calls per Generate All in each `LLM_RESEARCH_MODE` (from tests), typecheck/build/test counts. Then create empty `docs/tasks/TASK-004.fix-done`.
