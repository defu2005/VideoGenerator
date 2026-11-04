# TASK-025 — Cursor guide (YouTube publisher)

Read `docs/cursor/README.md` and `docs/cursor/TASK-024.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
A real `YouTubePublisher` on the TASK-024 interface, using the YouTube Data API v3 with the **user's own** Google Cloud OAuth client. Long videos (16:9) and Shorts (9:16, at most 3 minutes) both go through `videos.insert`.

Check the current official docs (developers.google.com/youtube/v3) while coding; the details below may have changed. Tests never hit the network.

## Setup the user does (write it as a Vietnamese help text in the UI and in the report)
1. In Google Cloud Console, create a project, enable **YouTube Data API v3**.
2. Configure the OAuth consent screen (External, add their own Google account as a test user).
3. Create an OAuth client of type **Desktop app** or **Web application** with redirect URI `http://127.0.0.1:3001/api/oauth/youtube/callback`.
4. Put `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` into `.env` themselves. Add both to `.env.example` with comments; do not touch `.env`.
5. Note for the help text: while the consent screen is in "Testing", refresh tokens expire after 7 days, so the account will need "Kết nối lại" weekly until the user publishes the consent screen. Also note: videos uploaded by an **unverified** API project may be locked to private by YouTube until the project passes Google's audit. The publisher must detect this (the returned `status.privacyStatus` differs from the requested one) and record it as a warning on the publication, not as a failure.

## OAuth

> **Credentials:** read the app credentials from the account's vault entry first (TASK-024 "Account credentials"); the `.env` keys below are only the fallback. The "Kết nối" button is disabled only when neither exists.
- Auth URL `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`, `access_type=offline`, `prompt=consent`, PKCE S256, scopes `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`.
- Token exchange/refresh at `https://oauth2.googleapis.com/token`; revoke at `https://oauth2.googleapis.com/revoke`.
- Identity: `GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true` → channel title, custom URL handle, channel id.
- If `YOUTUBE_CLIENT_ID` is missing, the "Kết nối" button is disabled with the setup help.

## Upload
- Resumable upload: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` with the metadata, then PUT the file in chunks (8 MiB multiples), reporting progress. Resume after a dropped connection by querying the upload status (`Content-Range: bytes */<size>`), up to the job's retry budget.
- `snippet`: title (≤100 chars), description (≤5000 bytes), tags (total ≤500 chars), `categoryId` from the account's `publishSettings` (default `27` Education), `defaultLanguage`/`defaultAudioLanguage` from the project language.
- `status`: `privacyStatus` (public/unlisted/private), `publishAt` (ISO, only with `private`) for scheduled posts, `selfDeclaredMadeForKids: false`, `containsSyntheticMedia: true`.
- **Shorts:** vertical renders ≤ 180 s. Add `#Shorts` to the end of the description if not present. Never upload a vertical video longer than 180 s as a Short; warn instead.
- **Thumbnail:** for landscape videos, if the project has a thumbnail, call `thumbnails.set` after upload. A 403 there (unverified channel cannot set custom thumbnails) is a warning, not a failure.
- **Playlist:** if `publishSettings.playlistId` is set, `playlistItems.insert` after upload. Needs the `youtube` scope instead of `youtube.readonly`; request `https://www.googleapis.com/auth/youtube` only when a playlist id is configured, and say so in the UI.
- **Quota:** each upload costs a lot of quota units (check the docs; 1600 at the time of writing, daily default 10,000). Track the units used per day in app_settings `youtubeQuota` and refuse new uploads with a clear message when the next one would exceed the limit (configurable `YOUTUBE_DAILY_QUOTA`, default 10000).
- Errors: map `quotaExceeded`, `uploadLimitExceeded`, `forbidden`, `invalidCredentials` to Vietnamese messages. Quota/limit errors are not retried today; reschedule the job for the next day's quota reset (midnight Pacific time) instead.

## Tests (no network: inject a fake `fetch`)
- Auth URL params incl. PKCE and scopes; code exchange; refresh; identity parse.
- Resumable flow: init → two chunks → done; resume after a dropped chunk; progress callbacks.
- Scheduled: `private` + `publishAt`. Shorts description tag. Thumbnail 403 → warning. Privacy downgraded by YouTube → warning.
- Quota counter and the next-day reschedule.

## Live check
Claude does the live check with the user's own account after review. **Do not** run a real upload yourself.

## Steps
1. Server: publisher, config keys, quota tracking, help text, tests.
2. Web: setup help on the account form, warnings on publications + tests.
3. Done checklist. Write `docs/tasks/TASK-025.report.md` and `docs/tasks/TASK-025.done`.
