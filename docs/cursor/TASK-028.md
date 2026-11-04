# TASK-028 — Cursor guide (Topic queue and automation scheduler per profile)

Read `docs/cursor/README.md`, `TASK-022.md` and `TASK-024.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
Each profile produces and publishes videos **by itself**: it takes the next topic from its queue, creates an AUTO project, runs the pipeline to render, renders the formats its accounts need, then publishes on schedule. The user only fills or approves the topic queue, or lets the LLM suggest topics from the profile's direction.

## Topic queue
- Table `profile_topics`: `id`, `profile_id`, `topic`, `notes` (nullable), `source` (`USER` | `LLM`), `status` (`PENDING` | `APPROVED` | `IN_PRODUCTION` | `DONE` | `REJECTED` | `FAILED`), `priority` (int), `project_id` (nullable), `error` (nullable), `created_at`, `updated_at`.
- **LLM suggestions:** new `LlmTaskId` `topicSuggest` (LLM_TASKS entry, budget feature, mock answer). Input: the profile's direction, language, the last 50 topics of this profile (done, rejected and pending, so it does not repeat), and an optional user hint. Output: N topics with a one-line angle each. Deduplicate in code (normalised text, and a similarity check against past topics with a simple token-overlap ratio > 0.7).
- Suggestions arrive as `PENDING` unless the profile setting `autoApproveTopics` is on (default **off**). Only `APPROVED` topics are produced.
- When `APPROVED` topics run low (fewer than the next 3 days of slots) and `autoSuggest` is on, the scheduler asks for more.

## Schedule (per profile, JSON `automation` column on `profiles`)
- `enabled` (default false), `timezone` (default `Asia/Ho_Chi_Minh`), `videosPerDay` cap (1–10, default 1), `publishTimes` (list of `HH:mm`, e.g. `["19:00"]`), `leadTimeHours` (how long before a publish time production starts, default 6), `autoSuggest`, `autoApproveTopics`, `accountIds` (which of its accounts to publish to; default all enabled accounts).
- The **automation ticker** (reuse the TASK-024 ticker, every 60 s):
  1. For each enabled profile, compute the next publish slot that has no topic assigned and is within `leadTimeHours`.
  2. Respect `videosPerDay` (count projects created by automation for that profile on that local day).
  3. Take the highest-priority `APPROVED` topic, create a project from the profile (TASK-022 inheritance), with `mode: "AUTO"`, `autoRender: true`, set the topic to `IN_PRODUCTION`, start the pipeline.
  4. When the render finishes, call `render-variants` (TASK-023), then create publications (TASK-024) with `scheduledFor` = the slot, for the profile's selected accounts that have `autoPublish` on. Accounts without `autoPublish` get nothing; the user publishes by hand.
  5. Mark the topic `DONE`, or `FAILED` with the error when the pipeline fails. A failed topic does not block the next one.
- **Only one pipeline at a time** across all profiles (respect the existing worker concurrency). Queue the rest.
- **Missed slots** (the app was off): never publish late into the past. Move the slot's video to the next free slot that day, or the next day.
- **Global kill switch:** app setting `automationPaused`. A "Tạm dừng tất cả" button in the UI.
- Write an `automation_log` table (`id`, `profile_id`, `at`, `level`, `message`, `data` JSON) and keep 30 days.

## UI
- Profile page: a tab **"Tự động"** with the schedule form, the switches, and the next 7 days of slots (topic assigned, production status, publication status).
- A tab **"Chủ đề"**: the queue with drag-to-reorder (or up/down buttons), add a topic, "Gợi ý chủ đề" (with a hint field and a count), approve/reject per row and in bulk.
- A dashboard card "Tự động hóa": running profile, next production, today's count, recent errors.

## MCP
`list_topics`, `add_topic`, `suggest_topics`, `approve_topics`, `automation_status`.

## Tests (no network, mock LLM, fake clock)
- Suggest + dedupe; auto-approve off/on.
- Ticker: creates one project at the right time; respects the daily cap and the lead time; one pipeline at a time; missed slot rescheduled; paused switch.
- End-to-end with the mock pipeline and mock publisher: topic → project → render (stub) → publication scheduled at the slot.
- Web: the schedule form saves; the queue approves.

## Steps
1. Shared: schemas, task id, budget feature.
2. Server: tables + drizzle generate, suggest service, ticker logic (pure function for slot planning, well tested), routes, tests.
3. Web tabs, dashboard card + tests. MCP tools.
4. Done checklist (browser, throwaway profile with the mock publisher; never touch project `56374fb2-54cf-48ff-9441-2e6c653295d4`). Write `docs/tasks/TASK-028.report.md` and `docs/tasks/TASK-028.done`.
