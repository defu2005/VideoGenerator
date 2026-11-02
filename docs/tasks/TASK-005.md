# TASK-005 — Scene Plan (deterministic) + Scene Board UI

## GOAL
Replace the fake SCENE_PLAN executor with a real one that turns the script into an ordered list of **scenes** (narration chunk, timing, visual requirement, image search queries, music mood/energy) using **code only**, and build the **Scene Board** (Scenes tab) where the user sees the whole video as a storyboard and can edit, split, merge, reorder and delete scenes.

## CONTEXT
- Read `docs/ARCHITECTURE.md` §4 (budget modes + LLM rules), §5 (pipeline, invalidation), §6 (data model: Scene).
- Script data: `Script { title, hook, sections[{ id, heading, narration, visualQueries{primary, alternatives[]}, visualNotes, musicMood, energy, estDurationSec }], outro, music }` (`packages/shared/src/schemas/script.ts`).
- Brief settings: `settings.sceneDurationSec` (2–20, platform preset), `settings.wordsPerMinute`, `settings.language`, `settings.aspectRatio`.
- Engine: executors are registered in `apps/server/src/pipeline/executorRegistry.ts` (overrides map); `markStaleFrom` handles invalidation; `orchestrator.runStage` already re-runs a DONE stage and stales later ones.
- Budget: `resolveBudget(project)` from `packages/shared/src/budget/modes.ts`.
- Next tasks consume scenes: TASK-006 (image search per scene, uses `visualQueries`), TASK-008 (voice per scene, uses `narration`), TASK-011 (timeline uses order + durations).

## FILES TO INSPECT
- `apps/server/src/pipeline/executorRegistry.ts`, `orchestrator.ts`, `invalidation.ts`, `stageExecutor.ts`
- `apps/server/src/stages/script/*` (scriptUtils: countWords, durations), `src/services/scriptService.ts`
- `packages/shared/src/schemas/script.ts`, `src/budget/modes.ts`, `src/schemas/project.ts`
- `apps/web/src/features/projects/ProjectDetailPage.tsx`, `src/features/script/*`, `src/hooks/usePipeline.ts`

## FILES TO CREATE/MODIFY (guide)
```
packages/shared/src/schemas/scene.ts            # Scene, ScenePatch, ScenePlanSummary
packages/shared/src/scenes/sentences.ts         # splitSentences(text, language)
packages/shared/src/scenes/planScenes.ts        # planScenes(script, settings) -> Scene drafts (pure, deterministic)
packages/shared/test/sentences.test.ts, planScenes.test.ts
packages/shared/src/budget/modes.ts             # + sceneQueryAssist feature (QUALITY true)
apps/server/src/db/schema.ts + drizzle (generated!)   # scenes table
apps/server/src/stages/scenes/scenePlanExecutor.ts
apps/server/src/stages/scenes/sceneQueryPrompt.ts     # QUALITY only
apps/server/src/services/sceneService.ts
apps/server/src/api/scenes.ts
apps/server/test/scenePlan.test.ts, scenesApi.test.ts
apps/web/src/features/scenes/SceneBoard.tsx, SceneCard.tsx, SceneEditor.tsx, DurationBar.tsx, *.test.tsx
apps/web/src/services/scenesApi.ts, src/hooks/useScenes.ts
apps/mcp/src/tools.ts                           # + get_scenes (read-only)
```

## REQUIREMENTS

### 1. Data model
`Scene`:
```
id, projectId, order (0-based, contiguous),
kind: "hook" | "section" | "outro",
sectionId: string | null, label: string,           // label = section heading, "Hook", "Outro"
narration: string,
visualNotes: string,                                // what the image should show
visualQueries: { primary: string, alternatives: string[] },
musicMood: string, energy: "low"|"medium"|"high",
estDurationSec: number,                             // computed from words / wpm, 1 decimal
durationOverrideSec: number | null,                 // user override (1–60)
startSec: number,                                   // cumulative, computed
transitionNote: string,
origin: "AGENT" | "USER", edited: boolean,
inputHash: string, createdAt, updatedAt
```
Table `scenes` (FK cascade on project delete; unique `(project_id, order)` enforced in a transaction on reorder). **Generate the migration with `npx drizzle-kit generate --name scenes` from `apps/server`; never write or edit migration files by hand** (the migration hygiene test must pass).

### 2. Sentence splitting (shared, pure)
`splitSentences(text, language)`:
- Split on `.`, `!`, `?`, `…`, and line breaks; keep the terminal punctuation with the sentence; collapse whitespace.
- Do NOT split on: decimal numbers (`3.5`, `1.000`), common abbreviations (`TP.HCM`, `Mr.`, `Dr.`, `St.`, `vs.`, `v.v.`, `e.g.`, `i.e.`, `U.S.`), initials (`A. Turing`), ellipsis inside quotes followed by lowercase.
- Unicode-aware (Vietnamese). Table-driven tests (≥20 cases vi + en).

### 3. Scene planning algorithm (shared, pure, deterministic)
`planScenes(script, { sceneDurationSec, wordsPerMinute, language })`:
1. Units in order: hook (if non-empty) → each section → outro (if non-empty). **Never merge across units.**
2. Within a unit, greedily pack sentences into scenes so each scene's duration (words×60/wpm) is close to `sceneDurationSec`: add the next sentence if the scene stays ≤ 1.3× target, or if the scene is still < 0.6× target. Allowed range per scene: 0.5×–1.6× target, except a unit shorter than 0.5× target stays one scene.
3. A single sentence longer than 1.6× target is split at `,` `;` `:` `—` boundaries, then (if still too long) by word count into near-equal parts.
4. Merge a trailing tiny scene (< 0.5× target) into the previous scene of the same unit when the result ≤ 1.8× target.
5. Visual data per scene: `visualNotes` = section visualNotes; queries: first scene of a unit gets `primary`; following scenes take `alternatives[0..]` in order as their primary (remaining alternatives kept as their alternatives); when exhausted, reuse the section primary and set alternatives to the unused ones. Hook/outro use the first/last section's queries.
6. `musicMood`/`energy` from the section (hook → first section, outro → last section).
7. `startSec` cumulative using `durationOverrideSec ?? estDurationSec`.
8. Same input → identical output (stable ids: `${projectId}:${order}` is NOT required; use random UUIDs but tests compare everything except ids/timestamps).

### 4. Executor (SCENE_PLAN)
- Reads the current script (fail non-retryable `SCRIPT_MISSING` if none), runs `planScenes`, replaces the project's scenes in one transaction, `inputHash = sha256(script content + sceneDurationSec + wpm)`.
- If existing scenes have `edited: true` and the stage is re-run, still replace them (the user explicitly re-ran) but the API `run` for SCENE_PLAN must require `{ confirmOverwrite: true }` when edited scenes exist, else 409 `SCENES_EDITED` (UI shows a confirm dialog).
- Progress messages; message on success: `N scenes · total ~Xs (target Ys)`.
- **LLM calls:** 0 in ECO/BALANCED/CUSTOM-default. QUALITY adds feature `sceneQueryAssist` (add to `BudgetFeatures`, true only in QUALITY, CUSTOM toggle; update `estimateBudget` to count it as 1 for SCENE_PLAN): **one batched call** for all scenes of units that were split into >1 scene, returning `{ scenes: [{ index, primary, alternatives[≤3] }] }` (English search terms, keep proper nouns). Cached by input hash. Any failure → keep code-generated queries, stage still DONE with message "AI query assist skipped (<code>)". Record usage/features.

### 5. API
| Method | Path | Behavior |
|---|---|---|
| GET | `/api/projects/:id/scenes` | `{ scenes: Scene[], totalSec, targetSec, stale: boolean }` |
| PATCH | `/api/projects/:id/scenes/:sceneId` | edit `label, narration, visualNotes, visualQueries, musicMood, energy, durationOverrideSec, transitionNote`; recompute `estDurationSec` and all `startSec`; `edited=true` |
| POST | `/api/projects/:id/scenes/reorder` | `{ sceneIds: string[] }` (must be a permutation) |
| POST | `/api/projects/:id/scenes/:sceneId/split` | `{ sentenceIndex: number }` splits after that sentence (≥1 sentence each side); both parts copy visual data |
| POST | `/api/projects/:id/scenes/merge` | `{ sceneIds: [a, b] }` adjacent only; narration joined; durationOverride cleared |
| DELETE | `/api/projects/:id/scenes/:sceneId` | delete; reindex; at least 1 scene must remain |
- All mutations: 409 when a job is active; mark SCENE_PLAN `DONE` with message "Edited by user" and call `markStaleFrom(SCENE_PLAN)` (later per-scene invalidation comes in TASK-006/008); emit pipeline events.
- `GET` includes `stale` = SCENE_PLAN state is STALE (e.g. script edited after planning).

### 6. Scene Board UI (Scenes tab)
- Header: total duration vs target (DurationBar: green within ±20%, amber otherwise), scene count, "Regenerate scene plan" (confirm when edited scenes exist; shows estimate "0 lượt gọi AI" or "1 lượt (QUALITY)"), stale banner when the script changed after planning.
- Storyboard grid of SceneCards (responsive: 4–5 per row desktop, 2 tablet, 1 mobile): order number, `start–end` timecode (mm:ss), label, 2-line narration excerpt, primary query chip, mood/energy badge, duration (override marked), "edited" dot. Image placeholder area labeled "Ảnh sẽ có ở bước Visual" (TASK-006).
- Reorder: drag-and-drop with native HTML5 DnD (no new library) **and** keyboard-accessible move left/right buttons.
- Click a card → SceneEditor side panel: narration textarea (live word count + duration), visual notes, primary query + alternatives (tags), mood, energy, duration override (with "auto" reset), transition note; sentence list with "Split after this sentence"; "Merge with next"; "Delete". Save via PATCH; unsaved-changes guard.
- Empty state (no scenes): explains the stage and offers "Run scene plan" (enabled when SCRIPT is DONE).
- Live refresh on pipeline SSE `stage.updated` for SCENE_PLAN.

### 7. MCP
Add read-only `get_scenes` tool (`projectId`) returning compact scenes (order, timecode, label, narration excerpt, primary query). No mutation tools in this task.

## LLM calls
ECO / BALANCED: **0**. QUALITY: **+1** (`sceneQueryAssist`, batched, cached, optional). Estimate endpoint/UI updated accordingly.

## DO NOT
- Do not use an LLM for sentence splitting, packing, timing or ordering in any mode.
- Do not add dependencies (no DnD library, no NLP library).
- Do not hand-write or edit migrations.
- Do not implement image search, voice or timeline.
- Do not run real `copilot` prompts. Do not commit.

## ACCEPTANCE CRITERIA
1. Root typecheck/build/test pass (including migration hygiene); `npx drizzle-kit generate` in `apps/server` reports no changes after your migration.
2. Live dev server, mock provider, BALANCED, 60 s vi project with `sceneDurationSec` 3 (tiktok) and 180 s youtube project (7 s): Generate All → SCENE_PLAN DONE; scenes cover all narration in order with no text lost or duplicated (concatenated narration == hook + sections + outro, whitespace-normalized); every scene within the allowed range except documented exceptions; total ≈ script duration.
3. Scene Board shows the storyboard; edit/split/merge/reorder/delete work and persist; durations and timecodes update; later stages become STALE.
4. Re-running SCENE_PLAN with edited scenes requires confirmation (409 without `confirmOverwrite`).
5. QUALITY: SCENE_PLAN makes exactly 1 extra call only when some unit was split; failure keeps code queries and the stage DONE.
6. `get_scenes` MCP tool works against the running API.

## TESTS
- Shared: sentence splitter table (vi/en, abbreviations, decimals, initials, ellipsis, line breaks); planScenes: packing bounds, long-sentence splitting, trailing merge, unit boundaries, hook/outro, query distribution, determinism, text preservation property test (random scripts → concatenation equality).
- Server: executor (no script → SCRIPT_MISSING; replace scenes; inputHash; message), API ops incl. validation errors and 409s, startSec recomputation, invalidation, QUALITY assist (split → 1 call; no split → 0; failure fallback), estimate includes SCENE_PLAN.
- Web: board renders cards/timecodes, keyboard reorder, editor save payload, split/merge buttons, confirm dialog on regenerate with edited scenes, stale banner.
- MCP: `get_scenes`.

## DEPENDENCIES
TASK-004E (done).

## REPORT BACK
Write `docs/tasks/TASK-005.report.md` (files, migration name, scene stats from the live run in AC2, LLM calls per mode, command results, deviations, remaining issues). Then create empty `docs/tasks/TASK-005.done`.
