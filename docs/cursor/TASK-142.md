# TASK-142 — Batch factory: one order → many varied videos, with variants 🏭🎞

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** L. **Migration:** one (drizzle-kit only). **New dependency:** none.
**Depends on:** 129c (recipes and fleet placement), 140 (scorecard and `auto_if_score`), 136 (LLM relay, so quota is one pool), 137/138 (storage and GC at volume). Run it alone among migration tasks.
**Source:** RESEARCH-076 P1 "batch with diversity" and [SCALE-PLAN.md](SCALE-PLAN.md) row 9.

## Why

- Today a batch means the topic queue (Hermes scouts → `topic_queue` → autopilot) creating projects one by one with the same recipe, style and hook pattern.
- At volume this has three problems:
  - the videos look alike → platforms label the channel "mass-produced / reused content" (YouTube inauthentic content policy, TikTok originality);
  - each aspect ratio or language is a new full project → script, search and voice are paid again;
  - nothing plans the batch against quota, render capacity and publish slots, so it stalls half-way.

## Read first

- `topics/*` (topic queue), `operator/autopilot.ts`, recipes and placement from 129a/129c, `publishing/schedule*`.
- `originality/*` (113 similarity), `services/usageService.ts`, `providers/llm/quota.ts`, `jobs/resourceGovernor.ts`.
- Project creation and cloning, `style/*` profiles, hook templates (066), TTS voices and the dubbing path if one exists (`services/ttsService.ts`, translation task notes).

## Build

### 1. Batch order (migration)

- Table `batch_orders`: `id`, `workspace_id`, `name`, `spec` JSON, `status` (`draft|planned|running|paused|done|cancelled`), `created_by`, timestamps.
- Table `batch_items`: `id`, `batch_id`, `project_id` (nullable until created), `channel_id`, `variant_of` (nullable item id), `plan` JSON (recipe, style, hook, voice, length, aspect, language), `status`, `score` (from 140), `error`.
- `spec`:
  - topics (explicit list or "from queue, N items");
  - channels with count per channel;
  - variant matrix: aspects (`9:16`, `16:9`, `1:1`) and languages;
  - publish window and slots per day per channel;
  - budget cap (USD and minutes of render).

### 2. Planner (code, then one LLM call for hooks only)

- `planBatch(order)` builds items with a **diversity allocation**:
  - round-robin with weights over allowed recipes, style profiles, hook types, voices and lengths per channel;
  - no two items in a channel within the same publish week share (recipe, style, hook type);
  - 113 similarity of the planned titles/outlines against the channel's last 30 videos must stay under the threshold, else re-allocate.
- One LLM call per batch proposes distinct hook angles for the topics (validated, deduplicated); the rest is code.
- **Feasibility estimate** before start, shown to the user:
  - LLM tokens and cost from `pricing.ts` against relay grants and workspace budget;
  - render minutes against fleet capacity (129c placement, governor);
  - publish slots against the window.
  - Infeasible → the planner says which limit and proposes a smaller N or a longer window. Never starts silently over budget.

### 3. Master + variants

- Each topic produces one **master** item (the full pipeline at the channel's main aspect and language).
- **Aspect variants** reuse the master's script, voice, subtitles and selections. They re-run only TIMELINE (with reframing: safe-area aware crop of footage, template layouts per aspect) and RENDER. Implement as a project clone that copies stage outputs and marks those stages DONE with the master's `inputVersion` lineage (134), so invalidation still works.
- **Language variants** reuse selections and timing structure: translate the script (one LLM call), re-run VOICE and SUBTITLES, re-time the timeline to the new voice, then RENDER. Titles and descriptions are translated in the same call.
- Variants inherit the master's 140 scorecard for script/visual dimensions and are re-scored for audio, captions and technical.

### 4. Run control

- The batch runs through the normal autopilot and placement: items become projects with the item plan applied; the batch only schedules and watches.
- Concurrency per batch (setting), pause/resume/cancel, and an automatic pause when:
  - the budget cap is reached;
  - more than 20 % of finished items are held by 140 (quality drift);
  - an originality block hits two items in a row.
- Publishing uses the existing scheduler with the batch's slots; publish gates (083) are unchanged.

### 5. UI and tools

- "Sản xuất hàng loạt" page: create order (wizard), feasibility, item grid (status, score, variant tree), pause/resume, per-item links.
- Tools: `plan_batch` (dry-run plan + feasibility, no side effects), `get_batch` (read). Starting a batch is a confirm-risk action (pending action the user approves, TASK-047 rules).

## Mã nguồn mở có sẵn (open source)

- **ShortGPT / AutoShorts** batch modes: one config → many shorts. Idea only.
- **Latin-square / round-robin allocation**: textbook method for diversity; write it in code.
- **FFmpeg `cropdetect` + saliency crop ideas** (e.g. autoflip from MediaPipe, Apache-2.0): reframing for aspect variants. Idea only unless a small permissive piece fits; report before adding.

## Rules

- README rules 1–11. Migration only through drizzle-kit.
- Never include the protected project `56374fb2-…` in a batch, as a master or a source to clone.
- Tests: mock LLM, fake fleet and governor, no network, no real render (use the fake ffmpeg path).

## Tests

- Allocation: 12 items over 2 channels, 3 recipes, 3 styles → no repeated (recipe, style, hook) per channel-week; similarity re-allocation triggers on a fixture near-duplicate.
- Feasibility: over budget → refused with the limit named and a smaller N proposed.
- Aspect variant: only TIMELINE and RENDER run; editing the master script invalidates the variant.
- Language variant: VOICE, SUBTITLES, TIMELINE, RENDER run; selections reused.
- Auto-pause on budget, on 140 hold rate and on two originality blocks.
- Start requires a user-approved pending action; `plan_batch` has no side effects.

## Done

- [ ] tables, planner with diversity allocation, feasibility
- [ ] master + aspect + language variants with lineage
- [ ] run control (concurrency, pause rules); UI; tools
- [ ] tests; shared + server + web suites; typecheck; build
- [ ] `docs/ARCHITECTURE.md`, user guide (Sản xuất hàng loạt), changelog
- [ ] report → `docs/tasks/TASK-142.done`
