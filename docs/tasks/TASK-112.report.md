# TASK-112 report — Style 5: the director reads genre packs instead of recipe ids

## Done
- `GenreDirectives` is built once per project (`planProject`: `input.directives ?? directivesForRecipe(recipeId, genres)`) and attached to every `DirectorInput`. Every recipe-id check in `compose/director/{rules,kinds070}.ts` and `composeService.ts` now reads `disabledKinds`, `forcedKinds`, `compareFallback`, `listOpening`, `hookEveryScene`, `templates[kind][0]` or `pacing`. `llmNotes` and the per-kind rules go into the director prompt. A grep test fails if `recipeId ===` / `!==` returns under `src/compose` (eval fixtures excluded).
- `myth_vs_fact` keeps its behaviour through the new data field `director.compareFallback` (default false) plus `compare.force`; a piece-level test proves it.
- QUALITY only: the director's single LLM call may carry an optional `variants` field built from `variantOptions` (rule pick first, at most 4 per shot). Valid letters go through `applyVariantChoices` at render time; invalid, unknown or missing answers keep the rule pick. ECO and BALANCED have no hook, no extra prompt field, and keep `pickVariants` alone. The compose plan records the choices in the additive optional `llmVariantChoices`.
- Data-only example genre `top_facts` (no recipe of its own) changes the plan through its directives only, proven by test; a second ad-hoc pack (`documentary_calm`) is parsed in a test with no code change.
- Docs: `docs/architecture/style-system.md` "Add a genre" rewritten; changelog line in `docs/user-guide/nhat-ky-thay-doi.md`.

## Eval, before / after
Equivalence snapshots (`apps/server/test/__snapshots__/genreDirector.test.ts.snap`) were frozen on the unmodified director, then compared after the change.
- 7 recipe-id genres and 12 eval fixtures: identical (shot kinds, reasons, stats).
- 6 snapshots (history, finance, travel, two scenes each) changed on purpose: those are genre-pack ids, not recipe ids, which the old director ignored and treated as explainer. Now their packs apply. This is the intended fix, not a regression.
- Eval stats unchanged for the equivalent set, so the `runEval.ts` score is not lower.

## Files
shared: `style/genre.ts`, `style/genre.test.ts`, `compose/schema.ts`, `compose/index.ts`.
server: `compose/director.ts`, `compose/director/{kinds070,rules,llm,index}.ts`, `compose/composeService.ts`, `compose/render/graphicStyle.ts`, `services/composeBridge.ts`, `services/renderService.ts`; tests `test/genreDirector.test.ts`, `test/genreDirectives.test.ts`, `test/helpers/genreFixtures.ts`, `test/__snapshots__/genreDirector.test.ts.snap`.
docs: as above. No migration, no new dependency.

## Tests
shared 739 pass (91 files). server 1207 pass, 6 skipped (136 files, 2 skipped). server `tsc --noEmit` clean. Web and mcp not touched by code changes.

## Deviations
- Unknown ids and genre-pack ids are now honoured through directives (see the 6 changed snapshots).
- Pacing falls back to `directives.pacing.preset` when `settings.edit.preset` is absent.
- `forcedKinds` for compare stays as data; `compareFallback` drives the fallback.
- Additive shared fields: `GenrePack.director.compareFallback`, `ComposePlan.llmVariantChoices`.
- Variant options are keyed by proxy ids `${sceneId}#${n}` before shots exist and are validated again at render.

## Not done
- No live QUALITY run against a real LLM (tests never use the network).

## Open source findings
None.
