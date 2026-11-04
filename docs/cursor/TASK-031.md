# TASK-031 — Cursor guide (notifications + Telegram bot)

Read `docs/cursor/README.md` first. This task adds an app-wide notification service and a Telegram bot channel. TASK-032 (the LLM assistant) builds on it later, so keep the Telegram transport reusable (send text, send buttons, receive messages and button presses).

No new npm dependencies: call the Telegram Bot API with `fetch` (`https://api.telegram.org/bot<token>/<method>`). Tests mock `fetch`; no network.

## 1. Settings and secret storage
- The bot token is a secret. Store it encrypted with `TokenVault` (`apps/server/src/publishing/tokenVault.ts`). Add small generic methods `storeSecret(key, value)`, `loadSecret(key)`, `deleteSecret(key)`. They reuse the same AES-GCM encryption in a new table `app_secrets` (key, ciphertext, iv, auth_tag, updated_at). Generate the migration with drizzle-kit. Key: `telegram.botToken`.
- Non-secret settings in a new settings module `apps/server/src/settings/notifications.ts`. Follow the existing settings modules for storage. Zod schema `NotificationSettingsSchema` goes in `packages/shared`. Fields:
  - `telegram.enabled: boolean` (default false);
  - `telegram.chatId: string | null`;
  - `telegram.botUsername: string | null` (from `getMe`);
  - `events`: toggles, all default true:
    - `attention`: errors and things that need you;
    - `published`;
    - `waitingApproval`;
    - `dailySummary`.
  - `dailySummaryTime: "HH:mm"` (default "21:00");
  - `timezone` (default `Asia/Ho_Chi_Minh`);
  - `quietHours?: { from, to } | null` (default null; while active, `published` and `dailySummary` are queued until it ends, but `attention` is still sent).
- API, routes in `apps/server/src/api/notifications.ts`:
  - `GET /api/notifications/settings`: never returns the token, only `tokenConfigured: boolean` and `botUsername`.
  - `PUT /api/notifications/settings`.
  - `PUT /api/notifications/telegram/token`, with body `{ token }`: validates it with `getMe`, stores it encrypted and saves `botUsername`. An invalid token returns 400 with a Vietnamese message.
  - `DELETE /api/notifications/telegram/token`.
  - `POST /api/notifications/telegram/pair`: returns a one-time 6-digit code valid for 10 minutes.
  - `POST /api/notifications/test`: sends "Video Agent: thông báo thử".
  - `GET /api/notifications/log`: last 100 entries.

## 2. Pairing and security (important)
- The bot answers **only** the paired chat. Pairing: the user presses "Ghép nối" in the web UI, gets a code, then sends `/start <code>` to the bot. The poller sees a matching, unexpired code, saves that `chat.id` as `chatId` and replies "Đã ghép nối với Video Agent".
- Every update from any other chat is ignored and gets no reply; log it at debug level. Only private chats can pair.
- Never log the token or put it in error messages. Mask it in any error text from `fetch` because the URL contains it.

## 3. Telegram transport `apps/server/src/notifications/telegram.ts`
- `TelegramClient`:
  - `getMe`, `sendMessage(chatId, text, { buttons? })`. `buttons` is an inline keyboard of `{ text, data }` rows, with `callback_data` ≤ 64 bytes.
  - `answerCallbackQuery`, `editMessageReplyMarkup`, `getUpdates(offset, timeoutSec)`.
  - Use `parse_mode: "HTML"` and escape `& < >` in every dynamic value.
  - Split messages over 4000 characters.
  - On 429, wait `retry_after` and retry once.
- `TelegramPoller`:
  - Long polling (`getUpdates` with timeout 25 s) runs only when `enabled` and a token exists. Start and stop it with the server, like `PublishTicker` (`onReady` / `onClose`, honor `WORKER_ENABLED`). Settings changes restart it.
  - Persist the update `offset` so updates are not processed twice after a restart.
  - Back off on network errors (5 s → 60 s max).
  - It dispatches incoming messages and button presses to a pluggable handler: `setMessageHandler(fn)` and `setCallbackHandler(fn)`. For this task, the handler only handles `/start <code>`, `/status` (a short automation status) and `/help`. Any other text gets the reply "Trợ lý AI sẽ có ở bản sau" (TASK-032 replaces it).
- No webhooks: the app runs locally.

## 4. Notification service `apps/server/src/notifications/notificationService.ts`
- `notify(event: NotificationEvent)`. A shared zod discriminated union in `packages/shared` with these kinds:
  - `publish_succeeded`: profile, account, platform, title, url;
  - `publish_failed`: plus error;
  - `render_failed`: project, error;
  - `stage_failed`: project, stage, error;
  - `waiting_approval`: project, gate, link to the web page;
  - `token_expiring`: account, expiresAt;
  - `account_error`: account, error;
  - `automation_warning`: profile, message, from `automation_log` entries at `warn` or `error` level;
  - `automation_paused`: the kill switch;
  - `daily_summary`.
- Map kinds to the four toggles:
  - `published` → `publish_succeeded`;
  - `waitingApproval` → `waiting_approval`;
  - `dailySummary` → `daily_summary`;
  - everything else → `attention`.
- Vietnamese message templates, short, with an emoji status prefix (✅ ❌ ⚠️ ⏸ 📊). Include a link to the local web page (`config` web base URL, default `http://localhost:5180`) where it makes sense.
- **Dedup:** the same kind + subject (publication id, project+stage, account) is sent at most once per 6 hours. Store this in a table `notification_log` (id, at, kind, subject_key, channel, status sent/failed/skipped, message, error). Old rows are deleted after 30 days. Failed sends retry with backoff 3 times, then stay `failed`.
- When Telegram is disabled or unpaired, `notify` only writes the log as `skipped`. It never throws into the caller: notification failures must not break publishing or the pipeline.

### When to send `waiting_approval` (user rule)
Send it only when a gate actually enters `WAITING_USER` and is waiting for a person. Do **not** send it (and log nothing) when the project runs fully automatic: AUTO mode, or a project created by automation (TASK-028) whose gates are auto-decided. In those runs nothing waits for the user, so there is nothing to approve. If an AUTO run still ends up stuck at a gate (unexpected), send it as `attention` ("Dự án tự động bị dừng ở …"), not as an approval request.

## 5. Hook points (call `notify`, wrapped so it never throws)
- `publishService`: where a publication becomes `PUBLISHED` or `FAILED` (final failure only, not each retry).
- Pipeline orchestrator / job worker: a stage becomes `FAILED`; a gate becomes `WAITING_USER` (apply the rule above). Render failures come through the RENDER stage or `renderService`; send one notification, not two.
- `automationService`: every `automation_log` insert at level `warn`/`error` → `automation_warning`. Its 6 h dedup and the existing log dedup from TASK-028B keep this quiet. The kill switch → `automation_paused`.
- Token expiry: once per hour (reuse the publish ticker), check connected accounts. Expiring within 3 days and not auto-refreshable → `token_expiring`. A connection check that fails → `account_error`.
- **Daily summary:** a timer at `dailySummaryTime` in `timezone`, at most once per day; remember the last sent date. Content:
  - videos produced and published today, per profile and platform;
  - failures;
  - LLM cost today (reuse `usageService`);
  - the next 24 h of scheduled publications;
  - topics left in each profile queue.

## 6. Web UI
New page "Thông báo" in the sidebar (`/settings/notifications`):
- **Telegram setup steps**, in Vietnamese: create a bot with @BotFather, paste the token (password field, never shown back), press "Lưu".
- **Status:**
  - bot name;
  - paired chat or "Chưa ghép nối";
  - button "Ghép nối", which shows the code and the text `/start 123456` with a copy button, plus the `t.me/<botUsername>` link;
  - button "Gửi thử";
  - toggle "Bật thông báo Telegram".
- **Event toggles** with Vietnamese labels: "Lỗi / cần chú ý", "Đăng thành công", "Chờ duyệt (chỉ khi không chạy tự động)", "Tóm tắt hằng ngày". Also: summary time, timezone, quiet hours.
- **Log table:** time, kind, status, message.

## 7. Tests (mock fetch, fake clock, no network)
Server:
- The token is stored encrypted and is never in any API response or log.
- An invalid token gives 400.
- Pairing:
  - the right code pairs;
  - a wrong or expired code does nothing;
  - a message from an unpaired chat is ignored and gets no reply.
- The poller persists the offset and backs off on errors.
- `notify`:
  - respects the toggles;
  - dedups for 6 h;
  - retries;
  - never throws when Telegram fails;
  - logs `skipped` when disabled.
- `waiting_approval`: sent for an ASSISTED project at a gate; **not** sent for an AUTO / automation project.
- A publish success and a final failure each send one message; a retry that later succeeds sends no failure message.
- HTML escaping; splitting of long messages.
- The daily summary is sent once per day at the set time in the timezone, and is held during quiet hours.

Web: the settings form never renders the token back; the pairing code is shown; the toggles save.

## Done
Done checklist from the README. Write `docs/tasks/TASK-031.report.md` and `docs/tasks/TASK-031.done`.
