# Module split (TASK-085)

Three large files were split with no behaviour change. Old paths still work: each one is now a facade that re-exports from the new location, so the importers did not change.

## Where things live now

| Old file | New location | What moved |
|---|---|---|
| `apps/server/src/db/schema.ts` | `apps/server/src/db/schema/` | Tables by domain: `profiles`, `publishing`, `pipeline`, `visuals`, `llm`, `operator`, `finance`, `knowledge`, `auth`, `nodes`, `style`, `misc`. `index.ts` re-exports all of them. `schema.ts` is a one-line `export * from "./schema/index.js"`. `apps/server/drizzle.config.ts` points at `./src/db/schema/index.ts`. |
| `apps/server/src/assistant/tools.ts` | `apps/server/src/registry/tools/` | Tool definitions in group files: `projects`, `overview`, `topicsAutomation`, `pipelineActions`, `growth`, `operator`, `skills`, `system`. `define.ts` holds the tool types and `defineTool`. `shared.ts` holds two schemas used by more than one group. `index.ts` concatenates the groups in the original order and holds the registry tail (`ASSISTANT_TOOLS`, `ALWAYS_CONFIRM_TOOLS`, `runTool`, and related). `define.ts` and `shared.ts` are not tool groups. `assistant/tools.ts` is a facade. |
| `apps/server/src/services/visualService.ts` | `apps/server/src/visuals/` | `service.ts`: the `VisualService` class, moved verbatim. `types.ts`: types, constants and small helpers used by the other files (`parseJson`, `createSearchStats`, `parseCheckpoint`, `isProtectedSelection`, and others). `query.ts`: query normalisation and simplification. `candidate.ts`: candidate normalisation, licences, download URLs, `resolveFeatures`. `download.ts`: download error classification (`isRetryableDownloadError`). `services/visualService.ts` now re-exports `VisualService` and `isRetryableDownloadError`. |

## What is not split yet

- **The `VisualService` class is not split by filter step.** The spec's step files (`relevance.ts`, `vision.ts`, `license.ts`, `assign.ts`, `dedupe.ts`, `gate.ts`, `crop.ts`) do not exist. The class is one file of about 3,400 lines, and `executeStage` alone is about 1,000 lines inside it. Splitting that method needs a logic-level change, which this task excludes.
- **The tool group names** follow the current grouping in `registry/tools/`, not the example list in the spec (`observe`, `publishing`, `analytics`, `finance`, `knowledge`, `settings`, `help`). Those groups do not exist as files yet.

## Rules for the next change

- Edit the file that owns the code: a table in `db/schema/<domain>.ts`, a tool in its group file under `registry/tools/`, a helper in `visuals/`.
- Do not add tools or tables through the facades (`db/schema.ts`, `assistant/tools.ts`, `services/visualService.ts`). They only re-export.
- Tool order is visible to the LLM. Keep `registry/tools/index.ts` in its current order when adding a group. When you add a tool, also add its name to the expected list in `apps/server/test/toolOrder.test.ts`, on purpose.
- Schema changes still need a migration. `drizzle-kit generate` prints "No schema changes" for this split.
