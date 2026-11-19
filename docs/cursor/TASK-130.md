# TASK-130 — Stop narration from repeating at the hook and section seams 🔁

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`). **Size:** S. **Migration:** none. **New dependency:** none.
**Depends on:** nothing. It may run beside any task that does not edit `packages/shared/src/scenes/*` or `apps/server/src/stages/script/*`.
**Source:** Hermes `PROPOSALS_AND_BUGS.md` #17 (BUG-SCRIPT-HOOK-DUP-008).

## Why

In the Berserk project the hook question is read twice in the first 10 seconds:
- Scene 0 (`hook`) and scene 1 (the first section) carry the same sentence.
- The LLM writes `script.hook` and then opens `sections[0].narration` with that same sentence.
- `planScenes` (`packages/shared/src/scenes/planScenes.ts` ~line 225) makes a hook unit and a section unit without comparing them.

The same seam exists at the end: the outro can repeat the last sentence of the last section. Generally, nothing stops two neighbouring scenes from carrying the same sentence.

## Read first

- `packages/shared/src/scenes/planScenes.ts`: `planScenes`, `packUnit`, and `splitSentences` from `./sentences.ts`.
- `apps/server/src/stages/script/prompt.ts`, `mergedStoryPrompt.ts` and `reviewPrompt.ts`: the script prompts and the review pass.
- `apps/server/src/stages/script/scriptUtils.ts`: post-processing of the LLM script.
- The guideline and quality checks that run before render (`guidelines/*`, `operator/qualityGates.ts`). Find where scene-level text checks live.

## Build

1. **A shared seam dedupe in code (no LLM).** Add `dedupeSeams(script, language)` in `packages/shared/src/scenes/` and call it at the start of `planScenes`.
   - **Hook seam:** if the first sentence(s) of `sections[0].narration` repeat `script.hook`, drop them from the section, never from the hook.
   - **Outro seam:** if the outro starts with the last sentence of the last section, drop it from the outro.
   - **Section seams:** if a section's first sentence equals the previous section's last sentence, drop it from the later section.
   - **Matching:** normalise text first (NFC, lower case, collapse whitespace, strip punctuation and quotes, Vietnamese diacritics kept). Two sentences count as equal when they are identical after normalising, or when their token Jaccard similarity is ≥ 0.9 and both have at least 6 words.
   - Never empty a section: if dropping would leave no text, keep it as it is and report it instead.
   - Return the cleaned script plus a list of what was dropped (`{ seam, sectionId, sentence }`). `planScenes` must keep its current signature; expose the drop list through a separate exported helper so callers can log it.
2. **Persist the fix at the source.**
   - In the SCRIPT executor, run the same dedupe on the generated script before saving it, and write one log line per dropped sentence.
   - The saved script and the scenes then agree, and the script editor shows the cleaned text.
3. **Prompt.**
   - Add one rule to the script prompt and the merged-story prompt: the hook is spoken on its own, and section 1 must continue after it without repeating it. Do the same for the outro.
   - Keep the prompt change short; the code dedupe is the guarantee.
4. **Check before render.** Add a check over the final scene list for the same sentence in two neighbouring scenes, using the same matcher.
   - Put it where the other scene text checks run, as a warning with the scene ids.
   - It must not block render on its own.
   - This catches manual edits.
5. **Existing projects.** The scene editor already allows deleting a scene. Add no automatic migration of old projects. Re-running SCRIPT or scene planning applies the dedupe.

## Mã nguồn mở có sẵn (open source)

- No library is needed; this is a few lines of string matching. The Jaccard idea is standard.
- `string-similarity`-style packages exist, but do not add one (rule: no new dependency).

## Rules

- README rules 1–11. Tests are pure; no LLM.
- Do not touch the Berserk project data (`1ef6de1f-…`) or project `56374fb2-…`.
- Keep `planScenes` output identical for scripts with no repeats; snapshot or fixture tests must stay green.

## Tests

- hook repeated as the first sentence of section 1 → dropped from section 1; the hook is kept;
- hook repeated with different punctuation, quotes or casing → dropped;
- near-duplicate (Jaccard ≥ 0.9, ≥ 6 words) → dropped; a short 3-word repeat → kept;
- the outro repeats the last section's last sentence → dropped from the outro;
- section N+1 opens with section N's last sentence → dropped;
- a section made only of the repeated sentence → kept, and reported;
- no repeats → `planScenes` output unchanged (existing tests);
- the pre-render check flags two neighbouring scenes with the same sentence, as a warning only.

## Done

- [ ] `dedupeSeams` + call in `planScenes` + SCRIPT executor
- [ ] prompt lines; pre-render warning
- [ ] tests; shared + server suites; typecheck; build `@vg/shared`
- [ ] changelog line in `docs/user-guide/nhat-ky-thay-doi.md`, and a status line under #17 in `PROPOSALS_AND_BUGS.md`
- [ ] report → `docs/tasks/TASK-130.done`
