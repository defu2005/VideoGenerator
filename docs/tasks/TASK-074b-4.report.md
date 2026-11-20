# TASK-074b-4 report: auto-activation rules (user activation, auto activation for read-only skills with a baseline)

Status: **implemented, not reviewed.** No `.done` file was written. The 2026-11-20 advisor ruling overrides the guide's `.done` dependency on 074b-3b, so this task was coded directly in the working tree, like 074b-2 and 074b-3b. Codex review is still needed. Nothing was committed or pushed.

## Decisions taken (guide "Open questions" resolved by default)

- **Setting name:** kept `autoActivateReadOnlySkills` (the name in the saved fleet settings), not the spec's `operator.autoActivateReadSkills`. Renaming would drop what users have already saved.
- **Routing threshold:** kept ≥ 80 (`SKILL_EVAL_MIN_SCORE`) and added the behaviour eval on top. The guide's estimate line says "replace the old condition"; that replacement was not made.
- **`user_edit` exemption:** applies only to drafts whose `evidence.source` is `user_edit`, and only on the user path. It does **not** apply to `user_review` (agent-written content) and does not apply to the auto path at all (auto never shadows a `user_edit` draft; see mutation h).
- **Activation by the user does not need the shadow to finish first.** The user is the final decision-maker; the shadow progress is displayed for information.
- **"No worse than baseline"** compares declared tools only: the candidate's `tools` must be a subset of the baseline's `tools` (`parseSkillMarkdown`). It does not compare actual call traces. The guide asked for a call-level comparison; that difference is listed under Deviations.
- **Archived rows:** restoring an `archived` version skips the behaviour gate, because the gate runs only for `draft` rows in `activateSkillVersionInTx`. The user path still goes through the `needs_merge`, `shadow`, name and routing-score checks in `activateSkillVersionInTx` (`skillVersions.ts:141-158`). The read-only check exists only on the auto path (`autoActivation.ts`); the user path does not run it. Verified by the test "restoring an archived version is not blocked by the eval gate (rollback)".
- **Built-in skills:** auto never activates a non-research built-in. A research built-in with no DB version is the baseline (`baselineFor` returns the built-in as a `builtin` baseline) and **can** be auto-activated if it passes the rest of the gate. Verified with `research-market`.
- **`research-provider` is not eligible.** Its name is used by two entries in `OPERATOR_SKILLS`: the research built-in in `src/research/skills.ts` and a non-research entry in `src/operator/skills.ts` (line ~121). The guard (`autoActivation.ts:47`, and the same check in `service.ts:902`) finds the non-research one first and refuses it. This is the safe direction; the name collision itself is a bug for a separate task (see Risks).
- **Eval is not run automatically after a draft is saved.** It runs only when someone clicks "Chạy eval hành vi". Auto-shadowing happens inside that route response (`autoShadow` field), not in a background job.

## What changed

### Server (`apps/server`)

- **`src/operator/autoActivation.ts`** (new, untracked in git). No import from `fleet/`, the executor, the runner, or the operator service; a test checks this.
  - `readOnlyReasons(markdown, files, registry)`: every declared tool must be `read`, and no mutating tool name may appear in the markdown or the evidence files.
  - `fitReasons(...)`: built-in guard (non-research built-ins only), read-only, baseline exists, declared tools subset of baseline, routing score ≥ 80, behaviour eval passed (no `user_edit` exemption here).
  - `autoEligibility(db, name, version, registry, now)`: for a `shadow` row. Requires `shadowProgress(...).status === "du_mau"`, then `fitReasons`.
  - `autoShadowReasons(db, name, version, registry)`: for a `draft` just evaluated. Refuses non-draft, `user_edit` drafts, and anything failing `fitReasons`.
  - `checkAutoActivation(db, name, { now, registry, autoEnabled })`: a silent no-op when disabled or when there is no shadow. Otherwise the checks run inside `db.transaction(...).immediate()`: if they pass, the shadow is flipped to `draft` and `activateSkillVersionInTx` runs. The `try/catch` is **outside** the transaction. An `AppError` thrown by `activateSkillVersionInTx` after the flip rolls the transaction back (the flip is undone) and is returned as a reason. A non-`AppError` throw re-throws.
- **`src/operator/skillVersions.ts`**: `activateSkillVersionInTx` (no transaction of its own), used by `activateSkillVersion` and by the auto path. The user-path behaviour gate sits inside the `draft` branch: `SKILL_BEHAVIOUR_NOT_PASSED` (409) with the reason from `behaviourReason`. `isBehaviourExempt` is true only for `user_edit`.
- **`src/operator/behaviourGate.ts`** (untracked in git): `behaviourReason` compares the baseline **kind** (`none` / `builtin` / `active`) as well as `activeVersion`, so an eval taken against a built-in is stale once a DB active row exists (mutation f).
- **`src/operator/service.ts`**
  - `findSkills` and `suggestion` call `autoActivateAfterShadow(recordShadow(...))`. `autoActivateAfterShadow` wraps each name in try/catch and logs `operator auto activation failed`; a throw does not change the routing result.
  - `runSkillBehaviourEval` calls `autoShadowAfterEval`, which only runs when `operator.shadowEnabled` **and** `autoActivateReadOnlySkills` are both on. The manual shadow is not displaced by the auto path.
  - `activateSkill` (user route) goes through the same gate.
- **`src/fleet/service.ts`**: the direct `activateSkillVersion` call on fleet draft submission is removed. Fleet drafts are stored as `agent_proposal` and never activate there.
- **`src/api/operator.ts`**
  - `userOnly(request)` (403 `OPERATOR_SKILL_USER_ONLY` unless `request.actor.kind === "user"`) guards `PUT /api/operator/skills/:name/draft` and `POST /api/operator/skills/:name/versions/:version/activate`. **Found during this task:** an API key bound to an owner passed `operator.use` and could write a `user_edit` draft and activate it, skipping the eval because `user_edit` is exempt. The guard closes that path. The `behaviour-eval`, `shadow` and `DELETE shadow` routes stay available to keys by design.
  - `POST .../behaviour-eval` response includes `autoShadow: { shadowed, reasons }`.
  - `GET /api/operator/skills` items include `activation: { allowed, reasons }` for the UI.
- **`src/operator/shadow.ts`** (untracked in git): `SHADOW_MIN_RUNS = 5`, 7-day window (`shadowProgress`). `recordShadowRuns` returns `string[]` (the names of skills that wrote rows). This task consumes that return value through `recordShadow`. Git cannot show whether the return type was added in 3b or here.
- **`src/operator/skillBehaviourEval.ts`** (untracked in git): this task's changes to it cannot be isolated from 074b-3b, so no change is attributed to this task here.

### Web (`apps/web`)

- **`src/features/operator/SkillVersions.tsx`**: the "Duyệt và dùng" button is disabled when `activation.allowed === false`, and shows `Chưa dùng được: <reasons>`.
- **`src/features/operator/FleetTab.tsx`**: the checkbox label is "Tự kích hoạt skill chỉ đọc khi qua đánh giá". The help text says skills with write tools, built-in skills, the user's own edits, and drafts that need merging still wait for the user in "Phiên bản skill".

## Tests

New tests (32 across the two new server files: 20 + 12):

- `apps/server/test/operatorAutoActivation.test.ts` (20 tests). Auto path: activates after 5 runs; off-setting no-op; second call no-op; fewer than 5 runs refused; stale eval with exact reason; no stored eval; eval did not pass; declared tool not in baseline; mutating tool named; non-research built-in never auto-activates; **research built-in with no DB version activates** (`research-market`, candidate declares only `web_search`); user_edit never auto-shadowed; user_edit shadow with no eval refused; no baseline; read-only checks; import allowlist. User path: pattern draft refused 409; user_edit activates; stored eval against a different baseline kind refused; **restore of an archived version is not blocked** (`gate-restore-skill`).
- `apps/server/test/operatorAutoWiring.test.ts` (12 tests, through the real routes and the real `findSkills` path, with an injected fake behaviour model). Covers: flags off changes nothing; **auto on with the shadow switch off does not shadow**; both flags on shadows through the route; five `find_skills` runs activate and write the user skill file, four do not; **after the activation, the next `find_skills` run reports version 2** (`wire-next-skill`); **a non-AppError throw on the auto path is logged, `find_skills` still returns, and the rows are unchanged** (`wire-throw-skill`: the shadow row's evidence JSON is corrupted before the fifth run, so `JSON.parse` throws a `SyntaxError`); **the eval route and five runs call no `runTool`, `runCursorProcess` or `createModelRuntime`** (`wire-exec-skill`, pass-through `vi.fn` spies on those three modules); manual activate refused 409 for a pattern draft, accepted for `user_edit`; listing shows the reason; promote saves a draft; API-key guard (403 for PUT draft and activate, user still allowed); helper shape test.
- New helper: `apps/server/test/helpers/behaviour.ts` (`storePassingBehaviourEval`). Untracked in git, so its origin cannot be diffed; the test "the test helper stores the same shape a real eval run stores" checks it.
- `apps/web/src/features/operator/SkillVersions.shadow.test.tsx`: two new tests (disabled with reason when refused; enabled when allowed).

Changes to existing tests:

- `apps/server/test/fleet.test.ts`: test renamed from "...and auto-activates read-only skills only when enabled" to "...and never auto-activates fleet drafts"; a passing eval is stored before the manual activation; expectations for the three fleet drafts (`first`, `fresh`, `mutatingMention`) changed to `draft`.
- `apps/server/test/operator.test.ts`: 3 lines added, storing a passing eval before a manual activation.
- `apps/server/test/skillDraftChecks.test.ts`: untracked in git, so its changes cannot be isolated; it uses the helper for a manual activation.

## Required tests from the guide: walk

| Guide requirement | Status | Where |
|---|---|---|
| Restoring an archived version is not blocked by the eval | covered | `operatorAutoActivation.test.ts`, "restoring an archived version is not blocked by the eval gate (rollback)" |
| An error in `autoActivateAfterShadow` is logged and routing is unaffected | covered | `operatorAutoWiring.test.ts`, "a non-AppError throw on the auto path is logged; find_skills still answers..." |
| Next turn uses the new active version | covered | `operatorAutoWiring.test.ts`, "after the auto activation, the next find_skills run serves the new version" |
| Non-execution: `runTool`, `runCursorProcess`, `createModelRuntime` are not called | covered | `operatorAutoWiring.test.ts`, "the eval route and five find_skills runs call no tool runner, cursor process or model runtime". The test first asserts `vi.isMockFunction` on each of the three, so a zero count cannot come from a spy that is not on the path. The spies sit on module-level `vi.mock` pass-throughs, so any importer in the graph reaches them. Verified by reading: `service.ts` imports `createModelRuntime`; `runTool` is imported by `assistant/service.ts` and `assistant/loop.ts`; `runCursorProcess` by `operator/cursorRuntime.ts`. (`media/ffmpeg.ts` has its own unrelated local `runTool`, not mocked.) Not proven: that the eval/find path never reaches the mocked modules through a route the spies miss; the test covers only the path it runs |
| Import allowlist (no executor, runner, fleet or operator service) | covered | "imports no executor, runner, fleet or operator service" (static imports of `autoActivation.ts`) |
| `fleet.test.ts` updated, not deleted | covered | renamed and updated (see Changes to existing tests) |
| `shadowEnabled` off blocks auto shadow | covered | "with auto on but the shadow switch off, a passed eval does not shadow the draft"; "with the flags off, ..." |

Not covered by a test: a throw **after** the shadow→draft flip inside `checkAutoActivation` (for example an `AppError` from `activateSkillVersionInTx`), which should roll the flip back. The rollback depends on `better-sqlite3` transaction semantics; no test forces it.

## Deviations from the guide

- **No single `activationGate(..., { path })` function.** The checks are split across `fitReasons`, `autoEligibility`, `autoShadowReasons`, `behaviourReason` (in `behaviourGate.ts`), and `activateSkillVersionInTx`.
- **`checkAutoActivation` has no `minRuns` option.** The threshold is the constant `SHADOW_MIN_RUNS` in `shadow.ts`.
- **"No worse than baseline" is a declared-tools subset check**, not "count ≤ baseline" and not a call-trace comparison (3b does not record which version each run chose).
- **Non-research built-ins never auto-activate.** The guide allowed a built-in baseline to auto-activate; only research built-ins can, and only without a DB row for that name.
- **`userOnly` on the draft-write and activate routes** is outside the guide's scope. It was added for the API-key hole found during this task.
- **Auto path requires a manual eval click first.** No background eval; per the guide, that would need its own queue and budget.

## Verification run (2026-11-20)

Scratchpad files are session temp files under `C:\Users\defu\AppData\Local\Temp\claude\b5570a7e047086c0\074f5dd9-9e4f-4407-b442-670a7f5dc0ae\scratchpad\`. They are outside the repo.

| Check | Result |
|---|---|
| `apps/server` tsc, final | exit 0 |
| `apps/server` full vitest, final run (`scratchpad\server_full_final2.txt`) | 269 files passed, 4 skipped (273); 2170 tests passed, 8 skipped (2178) |
| `apps/server` `operatorAutoActivation` + `operatorAutoWiring`, final | 2 files, 32 tests passed |
| `apps/web` full vitest (`scratchpad\web_full.txt`) | 93 files, 254 tests passed |
| `apps/web` tsc | exit 0 |
| `apps/mcp` tsc | exit 0 |
| `packages/shared` tsc | exit 0 |
| The two new test files, type-checked (`apps/server/tsconfig.json` excludes `test/`, so the real tsc never covers them) | 0 errors in `test/operatorAutoWiring.test.ts` and `test/operatorAutoActivation.test.ts`. Run with a scratch tsconfig in `scratchpad\tsconfig.tests074b4.json` (includes the two files and `src/publishing/fastify.d.ts`). That config reports 4 errors in untouched `src/` files (`visualToolkit.ts`, `ffmpeg.ts`, `imageCrop.ts`, `imageHash.ts`), which come from the scratch config, not this task; the real server tsc exits 0 |
| Re-run of the two files after the last edit (spy assertions added) | 2 files, 32 tests passed |

## Mutation check

`scratchpad\mutate_074b4.py` rewrites one gate site at a time, runs `operatorAutoActivation`, `operatorAutoWiring`, `operator` and `operatorShadowGate` tests, then restores the original bytes. A grep afterwards confirms no mutation remained in `src`.

The table below is from a run at 78 tests, before the mutation k entry was added and before the three wiring tests (error path, non-execution, next turn) were added. Added tests can only add failures, so a KILLED verdict cannot flip; the failing-test counts for a–j may now be higher, and were not re-run.

Mutation k was run on its own at 81 tests, before the three wiring tests were added. Those three tests were not put through the mutation script.

| id | Gate site mutated | Verdict | Tests failing |
|---|---|---|---|
| a_fit_behaviour | auto path ignores behaviour eval | KILLED | 4 |
| b_inner_gate | user-path inner `SKILL_BEHAVIOUR_NOT_PASSED` check removed | KILLED | 4 |
| c_readonly | read-only check skipped | KILLED | 1 |
| d_tools_subset | declared-tools subset check removed | KILLED | 1 |
| e_no_baseline | no-baseline reason removed | KILLED | 1 |
| f_kind_compare | baseline kind not compared in `behaviourReason` | KILLED | 1 |
| g_min_runs_4 | `SHADOW_MIN_RUNS` 5 → 4 | KILLED | 6 |
| h_user_edit_shadow | `user_edit` not exempted in auto shadow | KILLED | 1 |
| i_research_guard | built-in guard removed (all built-ins, research included) | KILLED | 1 |
| j_user_only_route | `userOnly` check removed in `api/operator.ts`, which guards both the draft-write and activate routes | KILLED | 1 |
| k_research_guard_skip | `!skill.research` removed from the guard, so research built-ins are refused too | KILLED | 1 (only "activates a research built-in with no DB version…") |

Mutation i was killed by the existing negative test "never auto-activates a built-in skill". Mutation k targets only the research case, so it is the check that the new positive test discriminates.

## Risks and known limits (not mitigated in this task)

- **`research-provider` name collision.** Two `OPERATOR_SKILLS` entries share the name (research in `src/research/skills.ts`, non-research in `src/operator/skills.ts`). The guard and `checkSkill` treat the name inconsistently. Not changed here; it needs its own task. The guide for fixing it is [docs/cursor/TASK-151.md](../cursor/TASK-151.md) (not yet implemented).
- **Flip-then-refuse path not tested.** A refusal from `activateSkillVersionInTx` happens after the shadow→draft flip. The refusal tests cover refusals raised before the flip (`fitReasons`). The rollback of the flip relies on `better-sqlite3` transaction semantics and is not forced by a test.
- **`auth/policy.ts`**: owner-bound API keys still reach the operator routes through `operator.use`. This task only closes the draft-write and activate routes. The eval and shadow routes remain open to keys by design. A broader policy change is out of scope.
- **Dead end for non-exempt drafts with fewer than 3 behaviour scenarios**: such a draft cannot pass the eval, so it can only leave the queue by being edited into `user_edit`. Not changed.
- **NULL `run_id` rows** (legacy) may double-count toward `SHADOW_MIN_RUNS`. 3b counts `COUNT(DISTINCT COALESCE(run_id, id))`. Left as is.
- **`syncWorkspace` during a run**: `writeUserSkill` (called on activation) can sync the workspace while a run is in progress. Not observed to break anything in the test suite; not verified under real concurrency.
- **Declared-tools comparison is not a call-trace comparison.** See Deviations.
- **Git cannot isolate this task's diff** in `shadow.ts`, `behaviourGate.ts`, `autoActivation.ts`, `skillBehaviourEval.ts`, `skillDraftChecks.ts`, `findingEvents.ts`, `test/helpers/behaviour.ts`, `test/skillDraftChecks.test.ts`, and `test/operatorBehaviourEval.test.ts` / `test/operatorShadow.test.ts` / `test/operatorShadowGate.test.ts`: they are untracked because 074b-1 through 3b were never committed. Only the two new test files `operatorAutoActivation.test.ts` and `operatorAutoWiring.test.ts` are attributable to this task.

## Not done here (by instruction)

- No commit, no push, no `.done` file.
- External blockers (073d data gate, 143 Docker/Litestream, Hermes key and approval, 135b/c, better-auth, 141, 139) untouched.
- The project `56374fb2-…` and `data/` were not touched; the dev data dir was used.
- No Codex review yet.

## Corrections after advisor review (2026-11-20, TASK-152)

Appended, not rewritten. The points below override the matching lines above.

1. **Test count.** The section "Tests" says 32 (20 + 12). The review file counts 21 + 12 = 33 `it(` lines in the two files (`TASK-074b-4.review.md:59`, `:75`). It says the report leaves out the test at line 213 (now line 224), `research-provider-terms`, which belongs to TASK-151. Read that way, 074b-4's own count is **32** and the TASK-151 test sits outside it. That test is not in the report's list. Git cannot confirm this, because both test files are untracked. Since then TASK-152 added two tests (the 6c rollback test and the Việc 4 test), so the files now hold 35 (22 + 13).
2. **Finding 9 (archive keeps routing) withdrawn.** `archived` is written at `skillVersions.ts:158`, in the same transaction that activates the replacement. `userSkills()` loads a file only when there is no active row, so an archived version is not routed.
3. **Finding 6 (file written after the DB is active): no code change.** `syncWorkspace()` runs at the start of every operator run (`operator/service.ts:1226`) and rebuilds `skills/user/*.md` from active DB rows (`userSkills()`, `writeOperatorWorkspace`). The DB is the source of truth. A failed `writeUserSkill` leaves a stale file only until the next run starts. Not checked under real concurrency.
4. **Flip-then-refuse rollback: now tested.** The "Not covered by a test" note and the "Risks" item above are now partly closed: `test/operatorAutoActivation.test.ts`, "rolls the flip back when activation fails after it (TASK-152 6c)", injects a DB error through an SQLite trigger; the shadow stays shadow and the active row stays active. The AppError-after-flip path appears unreachable with stored data, because `autoEligibility` runs the same checks before the flip. Only a hand-edited name mismatch could reach it. The test covers the DB-error rollback instead.


5. **Correction 3 is withdrawn.** The claim that `syncWorkspace()` rebuilds `skills/user/*.md` from active DB rows is wrong. `writeOperatorWorkspace` (`apps/server/src/operator/workspace.ts:89`) writes only code skills and repo skills, and `userSkills()` only reads the files. So a failed `writeUserSkill` left the file stale until items 4-5 below. The DB is still the source of truth, but no sync healed the file before this change.

## Items 4-5: skill file write failure (2026-11-20)

Status: code and tests done in the working tree. No `.done`, no commit, no push. Codex review not used. Advisor review (2026-11-20): the first review said "not done yet" and raised three blockers: the name guard, the AGENTS.md red check, and pinning the active-only sync. All three were fixed. The name guard matches `checkSkill` (`skillVersions.ts:29`) and the `:name` routes (`api/operator.ts`), so an active name always passes it. The AGENTS.md test is red-checked. A test pins that a sync writes only the active version. The advisor was re-run after these fixes and found no code blockers left.

### What changed

- `apps/server/src/operator/service.ts`
  - `writeUserSkill(name, markdown)`: the DB commit stays. The file write is in a try/catch. A failure logs, opens the finding `skill_file_write` (dedupe `skill-file-write:<name>`, severity `warn`, detail `{name, code}` where `code` is the errno), and publishes one `supervisor_finding` event only when the finding opens or reopens. A successful write resolves the finding. The following `syncWorkspace()` is also wrapped, so a failure there (for example a directory at `AGENTS.md`) does not throw out of `activateSkill`.
  - `syncUserSkillFiles()` (first step of `syncWorkspace()`): for each active row it rewrites a missing or differing `skills/user/<name>.md`. A matching file resolves the finding; a failed write opens it. Names outside `^[a-z0-9][a-z0-9-]{1,79}$` are skipped, and `writeUserSkill` applies the same guard before it builds a path.
- `apps/web/src/features/operator/SupervisorStatusPanel.tsx`: label `skill_file_write` maps to "Không ghi được file skill".
- The findings endpoint is not filtered by kind. `listSupervisorState` (`apps/server/src/operator/supervisor.ts:55-69`) filters only by profile and by `status != 'resolved'`, so the new finding reaches the panel.
- **Route contract unchanged.** `POST /api/operator/skills/:name/versions/:version/activate` still returns `{ ok: true }`. A user sees the failure only in the Supervisor panel, not in the response.

### Deviation from TASK-152 item 6b

The guide offered two options: write the file before committing the activation, or throw inside the transaction so it rolls back. Neither was taken. The DB commit stays, the failure is flagged, and the next sync heals the file. Reason: a rollback on a disk error would undo an activation the user has already approved. The guide's test "write fails, target not active" was therefore not written as specified. The replacement test is "write fails, still active, finding open, next sync heals it".

### Tests

- `apps/server/test/operatorSkillFileWrite.test.ts` (7 tests):
  - auto path: the blocker is placed before run 5, and no finding exists before it;
  - manual path: `activateSkill` does not throw, and the activation stands;
  - AGENTS.md directory after a good skill write: no throw out of `activateSkill`;
  - heal: the next `syncWorkspace()` rewrites the file and resolves the finding;
  - notification: one `supervisor_finding` event on open, none on a repeated failing sync;
  - clean path: no finding;
  - active-only sync: a sync writes the active version and never the draft beside it.
  - The blocker is a directory at `<name>.md`, so the failure is EISDIR. A real permission error (EACCES) is not tested.
- `apps/server/test/operatorAutoActivation.test.ts`: flip-then-refuse on a name mismatch. `checkAutoActivation` returns `activated: false` with reason "Tên skill không khớp.", the candidate stays `shadow`, and v1 stays `active`. The earlier section said the AppError-after-flip path was unreachable with stored data. A hand-edited `markdown` reaches it, and this test covers that case.

### Verification (exit codes captured directly)

| Check | Command | Result |
|---|---|---|
| Focused | `npx vitest run test/operatorSkillFileWrite.test.ts test/operatorAutoActivation.test.ts` (apps/server) | exit 0; 2 files, 30 tests passed |
| Server types | `npx tsc --noEmit` (apps/server) | exit 0 |
| Full server suite | `npx vitest run` (apps/server) | exit 0; 274 files passed, 4 skipped; 2223 tests passed, 8 skipped |
| Web types | `npx tsc -p tsconfig.json --noEmit` (apps/web) | exit 0 |
| Test files type check (scratch config, the three operator test files, `scratchpad/tsconfig.tests074b4b.json`) | `npx tsc -p <scratch config> --noEmit` | 0 errors in the three test files; 4 errors remain in unrelated source files (`src/agents/visualToolkit.ts`, `src/media/ffmpeg.ts`, `src/services/imageCrop.ts`, `src/services/imageHash.ts`), not touched by this change |

No web test covers `SupervisorStatusPanel`; the label change is covered by the type check only.

### Not verified

- The AGENTS.md test was red-checked: with the try/catch removed it fails with EISDIR (`AssertionError: expected [Function] to not throw`), then the wrap was restored and the focused run passed again.
- Real permission errors (EACCES) are not tested.
- Concurrent `syncWorkspace()` during a run is not tested.
- The first-run legacy migration can overwrite a healed file once. The next sync repairs it.
- The `activateSkill` route still returns only `{ ok: true }`. The user sees the finding only in the Supervisor panel.
- The web vitest suite was not rerun. Only web tsc ran (exit 0), and the web change is one label line.

### Open decisions for the user (not done here)

- Delete or keep `C:/Users/defu/AppData/Local/Temp/shadow.bak.ts`. This is the user's call.
- Enable `autoActivateReadOnlySkills`. It stays off.
- Bound the `query` storage in `operator_skill_shadow_runs`.
