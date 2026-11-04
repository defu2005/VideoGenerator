# TASK-029 — Cursor guide (TikTok publisher)

Read `docs/cursor/README.md` and `docs/cursor/TASK-024.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
A `TikTokPublisher` on the TASK-024 interface using the TikTok **Content Posting API** with the user's own TikTok developer app. Check the current official docs (developers.tiktok.com) while coding; details below may have changed. Tests never hit the network.

## Important platform limit (show it in the UI and the report)
Until the user's TikTok app passes TikTok's audit, **Direct Post can only post as private (`SELF_ONLY`)**. The publisher must:
- call `creator_info/query` first and use only a `privacy_level` from the returned options;
- when "public" is requested but not allowed, post `SELF_ONLY` and record the warning "Ứng dụng TikTok chưa được duyệt: video đăng ở chế độ riêng tư".
- Also support **"Gửi vào hộp thư nháp"** (inbox upload, `video.upload` scope) as an account setting, so the user finishes the post in the TikTok app.

## Setup the user does
Create an app on developers.tiktok.com, add Login Kit + Content Posting API, add redirect URI `http://127.0.0.1:3001/api/oauth/tiktok/callback` (TikTok may require HTTPS or a registered domain for redirects; if so, document the workaround in the help text, do not invent one), put `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` into `.env` themselves. Add them to `.env.example`.

## OAuth

> **Credentials:** read the app credentials from the account's vault entry first (TASK-024 "Account credentials"); the `.env` keys below are only the fallback. The "Kết nối" button is disabled only when neither exists.
- Authorize `https://www.tiktok.com/v2/auth/authorize/` with `client_key`, scopes `user.info.basic,video.publish,video.upload`, PKCE, state.
- Token `https://open.tiktokapis.com/v2/oauth/token/` (exchange and refresh), revoke `/v2/oauth/revoke/`.
- Identity `GET /v2/user/info/?fields=open_id,display_name,username`.

## Upload
- Direct Post: `POST /v2/post/publish/video/init/` with `post_info` (title = caption with hashtags, ≤ 2200 chars; `privacy_level`; `disable_comment` false; `is_aigc: true` for the AI-generated content label) and `source_info` `FILE_UPLOAD` with size and chunk plan (chunks 5–64 MB, last chunk may be larger; small files in one chunk).
- PUT the chunks to the returned `upload_url` with `Content-Range`, report progress.
- Poll `POST /v2/post/publish/status/fetch/` until `PUBLISH_COMPLETE` or `FAILED` (back off, max about 10 minutes). Store the post id; build the URL if the API returns one, else link to the profile.
- TikTok has no native scheduled publish via API: use the TASK-024 ticker (keep `SCHEDULED`, upload at the time).
- Only vertical renders. Duration must be within the `max_video_post_duration_sec` from `creator_info`; otherwise fail with a clear message.
- Respect rate limits (HTTP 429 → retry with backoff).

## Tests (fake fetch)
OAuth URL; exchange/refresh; creator_info privacy downgrade warning; chunk plan math; init → chunks → status polling → complete; failure status; inbox mode; duration limit.

## Steps
1. Server publisher, config keys, help text, tests.
2. Web: account form options (direct post / inbox), warnings + tests.
3. Done checklist. Claude does the live check. Write `docs/tasks/TASK-029.report.md` and `docs/tasks/TASK-029.done`.
