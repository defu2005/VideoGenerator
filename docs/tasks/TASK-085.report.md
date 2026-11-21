# TASK-085 report: split three large files (no behaviour change)

**Status: partly met.** Facades and moves are done for all three files. The spec's step-by-step split of `visualService.ts` is not met (see Gap). Do not treat TASK-085 as complete. `docs/tasks/TASK-085.done` is not created; it is the user's marker.

## Commits (on `dev`, not pushed)

| Step | Commit | Change |
|---|---|---|
| 1 | `a4cd921` | `db/schema.ts` → `db/schema/<domain>.ts`, `drizzle.config.ts` points at the folder |
| 2 | `fd02232` | `assistant/tools.ts` → `registry/tools/<group>.ts`, order kept |
| 3 | `0967d10` | `services/visualService.ts` → `visuals/{service,types,query,candidate,download}.ts`, facade kept |

## Checks

- `npx drizzle-kit generate`: "No schema changes, nothing to migrate" (after step 1 and again after step 3).
- Server `tsc --noEmit` exit 0; root `npm run typecheck` exit 0 (after step 3).
- Server suite (`apps/server`, `npx vitest run`): **2529 passed | 9 skipped** (2538 total), 307 files passed | 4 skipped. The same counts were recorded after step 2 and after step 3. I did not record a pre-TASK-085 run in this task, so this report does not claim a before/after comparison beyond that.
- Root `npm test`: see the result line below.
- Step 3 proofs:
  - `visuals/service.ts` lines 1–3376 equal HEAD `services/visualService.ts` lines 164–3539 byte for byte (EOL-insensitive), in order.
  - Helper files: every non-blank body line of HEAD lines 112–3748 appears in the new files, with a leading `export ` allowed on declarations. Nothing is missing and nothing is added.
  - Module specifiers: the 9 sibling imports (`./x.js`) became `../services/x.js`; the four helper modules import each other with `./`.
  - Facade re-exports exactly `VisualService` and `isRetryableDownloadError`. HEAD had only these two top-level exports.
  - Fresh-process check: prototype has 104 names and constructor `length` 4, same as the baseline taken before the move. Export keys are the same two names.

## Deviations from the spec

- **Class not split by step.** `VisualService` is still one class of about 3,400 lines in `visuals/service.ts`. `executeStage` is about 1,000 lines inside it. Splitting it is a logic change this task excludes. The step files `relevance.ts`, `vision.ts`, `license.ts`, `assign.ts`, `dedupe.ts`, `gate.ts`, `crop.ts` were not created.
- **Helper files:** the split is `types`, `query`, `candidate`, `download`, not the spec's filter-step names.
- **Tool groups:** the names follow the existing grouping in `registry/tools/`, not the spec's example list.
- **Hand edit:** after the move script ran, one unused import (`downloadError`) was removed from `visuals/candidate.ts` by hand. The proof ignores import lines, so tsc and `--noUnusedLocals` are what cover that. The script is scratch and is not a reproducible generator.
- **Import order** in the moved files differs from HEAD; helper-only imports now load through the helper files. The server suite and the fresh-process check both pass.
- **Tests:** no test files were moved or edited. No test imports private paths.

## Known issues, not fixed (behaviour unchanged)

- `visuals/service.ts` has three TS6133 "declared but never read" errors on private methods: `bestCandidate` (line 1075), `findNeighbourWithImage` (1287), `cloneCandidateToScene` (1315). They are declared in HEAD too and were moved verbatim. Repo-wide `--noUnusedLocals` shows 54 TS6133 and 1 TS6138 (`src/storage/references.ts`) outside this change.

## Docs still pointing at the old path (not updated)

- `docs/ARCHITECTURE-TARGET.md:189` and `docs/BLUEPRINT.md:174` describe `services/visualService.ts` as the big file.
- Several `docs/cursor/TASK-*.md` specs refer to `services/visualService.ts` line numbers. Those line numbers no longer match.
- The dynamic imports in `operator/qualityRepair.ts`, `operator/repairActions.ts` and `registry/tools/operator.ts` still use the old path. The facade serves them, so they are fine.

## Next

- Refresh the TASK-080 commit plan and the architecture references once, after this task (not done here).
- User: push, and create `docs/tasks/TASK-085.done` when satisfied.

## Root `npm test`

Result: exit 0. Four suites ran, all passing: 98 files / 788 tests, 7 files / 66 tests, 307 files / 2529 passed + 9 skipped (server), 95 files / 303 tests. Log: scratchpad `task085-root-npm-test.log`. Suite labels were not captured in the log, so the per-package mapping is not recorded here.
