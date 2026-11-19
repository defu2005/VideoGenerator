# TASK-130 Report: Stop narration from repeating at the hook and section seams

Not committed, not pushed (AGENTS.md rule). No migration, no new dependency.
Protected projects untouched (`56374fb2-54cf-48ff-9441-2e6c653295d4` and Berserk `1ef6de1f-cf84-4552-8aed-8958f290bc0e`).

## What changed

1. **Shared seam deduplication logic (`packages/shared/src/scenes/dedupeSeams.ts`)**:
   - `normalizeSentence(text)`: NFC Unicode normalization, lower case, collapse whitespace, strip punctuation and quotes, keeping Vietnamese diacritics.
   - `tokenJaccard(tokensA, tokensB)`: token Jaccard similarity across whitespace-tokenized words.
   - `areSentencesEqual(a, b)`: identical after normalization, or token Jaccard >= 0.9 and both sentences >= 6 words.
   - `dedupeSeams(script, language)`:
     - **Hook seam:** drops initial sentence(s) of section 0 that repeat `script.hook`, never drops from the hook.
     - **Section seams:** drops section `i`'s first sentence if it equals section `i-1`'s last sentence.
     - **Outro seam:** drops outro's first sentence if it repeats the last section's last sentence.
     - **Section protection:** if dropping would leave a section with no text, keeps it as is and reports it with `{ action: "kept", reason: "would_empty_section" }`.
     - Returns `{ ...cleanedScript, script: cleanedScript, dropped, reports }` supporting both destructuring and direct script usage without changing `planScenes` signature.
   - Exported helpers: `getSeamDrops(script, language)` and `getSeamReports(script, language)`.
   - Pre-render check: `checkNeighbouringSceneDuplicates(scenes, language)` and alias `preRenderCheck`.

2. **Integration in scene planning (`packages/shared/src/scenes/planScenes.ts`)**:
   - Calls `dedupeSeams(script, settings.language)` at the start of `planScenes`.
   - Re-exports `dedupeSeams`, `getSeamDrops`, `getSeamReports`, `checkNeighbouringSceneDuplicates`, `preRenderCheck`.

3. **Re-export in `@vg/shared` index (`packages/shared/src/index.ts`)**:
   - Re-exports `./scenes/dedupeSeams.js`.

4. **Integration in SCRIPT executor (`apps/server/src/stages/script/scriptExecutor.ts`)**:
   - In both merged-story early return and final save paths, runs `dedupeSeams` on the generated script and recalculates section durations.
   - Writes one info log line per dropped sentence (`Dropped duplicate narration sentence at ...`).

5. **Prompt rules (`apps/server/src/stages/script/prompt.ts` & `mergedStoryPrompt.ts`)**:
   - Added concise instruction: "The hook is spoken on its own: section 1 must continue after it without repeating it. The outro must conclude the video without repeating the last section."

6. **Pre-render check in quality gates and guidelines**:
   - `apps/server/src/operator/qualityGates.ts`: added `preRenderSceneCheck(sqlite, projectId, language)` and re-exported `checkNeighbouringSceneDuplicates` & `preRenderCheck`.
   - `apps/server/src/guidelines/service.ts`: added pre-render check in `runCodeChecks(project, "TIMELINE")` reporting duplicate neighbouring sentences with `severity: "SHOULD"` (warning, non-blocking).
   - `apps/server/src/services/renderService.ts`: added `warnDuplicateNarration(project, issues)` checking neighbouring scene duplicates with `code: "DUPLICATE_NARRATION"`, `severity: "WARN"`.
   - `packages/shared/src/schemas/render.ts` & `apps/web/src/features/render/RenderPanel.tsx`: added `DUPLICATE_NARRATION` render issue code and UI label.

7. **Documentation**:
   - `docs/user-guide/nhat-ky-thay-doi.md`: added `## TASK-130` entry.
   - `PROPOSALS_AND_BUGS.md`: updated status under item 17 (BUG-SCRIPT-HOOK-DUP-008).

## Tests

- `packages/shared/test/dedupeSeams.test.ts` (11 new tests):
  - Normalization with NFC, lower case, whitespace collapsing, punctuation and quote removal (Vietnamese diacritics preserved).
  - Hook repeated with different punctuation, quotes or casing → dropped.
  - Near-duplicate (Jaccard >= 0.9, >= 6 words) → dropped; short 3-word repeat (< 6 words) → kept.
  - Hook repeated as first sentence of section 1 → dropped from section 1; hook kept.
  - Outro repeats last section's last sentence → dropped from outro.
  - Section N+1 opens with section N's last sentence → dropped.
  - Section made only of repeated sentence → kept, and reported.
  - Helpers `getSeamDrops` and `getSeamReports` work as expected.
  - No repeats → `planScenes` output completely unchanged.
  - Hook repeat in `planScenes` automatically deduped.
  - Pre-render check flags two neighbouring scenes with the same sentence as a warning only.
- `apps/server/test/autonomyGates.test.ts` (13 passed, 1 new test for pre-render scene duplicate warning).
- `apps/server/test/researchScript.test.ts` (21 passed, 1 new test for SCRIPT executor deduplication & log).
- `packages/shared/test/planScenes.test.ts` (12 passed).
- `packages/shared/test/sentences.test.ts` (24 passed).
- `packages/shared/test/guidelines.test.ts` (6 passed).
- `apps/server/test/scenePlan.test.ts` (5 passed).
- `apps/server/test/timeline.test.ts` (5 passed).
- `apps/server/test/guidelines.test.ts` (5 passed).
- Full `packages/shared` suite: 92 test files, 752 passed.
- Full `apps/mcp` suite: 1 test file, 22 passed.
- `npm run typecheck` across all 4 workspaces (`packages/shared`, `apps/mcp`, `apps/server`, `apps/web`): 0 errors.

## Deviations from the spec

None. All requirements in `TASK-130.md` were implemented as specified.

## What is not done

Existing old project data (such as Berserk project `1ef6de1f-...`) was not automatically migrated in the DB per requirement ("Add no automatic migration of old projects. Re-running SCRIPT or scene planning applies the dedupe").
