# TASK-146 — Beats downstream: visuals, motion and music follow the story, plus an optional SCRIPT_REVIEW gate 🎞️

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M–L. **Migration:** only if the gate needs a setting column or a backfill. Generate it with drizzle-kit; prefer storing the setting in the existing project or channel settings JSON so that no migration is needed. **New dependency:** none.

**Depends on:**
- TASK-145, which adds the beat fields on script sections and `script_drafts`.
- TASK-141, which owns `apps/server/src/compose/director/*`. Start only after 141 is done, or skip step 4 and note it.

**Source:** `docs/research/AI_VIDEO_AGENT_SKILLS_RESEARCH.md` §4 (visual and motion grammar), §5 P1 rows, §9 Phase B.

## Why

After TASK-145 every script section knows its purpose (`reveal`, `tension`, `evidence`…), its emotion and its visual intent. Today that knowledge stops at SCRIPT:
- the scene planner cuts by sentence length;
- visual search uses generic queries;
- motion is chosen by a per-preset frequency table;
- music has one mood for the whole video.

So even a good script still looks like "đọc nội dung với ảnh minh hoạ". This task carries the beat downstream. It also lets the user approve the outline or script before money is spent on visuals and voice, when they want to.

## Read first

- TASK-145's guide and report: the section beat fields, `StoryOutlineSchema`, `script_drafts`.
- `packages/shared/src/scenes/*` (`planScenes`, TASK-130 `dedupeSeams`) and `stages/scenePlan/*`.
- `stages/visualSearch/*`, `stages/visualReview/*`, and the vision check prompt: how scene queries and the vision check are built.
- `packages/shared/src/motion/plan.ts`: `MotionScene` and the `FREQUENCY` table per `EditPreset`.
- `apps/server/src/compose/director/llm.ts`: `buildDirectorPrompt` and `createLlmDirector` (after TASK-141).
- `stages/musicSearch/*` and the timeline music placement: how the mood and the cue are chosen.
- `packages/shared/src/pipeline.ts`: `STAGE_ORDER`, `GATES`, `STAGE_DEPENDS`. Also `pipeline/orchestrator.ts`, `pipeline/invalidation.ts`, `pipeline/dataContract.ts`, and the gate approval API and tools.
- `.agents/skills/video-du-an-va-pipeline/SKILL.md`: how gates are described to agents.

## Build

### 1. Scenes carry the beat

- `planScenes` copies `beatPurpose`, `emotion`, `visualIntent` and `factIds` from a section onto each scene cut from it. Scene type: optional fields, back-compatible.
- Beat boundaries are hard scene boundaries: a scene never spans two beats.
- A `reveal` beat gets its own short scene for the reveal sentence, so the cut lands on it.
- Old scripts without beat fields plan exactly as today. Add a snapshot test on an old fixture.

### 2. Visual intent drives search and review

- When a scene has `visualIntent`, it is the first query, and the existing `visualQueries` follow as alternatives.
- The vision check prompt gets the intent and the beat purpose ("this shot must show: …; purpose: reveal"), so it rejects pretty but off-story images.
- `evidence` beats prefer document, map, chart or graphic sources (existing `graphics` recipe kinds) over stock photos when the recipe allows graphics.
- No new provider calls: same budget, better queries.

### 3. Motion grammar by beat

In `packages/shared/src/motion/`, add a `BEAT_MOTION` table: `beatPurpose → preferred motions`. It is applied before the preset `FREQUENCY` table, which still limits how often strong moves happen.

| Beat | Motion |
|---|---|
| `hook` | punch-in or fast push on the first shot |
| `setup` | slow Ken Burns pan |
| `tension` | slow push-in; shorter shots towards the end of the beat |
| `reveal` | hard cut, punch-in on the reveal line, no dissolve |
| `evidence` | zoom or highlight on the detail; graphic call-out when available |
| `explanation` | steady, minimal motion |
| `payoff` | hold, then a slow pull-out |
| `reflection` | pull-out or dissolve, longer shots |
| `transition` | whip or dissolve per preset |
| `cta` | static |

- Emotion adjusts the speed: `urgent` and `tense` are faster, `calm`, `sad` and `awe` slower. Use one multiplier table.
- Keep it deterministic, a pure function with tests. Do not add an LLM call here.

### 4. Director prompt (after TASK-141)

- `buildDirectorPrompt` gets, per scene, the beat purpose, the emotion and the visual intent, plus the outline's central question.
- The director may override `BEAT_MOTION` only with a reason field, which is logged.
- If TASK-141 is not done when you reach this step, skip it and write that in the report.

### 5. Music follows emotion

- Group consecutive scenes by emotion into music segments. A segment is at least 20 s, so short emotions merge into their neighbours.
- When the budget allows more than one track (existing music settings), each segment gets a mood query. Otherwise keep one track, and use the emotion curve only for ducking and volume:
  - lower under `tension` and `reflection`;
  - a short dip before a `reveal`;
  - a lift on `payoff`.
- The timeline places the cues at scene boundaries with the existing crossfade.
- One track stays the default, so cost does not rise unless the user enabled multi-track music.

### 6. Optional SCRIPT_REVIEW gate

- **Setting:** `scriptOutlineApproval`: `off | outline | script`. Default `off`. It is set per project, with a channel default in the channel profile.
- **Stage:** a new gate stage `SCRIPT_REVIEW` after SCRIPT in `STAGE_ORDER` and `GATES`. `SCENE_PLAN` depends on `SCRIPT_REVIEW`, and `SCRIPT_REVIEW` depends on `SCRIPT`.
  - When the setting is `off`, the orchestrator auto-passes the gate with a system note. No waiting, no notification.
  - With `outline` or `script`, the gate waits for user approval like the other gates: same API, same Telegram notification, same pending-action rules for agents (agents may not approve it on the protected project, nor without the user).
- **`outline` mode:** the story engine (TASK-145) stops after the outline and the hooks. The user sees the outline panel with "Duyệt dàn ý" and can edit the central question or a beat's concrete moment.
  - Approving resumes SCRIPT from narration, with the edited outline.
  - This needs a SCRIPT sub-state stored in `script_drafts` (`phase: outline_ready | done`). Do not add a new pipeline state.
- **`script` mode:** the gate opens after the full script, and the user approves or edits it in the existing editor.
- **Existing projects:** check how stage rows are created. If the projects table stores per-stage rows, backfill `SCRIPT_REVIEW` rows as passed for every project whose SCRIPT is already done, through a generated migration or an idempotent startup step (pick the one the codebase already uses for new stages; look for how TASK-0xx added a stage before). A project in flight must never get stuck waiting on a gate it never had.
- **Invalidation:** a rerun of SCRIPT resets `SCRIPT_REVIEW`. An edit to an approved outline reopens it.
- **Data contract:** register the stage, the gate and its outputs (none, or the approval record).
- Update everything that lists stages:
  - the web pipeline view and the stage labels (Vietnamese label "Duyệt kịch bản");
  - the MCP tool descriptions for gates;
  - budget estimates (no cost);
  - the fleet and node stage routing: the gate is never leased to a worker.

### 7. Docs and skills

- `docs/ARCHITECTURE.md`:
  - beat fields downstream;
  - the `BEAT_MOTION` table;
  - music segments;
  - the new gate and its auto-pass.
- User guide:
  - "Duyệt dàn ý trước khi làm hình" (the setting, the two modes, what happens when it is off);
  - a note in the motion and music section;
  - `featureMap` entries and a changelog line.
- Skills:
  - `video-du-an-va-pipeline`: the new gate, and that agents only create a pending action for it;
  - `video-stage-kich-ban`: the outline review;
  - `video-render-va-thumbnail`: beat-driven motion and how to read the director's override reasons.

## Mã nguồn mở có sẵn (open source)

Checked 2026-11-17:

| Project | Licence | Use |
|---|---|---|
| [Vincentwei1021/video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft) | no licence | Beat-to-shot grammar ideas from its README only. Copy nothing. |
| [remotion-dev/skills](https://github.com/remotion-dev/skills) | see repo (check before copying) | Motion and timing ideas only. We do not use Remotion. |
| [jtydhr88/screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) | MIT | Scene and beat vocabulary, kept consistent with TASK-145. |
| video-production-skills (listed in the research doc) | Apache-2.0 | Shot list and music cue checklists. Ideas; attribution if wording is adapted. |

No dependency is added. If a maintained library for beat → shot mapping exists, report it (README rule 11).

## Rules

- README rules 1–12. Migration only through drizzle-kit, and only if truly needed.
- Never approve gates, run stages or render on the protected project `56374fb2-…`. The new gate follows the same rule.
- Tests: mock LLM, fake ffmpeg, fixtures. No network.
- The default behaviour (`scriptOutlineApproval=off`, one music track) must cost nothing extra and must not stop any pipeline.
- Do not edit `compose/director/*` before TASK-141 is done.

## Tests

- **`planScenes`:**
  - beat fields are copied;
  - no scene spans two beats;
  - the reveal sentence gets its own scene;
  - the old-script snapshot is unchanged.
- **Visual search:** the intent is the first query; the vision prompt contains the intent and the purpose.
- **`BEAT_MOTION`:**
  - each purpose maps to its motion;
  - the emotion multiplier works;
  - the preset frequency cap still applies.
- **Director (if done):** the beat info is in the prompt; an override without a reason is rejected.
- **Music:**
  - segments merge under 20 s;
  - one-track mode yields a ducking curve, multi-track mode yields cues at boundaries.
- **Gate:**
  - `off` auto-passes and the pipeline reaches SCENE_PLAN with no wait;
  - `outline` stops SCRIPT after the outline, and approval resumes narration with the edited outline;
  - `script` waits after the full script;
  - a SCRIPT rerun resets the gate;
  - existing projects are backfilled or passed and never stuck;
  - agents get a pending action, not an approval;
  - the protected project is blocked.
- Existing pipeline, gate, timeline, render (fake ffmpeg), MCP and web suites stay green.

## Done

- [ ] beat fields on scenes, hard beat boundaries
- [ ] visual intent in queries and vision check
- [ ] `BEAT_MOTION` + emotion speed, deterministic
- [ ] director prompt gets beats (or skipped, with the reason noted)
- [ ] music segments and ducking
- [ ] SCRIPT_REVIEW gate: setting, orchestrator auto-pass, outline and script modes, backfill, invalidation, UI, tools
- [ ] tests; shared, server, mcp and web suites; typecheck; build
- [ ] ARCHITECTURE, user guide sections, featureMap, changelog, three skill updates
- [ ] report → `docs/tasks/TASK-146.report.md` and `docs/tasks/TASK-146.done`
