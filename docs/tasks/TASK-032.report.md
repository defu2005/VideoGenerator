# TASK-032 report — LLM assistant (web + Telegram)

## What changed

### Shared
- `packages/shared/src/schemas/assistant.ts` — conversations, messages, pending actions, settings (`confirmMode`), `AssistantChatStepSchema`, API bodies/responses
- `packages/shared/src/schemas/llm.ts` — task `assistantChat` (SETTINGS, fast, budgetFeature)
- `packages/shared/src/budget/modes.ts` — feature `assistantChat` trên mọi preset
- `packages/shared/src/index.ts` — export assistant schemas
- Tests: `llm.test.ts`, `budget.test.ts`; `BriefFields.tsx` + `ProjectDetailPage.test.tsx` CUSTOM toggle

### Server
- `apps/server/src/db/schema.ts` — `assistant_conversations`, `assistant_messages`, `assistant_pending_actions`
- Migration `apps/server/drizzle/0027_equal_hellcat.sql` (+ snapshot) via drizzle-kit
- `apps/server/src/settings/assistant.ts` — settings key `assistant`
- `apps/server/src/assistant/tools.ts` — catalog read/safe/confirm (không credential/token/OAuth)
- `apps/server/src/assistant/loop.ts` — vòng `generateRoutedStructured` tối đa 6 bước, clarify / pending / autoConfirm, retry lỗi tool 1 lần
- `apps/server/src/assistant/service.ts` — conversations, sendMessage (409 khi busy), confirm/reject/confirmAll, pending TTL 30 phút
- `apps/server/src/assistant/telegramBridge.ts` — thay placeholder: text → assistant, `/new` `/pause`, callback `pa:…`
- `apps/server/src/api/assistant.ts` — routes conversations/messages/actions/settings + confirm-all
- `apps/server/src/providers/llm/mock.ts` — `setAssistantChatScript` / `clearAssistantChatScript`
- `apps/server/src/notifications/telegram.ts` — `sendChatAction` (typing)
- `apps/server/src/notifications/notificationService.ts` — nút «Duyệt» cho `waiting_approval` → pending `approve_gate`
- `apps/server/src/app.ts` / `fastify.d.ts` — wire AssistantService + handlers
- Tests: `apps/server/test/assistant.test.ts` (11 cases)

### Web
- Page `/assistant` — `AssistantPage.tsx` + `assistantApi.ts`
- Sidebar «Trợ lý AI», chip clarify, thẻ pending, tool activity collapsible, công tắc «Tự động hết…»
- Test: gửi tin / confirm pending / quick-reply chips

## Test counts

| Workspace | After TASK-031 | After TASK-032 |
|---|---|---|
| shared | 208 | **208** |
| mcp | 12 | **12** |
| server | 478 | **490** |
| web | 96 | **99** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change.

## Live / browser check
- Không gọi LLM/Telegram thật (mock provider + mock `fetch`).
- Phủ API loop, pending/confirm/reject/expire/auto/delete-still-waits, catalog không credential, 409 concurrent, Telegram paired/unpaired/callback/`/pause`.
- Web: render reply, confirm API, chip gửi option.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Usage LLM ghi trên `assistant_messages.content.usage` (không insert `jobs` vì `project_id` FK bắt buộc và assistant không gắn project). «Mức dùng» theo job chưa cộng assistantChat.
- Nút thông báo `waiting_approval` chỉ có «Duyệt» (callback → pending `approve_gate`); không có nút «Xem» riêng (link đã nằm trong nội dung tin).
- `set_profile_automation` map `autoApprove` → `autoApproveTopics`; `autoPublish` cập nhật `publishSettings` của tài khoản hồ sơ nếu được truyền.

## Not done
- No commit/push (per rules).
- Live chat với model thật / bot Telegram của user (sau review).
- Ghi usage assistant vào bảng `jobs` / dashboard «Mức dùng» (cần quyết định project sentinel hoặc schema nullable).
