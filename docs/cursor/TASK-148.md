# TASK-148 — Stage self-learning: feedback capture, per-stage lessons, quality ledger 🧠

**Who:** Codex (the user hands it over), or Sonnet 5.5 / Cursor `grok-4.7-xhigh`. **Size:** L. **New dependency:** none.
**Migration:** yes. Run `npx drizzle-kit generate` in `apps/server` after editing `db/schema.ts`. Never hand-write it. Only exception: the advisor's ruling in 148d trims the freshly generated, never-applied 0096 SQL.

**Parts:**

| Part | What | Order and dependencies |
|---|---|---|
| **148a** | A: capture feedback | core, first |
| **148b** | B: lessons injected into stage prompts | core, after 148a |
| **148c** | C: per-stage quality ledger | core |
| **148d** | D: query patterns for the visual scout | done 2026-11-19 (khoá theo kênh, migration 0096) |
| **148e** | E: A/B of prompts and skills | later; after TASK-145 (`bench:script`) and TASK-074b (shadow runs) |
| F | retention per beat | noted only, not built here |

**Depends on:**
- TASK-145, for `script_drafts` and the critic scores. Without it, 148c reads `quality_score` only.
- Migration order: generate after 145's migration is in the journal, so the numbers do not clash.

**Source:** review on 2026-11-17, "các agent thực hiện các stage cụ thể đã có khả năng tự học hỏi chưa".

## Why

What learns today:
- `learning/learningService.ts` builds per-channel `learned_notes` and `learned_hints` from publications and metrics. Only the script, merged-story and metadata prompts read them.
- Fleet lessons (`fleet/lessons.ts`) feed the operator handbook. No stage executor reads them.
- `image_verdicts` (`agents/visualCache.ts`) caches vision verdicts per image.

What is missing:
1. **User edits and gate rejections are thrown away.** Examples:
   - the user rewrites a hook;
   - deletes a scene;
   - swaps a track;
   - rejects VISUAL_REVIEW with a reason;
   - edits the title.

   These are the clearest quality signals the app gets, and nothing records them as feedback.
2. **Stage prompts never see stage-specific lessons.** The scene planner, the vision check, music search and the timeline director learn nothing.
3. **There is no per-stage quality history.** The app cannot tell that SCRIPT got worse after a model change, or that a channel's vision reject rate doubled.
4. **The visual scout does not learn** which query shapes work for a topic type.
5. **There is no way to compare** two prompt or skill versions on real outcomes.

## Read first

- `apps/server/src/learning/learningService.ts`, `features.ts`, `loadRows.ts`: how notes are distilled, approved and undone. Copy this flow; do not invent a second one.
- `apps/server/src/fleet/lessons.ts`: lesson format, retire.
- `apps/server/src/stages/*/prompt*.ts` for each stage that calls an LLM. Find where `learned_notes` are injected today in `stages/script/prompt.ts`.
- `apps/server/src/api/script.ts`, scene edit API, visual review API, music selection API, metadata API: where user edits are saved.
- `apps/server/src/pipeline/orchestrator.ts`: gate approve and reject.
- `apps/server/src/agents/visualCache.ts`, `stageService.ts`.
- `apps/server/src/operator/skillVersions.ts`, `skillEval.ts`, and the TASK-074 guide (074b shadow, 074c improvement requests).
- `docs/cursor/TASK-145.md` (`script_drafts`, critic, `bench:script`).

## Build

### 148a. Capture feedback (A)

**Table `stage_feedback`**, in `db/schema.ts`:

| Column | Meaning |
|---|---|
| `id`, `created_at` | |
| `project_id`, `profile_id` | |
| `stage` | |
| `kind` | `user_edit`, `gate_reject`, `gate_approve_with_edit`, `swap`, `agent_release` |
| `target` | for example `hook`, `section:3`, `scene:12`, `music`, `title` |
| `before`, `after` | text or JSON, capped at 4 KB each, after `redactExportText` |
| `reason` | the user's reason, if any |
| `source` | `user`, `agent:<instance>` or `operator` |
| `distilled_at` | nullable |

Write rows from the existing save paths only. Add no new UI except an optional "Lý do" field on gate reject, if one does not exist yet.
- **Script editor save:** one row per changed hook, section or outro. Use a small diff by section, not the whole script.
- **Scene edit:** delete, merge, split and query change.
- **VISUAL_REVIEW:** a manual image swap, or a reject with a reason.
- **MUSIC_REVIEW:** the user picks a track other than the top-ranked or auto-picked one.
- **FINAL_APPROVAL and metadata:** title, description and tag edits.
- **`stage_release` with `cannot_do`:** the agent's reason.

Rules:
- The protected project's rows are never written.
- Retention is 180 days; prune in the existing cleanup job.

**Weekly distillation.** A new standing-order module `stage-learning`, seeded and disabled by default, like `seed-research-weekly`.
- For each channel with at least 5 new rows in a stage, one LLM call (budget feature `stageLearning`: off or on) proposes at most 5 notes for that stage.
- Each note is a short rule with:
  - `evidence`, the feedback ids;
  - `confidence`.

**Table `stage_notes`:**
- `id`, `profile_id` (null means global), `stage`, `text`, `evidence_ids`;
- `status`: proposed, approved, rejected or retired;
- `created_at`, `decided_at`, `decided_by`, `uses`, `last_used_at`.

Approval:
- The user approves, edits or rejects in a new section "Bài học theo bước" on the channel learning page, next to `learned_notes`.
- Undo works the same way as for `learned_notes`.
- Agents may only propose. Approving is a confirm-risk pending action.

### 148b. Lessons reach the stages (B)

Add `stageLessons(profileId, stage, limit)`, returning approved notes for the channel plus global notes, newest and most used first. Inject them into these prompts:

| Stage | Prompt |
|---|---|
| RESEARCH | research prompt |
| SCRIPT | writer, review and critic (after 145) |
| SCENE_PLAN | only if it has an LLM step; otherwise skip and say so |
| VISUAL_REVIEW | vision check prompt |
| MUSIC_SEARCH | the mood and query builder, if LLM-based |
| TIMELINE | director prompt; only after TASK-141 is done, otherwise skip and note it |
| metadata | metadata prompt |

Injection rules:
- A block "Channel lessons for this step", with at most 5 notes and at most 600 characters in total.
- Count `uses` on each note.
- If the prompt token budget is tight, drop lessons before dropping research facts.

Agents also get the lessons:
- add `lessons` to the stage-agent context (`stageService` context, and the TASK-147 adapters if present);
- add a tool `get_stage_lessons` (risk `read`) for operators.

### 148c. Quality ledger (C)

**Table `stage_quality`:** one row per finished stage run.
- `project_id`, `profile_id`, `stage`, `job_id`, `executor` (app or `agent:<instance>`), `model_route`;
- `retries`, `duration_ms`, `cost_usd`;
- `metrics`: JSON per stage. Examples:

  | Stage | Metrics |
  |---|---|
  | SCRIPT | `quality_score`, critic `total` and per-criterion scores, the `[lint]` count by code, whether there are blocking facts |
  | VISUAL_SEARCH and VISUAL_REVIEW | vision reject rate, `VISUAL_NEEDS_USER` count, user swaps |
  | MUSIC_REVIEW | auto-picked or user-swapped, `MUSIC_NONE` |
  | TIMELINE | duration deviation from target |
  | RENDER | retries |

Write it from the stage executor completion hook, in one place, never in each executor.

**Trends:**
- Add `stageQualityTrend(profileId?, stage, days)`, returning a rolling mean against the previous window.
- Show a small table in the existing monitoring or analytics page: stage, last 14 days compared with the 14 before, executor and model.
- Add a tool `stage_quality_report` (risk `read`).

**Alerts.** Raise one when a stage's key metric drops more than 20 % over 14 days with at least 5 runs:
- create an improvement request through TASK-074c if it exists; otherwise create an operator finding or notification with the same evidence;
- never change prompts, models or settings automatically;
- dedupe by stage and metric per week.

### 148d. Visual query patterns (D, later)

- From `image_verdicts` and the scene queries, record per channel and topic tag: the query shape (has a proper noun, has a year, a generic word, a language), plus accept and reject counts.
- Give `visual_cache_query` and the visual scout context a short "queries that worked here" hint, with up to 5 examples.
- Code only; no LLM.
- Migration (adds `visual_query_patterns`), advisor's final ruling 2026-11-19: generate-then-trim. Run `drizzle-kit generate` and keep the generated 0096 snapshot and journal entry. Delete from the 0096 SQL every statement that rebuilds `missions` (including its PRAGMA pair and the two index statements). Do not touch 0093, 0095 or any applied file. Acceptance: a second `generate` reports no changes and the 0096 SQL names no `missions` statement. Test on a DB copy only, never `data/app.db`.
### 148e. Prompt and skill A/B (E, later)

- A prompt variant registry per stage (`stage_prompt_variants`: id, stage, text hash, status).
- An offline A/B through `bench:script` (145) for SCRIPT.
- A shadow run through the 074b shadow path for skills.
- A winner is promoted only by the user. Results are stored with the evidence.
- **Trạng thái (2026-11-19): chờ 074b-3a (cơ chế shadow).** Không chờ 074b-2 hay 074b-3b, vì 148e chỉ dùng cơ chế ghi lại lệnh dự kiến. Ước lượng và thứ tự: `docs/cursor/TASK-074-estimate-2026-11-19.md`. Phần prompt variant và A/B `bench:script` không phụ thuộc 074 và có thể làm trước.

### F. Retention per beat (noted, not built)

When YouTube retention curves are available (TASK-090 analytics), map the drop points to scene and beat ids, and feed them into 148a as feedback rows of kind `retention_drop`. Write the idea in ARCHITECTURE as future work.

## Docs and skills (rule 12)

- **`docs/ARCHITECTURE.md`:** the feedback, notes and quality flow; the injection caps; and that nothing self-edits.
- **User guide:** a section "Ứng dụng học từ chỉnh sửa của bạn", covering:
  - what is captured;
  - how to approve or undo lessons;
  - how to read the quality table;
  - the `featureMap` entries and a changelog line.
- **Tools:** `get_stage_lessons`, `propose_stage_note` (confirm) and `stage_quality_report`, plus MCP descriptions and permissions.
- **Skills:**
  - a new operating skill `video-hoc-theo-buoc`, covering when to read the ledger, how to propose a note with evidence, and never approving notes itself;
  - one line in each `video-stage-*` skill saying to read `get_stage_lessons` first;
  - a table row in `video-van-hanh-app`.

## Mã nguồn mở có sẵn (open source)

| Project | Licence | Use |
|---|---|---|
| This repo's `learningService` | ours | The approve and undo flow to copy |
| [langfuse/langfuse](https://github.com/langfuse/langfuse) | MIT (core) | Ideas for the quality ledger and prompt versioning. Do not add it as a service |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | MIT | Ideas for 148e A/B. Do not add the dependency without asking (rule 11) |
| [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy) | MIT | Background on prompt optimisation from feedback. Reading only |

No dependency is added. If one of these would replace a large part of 148e, report it instead of adding it.

## Rules

- README rules 1–12. Migration only through drizzle-kit; never edit a migration already applied anywhere. The only trim allowed is the never-applied 0096 SQL under 148d.
- Nothing changes prompts, models or settings without user approval.
- The protected project: no feedback rows, no ledger rows and no actions.
- Tests: mock LLM, in-memory DB, fixtures. No network.
- Stored text goes through `redactExportText`, with no secrets.

## Tests

- **148a:**
  - each save path writes the right feedback row;
  - the protected project writes none;
  - rows are capped and redacted;
  - distillation with the mock LLM produces at most 5 notes with evidence;
  - approve, reject and undo work;
  - agents only produce pending actions.
- **148b:**
  - approved notes appear in each listed prompt within the caps;
  - rejected and retired notes do not;
  - `uses` is counted;
  - the agent context includes lessons.
- **148c:**
  - one ledger row per completed run, written in one place;
  - the trend maths;
  - a 20 % drop raises one deduped request;
  - nothing is changed automatically.
- **148d and 148e:** tests for their parts when built.
- The existing learning, script, visual, music, timeline and operator suites stay green.

## Done

- [ ] 148a tables, capture paths, weekly distillation, approve or undo UI
- [ ] 148b injection into stage prompts and agent context, caps, tool
- [ ] 148c ledger, trends, table, alert to improvement request
- [x] 148d (done 2026-11-19) and [ ] 148e (later parts, separate reports allowed)
- [ ] migration generated with drizzle-kit
- [ ] tests; server, shared, mcp and web suites; typecheck; build
- [ ] ARCHITECTURE, user guide, featureMap, changelog, tools, skill `video-hoc-theo-buoc`, lines in `video-stage-*`
- [ ] report → `docs/tasks/TASK-148.report.md` and `docs/tasks/TASK-148.done`
