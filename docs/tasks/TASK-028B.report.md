# TASK-028B report — Automation review fixes

## What changed

### Shared
- `packages/shared/src/automation/slots.ts` — `pickNextFreePublishSlot` (next free publish ≥5 min ahead, skips assigned slots, respects `videosPerDay` per local day)
- `packages/shared/test/automation.test.ts` — coverage for the new helper

### Server
- `apps/server/src/services/topicService.ts` — `countTopicSupplySync` (PENDING + APPROVED)
- `apps/server/src/services/automationService.ts`:
  1. **Auto-suggest cost bug:** supply = PENDING + APPROVED; skip when supply already covers free slots of the next 3 days; 6 h cooldown per profile (success or failure) via `automation_log` `data.kind = "autoSuggest"` + in-memory map
  2. **Late finish:** if `scheduledFor` is past or &lt;5 min ahead, move to next free future slot, update topic, warn log `Dời lịch đăng …`; never create a publication in the past
  3. **Log spam:** «Có slot trống nhưng hết chủ đề APPROVED» at most once per profile per 6 h (`data.kind = "noApprovedTopics"`)
- `apps/server/test/automation.test.ts` — three new ticker tests (suggest cooldown, late reschedule, hết-chủ-đề once)

No schema / migration change. Second `drizzle-kit generate` → “No schema changes”.

## Test counts

| Workspace | After TASK-028 | After TASK-028B |
|---|---|---|
| shared | 207 | **208** |
| mcp | 12 | **12** |
| server | 430 | **433** |
| web | 93 | **93** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. No `package.json` / lockfile change.

## Live / browser check
- Behaviour covered offline by server tests (fake clock, mock LLM, mock publisher).
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- «Hết chủ đề» test asserts once across many ticks only (guide wording); the 6 h re-allow path is the same cooldown helper as auto-suggest and is covered there.
- If no future free slot exists when finishing late, publication is skipped and a warn is logged (never past schedule).

## Not done
- No commit/push (per rules).
