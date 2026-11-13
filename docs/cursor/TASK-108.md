# TASK-108 — Style system, part 1: wire it into the render, write the design, prove it

**Who:** Cursor, model `grok-4.7-xhigh` (it touches the render contract between server and templates). **Size:** M. **Order:** now, before anything else in compose. **No DB change** in this task.

Read first: `docs/cursor/README.md`, `docs/cursor/TASK-106.md` (the original brief), then the code Fable left in `packages/shared/src/style/` (start with `index.ts`, `resolve.ts`, `picker.ts`, `axes.ts`).

## Where things stand

Fable built the core of TASK-106 and then ran out of budget before finishing:

- **Done, with 56 passing tests:** `packages/shared/src/style/`:
  - tokens and patches (`tokens.ts`)
  - palette roles with contrast checks (`palette.ts`, `color.ts`)
  - font registry (`fonts.ts`)
  - versioned style packs, 3 ways to create one, and presets (`pack.ts`)
  - the layered resolver, base → genre → pack → video → shot (`resolve.ts`)
  - template manifests and variation axes (`axes.ts`)
  - the seeded variant picker with rotation (`picker.ts`)
  - genre packs that wrap `formats/recipes.ts` (`genre.ts`)
  - the visual sameness score (`sameness.ts`)
- **Done:**
  - `apps/server/assets/compose/common.js` reads `variables.style` (`VG.S`, `VG.axis`, `VG.enter`, `VG.alpha`).
  - `list_full/index.html` is converted to tokens and axes ("contract tokens-v1").
- **Missing:**
  - no `docs/architecture/style-system.md`
  - no sample renders
  - no report or Cursor split plan
  - **nothing on the server passes `variables.style`**
- **Urgent bug:** `list_full/index.html` line 21 does `if (!S) throw new Error("list_full needs variables.style")`. Every real render of a `list_full` shot fails today. Fix this first.

## What to do

1. **Pass the style to every template** (`apps/server/src/compose/render/graphicVars.ts` and `graphic.ts`, plus `context.ts` if the context needs new fields).
   - **Resolve the style** once per video:
     - `genre`: `genrePack` for the project's format recipe id, through `directivesForRecipe` or `genrePack`. Use its `style` patch.
     - `pack`: no DB yet, so build it with `stylePackFromBrand({ id: "project:"+projectId, name: "brand", colors: [brandColor, accentColor] })` when a brand colour exists, otherwise null.
     - `video` and `shot`: null for now.
     - Call `resolveStyle(layers, { width, height })`.
   - **Pick variants** once per video with `pickVariants`:
     - Pass seed `${profileId ?? "none"}|${projectId}`, the graphic shots, `tokens`, `aspect` and `packSeed`.
     - There is no history yet (empty), so rotation across videos starts working when a later task stores looks.
     - A value already fixed on the shot is kept; the picker does this, so check it.
   - **Pass the result** to every graphic template as `variables.style = templateStyle(resolved, pick.axes)`. Templates that are not converted ignore it.
   - **Remove the throw in `list_full`.** Keep the template working even when `style` is missing (direct callers, old tests): fall back to `templateStyle(resolveStyle({}, frame))` on the server side, or a safe default in the template. Say which in the report.
   - **Cache key:** the per-shot graphic cache key must include the style fingerprint and the axes, so a style change re-renders the shot and an unchanged style reuses the cache.
   - **Keep the old fields working:** do not remove `brandColor`, `accentColor` or `colors` while other templates still read them.
2. **Write `docs/architecture/style-system.md`** from the code (English, ~200 lines max). Cover:
   - the data model (point to the zod schemas, do not copy them)
   - the resolution order
   - the module map
   - how a template consumes tokens and declares axes (the tokens-v1 contract, using `list_full` as the example)
   - how to add a genre (data only) and a template
   - the import rule for third-party HyperFrames blocks (licence allowlist in `axes.ts`, attribution, token lint)
   - the DB needs for later: a `style_packs` table with versions, a profile → pack link, a per-video look history row for rotation and sameness. Describe them only; no migration here.
   - the integration points for the director and originality
3. **Prove it:**
   - Render `list_full` with `VG_COMPOSE_SAMPLES=1` (the existing sample path) twice, with two clearly different presets from `STYLE_PRESETS`, at 16:9 and 9:16.
   - Put the PNGs in `docs/compose/samples/style/` and look at them yourself. Both must read well: Vietnamese diacritics intact, nothing cut off, text clear of the bottom subtitle zone in 9:16.
   - If something looks wrong, list it in the report; do not polish other templates.
4. **Tests:**
   - server tests for the style that `graphicVariables` passes (present; changes with the pack; same seed gives same axes)
   - the cache key changing with the style
   - `list_full` without style no longer failing

## Rules

- No commit or push. No new npm dependency. No migration.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `apps/server/src/pipeline/**`, `apps/server/src/jobs/**`, `apps/server/src/originality/**`, `apps/server/src/publishing/**`.
- Do not convert other templates in this task. Change `packages/shared/src/style/` only to fix a bug you find; list each change in the report.
- Tests: no network, no real LLM, no real browser in unit tests. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- `npm run typecheck` at the root; `npm test` in `packages/shared` and `apps/server`. Failures outside your area: list them with the file.
- Also add a test for TASK-107: a `recheck` that throws during a timeline build and a render. The step still succeeds and a warning is logged (TASK-107 left this out).
- Write `docs/tasks/TASK-108.report.md` in Vietnamese, at most 50 lines:
  - what is wired
  - the cache key change
  - where the samples are
  - what looks wrong
  - test results
- Then create the empty `docs/tasks/TASK-108.done`.
