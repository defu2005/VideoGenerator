# TASK-145 — Story engine: outline → hook candidates → narration → critic → targeted rewrite 🎬

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** L. **Migration:** one, through drizzle-kit only (next free number when you run it: 0087 if Codex's TASK-138 0086 is in the journal). **New dependency:** none.

**Depends on:**
- TASK-144: recipe guidance, `narrationRules.ts`, `lintNarration`.
- A free migration slot: no other migration task may run at the same time.

**Files it owns:** `apps/server/src/stages/script/*`, `packages/shared/src/script/*`, `packages/shared/src/schemas/script.ts`, the script editor in `apps/web`. Do not run it beside a task that edits these.

**Source:** `docs/research/AI_VIDEO_AGENT_SKILLS_RESEARCH.md` §3 (all), §5 P0 rows 2–6, §8.2 rubric, §9 Phase A.

## Why

Today SCRIPT is a single generation, optionally followed by one or two "review and revise" passes from the same kind of prompt. That has three weaknesses:
- Nothing decides the story before the words are written, so the model falls back to chronological listing.
- One model writes and judges its own text.
- Length fixes and quality fixes are mixed in one pass.

The research recommends splitting this into decisions with schemas: an outline first, several hooks compared, narration written from the approved outline, then an independent critic with a weighted rubric, and only the failing parts rewritten.

## Read first

- Everything in TASK-144's "Read first", plus TASK-144's report.
- `packages/shared/src/schemas/llm.ts`: the LLM task list (`scriptReview` entry, `tier`, `qualityWeight`, `budgetFeature`).
- `packages/shared/src/budget/modes.ts`: the budget features and `maxCalls` for SCRIPT (~lines 588 and 657).
- `apps/server/src/providers/llm/registry.ts` `resolveTask`, and `providers/llm/structured.ts` `generateRoutedStructured`.
- `apps/server/src/operator/qualityGates.ts` and `operator/qualityRepair.ts`: how `quality_score`, `blocking_facts` and `revise_round` hold or repair a project.
- `packages/shared/src/modelEval/*`: suites and fixtures, for the benchmark.
- `apps/server/src/services/scriptService.ts` and `api/script.ts`: how the script is read and edited (USER origin).
- `pipeline/dataContract.ts` and `pipeline/inputVersion.ts` (TASK-134): register any new table.

## Build

### 1. Schemas (shared)

**a. `StoryOutlineSchema`** in `packages/shared/src/script/outline.ts`:

- `centralQuestion`: the one question the video answers.
- `promise`: what the viewer gets by the end.
- `framework`: one of `question_driven | cold_open | contradiction | three_act | story_circle | freytag | listicle_payoff`. The choice must fit the recipe; the prompt lists which frameworks each recipe allows.
- `surprises[]`: the 2–4 most counter-intuitive facts, each with `factIds`.
- `beats[]`, each with:
  - `id`, `sectionKey` (from the recipe);
  - `purpose` (`hook | setup | reveal | evidence | tension | explanation | payoff | reflection | transition | cta`);
  - `emotion` (`curious | tense | awe | sad | warm | urgent | calm | playful`);
  - `concreteMoment`: the scene, person, object or decision this beat is told through;
  - `newInformation`;
  - `opensLoops[]` and `closesLoops[]` (loop ids);
  - `factIds[]`;
  - `visualIntent`: a short English phrase;
  - `targetSec`.
- `loops[]`: `{ id, question }`, each with where it opens and where it closes.
- `setupPayoffs[]`.

**b. Fact ids.** Give the research `keyFacts` stable ids in code (`f1…fn`, by order) when they are passed to the outline prompt. Do not change `ResearchNotesSchema`.

**c. `ScriptSectionObjectSchema` gains optional fields** (the schema stays backward-compatible):
- `beatPurpose`, `emotion`, `visualIntent`, `factIds[]`, `opensLoops[]`, `closesLoops[]`.

`ScriptSchema` gains optional `centralQuestion` and `framework`. Old scripts must still parse.

**d. `HookCandidateSchema`:** `{ id, tactic: curiosity_gap | cold_open | contradiction | high_stakes | question, text, promise }`.

**e. `ScriptCritiqueSchema`:**
- `scores` on the research §8.2 rubric, each 0–5:
  - `structure` (20 %), `hook` (20 %), `accuracy` (20 %), `ttsNatural` (15 %), `visualizable` (15 %), `originality` (10 %);
- `total` (0–100, computed in code, never trusted from the LLM);
- `sectionIssues[]`: `{ sectionId, criterion, problem, fix }`;
- `hookPaidOff` (boolean);
- `unclosedLoops[]`.

### 2. The engine (server)

`stages/script/storyEngine.ts`, called by `scriptExecutor.ts`. The steps are below. Each LLM step is its own task id in `schemas/llm.ts`:
- `storyOutline`: tier strong;
- `scriptCritic`: tier strong;
- `scriptRewrite`: tier strong;
- `scriptLengthFit`: tier cheap.

The existing `script` task writes the narration. Give each new task a Vietnamese label and a `budgetFeature`, and add each to `modelAdvisor` and `providerIntel` routing where `scriptReview` appears.

1. **Outline + hooks (1 call, `storyOutline`).**
   - Input: the project, the recipe guidance (TASK-144), research with fact ids, channel direction, learned notes and guideline text.
   - Output: `{ outline, hooks: HookCandidate[3] }`. The 3 hooks must use 3 different tactics from the recipe's `hookStyles` mapped to tactics.
   - Validate in code:
     - every beat `sectionKey` belongs to the recipe and the required keys are present;
     - every loop opened is closed by a later beat;
     - `factIds` exist;
     - the beat `targetSec` values sum to within 10 % of the target duration.
   - On a validation failure, make one repair call with the error list. If it still fails, fall back to the TASK-144 single-pass path and note it.
2. **Hook pick (1 call, `scriptCritic`).**
   - Score each hook 0–5 on clarity, curiosity, accuracy against the facts, audience fit, and whether the outline can pay it off.
   - Code picks the highest total; ties go to the tactic the channel used least in its last 10 scripts.
   - Store all 3 with their scores.
3. **Narration (1 call, `script`).** Write the `Script` from the approved outline and the chosen hook, with the TASK-144 narration rules.
   - Sections follow the beats: one section per beat, or adjacent beats merged when they share a `sectionKey`.
   - Copy `beatPurpose`, `emotion`, `visualIntent`, `factIds` and the loop ids onto the sections.
   - Keep `visualQueries`, `visualNotes`, `musicMood` and `energy` as today.
4. **Lint + critic (1 call, `scriptCritic`).**
   - Run `lintNarration` first and pass its findings to the critic.
   - The critic returns `ScriptCritique`; code computes `total`.
   - The critic must not rewrite. It only judges.
5. **Targeted rewrite (0–2 calls, `scriptRewrite`).**
   - Rewrite only when `total < 75`, or any criterion < 3, or `hookPaidOff` is false, or there are `fix` lint findings.
   - Rewrite only the sections named in `sectionIssues` (plus the hook or outro when involved). Send the outline, the neighbouring sections' first and last sentences, and the issues.
   - Merge the returned sections by id, then run lint + critic again (step 4).
   - At most `rewriteRounds` rounds (budget: 1 or 2). Stop early when `total` does not improve by ≥ 3.
6. **Length fit (0–1 call, `scriptLengthFit`).**
   - Compute the duration with `computeSectionDurations`. Only when it is outside ±15 % of the target, run one call: change length only, keep each section's concrete moment, its loop lines and its hook payoff.
   - After the call, the lint must not get worse, otherwise keep the pre-fit script and note it.
   - Length is never mixed into the critic or the rewrite.
7. **Fact check and guidelines.** These run as today, after the engine. Fact check now gets `factIds` per section, so its notes can name sections.
8. **Result.**
   - `quality_score` = `total / 10`, rounded to one decimal, so the existing quality gates work unchanged.
   - Hold: when the final `total < 60`, or `accuracy < 3`, or there are blocking facts, use the existing hold and repair path (`qualityGates`/`qualityRepair`). Do not invent a new state.
   - `review_notes`: the critic's top issues, in plain Vietnamese, `[lint]` notes, and engine fallbacks. Keep the cap of 8.

### 3. Budget modes

- Add the budget feature `storyEngine`: `off | lite | full`.
  - `lite`: outline + hooks, narration, one critic, at most one rewrite, no separate hook-pick call (code picks the hook the outline call ranked first).
  - `full`: every step, two rewrite rounds.
  - `off`: today's path plus TASK-144.
- Defaults by mode: cheapest → `off`; balanced → `lite`; quality modes → `full`.
- Merged-story mode (research and script in one call) keeps `off`.
- Update `maxCalls` and the SCRIPT estimate in `modes.ts` so the budget preview stays honest.
- The mode is part of the script input hash, so changing it marks SCRIPT stale.

### 4. Storage (migration)

- Add a table `script_drafts`:
  - `project_id` (PK, FK cascade);
  - `outline` JSON, `hook_candidates` JSON (with scores and the chosen id), `critique` JSON (last), `critique_history` JSON (score per round);
  - `engine_mode`, `input_hash`, `updated_at`.
- Register it in `pipeline/dataContract.ts` as a SCRIPT output, so invalidation and the node snapshot (135a) carry it.
- Generate with `npx drizzle-kit generate` in `apps/server`. Never hand-write it.
- A user edit of the script (USER origin) keeps the draft row but marks the critique as stale in the API response. There is no automatic critic on user edits; there is a "Chấm lại" button (step 5).

### 5. API, tools, UI

**API**
- `GET /api/projects/:id/script` also returns `draft` (outline, hooks with scores, critique), or `null`.
- `POST /api/projects/:id/script/hook` `{ hookId }` switches to another candidate. It rewrites only the hook and the first sentence of section 1 (one `scriptRewrite` call) and saves as AGENT origin with the usual invalidation.
- `POST /api/projects/:id/script/critique` re-scores the current script (one critic call). It costs money, so it uses the existing job and usage accounting.

**Tools (MCP and assistant registry, TASK-047 rules)**
- `get_script_draft`: read-only.
- `rescore_script` and `switch_script_hook`: both `confirm` risk, so they become pending actions the user approves.
- Write the tool descriptions in the same style as the existing script tools.

**Web, script editor**
A "Dàn ý & chấm điểm" panel showing:
- the central question and framework;
- the beats as a list (purpose, emotion and concrete moment) with open and closed loops;
- the 3 hooks with scores and a "Dùng hook này" button;
- the rubric bars, the `total` and the section issues, with links that scroll the editor to the section.

Keep it read-only apart from the hook switch and "Chấm lại".

### 6. Benchmark (research §8)

- Add a `modelEval` suite `storyEngine`: 10 topic fixtures covering history, explainer, listicle, story, news, science, biography, manga or culture, in Vietnamese and English, at 60 s, 180 s and 600 s. Each fixture holds the topic, recipe and research notes. No project ids, no real data.
  - In tests the suite runs with the mock LLM and checks only the pipeline wiring and the schema validity.
- Add a CLI `apps/server/src/cli/benchScript.ts` (npm script `bench:script` in `apps/server`) for the user or Claude to run by hand against the dev server's LLM routes:
  - for each fixture, generate with `storyEngine=off` and `full`;
  - judge each pair blind with a third route (A/B order randomised), using the rubric;
  - write `tmp/bench-script-<date>.md` with the per-criterion means, the wins, and cost and tokens per variant.
  - It is never part of the test suites.

### 7. Docs and skill

- `docs/ARCHITECTURE.md`: the story engine steps, the tables and the budget feature.
- User guide: a "Kịch bản: dàn ý, hook và chấm điểm" section (how to read the panel, switching hooks, what holds a script), a `featureMap` entry and a changelog line.
- Extend the operating skill `.agents/skills/video-stage-kich-ban/SKILL.md` (it already exists; do not create `video-bien-kich`):
  - when to use it;
  - how to read the outline and critique with `get_script_draft`;
  - when to propose a hook switch or a rescore (pending actions);
  - when to escalate to the user (accuracy < 3, blocking facts, `hookPaidOff` false after rewrites).

  Update its row in the table in `video-van-hanh-app/SKILL.md` if the scope changes.

## Carry-over from the TASK-144 review

Fix these two small points from 144 while you are in `stages/script/*`:
- `scriptExecutor.ts` keeps the first 3 lint findings in check order. Sort `fix` before `warn` before slicing, so a `CLICHE` warn never pushes out a `DATE_LIST` fix.
- `TEMPLATE_SENTENCE` in `packages/shared/src/script/lint.ts` matches the bare word `like` (and `chuông`) anywhere. An English outro sentence such as "it looks like the wall was never one wall" counts as a template sentence. Match `like` only together with `subscribe`, `comment` or `share`, and add an English test.

## Mã nguồn mở có sẵn (open source)

Checked 2026-11-17 (licence and last push):

| Project | Licence | Use |
|---|---|---|
| [jtydhr88/screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) | MIT, active | Story structure, dramaturgy and scene skills: source for the framework list and the outline prompt. You may adapt wording; keep an attribution comment at the top of the prompt file. |
| [danjdewhurst/story-skills](https://github.com/danjdewhurst/story-skills) | MIT, active | Continuity and editorial review: source for loops, setup/payoff and the critic checklist. Same attribution rule. |
| [chenyuxiaojin/video-agent-skills](https://github.com/chenyuxiaojin/video-agent-skills) | MIT | Research → writer → storyboard handoff and checkpoints. Design only. |
| [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills) | MIT, active | Character and beat-to-shot ideas. Design only, mostly for the `story` recipe. |
| [Vincentwei1021/video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft) | no licence | Do not copy. |

These are skill packs (Markdown), not libraries, so nothing is added to `package.json`. Do not vendor whole packs. If you find a maintained TypeScript library for narrative critique that fits better, report it (README rule 11) instead of adding it.

## Rules

- README rules 1–12. Exactly one migration, generated by drizzle-kit.
- Never run SCRIPT, the critic or a render on the protected project `56374fb2-…`.
- Tests: mock LLM and fixtures only, no network.
- The LLM never computes `total` and never decides the hold. Code does.
- Old scripts without beat fields keep working end to end. SCENE_PLAN must not require the new fields; TASK-146 consumes them.

## Tests

- **Outline validation:**
  - a loop that is never closed → repair call;
  - an unknown `sectionKey` → repair;
  - a second failure → fallback to the single pass, noted.
- **Hook pick:** the highest score wins; a tie goes to the least-used tactic.
- **Rewrite:**
  - only the sections named in `sectionIssues` change, and the other sections are byte-identical;
  - the loop stops at max rounds and when there is no gain of ≥ 3;
  - `total` is computed in code even when the LLM sends a different number.
- **Length fit:** it runs only outside ±15 %; it is reverted when the lint gets worse.
- **Budget:**
  - `off`, `lite` and `full` make 0, up to 7 and up to 10 story-engine calls at max, counting the narration writer (`modes.ts` storyEngineMax = `full ? 10 : 7`, 2026-11-19). Engine-only max (without the writer): full 9, lite 6. Full = outline 2 (first call + one semantic repair; schema retries are added through `repairs`) + critic 4 (hook critic 1 + narration critic 3 across 2 rewrite rounds) + rewrite 2 + length fit 1 = 9, plus writer 1 = 10. Lite = outline 2 + critic 2 + rewrite 1 + length fit 1 = 6, plus writer 1 = 7.
  - `maxCalls` and the estimate match;
  - changing the mode marks SCRIPT stale.
- **Hold:** `total` 55 → the existing hold path; `accuracy` 2 → hold.
- **Storage:** `script_drafts` is written, carried by `dataContract`, and cleared or rewritten on rerun.
- **API and tools:** the hook switch changes only the hook and section 1 opening; the tools are `confirm` risk.
- **Back-compat:** a fixture of an old script parses, plans scenes and renders the timeline (fake ffmpeg).
- **Web:** the panel renders a fixture draft, and the hook button calls the API.

## Done

- [ ] schemas (outline, hooks, critique, optional section fields)
- [ ] story engine steps 1–8 with fallbacks
- [ ] LLM task ids, budget feature, call estimates
- [ ] migration `script_drafts` (drizzle-kit) + data contract
- [ ] API, tools, script editor panel
- [ ] modelEval suite + `bench:script` CLI
- [ ] tests; shared, server and web suites; typecheck; build
- [ ] ARCHITECTURE, user guide section, featureMap, changelog, skill `video-stage-kich-ban` extended
- [ ] report → `docs/tasks/TASK-145.report.md` and `docs/tasks/TASK-145.done`
