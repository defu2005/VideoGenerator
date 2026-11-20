# TASK-147 — Agents claim more stages: RESEARCH, MUSIC_SEARCH and SCRIPT 🤝

**Who:** Codex (the user hands it over), or Sonnet 5.5 / Cursor `grok-4.7-xhigh`. **Size:** L.
**Migration:** none expected; agent outputs go into the existing stage output tables. If a column is truly needed, generate it with drizzle-kit. **New dependency:** none.
**Order:** split into parts that can land one at a time:

| Part | Content | When |
|---|---|---|
| **147a** | Generalise the stage-agent framework (contexts, validators, roles) | first |
| **147b** | RESEARCH | after 147a |
| **147c** | MUSIC_SEARCH | after 147a |
| **147d** | SCRIPT | after TASK-145 is done, because it reuses the story engine's critic and lint |

**Source:** the review on 2026-11-17. Only VISUAL_SEARCH can be claimed today, so external agents (Claude Code, Codex, Hermes fleet) cannot help with the stages where they are strongest: research with real web access and writing.

## Why

- `AgentStageService` (`apps/server/src/agents/stageService.ts`) already has a lease of 10 minutes, heartbeat, release with `cannot_do`, `LEASE_LOST`, usage reporting and the protected-project block. The framework is general.
- Only VISUAL_SEARCH is wired:
  - `supportedStages` defaults to `["VISUAL_SEARCH"]`;
  - `resolveStageExecution` (`packages/shared/src/agents/stageExecution.ts`) returns `app_then_agent` only for VISUAL_SEARCH;
  - the context builder, the `validateComplete` check and the submit tools (`visual_*`) are visual-only.
- **RESEARCH:** an agent with real web search and page reading gives better, sourced research than the app's LLM-only research.
- **MUSIC_SEARCH:** an agent can browse licensed libraries the app has no provider for.
- **SCRIPT:** the user may prefer a strong writing agent. The app must still own the quality gate (lint, critic, fact check), so a weak agent cannot slip a bad script through.

## Read first

- `apps/server/src/agents/stageService.ts`: claim, heartbeat, complete, release, `context`, `validateComplete`, `afterError`, `afterLocal`, `handoffAfterRepair`.
- `apps/server/src/agents/toolDefs.ts`, `visualToolkit.ts`, `visualCache.ts`, `usage.ts`, `releaseMonitor.ts`, `assignments.ts`.
- `packages/shared/src/agents/stageExecution.ts`: `StageExecutionMode`, `resolveStageExecution`, `resolveAgentWaitMinutes`.
- `apps/server/src/stages/research/*`, `stages/music/*` (MUSIC_SEARCH executor, license filter), `stages/script/*` (after TASK-144/145: `lintNarration`, the critic, the fact check, `script_drafts`).
- `apps/server/src/pipeline/dataContract.ts`: the output contract each stage must satisfy.
- `.agents/skills/visual-scout/SKILL.md`: the role skill format (`roles:`).
- `docs/user-guide/agent-nhan-stage.md` (or whatever `featureMap` points to for stage agents).

## Build

### 147a. Generalise the framework

1. **Per-stage adapters.** Add `apps/server/src/agents/stageAdapters/` with one adapter per stage:

   ```ts
   type StageAgentAdapter = {
     stage: PipelineStage;
     role: string;                         // "visual_scout" | "research_scout" | "music_scout" | "script_writer"
     buildContext(job: Job): unknown;      // what the agent needs, redacted, no secrets
     validateComplete(job: Job): void | Promise<void>; // the app-side gate; throws AppError with a clear code
     openReason?(job: Pick<Job, "projectId" | "stage">): string | null;
     handoffErrors: readonly string[];     // error codes that hand off in app_then_agent mode
   };
   ```

   - Move today's visual logic into `stageAdapters/visualSearch.ts` with no behaviour change.
   - `AgentStageService` takes `adapters: StageAgentAdapter[]`. `supportedStages` becomes the adapter stages.
   - `afterError` uses the adapter's `handoffErrors`, not the hard-coded list.
2. **Default modes.** `resolveStageExecution` keeps `app` as the default for every new stage. Only VISUAL_SEARCH keeps `app_then_agent`. The user turns the others on per channel or per project, in the existing stage execution settings UI. Add the new stages to that UI.
3. **Roles and assignments.**
   - `stage_claim_next` only returns jobs whose adapter role matches an assignment of the caller (`assignments.ts`).
   - An agent with no assignment for the role gets nothing.
   - `channel_manager` stays excluded.
4. **Role skills.** Each new role gets a role skill in `.agents/skills/<role-name>/SKILL.md` with `roles: [<role>]`, following `visual-scout`.

### 147b. RESEARCH (`research_scout`)

- **Context:** topic, language, target duration, recipe purposes, channel direction, learned notes, and the existing app research notes if any.
- **Tool `research_submit_notes`** (risk `safe` for the claiming agent, bound to the lease):
  - input matches the research notes schema;
  - every `keyFact` must carry `source: { url, title, quote }`, where the quote is at most 30 words.
- **App-side gate (`validateComplete`):**
  - the schema is valid and there are at least 6 `keyFacts`;
  - at least 60 % of facts have a source;
  - no source URL points to a blocked domain list (reuse the 074a `fetch_page` guard list if it exists);
  - the quote is non-empty.

  Failures return `RESEARCH_AGENT_INVALID` with the list of problems, so the agent can fix and resubmit within the lease.
- The sources are stored with the notes and shown in the research panel. This is better than the LLM-only notes, so the SCRIPT fact check can cite them.
- **Role skill `research-scout`:**
  - how to search;
  - how to quote;
  - never invent sources;
  - when to `stage_release` with `cannot_do`.

### 147c. MUSIC_SEARCH (`music_scout`)

- **Context:** mood, energy and keywords from the script, video duration, channel music rules, `copyrightMode` and the allowed licence list.
- **Tool `music_submit_candidates`:** up to 8 candidates, each with:
  - `title`, `artist` and a `sourceUrl`;
  - a `downloadUrl` the app can fetch;
  - `licence` (one of the allowed licence ids) and a `licenceUrl`;
  - `durationSec`, `mood` and a short reason.
- **App-side gate:**
  - the licence is in the allowed list for the project's `copyrightMode`;
  - the app downloads the file itself through the existing music download path, with its size and type checks;
  - the duration covers the video or can loop.

  Rejected candidates are listed back to the agent. Accepted ones join the normal candidate list, and MUSIC_REVIEW works as today.
- The agent never picks the final track. The gate stays the same.
- **Role skill `music-scout`.**

### 147d. SCRIPT (`script_writer`), after TASK-145

- **Context:**
  - the research notes;
  - the recipe guidance (`formatGuidance` from 144);
  - the narration rules (`narrationRules.ts` text);
  - the outline schema from 145;
  - channel direction, learned notes, platform guidelines and target length.
- **Tools:**
  - `script_submit_outline` (optional, when `scriptOutlineApproval=outline` from 146);
  - `script_submit_draft` (the full `ScriptSchema` with beat fields).
- **App-side gate.** Always run, and never skipped for agents:
  1. `lintNarration`;
  2. the critic from 145, using the app's own LLM route and counted in the project's budget;
  3. the fact check against the research notes.

  The same hold thresholds as the app path apply: total < 60, accuracy < 3, or blocking facts.
  - On hold, the agent gets the critique and may resubmit up to 2 times within the lease.
  - After that the job returns to the app path, or waits for the user, as configured.
- The draft is stored in `script_drafts` with `author: "agent:<instance>"`, so the user and the learning loop (TASK-148) can see who wrote it.
- **Role skill `script-writer`:**
  - the narration rules in short form;
  - reading the critique;
  - never inventing facts beyond the notes.

### Usage and safety (all parts)

- Each submit tool records usage through `agents/usage.ts`, with stage, role, instance and tokens if the agent reports them.
- The protected project `56374fb2-…` is never offered and never accepted.
- Every submit checks the lease (`LEASE_LOST` on mismatch) and the project and stage of the job.
- Text from agents goes through `redactExportText` before it is logged or published to the event bus.

## Docs and skills (rule 12)

- **`docs/ARCHITECTURE.md`:**
  - the adapter interface;
  - the stage, role and gate table;
  - why the app keeps the quality gate.
- **User guide**, in the stage-agent page:
  - which stages can be handed to agents;
  - how to turn it on per channel or project;
  - what the app checks;
  - the `featureMap` entries and a changelog line.
- **MCP:** tool descriptions for every new tool, and the docs sync in `apps/mcp` if it lists tools.
- **Skills:**
  - the role skills `research-scout`, `music-scout` and `script-writer`;
  - the operating skills, each with a line saying the stage can also be done by an agent and how to read `author`:
    - `video-stage-nghien-cuu`;
    - `video-stage-nhac`;
    - `video-stage-kich-ban`.
- Add the tools to `auth/toolActions.ts` and `routePermissions.ts`.

## Mã nguồn mở có sẵn (open source)

| Project | Licence | Use |
|---|---|---|
| Existing VISUAL_SEARCH agent path in this repo | ours | The pattern to copy for every adapter |
| [Free Music Archive](https://freemusicarchive.org/) and [ccMixter](https://ccmixter.org/) | content under CC licences per track | Sources the music scout may browse. The licence is checked per track, never assumed per site |
| [jtydhr88/screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) | MIT | Ideas for the `script-writer` role skill. Credit it if wording is adapted |

No dependency is added. If you find a maintained library for licence detection of music files, report it (README rule 11).

## Rules

- README rules 1–12.
- New stages default to `app`; nothing changes for users who do not opt in.
- The app-side gates cannot be turned off for agents.
- Tests: fake agents through the tool layer, mock LLM for the critic, fake downloads. No network.
- Never approve gates or run stages on the protected project.

## Tests

- **147a:**
  - the visual adapter keeps every existing visual test green;
  - a stage without an adapter is never offered;
  - role matching works, and an agent without the role gets nothing;
  - `handoffErrors` per adapter decide the handoff.
- **147b:**
  - valid notes complete the stage;
  - too few facts or missing quotes are refused with `RESEARCH_AGENT_INVALID` and a list of problems;
  - a lease mismatch returns `LEASE_LOST`.
- **147c:**
  - a disallowed licence is rejected;
  - a download failure rejects only that candidate;
  - accepted candidates show in MUSIC_REVIEW;
  - the agent cannot pick the final track.
- **147d:**
  - a draft under the thresholds is held and the critique is returned;
  - the third failed submit returns the job to the app path;
  - a good draft completes with `author` set;
  - lint and critic run with the app's route.
- The protected project is blocked for every new tool.

## Done

- [x] 147a adapters, modes, roles, visual moved with no behaviour change (regression accepted 2026-11-18, rerun 2026-11-19)
- [x] 147b research agent path + gate + skill
- [x] 147c music agent path + gate + skill
- [x] 147d script agent path + gate + skill (after 145); `script_submit_outline` hoãn cùng TASK-146, xem `TASK-147d.done`
- [x] tests; server, shared, mcp and web suites; typecheck; build (2026-11-19: server 262 files / 2060 pass; shared 98/788; mcp 7/65; web 90/246; typecheck and build exit 0)
- [x] ARCHITECTURE, user guide, featureMap, changelog, tool docs, role skills, operating skill lines
- [x] report → `docs/tasks/TASK-147.report.md` and `docs/tasks/TASK-147.done` (or `TASK-147a.done` per part)
