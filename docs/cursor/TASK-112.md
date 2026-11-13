# TASK-112 — Style 5: the director reads genre packs instead of recipe ids 🎬

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M. **Migration:** none. **New dependency:** none.

## Why

TASK-106 defined genre packs (`packages/shared/src/style/genre.ts`), where a genre is data:
- the shot kinds it enables or forces;
- its templates per kind and its opening style;
- its pacing and LLM notes.

`genreDirectives(pack)` flattens all of that for the director, but the director still hard-codes recipe ids:
- `apps/server/src/compose/director/kinds070.ts:84` checks `recipeId !== "explainer" && recipeId !== "news_recap"`;
- `kinds070.ts:136` checks `"myth_vs_fact"`, and `kinds070.ts:222` checks `"listicle"` / `"how_to"`;
- `director/rules.ts:181–182` checks `"listicle"` and `"short_hook"`.

So adding a genre still needs code. After this task, a new genre is one `GenrePack` entry.

The per-shot style variants (`packages/shared/src/style/picker.ts`) also pick by rules only. In QUALITY mode, the director's existing single LLM call may choose among `variantOptions`.

## Read first

- `packages/shared/src/style/genre.ts`: `GenrePackSchema`, `GENRE_PACKS`, `genreDirectives`, `directivesForRecipe` (unknown ids behave like `explainer`).
- `apps/server/src/compose/director/{index,rules,kinds070,llm,labels}.ts` and `compose/director.ts`.
- `packages/shared/src/style/picker.ts`: `pickVariants`, `variantOptions`, `applyVariantChoices`; and `compose/render/graphicStyle.ts`, where the picks are used today.
- `apps/server/src/compose/eval/runEval.ts`: the director eval. This task must not lower its scores.
- TASK-067b and TASK-070 reports, for why each rule exists.

## Build

1. **Directives in, ids out.**
   - Build `GenreDirectives` once per project, from the project's recipe id via `directivesForRecipe`, plus any profile-level genre pack if one is stored.
   - Pass the directives into every director function that today receives `recipeId`.
   - Replace each id check with the directive that means the same thing:

     | Today | After |
     |---|---|
     | explainer/news_recap gate for map and compare | `!directives.disabledKinds.includes(kind)` plus the textual trigger, and `forcedKinds` skips the trigger |
     | `myth_vs_fact` compare fallback | a genre flag. Add `compareFallback: boolean` to `GenrePack.director` with default false and set it true for `myth_vs_fact`. Schema change in shared, backward compatible |
     | listicle/how_to list kinds | `listOpening` and the `list_full` enabled or forced flags |
     | listicle `list` / `short_hook` hook | `listOpening` / `hookEveryScene` |
   - Template choice per kind comes from `directives.templates[kind][0]` unless the variant picker chooses another one in the list.
   - Pacing comes from `directives.pacing`.
   - `llmNotes` go into the director's LLM prompt.
   - After the change, `grep -rn 'recipeId ===\|recipeId !==' apps/server/src/compose` returns nothing outside tests and eval fixtures. Add that grep as a test.
2. **Equivalence first.** Before changing any code, freeze the director's output for all eval fixtures and for each built-in genre, as a snapshot. After the change, the snapshots must be identical. If one differs, it is a bug, unless the report explains it as a fix.
3. **QUALITY variant choice.**
   - In QUALITY budget mode only, add the `variantOptions` (at most 4 per shot) to the director's **existing** single LLM call, as an optional field in its output schema.
   - Apply the answer with `applyVariantChoices`. Invalid or missing choices keep the rule pick.
   - Add no new LLM call. ECO and BALANCED keep `pickVariants` alone.
   - Record in the compose plan which shots used an LLM choice.
4. **A new genre is data.** Add one example genre pack that has no code path today, for example `top_facts` or `documentary_calm`. Prove with a test that the director honours it with no code change.

## Mã nguồn mở có sẵn (open source)

- Nothing new to adopt. This is a refactor of our own rule engine to data-driven directives. The idea matches the "config over code" pattern used by **Remotion templates** and **Motion Canvas** scenes. Nothing to copy.

## Rules

- README rules 1–11. Do not change the templates or `tokens-v1`. Do not edit `visuals/` or the TASK-125 and TASK-119 files.
- The eval score in `runEval.ts` must not drop. Put the before and after numbers in the report.

## Tests

- the snapshot equivalence for every built-in genre plus the eval fixtures;
- the grep test;
- the new genre pack works without code changes;
- QUALITY: valid choices are applied, invalid choices fall back, and ECO makes no extra prompt field;
- `compareFallback` keeps the `myth_vs_fact` behaviour.

## Docs

`docs/architecture/style-system.md`: "Thêm một thể loại", which says a genre is data, with the fields. Add a changelog line; the user guide only needs a line if a user-visible genre was added.

## Done

- [ ] directives replace every recipe id check; grep test
- [ ] snapshot equivalence; eval not lower
- [ ] QUALITY variant choice inside the existing LLM call
- [ ] example data-only genre
- [ ] typecheck, server and shared suites
- [ ] report `docs/tasks/TASK-112.report.md`, then `docs/tasks/TASK-112.done`
