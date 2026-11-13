# TASK-110 — Style system, part 3: convert the other five templates to tokens 🎨

**Who:** Cursor, model `grok-4.7-medium`. The pattern already exists in `list_full`, and a lint plus sample renders check the result. **Size:** M–L. **Order:** after TASK-109. **No DB change.**

Read first:
- `docs/cursor/README.md`
- `docs/architecture/style-system.md`: sections "tokens-v1, using list_full" and "Add a template"
- `apps/server/assets/compose/list_full/index.html`: the reference conversion
- `apps/server/assets/compose/common.js`: `VG.S`, `VG.axis`, `VG.enter`, `VG.alpha`
- `packages/shared/src/style/axes.ts`: `TEMPLATE_MANIFESTS`, `templateTokenLint`
- `docs/tasks/TASK-108.report.md` and `docs/tasks/TASK-109.report.md`

## Why

Only `list_full` reads the style tokens. The other five templates still hold fixed colours, fonts, sizes and motion: `compare`, `quote_full`, `kinetic_text`, `chart` and `map`. So two channels with different style packs still get the same frames in most shots, and the variant picker has nothing to rotate for those templates. Their manifests are `legacy("…")` with only the background axis.

## What to do

Convert the templates **one at a time, in this order**: `compare`, `quote_full`, `kinetic_text`, `chart`, `map`.

Finish each template completely (template, manifest, lint, test, samples) before you start the next. If you run out of time, stop after a finished template. Report which ones are done; the rest becomes a follow-up task.

For each template:

1. **Template** (`apps/server/assets/compose/<id>/index.html`):
   - Colours, type (family, weights, sizes), motion (eases, durations, entrances), spacing and corner radius all come from `VG.S`, exactly as in `list_full`.
   - Keep the numbers left in `list_full` for layout geometry only, and give each a short reason in a comment.
   - Use `VG.enter` for the main elements' entrance.
   - When `variables.style` is missing, behave as `list_full` does (server-side fallback), so old callers and tests still work.
   - `compare` and `kinetic_text` read a shot style string through `v.shotStyle` (line ~13–15). Keep that working: it is the shot's own choice. The tokens decide how a choice looks; they do not replace the choice.
   - Vietnamese diacritics must render (only Be Vietnam Pro is registered). Nothing may be cut off, and text must stay clear of the bottom subtitle zone in 9:16 (use the safe-zone tokens).
2. **Manifest** in `TEMPLATE_MANIFESTS`:
   - `contract: "tokens-v1"` and `version: 2`.
   - At least one own axis (layout or composition) with two or more values that make a visibly different frame, plus `ENTRANCE_AXIS` and `BACKGROUND_AXIS`.
   - Use `families` when a value only suits some layout families, like `list_full`.
   - Content axes (`sourceField`) only where the shot data already has that field.
   - Give the axes ideas that fit the template, for example:
     - `compare`: split vs stacked, or versus badge vs divider
     - `quote_full`: centred vs left with a big quote mark
     - `chart`: card vs full-bleed
     - `map`: pin label style
3. **Lint and tests:**
   - `templateTokenLint` passes on the file.
   - Add the template to the existing lint test, if there is a list.
   - Add a server test that `graphicVariables` for the template passes axes from its manifest.
   - Check that the cache key changes with the axes. The TASK-108 tests probably cover this already; extend them only if they don't.
4. **Samples:**
   - Use the existing "style preset samples" path in `apps/server/test/compose.eval.test.ts`, with `VG_COMPOSE_SAMPLES=1` and `VG_COMPOSE_SAMPLE_ONLY` to narrow it.
   - For each template, render two clearly different presets from `STYLE_PRESETS`, at 16:9 and 9:16.
   - Put the PNGs in `docs/compose/samples/style/<id>/` and look at every one of them yourself.
   - If a frame looks broken, fix that template before moving on. If something is only a taste issue, list it in the report and do not polish it.

## Rules

- No commit or push. No new npm dependency. No migration.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `apps/server/src/pipeline/**`, `apps/server/src/jobs/**`, `apps/server/src/originality/**`, `apps/server/src/publishing/**`, `apps/server/src/style/**` (TASK-109's store).
- In `packages/shared/src/style/`, change only `axes.ts` (manifests). Any other change there must fix a bug, and you list it in the report.
- Do not change `list_full`, except to move a helper into `common.js` when two or more templates need it. Re-render the `list_full` samples after such a move.
- Tests: no network, no real LLM. Sample renders are local HyperFrames only. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- `npm run typecheck` at the root; `npm test` in `packages/shared` and `apps/server`. Failures outside your area: list them with the file.
- Update `docs/architecture/style-system.md`: which templates are tokens-v1 now. Add one line to `docs/user-guide/nhat-ky-thay-doi.md`.
- Write `docs/tasks/TASK-110.report.md` in Vietnamese, at most 50 lines. Include:
  - which templates are converted, and their axes
  - which templates are left, if any
  - where the samples are
  - what looks wrong
  - test results
- Then create the empty `docs/tasks/TASK-110.done`.
