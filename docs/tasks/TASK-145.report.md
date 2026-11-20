# TASK-145 report (Story engine: outline → hook candidates → narration → critic → targeted rewrite → length fit)

For Claude (Opus), the architect. Nothing committed or pushed.

## What changed
- **Shared types and budget features**:
  - `packages/shared/src/schemas/script.ts`: Added `StoryBeatSchema`, `StoryLoopSchema`, `StoryOutlineSchema`, `HookCandidateSchema`, `HookAssessmentSchema`, `ScriptCritiqueIssueSchema`, `ScriptCritiqueSchema`, `ScriptDraftSchema`, and `ScriptDraftPayloadSchema`.
  - `packages/shared/src/budget/modes.ts`: Added `storyEngine: "off" | "lite" | "full"` with defaults (`ECO: "off"`, `BALANCED: "lite"`, `QUALITY: "full"`, `MAX: "full"`). Added LLM call bound estimators for the story engine passes.
  - `packages/shared/src/llm/tasks.ts`: Added 5 new LLM tasks (`storyOutline`, `scriptCritic`, `scriptRewrite`, `scriptLengthFit`) mapped under the `script` task tier, updated `LLM_TASKS` catalog to 42 items.
  - `packages/shared/src/modelEval/storyEngineFixtures.ts`: Exported benchmark fixtures across explainer, story, and listicle formats.
- **Server Story Engine & Executor**:
  - `apps/server/src/stages/script/storyEngine.ts`: Implemented complete multi-step story engine:
    1. `storyOutline`: Generates narrative framework, central question, promise, beats with concrete moments and open loops, and 3 candidate hooks with tactics.
    2. `assessHooks` & hook selection: Evaluates curiosity, clarity, accuracy, audience fit, and promise payoff; balances against channel hook history to prevent repeated tactics.
    3. `draftNarration`: Generates section narration adhering directly to planned beats and loops.
    4. `critiqueScript`: Independent 6-criterion evaluation (structure, hook, accuracy, TTS naturalness, visualizability, originality) normalized to 100 points, flagging unclosed loops or unfulfilled promises.
    5. `targetedRewrite`: Surgically revises only failing sections (max 1 pass for lite, 2 for full), preserving passing sections and smoothing seams.
    6. `fitScriptLength`: Proportional length compression/expansion if narration deviates >15% from target duration.
    7. Graceful fallback to classic script generation if outline generation fails.
  - `apps/server/src/stages/script/scriptExecutor.ts`: Integrated story engine into stage execution, persistence to `script_drafts` table, and fallback note logging.
- **Persistence & Migration**:
  - `apps/server/src/db/schema.ts`: Defined `scriptDrafts` table storing outline, candidate hooks, chosen hook, critique, critique history, input hash, and staleness flag.
  - `apps/server/drizzle/0087_right_catseye.sql` & journal: Journaled migration for `script_drafts`.
- **Services & API**:
  - `apps/server/src/services/scriptService.ts`: Added `getScriptDraft`, `switchHook` (updates hook and rewrites section 1 to match), and `rescoreScript` (on-demand critic re-evaluation).
  - `apps/server/src/api/script.ts`: Fastify endpoints for `GET /api/projects/:id/script`, `POST /api/projects/:id/script/hook`, and `POST /api/projects/:id/script/critique`.
- **MCP & Assistant Tools**:
  - Added MCP tools in `apps/mcp/src/tools.ts`: `get_script_draft`, `switch_script_hook`, `rescore_script`.
  - Added assistant tools in `apps/server/src/assistant/tools.ts`: `get_script_draft`, `switch_script_hook`, `rescore_script` with appropriate permissions in `routePermissions.ts` and `toolActions.ts`.
- **Web UI**:
  - `apps/web/src/features/script/ScriptDraftPanel.tsx`: Full interactive draft panel displaying narrative framework, promise, beats (with anchor scrolling to section editors), 3 hook candidates with comparative scores, critique rubric breakdown (total / 100, 6 dimensions, unclosed loops, unfulfilled hook warning), and actions to switch hooks or rescore.
  - Integrated into `apps/web/src/features/script/ScriptTab.tsx` and linked with section anchors in `ScriptEditor.tsx`.
- **CLI Benchmark**:
  - `apps/server/src/cli/benchScript.ts`: CLI benchmark runner comparing baseline script vs story engine across fixtures.
- **Docs & Skills**:
  - `docs/ARCHITECTURE.md`: Added "Story Engine (TASK-145)" technical architecture section.
  - `docs/user-guide/du-an-va-quy-trinh.md`: Added user guide section `### Kịch bản: dàn ý, hook và chấm điểm {#dan-y-hook-cham-diem}`.
  - `packages/shared/src/features/featureMap.ts`: Added `story-engine` entry.
  - `docs/user-guide/nhat-ky-thay-doi.md`: Added changelog entry for TASK-145.
  - `.agents/skills/video-stage-kich-ban/SKILL.md`: Extended with draft tools, critique rubric interpretation, hook switching, rescore handling, and escalation rules.
  - `.agents/skills/video-van-hanh-app/SKILL.md`: Updated quick index table.

## Test results
- `npm run typecheck`: Green (0 errors) across all monorepo workspaces (`@vg/shared`, `@vg/mcp`, `@vg/server`, `@vg/web`).
- `@vg/shared`: 97 test files / 781 tests pass (`npm test -w @vg/shared`).
- `@vg/mcp`: 3 test files / 49 tests pass (`npm test -w @vg/mcp`).
- `@vg/web`: `ScriptDraftPanel.test.tsx` and `ScriptTab.test.tsx` pass (10 tests).
- `@vg/server`: `storyEngine.test.ts` (3 tests), `scriptLint.test.ts` (3 tests), `researchScript.test.ts` (21 tests) pass.

## Open source attribution
Concepts and structure derived from:
- `jtydhr88/screenwriting-skills` (MIT): Narrative framework taxonomy and outline decomposition.
- `danjdewhurst/story-skills` (MIT): Open loop tracking, setup/payoff continuity, and 6-dimension critic rubric.
Attribution comments preserved in `apps/server/src/stages/script/storyEngine.ts` and `narrationRules.ts`.
