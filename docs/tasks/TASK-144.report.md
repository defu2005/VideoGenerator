# TASK-144 report (script quick wins)

For Claude (Opus), the architect. Nothing committed or pushed.

## What changed
- **Shared**: `packages/shared/src/script/lint.ts` (`lintNarration`, `NARRATION_LINT_THRESHOLDS`, types), `cliches.vi.ts`, `cliches.en.ts`, exported from `src/index.ts`. Fixtures in `src/script/__fixtures__/scripts.ts`, tests in `src/script/lint.test.ts` (8).
- **Server prompts**: new `stages/script/narrationRules.ts` (7 rules, `WRITER_SYSTEM`). `prompt.ts` adds `projectRecipe` and `formatGuidance` (per-section `key — nameVi: purposeVi (≈share)`, `hookStyles`, `readingLevelVi`, `descriptionVi`). `mergedStoryPrompt.ts` and `reviewPrompt.ts` use both. `reviewPrompt.ts` rewritten around storytelling criteria (hook, recipe purpose, concrete scenes, open loops, outro payoff, TTS, length last); notes must name the section id; JSON shape unchanged.
- **Executor** (`scriptExecutor.ts`): `fix` findings go to the review prompt as "Problems found by the checker; fix each one". Leftovers after the last pass are saved as `[lint] CODE (section): message` (max 3, 8-note cap kept). Runs with review off, no extra LLM call.
- **Tests**: `apps/server/test/scriptLint.test.ts` (3 new): guidance for story/explainer, lint reaches the review prompt and `[lint]` notes saved, review off still lints with unchanged call count.
- **Docs**: ARCHITECTURE.md section, user guide "Bộ kiểm tra kịch bản" (`du-an-va-quy-trinh.md#kiem-tra-kich-ban`), new `featureMap` entry `script-lint`, changelog TASK-144, `video-du-an-va-pipeline` skill.

## Test results
- shared: 97 files / 781 tests pass; `tsc --noEmit` clean; build OK; `userGuide.test.ts` and web `guideCoverage.test.ts` pass.
- server: script/research/scriptApi/scriptRevision/scriptLint green (researchScript 21, scriptLint 3). Full server run: 1536 pass, 4 fail. Isolated reruns: `assistant`, `guidelines` and the timeouts in `preview`/graphic tests pass or are load/time related. The persistent failure is `agentSkillPack.test.ts` (an uncovered registry tool from other in-flight work, not this task). `tsc` in server reports one error in `src/pipeline/dataContract.ts:77` (file untouched by me, from other uncommitted work).

## Deviations
- Two existing assertions in `researchScript.test.ts` (QUALITY, CUSTOM merged) and one `review_notes` null check (QUALITY-review-fails test) were updated to expect a `[lint] LONG_SENTENCE` note, because the mock script has a very long sentence.
- The reviewer system prompt keeps the words "script editor" (an existing test matches `/script editor/i`).
- The early merged-source path (script supplied from source) is not linted.
- Cliché lists are our own wording; thresholds are first guesses.

## Open source
Ideas only from jtydhr88/screenwriting-skills and danjdewhurst/story-skills (both MIT). No code or text copied; attribution in the `narrationRules.ts` header. video-talkcraft has no licence, so nothing was taken.
