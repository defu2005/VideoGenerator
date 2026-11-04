# TASK-031 report — Notifications + Telegram bot

## What changed

### Shared
- `packages/shared/src/schemas/notifications.ts` — `NotificationSettingsSchema`, status (+ `tokenConfigured`), pairing/token bodies, `NotificationEvent` discriminated union, log schemas, toggle/subject helpers
- `packages/shared/src/index.ts` — export notifications schemas

### Server
- `apps/server/src/db/schema.ts` — tables `app_secrets`, `notification_log`
- Migration `apps/server/drizzle/0026_talented_scarecrow.sql` (+ snapshot) via drizzle-kit
- `apps/server/src/publishing/tokenVault.ts` — `storeSecret` / `loadSecret` / `deleteSecret` / `hasSecret` (AES-GCM, key `telegram.botToken`)
- `apps/server/src/settings/notifications.ts` — settings + pairing code + poller offset + quiet queue + last daily summary date
- `apps/server/src/notifications/telegram.ts` — `TelegramClient` (getMe, sendMessage + HTML escape/split/429 retry, callbacks, getUpdates) + `TelegramPoller` (long poll, offset persist, backoff, pluggable handlers, `/start` pairing, `/status`, `/help`)
- `apps/server/src/notifications/notificationService.ts` — `notify` (toggles, quiet hours queue, dedup 6h, retry×3, never throws), daily summary, hourly token expiry / account error checks
- `apps/server/src/api/notifications.ts` — settings/token/pair/test/log routes (token never returned; invalid token → 400 tiếng Việt)
- `apps/server/src/lib/config.ts` — `WEB_BASE_URL` default `http://localhost:5180`
- Hooks: `publishService.markPublished/markFailed` + `setConnection`; orchestrator stage/render fail + `WAITING_USER` (AUTO stuck → attention); `writeAutomationLog` warn/error; `setAutomationPaused`; `PublishTicker.tick` → notification tick
- `apps/server/src/app.ts` / `fastify.d.ts` — wire service + poller (`onReady`/`onClose`, honor `WORKER_ENABLED`)
- Tests: `apps/server/test/notifications.test.ts`

### Web
- Page `/settings/notifications` — `NotificationsPage.tsx` + `notificationsApi.ts`
- Sidebar + route; test asserts token never shown back, pairing code shown, toggles save

## Test counts

| Workspace | After TASK-030 | After TASK-031 |
|---|---|---|
| shared | 208 | **208** |
| mcp | 12 | **12** |
| server | 466 | **478** |
| web | 95 | **96** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change.

## Live / browser check
- Không gửi Telegram thật (mock `fetch`).
- Phủ API token/pair/settings/log, pairing đúng/sai/hết hạn, poller offset, notify toggles/dedup/retry/quiet hours/daily summary, waiting_approval ASSISTED vs AUTO attention.
- Web: form không render lại token; hiện `/start …`; lưu toggle.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Quiet-hours queue lưu trong `app_settings` (`notification.quietQueue`) thay vì bảng riêng.
- Poller offset / pairing code / last daily summary date cũng qua `app_settings`.
- `waiting_approval` với `unexpectedAutoStop` map sang toggle `attention` (đúng rule “không phải yêu cầu duyệt”).
- Token expiry check chạy trong `NotificationService.tick` (gọi từ PublishTicker mỗi phút, tự giới hạn 1 lần/giờ).

## Not done
- No commit/push (per rules).
- Live bot Telegram với token thật của user (sau review).
- TASK-032 LLM assistant (handler text vẫn trả “Trợ lý AI sẽ có ở bản sau”).
