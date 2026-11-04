# TASK-028 report — Topic queue + automation scheduler per profile

## What changed

### Shared
- `packages/shared/src/schemas/automation.ts` — `ProfileAutomation`, topic queue schemas, suggest/approve/reorder, automation log/status/slots view, kill-switch schema
- `packages/shared/src/automation/slots.ts` — timezone slot planning, lead-time pick, missed-slot reschedule, topic normalize/dedupe
- `packages/shared/src/schemas/profile.ts` — `automation` on profile create/update/detail
- `packages/shared/src/schemas/llm.ts` — `topicSuggest` task + `LLM_TASKS` entry
- `packages/shared/src/budget/modes.ts` — budget feature `topicSuggest: true` in every preset (not in pipeline `estimateBudget`)
- `packages/shared/src/schemas/dashboard.ts` — optional `automation` card on dashboard stats
- Tests: `packages/shared/test/automation.test.ts`; updates in `budget.test.ts`, `llm.test.ts`

### Server
- `apps/server/src/db/schema.ts` — `profiles.automation` JSON; tables `profile_topics`, `automation_log`
- Migration `drizzle/0025_fat_lucky_pierre.sql` (+ snapshot); second `drizzle-kit generate` → “No schema changes”
- `services/topicService.ts` — CRUD, approve/reorder, LLM suggest + dedupe, sync helpers for ticker
- `services/automationService.ts` — slot-driven production start, finish→variants→publish, autoSuggest, status/view, log prune 30 days
- `services/automationSettings.ts` — global `automationPaused` in `app_settings`
- `publishing/ticker.ts` — reuses 60s tick for automation
- `api/automation.ts` — settings pause, status, profile automation view, topic routes
- `api/dashboard.ts` — attaches automation card
- `providers/llm/mock.ts` — `TopicSuggest` answer
- `profileService.ts` / `app.ts` / `fastify.d.ts` — wire automation
- Tests: `apps/server/test/automation.test.ts` (suggest/dedupe/approve, ticker lead/cap/pause/missed/one-pipeline, e2e mock publish)

### Web
- Tabs **Chủ đề** / **Tự động** on profile detail (`TopicsTab.tsx`, `AutomationTab.tsx`)
- Dashboard card “Tự động hóa” + “Tạm dừng tất cả”
- `automationApi.ts`, `useAutomation.ts`, CSS for queue/slots
- `BriefFields.tsx` — CUSTOM toggle `topicSuggest`
- Tests: `AutomationTopics.test.tsx` (save schedule, approve topic)

### MCP
- Tools: `list_topics`, `add_topic`, `suggest_topics`, `approve_topics`, `automation_status`
- `apiClient.ts` + `tools.test.ts` catalog update

## Test counts

| Workspace | After TASK-027 | After TASK-028 |
|---|---|---|
| shared | 199 | **207** |
| mcp | 12 | **12** |
| server | 420 | **430** |
| web | 91 | **93** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. No `package.json` / lockfile change.

## Live / browser check
- UI covered offline by web tests (schedule save + approve on profile tabs; dashboard card renders when `automation` is present).
- Server e2e uses mock LLM + mock publisher; worker disabled; fake clock for lead time.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Added nullable `scheduled_for` on `profile_topics` (needed to bind a topic to a publish slot and drive the 7-day UI); not listed in the guide’s column list but required by the behaviour.
- `renderMissingVariants` failures (e.g. no timeline yet) are logged as warnings; publish still proceeds when a DONE render exists.
- `topicSuggest` is a budget feature in every mode but **not** counted in pipeline `estimateBudget` (settings/automation call, like `modelAdvisor`).

## Not done
- No commit/push (per rules).
