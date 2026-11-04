# TASK-024B — Cursor guide (account management UI gaps)

Read `docs/cursor/README.md` and `docs/cursor/TASK-024.md` ("Account credentials and automatic sign-in") first. TASK-024 is implemented but uncommitted; the server API is in place. This task fills the gaps in the **account page UI** (`apps/web/src/features/profiles/ProfileDetailPage.tsx`, tab "Tài khoản"). Keep changes small and focused; do not rewrite TASK-024 code that works.

## Server (small)
1. Add `canConnect: boolean` and `connectBlockedReason: string | null` (Vietnamese) to `PublishService.connectionDetail()` and its API response schema:
   - `false` with "Nền tảng này chưa được hỗ trợ đăng tự động" when the registry has no publisher for the platform (today: every real platform until TASK-025/029/030).
   - `false` with "Chưa có thông tin ứng dụng (nhập ở mục Thông tin ứng dụng hoặc đặt trong .env)" when neither the vault app credentials nor the `.env` fallback exist. Add a small publisher hook or a registry/config helper for the env fallback check; for `mock`, credentials are not needed.
   - else `true`, `null`.
2. Test it in `apps/server/test/publishing.test.ts`.

## Web (account card, per account)
Fetch `getAccountConnection` for each account (React Query, key per account; invalidate after every action). Show:
- **Identity:** display name, handle, external id (when connected), token expiry (date-time, red "Sắp hết hạn" if < 7 days), scopes granted (small chips), last check time, connection error text when `EXPIRED`/`ERROR`.
- **Thông tin ứng dụng** section: status "Đã cấu hình (…<idHint>)" or "Chưa cấu hình (dùng .env nếu có)". A form with two fields whose labels depend on the platform (YouTube: Client ID / Client Secret; TikTok: Client Key / Client Secret; Meta: App ID / App Secret), the secret field `type="password"` and `autoComplete="off"`, saved via `PUT .../app-credentials` (add `saveAppCredentials` and `deleteAppCredentials` to `publishApi.ts`). Clear the inputs after saving; never prefill or show the secret. Button "Xóa thông tin ứng dụng" (confirm dialog) when configured. Hide this section for `mock`.
- **Actions:** "Kết nối" / "Kết nối lại" (disabled with `connectBlockedReason` as the visible hint when `canConnect` is false), "Kiểm tra kết nối" (when connected; shows a pending state and the result), "Ngắt kết nối" (confirm dialog), existing "Sửa" / "Xóa".
- Keep the redirect URI line with the copy button.

## Tests
Web tests (no network, mock the api module): credentials form submits and clears, secret never rendered back, connect disabled with the reason, "Kiểm tra kết nối" calls the API, expiry warning.

## Done
Done checklist from the README. Write `docs/tasks/TASK-024B.report.md` and `docs/tasks/TASK-024B.done`.
