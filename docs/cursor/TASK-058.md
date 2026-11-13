# TASK-058 — Cursor guide (friendlier platform account sign-in: input checks, readable OAuth results, no stray accounts, correct "Kiểm tra tất cả")

Read `docs/cursor/README.md` first. Tests never use the network: mock `fetch` for every platform call. Update the user guide, `featureMap` and `nhat-ky-thay-doi.md` (README rule 10).

No new npm dependencies. No migration is expected; if you do need a column, change `schema.ts` and run `npx drizzle-kit generate`.

Builds on TASK-056 (Accounts page, `AddAccountWizard`, platform apps in TokenVault). It edits the accounts UI, the OAuth routes and the connection catalog. Run it after TASK-057 has finished.

## Why

A real user tried to connect YouTube and hit Google's page "Lỗi 401: invalid_client … flowName=GeneralOAuthFlow". The cause was that the Client ID saved for YouTube was the email `otakuovn@gmail.com`. Nothing in the app caught it. A review of the flow found these problems:

| # | Today | Problem |
|---|---|---|
| 1 | The wizard and the Connections page save any text as Client ID or Client Secret. | An email or other junk is only caught on the platform's own error page, and the user cannot tell what went wrong. |
| 2 | `GET /api/oauth/:platform/callback` throws `AppError` on `error=`, a bad state or a failed code exchange, so the user's new tab shows raw JSON such as `{"error":{"code":"OAUTH_DENIED",...}}`. The account's `connection` is never set to `ERROR`. | The wizard keeps showing "Đang chờ bạn đăng nhập…" forever, and the user sees JSON. |
| 3 | On success the callback redirects the new tab to the profile page. | The user ends up with two app tabs, while the wizard tab also moves to "Xong". |
| 4 | Step 1 of the wizard creates the account before the app step and sign-in. | Cancelling leaves "Chưa kết nối" rows behind. The test machine has 5 of them and none are connected. |
| 5 | Step 1 asks for "Tên hiển thị". | The user typed their Gmail address there, and it became the account name. The real channel name only arrives after sign-in. |
| 6 | Each row on the Accounts page has only "Chuyển hồ sơ". | There is no way to connect, reconnect or delete an account from that page. |
| 7 | The YouTube how-to has 3 short lines, and there is no error help. | The consent screen, test users, where to copy the Client ID, the 7-day token limit in Testing mode and common Google errors are all missing. |
| 8 | "Kiểm tra tất cả" skips `NOT_CONNECTED` accounts and counts only failed checks. | With 5 unconnected accounts it checks nothing and reports "Mọi tài khoản đều hoạt động." |

Goal: a first-time user can connect a channel by following the screen alone, every failure shows a Vietnamese reason and the next step, and no status message claims something it did not check.

## Rules for this task

- The client ID or app ID may be shown masked, as the existing `hint` does. The client secret is never returned to the browser, logged or put in a URL. Error texts from platforms are passed through the existing redaction helper before they are stored or shown.
- No assistant, MCP or operator tool may read, save or delete app credentials, and none may start OAuth. This is unchanged.
- Never create or call real platform apps in tests. Tests mock the HTTP responses.
- Keep PKCE, state and the TikTok hex challenge exactly as they are.

## 1. Credential format checks (problem 1)

Put the rules in `@vg/shared` (next to `packages/shared/src/connections/catalog.ts`), so the web and the server use the same code: `validatePlatformAppInput(platform, { clientId, clientSecret })` returns `{ ok, errors: { clientId?: string, clientSecret?: string }, warnings: [...] }` with Vietnamese messages.

- Trim the input first. Reject an empty value, inner whitespace or line breaks, and any value containing `@`. For `@`, the message is "Đây là email, không phải Client ID. Client ID nằm trong Google Cloud → Credentials → OAuth 2.0 Client IDs." (adapt the wording for each platform).
- **YouTube / Google:**
  - The Client ID must match `^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$`, otherwise it is an error.
  - A Client Secret that does not start with `GOCSPX-` gets a warning, not an error, because older secrets have another shape.
  - Also check that the ID and the secret are not swapped.
- **TikTok and Meta:**
  - A Meta App ID must be digits only.
  - TikTok client key: check the TikTok for Developers docs for the real format. If the docs do not state one, only apply the generic rules above.
  - Write in the report which formats you verified from docs.
- **Web:**
  - Validate as the user types, in the wizard (`AddAccountWizard.tsx`) and wherever the Connections page edits platform apps.
  - Show errors under the field and block "Lưu và tiếp" while there are errors. Show warnings without blocking.
- **Server:** `PUT /api/connections/platform-apps/:platform` (and the per-account app-credential route, if it takes the same input) runs the same check and answers 400 `INVALID_APP_CREDENTIALS` with the Vietnamese field messages.
- **Already-saved bad values:**
  - `GET /api/connections/platform-apps/:platform` gains `problems: string[]`. Compute it server-side from the stored values without returning them, for example "Client ID đã lưu không đúng dạng của Google".
  - The wizard app step and the Connections page show it in a warning box, together with a "Nhập lại" button that opens the form.
  - The stored `otakuovn@gmail.com` case must show this warning.

## 2. "Kiểm tra ứng dụng" before sign-in (problems 1 and 7)

Add `POST /api/connections/platform-apps/:platform/verify` (with the same profile/account scoping as GET). It checks that the saved app is accepted by the platform, without signing anyone in:

- **Google:**
  - POST to the token endpoint with `grant_type=authorization_code`, a dummy code, the saved ID and secret, and the app's redirect URI.
  - `invalid_client` / `unauthorized_client` → `{ ok: false, reason: "Google không nhận Client ID hoặc Client Secret này" }`.
  - `invalid_grant` → `{ ok: true }`: the credentials were accepted, and only the dummy code was rejected.
  - `redirect_uri_mismatch` → the redirect URI message from section 3.
  - Check Google's OAuth docs for these error codes and note in the report what you verified.
- **TikTok and Meta:** add the same check only if their docs show a call that tells "bad app" apart from "bad code" without user consent. Otherwise return `{ ok: null, reason: "Nền tảng này chưa hỗ trợ kiểm tra trước" }`, and the UI then hides the button.
- The UI has a "Kiểm tra ứng dụng" button in the wizard app step and on the Connections page, with a result line:
  - green "Ứng dụng hợp lệ";
  - red with the reason;
  - neutral "Chưa hỗ trợ".
- Never return the platform's raw response body. Map it to the Vietnamese reason and, if useful, the error code.

## 3. Readable OAuth results (problems 2 and 3)

Change `apps/server/src/api/oauth.ts`:

- **Errors on the callback:** for every failure (`error=` from the platform, missing code/state, unknown or expired state, a failed code exchange, failed identity fetch), do not throw JSON. Instead:
  1. When the account is known (from the state), set it to `ERROR` with a Vietnamese message using `publish.setConnection`, so the wizard's polling picks it up.
  2. Reply `200 text/html` with a small result page (see below).
- **The result page:**
  - It is a self-contained HTML page with `lang="vi"`, inline CSS, no external assets and no scripts except `window.close()` behind a button.
  - All dynamic text is HTML-escaped.
  - Send headers `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`, `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
  - Content:
    - **Success:** "Đã kết nối <tên kênh> (<handle>)". The page explains "Bạn có thể đóng tab này và quay lại app." and has a "Đóng tab" button plus a link to the Accounts page.
    - **Failure:** the title "Chưa kết nối được", the reason, what to do next and a link back.
- **Error mapping:** put it in one function with unit tests. Map at least:
  - `access_denied` → "Bạn đã từ chối quyền truy cập. Bấm Đăng nhập lại và chọn Cho phép."
  - expired or unknown state → "Phiên đăng nhập đã hết hạn (hoặc app vừa khởi động lại). Mở lại trang đăng nhập từ app."
  - `invalid_client` → wrong Client ID/Secret, with a link to the app step
  - `redirect_uri_mismatch` → "Thêm đúng redirect URI này vào ứng dụng: <uri>"
  - `invalid_grant` → "Mã đăng nhập đã dùng hoặc hết hạn, hãy đăng nhập lại."
  - Google `org_internal` / `admin_policy_enforced` and "app in Testing, user is not a test user" (`access_denied` with that description) → "Thêm email này vào Test users trong OAuth consent screen."
  - anything else → a generic message plus the short error code
- **Meta:** keep the existing success redirect with `metaPick`, because the user must still choose a Page there. Only errors use the HTML page.
- **Google errors that never reach the callback:**
  - Google's own 401 `invalid_client` page shows *before* any redirect, so the app cannot see it.
  - After 20 s of waiting, the wizard connect step shows a "Trang đăng nhập báo lỗi?" panel. It lists the 3 common Google errors (401 invalid_client, 400 redirect_uri_mismatch, 403 access_denied / chưa là test user) with a one-line fix each, plus buttons "Kiểm tra ứng dụng" (section 2) and "Sửa ứng dụng" (back to the app step).
  - The panel is driven by data in the catalog (section 6), not hard-coded in the component.

## 4. No stray accounts and a clearer first step (problems 4 and 5)

- **Remove "Tên hiển thị" from step 1.**
  - Step 1 only asks for the platform and the profile.
  - Create the account with the platform label as its temporary name, as now.
  - Sign-in already fills the real channel name. The "Xong" step gets an optional "Đổi tên gợi nhớ" field, which saves through the existing account update route.
  - If you keep a name field anywhere, a value with `@` shows the hint "Tên gợi nhớ, không phải email đăng nhập".
- **The wizard cleans up after itself.**
  - When the wizard closes before "Xong" (Huỷ, ✕, Esc or backdrop), it deletes the account it created in this run, using `DELETE /api/profiles/:id/accounts/:accountId`. It only does this if that account is still `NOT_CONNECTED` or `ERROR` and was created by this wizard run.
  - A toast says "Đã huỷ thêm tài khoản".
  - It never deletes accounts it did not create.
- **Resume an existing account.** `AddAccountWizard` gets an optional `accountId` prop. When it is set, the wizard skips step 1, starts at the app step if the app has `problems` or is not configured, and otherwise starts at the connect step. Reconnect uses this.
- **Existing stray accounts:** do not delete them automatically. Section 5 gives the user a delete button.

## 5. Accounts page actions and "Kiểm tra tất cả" (problems 6 and 8)

`apps/web/src/features/accounts/AccountsPage.tsx`:

- **Row actions:**
  - A row that is `NOT_CONNECTED` gets "Kết nối"; a row that is `EXPIRED` or `ERROR` gets "Kết nối lại". Both open the wizard with `accountId`.
  - Every row has "Xoá", with a confirm dialog that names the account and says scheduled posts for it will stop. It uses the existing delete route.
  - Keep "Chuyển hồ sơ".
- **"Kiểm tra tất cả":**
  - It checks only `CONNECTED`, `EXPIRED` and `ERROR` accounts.
  - The summary counts each group and never says everything works when something was skipped or not connected:
    - "Đã kiểm tra 3 tài khoản: 2 hoạt động, 1 cần kết nối lại. 5 tài khoản chưa kết nối."
    - With nothing to check: "Chưa có tài khoản nào đã kết nối để kiểm tra. 5 tài khoản chưa kết nối — bấm Kết nối ở từng dòng."
  - Use `toast.success` only when every account was checked and all of them work. Otherwise use the warning or error tone.
  - Disable the button (with a tooltip or hint) when no account is connected.
  - Move the counting into a pure function (like `filterAccounts`) and unit-test it.
- **The attention banner:** it now separates "chưa kết nối" from "hết hạn/lỗi", for example "5 tài khoản chưa kết nối · 1 tài khoản cần kết nối lại".
- **`ProfileDetailPage`:** if its accounts tab has its own connect/check logic with the same skip bug, fix it the same way and reuse the shared summary function.

## 6. Better how-to and error help in the catalog (problem 7)

In `packages/shared/src/connections/catalog.ts`:

- **YouTube steps** (keep them short):
  1. Tạo hoặc chọn dự án trong Google Cloud.
  2. Bật YouTube Data API v3 (APIs & Services → Library).
  3. Cấu hình OAuth consent screen: loại External, điền tên app và email.
  4. Thêm email của từng kênh vào Test users.
  5. Credentials → Create credentials → OAuth client ID → loại **Web application**.
  6. Thêm redirect URI bên dưới vào Authorized redirect URIs.
  7. Sao chép **Client ID** (đuôi `.apps.googleusercontent.com`) và **Client Secret** (đầu `GOCSPX-`) vào đây.
- **The 7-day note:**
  - Add it as a separate `noteVi`: "Khi ứng dụng còn ở chế độ Testing, Google thu hồi quyền sau 7 ngày và bạn phải đăng nhập lại. Bấm Publish app trong OAuth consent screen để hết bị; Google sẽ hiện cảnh báo 'chưa xác minh', bấm Advanced → tiếp tục."
  - Also explain that the quota is per Google Cloud project, shared by every channel using that app, and that "Chỉ hồ sơ này" lets a profile use a separate project.
- **New field `troubleshootVi`:** a list of `{ code, titleVi, fixVi }` per platform, used by sections 3 and 5. Fill it for Google from section 3. For TikTok and Meta, add only errors you verified in their docs.
- **Expired YouTube accounts:** when a YouTube account turns `EXPIRED`, the message shown on the row mentions the Testing/Publish app reason.
- **Docs check:** follow the platform docs for every step and error code, and list in the report the URLs you checked. Do not invent menu names.

## 7. Tests

- **Shared:** `validatePlatformAppInput` covers email-as-ID, swapped ID and secret, whitespace, a valid Google pair, and the `GOCSPX-` warning.
- **Server:**
  - The PUT route answers 400 for bad input.
  - `problems` lists a stored bad Client ID without returning it.
  - The verify route maps a mocked Google `invalid_client` / `invalid_grant` / `redirect_uri_mismatch` correctly.
  - The callback with `error=access_denied`, a bad state or a mocked failed exchange returns HTML (not JSON), sets the account to `ERROR` with the Vietnamese message and escapes injected text.
  - Success returns the HTML success page for YouTube/TikTok and the `metaPick` redirect for Meta.
  - No secret appears in any response or log line, checked by a test that searches the output for the secret string.
- **Web:**
  - The wizard blocks an email as the Client ID.
  - Closing the wizard after step 1 deletes only the account it created.
  - A resume with `accountId` starts at the right step.
  - The 20 s help panel appears (use fake timers).
  - The `ERROR` connection stops the waiting state.
  - Accounts page row buttons work.
  - The "Kiểm tra tất cả" summary covers every case in section 5, including the "all not connected" case from the real bug.
- **Counts:** test counts must not go down.

## 8. Live check

With `npm run dev`, on a test profile (never project `56374fb2-54cf-48ff-9441-2e6c653295d4`), and without real OAuth sign-in:

1. **Bad Client ID:** open the wizard for YouTube and type an email as the Client ID. The field error appears and save is blocked.
2. **Stored bad ID:** the existing saved app (Client ID `otakuovn@gmail.com`) shows the "Client ID đã lưu không đúng dạng" warning.
3. **Kiểm tra tất cả:** with only unconnected accounts, the message says nothing was checked.
4. **Error pages:** open `http://127.0.0.1:3001/api/oauth/youtube/callback?error=access_denied` and `…/callback?code=x&state=bogus`. Both show the Vietnamese HTML page, not JSON.
5. **Cancel cleans up:** start the wizard, go past step 1, cancel. No new row is left on the Accounts page.

Do not type a real secret anywhere. If you cannot run a browser, say so in the report.

## Done

- Code, tests and docs as above. Run typecheck, build and tests for all workspaces, and `npx drizzle-kit generate` in `apps/server` must print "No schema changes" unless you added a generated migration.
- User guide:
  - Update the accounts / connections pages in `docs/user-guide/` with the new YouTube steps, the 7-day note, the quota note and an error table.
  - Add a troubleshooting entry for "Lỗi 401 invalid_client".
- `featureMap`: add `nhat-ky-thay-doi.md` entries.
- Report `docs/tasks/TASK-058.report.md` with:
  - files changed;
  - deviations from this guide;
  - which credential formats and error codes were verified in which docs (URLs);
  - typecheck/build/test results with counts;
  - live-check results;
  - anything left undone.
- Finally create an empty `docs/tasks/TASK-058.done`.
