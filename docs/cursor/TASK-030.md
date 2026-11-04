# TASK-030 — Cursor guide (Facebook Reels and Instagram Reels publishers)

Read `docs/cursor/README.md` and `docs/cursor/TASK-024.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
Two publishers on the TASK-024 interface, both through Meta's **Graph API** with the user's own Meta developer app and one Facebook login:
- `FacebookReelsPublisher`: posts Reels to a **Facebook Page** the user manages.
- `InstagramReelsPublisher`: posts Reels to an **Instagram professional (Business/Creator) account** linked to a Page.

Check the current official docs (developers.facebook.com, Graph API version in a constant `META_GRAPH_VERSION`) while coding; details may have changed. Tests never hit the network.

## Setup the user does
Create a Meta app (type Business), add Facebook Login, set redirect URI `http://127.0.0.1:3001/api/oauth/facebook/callback` (if Meta insists on HTTPS for redirects, document the workaround in the help text; do not invent one), put `META_APP_ID` and `META_APP_SECRET` into `.env` themselves. Add them to `.env.example`. In development mode the app works for accounts that have a role in the app; that is enough for the user's own Page and IG account.

## OAuth (one Meta login, then pick the target)

> **Credentials:** read the app credentials from the account's vault entry first (TASK-024 "Account credentials"); the `.env` keys below are only the fallback. The "Kết nối" button is disabled only when neither exists.
- Dialog `https://www.facebook.com/<ver>/dialog/oauth` with scopes `pages_show_list,pages_read_engagement,pages_manage_posts,publish_video,instagram_basic,instagram_content_publish,business_management`.
- Exchange the code, then swap for a **long-lived user token**. From `/me/accounts` get the Pages and their **Page access tokens** (long-lived when derived from a long-lived user token). For IG, read `instagram_business_account` on each Page.
- After the callback, the account form shows a picker: which Page (for `facebook_reels`) or which IG account (for `instagram_reels`) this platform account maps to. Store the target id in `external_id` and the needed token in the vault.
- Long-lived tokens expire after about 60 days: set `expires_at`, and the UI warns 7 days before ("Cần kết nối lại").

## Facebook Reels upload
- `POST /<page-id>/video_reels?upload_phase=start` → `video_id` + upload URL.
- Upload the file to `https://rupload.facebook.com/video-upload/<ver>/<video_id>` with headers `offset: 0`, `file_size`, and the Page token.
- `POST /<page-id>/video_reels?upload_phase=finish&video_id=..&video_state=PUBLISHED&description=..` (or `SCHEDULED` with `scheduled_publish_time` (unix) for a future slot, if the docs still allow it; else use the TASK-024 ticker).
- Poll `GET /<video_id>?fields=status` until ready/published or error.

## Instagram Reels upload
- Create a container with `media_type=REELS`, `upload_type=resumable`, `caption`, `share_to_feed=true` → container id + upload URI.
- Upload the file to the `rupload.facebook.com/ig-api-upload/...` URI with headers `offset`, `file_size`.
- Poll the container `status_code` until `FINISHED` (or `ERROR`), then `POST /<ig-user-id>/media_publish?creation_id=..`.
- No native scheduling: use the TASK-024 ticker.
- Respect the content publishing limit (check `content_publishing_limit`; about 50 posts per 24 h at the time of writing).

## Both
- Vertical renders only; enforce the documented duration and size limits with clear messages.
- Mark AI-generated content if the API offers a field for it; otherwise add nothing.
- Map common Graph errors (expired token code 190, permission errors 10/200, rate limits 4/17/32/613) to Vietnamese messages; only rate limits and 5xx are retried.

## Tests (fake fetch)
OAuth exchange + long-lived swap + Page/IG discovery; FB start → upload → finish → status; IG container → upload → poll → publish; error mapping; expiry warning.

## Steps
1. Server publishers (shared Graph helper), config keys, help text, tests.
2. Web: the Page/IG picker after connecting, expiry warning + tests.
3. Done checklist. Claude does the live check. Write `docs/tasks/TASK-030.report.md` and `docs/tasks/TASK-030.done`.
