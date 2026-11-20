# TASK-074b-3a — cơ chế shadow cho skill do operator viết (ghi lại, không chạy)

**Who:** opencode (code), Codex (review). Claude writes this guide only. **Size:** M. **Migration:** yes, one table (`operator_skill_shadow_runs`, name to be confirmed). Take the next free migration number at start: re-read `apps/server/drizzle/meta/_journal.json` and the `drizzle/` folder. The last migration seen by Claude is `0097_script_agent_author` (idx 97); do not use that as the number.
**Part of:** TASK-074b (estimate `docs/cursor/TASK-074-estimate-2026-11-19.md`, part 3a).
**Depends on:** 074b-1 (drafts exist). **Does NOT depend on 074b-2** (behaviour eval) or on 074b-3b (gate).
**Unblocks:** TASK-148e (`docs/cursor/TASK-148.md`, §148e), which waits for this part.

## Why

When the router picks a skill that has a shadow version, the app records what that version would have done. It does not execute it. The active version still runs as before. Real routing traffic gives a count for later comparison (3b). This is the only part of 074b that touches the routing path that is already running, so it is built with an off switch and a test that proves nothing executes.

## Where the hook is (checked 2026-11-19)

- `apps/server/src/operator/service.ts:613` — `findSkills(query)` calls `routeQuery` and logs it. This is the routing a skill pick goes through.
- `apps/server/src/operator/service.ts:1199` — `suggestion(prompt, runId)` calls `routeQuery(prompt, …, 3)` and suggests skills to the agent.
- `apps/server/src/operator/service.ts:1351` — `considerProposal` calls `routeQuery(…, 1)` for proposal logic. Not a shadow point.
- `apps/server/src/operator/runtime.ts` — contains `runCursorProcess` (line 33). **The rest of the file is not read by Claude yet.** The first step of this part is to read it and confirm where a run commits to a skill. Report that location in the report before writing code. If the commit point is not in `runtime.ts`, use the one in `service.ts`.

## Build

1. **Gate.** Setting `operator.shadowEnabled`, shipped default **false**. When false, the shadow code path does nothing: no row, no log.
2. **Table** `operator_skill_shadow_runs`: `id`, `skill_name`, `shadow_version`, `active_version`, `run_id` (nullable), `query`, `rank` (integer, 1-based position in the returned list; nullable for a routing call that does not rank), `planned` (JSON text), `created_at`. Migration via `drizzle-kit generate` only. Never edit an applied migration.
3. **Choosing a shadow version.** A skill has at most one shadow version. The version is stored as a draft with a shadow marker: use the existing `operator_skill_versions` status field only if it already has a value for this; otherwise store the shadow marker in a column that the migration adds (report which). A shadow version never becomes `active` through this part.
4. **Recording.** When a routing call (`findSkills` or `suggestion`) returns a skill that has a shadow version and the gate is on, insert one row per such skill per call with `planned` = the list of tool names declared by the shadow version (deterministic parsing of its frontmatter or a fixed `tools:` line; no LLM). If the version declares no tools, record an empty list and say so in the row. The routing result returned to the caller is unchanged.
5. **Never execute.** The shadow path must not call any tool executor, the cursor process runner (`runCursorProcess` in `apps/server/src/operator/runtime.ts:33`, found by grep 2026-11-19), or the assistant tool registry. Enforce this in the code path and prove it in tests.
6. **Count.** No counter column. A hit is one row. For 3b, the count is `SELECT COUNT(DISTINCT COALESCE(run_id, id)) FROM operator_skill_shadow_runs WHERE skill_name = ? AND shadow_version = ?`, so `findSkills` and `suggestion` calls in the same run count once. Rows with no `run_id` count one each. `N` = 5 by default, a setting; the 7-day rule belongs to 3b. Any returned rank counts (advisor ruling 2026-11-19, the user may overturn). 3b may filter on `rank = 1` from the column.

## Not allowed

- The shadow path never executes a command. Not in test, not in dry-run form.
- Do not change the active version's behaviour, its ranking, or the routing scores.
- Do not run behaviour eval here (that is 074b-2).
- Do not run against the protected project `56374fb2-…` or `data/`. Use the dev data dir.
- Do not write the migration by hand.

## Tests (must exist)

- Gate off: routing with a shadow version writes no row.
- Gate on: routing with a shadow version writes one row with the declared tool list; the returned routing result is identical to the gate-off result.
- **Non-execution:** with a shadow version that declares tools, the tool executor and the cursor process runner are mocked to fail on call. Call `findSkills(query)` and `suggestion(prompt, runId)` with the shadow version present. Both return normally and neither mock is called. The scope is the routing calls only: an active run may still reach the runner, because the active version runs as before.
- Shadow version is never returned as `active`.
- A skill without a shadow version behaves exactly as before (existing routing tests stay green).
- Mutation check: if the gate check is removed, the gate-off test goes red; if the executor call is added to the shadow path, the non-execution test goes red. Report both.

## Done when

- Tests above pass; `apps/server` typecheck passes; migration generated with `drizzle-kit generate` and applied on a copy of the dev DB only.
- Report at `docs/tasks/TASK-074b-3a.report.md` with: where the commit point was found, the migration number and name, and the shadow marker decision.
- `docs/tasks/TASK-074b-3a.done` only after Codex review.
- After `.done`, TASK-148e (`docs/cursor/TASK-148.md` §148e) is unblocked for the shadow-run part only.

## Open source available

Searched 2026-11-19 (WebSearch, standard mode). No maintained JS/TS library records planned tool calls in shadow mode. Seen: `@kye/shadow-mode-sdk` (Apache-2.0, has a local mode; docs thin; maintenance and fit not checked), the `gitnexus` shadow harness (inside a larger package, not usable alone), and a dry-run boundary pattern written up as a design, not a package. Decision: in-house, a few lines in our code and our table. No dependency is added.

## Open questions (report, do not settle)

- Whether `operator_skill_versions` already has a field fit for the shadow marker, or a column is needed (decide from the schema at start).
- Whether the declared tool list exists in the skill markdown format today. If it does not, record an empty list and report it; do not invent a format.
