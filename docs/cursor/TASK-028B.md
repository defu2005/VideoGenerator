# TASK-028B — Cursor guide (automation review fixes)

Read `docs/cursor/README.md` and `docs/cursor/TASK-028.md` first. TASK-028 is implemented but uncommitted. Fix only the issues below in `apps/server/src/services/automationService.ts` (and the shared scheduling helpers if needed). Do not rewrite working code.

## 1. Auto-suggest calls the LLM every minute (cost bug)
`maybeAutoSuggest` runs on every 60 s tick. When `autoApproveTopics` is off, suggestions arrive as `PENDING`, the `APPROVED` count never rises, so the LLM is called again each minute.
- Count `PENDING` + `APPROVED` topics as the supply. Do not suggest when that supply already covers the free slots of the next 3 days.
- Add a cooldown: at most one auto-suggest per profile every 6 hours, success or failure. Use the `automation_log` (last auto-suggest entry for the profile) or a small in-memory map plus the log, so it also holds after a restart.

## 2. A render that finishes after its slot publishes late
In `finishCompletedProductions`, when `topic.scheduledFor` is already in the past (or less than 5 minutes ahead), never schedule the publication in the past. Move it to the next free slot (respect `videosPerDay`, the slots already assigned to other topics of the profile, and the profile timezone), update the topic's `scheduledFor`, and log at `warn` level "Dời lịch đăng …" with the old and new slot.

## 3. Log spam
"Có slot trống nhưng hết chủ đề APPROVED" is written every minute. Write it at most once per profile per 6 hours (same approach as the cooldown).

## Tests (fake clock, mock LLM, no network)
Add to `apps/server/test/automation.test.ts`:
- With auto-approve off and the topics stuck `PENDING`, 10 ticks over 10 minutes trigger only one suggest call. After 6 hours another is allowed if still needed.
- A render that finishes after the slot gets its publication at the next free future slot, never in the past.
- The "hết chủ đề" warning is written once across many ticks.

## Done
Done checklist from the README. Write `docs/tasks/TASK-028B.report.md` and `docs/tasks/TASK-028B.done`.
