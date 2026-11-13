# TASK-085 — Split the three big files (no behaviour change) ✂️

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** M. **Migration:** none. A `drizzle-kit generate` run must print "No schema changes". **New dependency:** none.
**Runs alone.** No other session may edit server code while this runs, because it touches files every task touches. Start it only when no other task is in flight. The user commits the result before the next task starts.

## Why

`docs/ARCHITECTURE-TARGET.md` §7 says three files are too big for agents:
- they grep them, edit the wrong place, and two tasks cannot add tools or tables at the same time;
- every G2–G5 task adds tables and tools, so this split comes first.

| File | Lines now | Target |
|---|---|---|
| `apps/server/src/services/visualService.ts` | ~3 380 | `apps/server/src/visuals/` split by filter step |
| `apps/server/src/assistant/tools.ts` | ~2 100 | `apps/server/src/registry/tools/<group>.ts` |
| `apps/server/src/db/schema.ts` | ~1 930 | `apps/server/src/db/schema/<domain>.ts` |

## Read first

- `docs/ARCHITECTURE-TARGET.md` §4 (tool groups) and §7 (target modules).
- `apps/server/drizzle.config.ts`: where drizzle-kit finds the schema.
- `apps/server/src/registry/{invoke,policy,audit}.ts`: how the tools are collected. Also every `*ToolDefs` array that `assistant/tools.ts` already spreads in (for example `originality/toolDefs.ts`).
- `apps/server/test/agentSkillPack.test.ts` and any test that counts or lists tools.

## Build

1. **`db/schema/`**
   - Move each table into a domain file: `profiles.ts`, `publishing.ts`, `pipeline.ts` (projects, jobs, stages, scenes, voice, subtitles, renders, …), `visuals.ts`, `llm.ts`, `operator.ts`, `finance.ts`, `knowledge.ts`, `auth.ts` (the Better Auth tables and teams), `nodes.ts`, `style.ts`, `misc.ts`.
   - `db/schema/index.ts` re-exports everything. Keep `db/schema.ts` as a one-line `export * from "./schema/index.js"`, so no import elsewhere has to change.
   - Point `drizzle.config.ts` at the new folder, either the glob or the index, whichever drizzle-kit reads correctly.
   - Run `npx drizzle-kit generate`. It **must** print "No schema changes". If it wants to create or drop anything, the move is wrong; fix it and do not keep any SQL it made.
2. **`registry/tools/`**
   - One file per group from ARCHITECTURE-TARGET §4, for tools that exist today: `observe`, `projects`, `pipeline`, `visuals`, `publishing`, `analytics`, `finance`, `operator`, `knowledge`, `settings`, `help`, and others as needed.
   - Each file exports an `AssistantToolDef[]` with `risk` and the grant next to each tool, as they are now.
   - `registry/tools/index.ts` concatenates them in the **current order**; the tool order is visible to LLMs and in snapshots.
   - Keep `assistant/tools.ts` as a thin re-export.
   - Add a test: the tool name list after the split equals the list before, in order, by a snapshot taken before you start.
3. **`visuals/`**
   - Split `visualService.ts` by step: `query.ts`, `relevance.ts`, `vision.ts`, `license.ts`, `assign.ts`, `dedupe.ts`, `gate.ts`, `crop.ts` if crop code lives there, and `service.ts`, which only orchestrates.
   - Pure helpers go to the step file, shared types go to `visuals/types.ts`.
   - `services/visualService.ts` re-exports `VisualService` and the public helpers, so imports keep working.
   - Move code. Do not rewrite it, and do not rename public functions.
4. Move the matching tests only if they import private paths. Prefer leaving the tests untouched; untouched passing tests are the proof that behaviour did not change.

## Mã nguồn mở có sẵn (open source)

- Nothing to adopt; this is a move. drizzle-kit supports a schema split across files (`schema: "./src/db/schema"` folder or a glob); see the drizzle-kit config docs.
- If a codemod tool such as `ts-morph` (MIT) is already in `node_modules`, you may use it from a scratch script outside the repo to move declarations. Do not add it as a dependency.

## Rules

- README rules 1–11 apply. No behaviour change: no logic edits, no renamed exports, no new features. If you spot a bug, list it in the report and leave it.
- Do not touch `node/*`, `jobs/worker.ts` logic or `api/*`, except import paths.

## Tests

- The full server, shared, web and mcp suites pass with the **same counts** as before. Record the counts before and after in the report.
- The tool-order snapshot test is new.
- `npx drizzle-kit generate` prints "No schema changes".

## Done

- [ ] `db/schema/` + config; drizzle-kit shows no change
- [ ] `registry/tools/` + order snapshot test
- [ ] `visuals/` split; the old paths re-export
- [ ] typecheck; all suites with the same counts
- [ ] `docs/architecture/` note listing where each group now lives. The user guide is untouched, since nothing the user sees changes.
- [ ] report `docs/tasks/TASK-085.report.md`, then `docs/tasks/TASK-085.done`
