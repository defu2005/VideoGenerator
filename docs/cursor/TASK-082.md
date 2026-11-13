# TASK-082 — First real run: YouTube OAuth, upload, analytics (runbook) 🚀

**Who:** **the user** (creates the developer app, signs in, approves), **Hermes** (runs the app through MCP and reports), then an implementer session per bug found. **Size:** M over several days. **Migration:** none planned.
**Depends on:** TASK-080 (a committed, known-good base).

This is a **runbook**, not a code task. Bugs found here become small guides `TASK-082-fix-N.md`, written by Claude and run by an implementer.

## Part 1 — the user (Claude cannot do these: they need your accounts and passwords)

1. In Google Cloud Console: create a project, enable **YouTube Data API v3**, **YouTube Analytics API** and **YouTube Reporting API**, and make an OAuth client of type "Web application".
   - The redirect URI is the one the app shows on the Kết nối page.
   - Put the client id and secret where the Kết nối page asks for them. They go to the encrypted token store; never paste them in chat.
2. On the OAuth consent screen: "Testing" mode, with your Google account as a test user. Scopes: upload, readonly, analytics readonly and the others the app lists.
3. In the app: Kết nối → YouTube → sign in → pick the channel. Check that the channel name and avatar show.
4. Choose a test video to publish **as private** (never on project `56374fb2-54cf-48ff-9441-2e6c653295d4`).

## Part 2 — Hermes (through MCP; skills `video-van-hanh-app`, `video-dang-bai`, `video-doc-so-lieu`)

Run each step, write what happened into `docs/tasks/TASK-082.runlog.md` (time, tool, result, error text), and stop at the first error.

1. `get_health`, then the connection status for YouTube.
2. Run the pre-publish check (skill `video-kiem-tra-truoc-khi-dang`) on the test project.
3. `publish_project` as **private**. This is a confirm action, so the user approves it in the app. Check: the video id is stored, the upload quota cost is logged, and the thumbnail and captions are uploaded if the flow does that.
4. After 1 h, 24 h and 48 h: analytics sync, and `get_publication_metrics`. Note which fields are empty: impressions and CTR come through Reporting with a delay, and retention needs some views.
5. Comments: sync and inbox for the video.
6. Token refresh: after 1 h, run a read call again and check that it works without signing in again.
7. Revoke test: the user disconnects in the app, and the next call shows a clear "Cần kết nối lại" message, not a crash.

## Part 3 — Claude

- After each Hermes report: read the runlog. Write a fix guide for each real bug, with the error text and the step that reproduces it in a mock test. A mock test that would have caught the bug is part of every fix.
- When YouTube passes all of Part 2: switch the video to public on the user's word (the user does it), then repeat for **TikTok**, then **Facebook/Instagram**, in that order. Each platform gets its own Part 1 written by Claude when it is time, because each one needs its own developer app.
- Update the user guide "Kết nối nền tảng" page with what really happened (screens, wait times, quota).

## Mã nguồn mở có sẵn (open source)

- **googleapis** (Apache-2.0) is already used. Check the official YouTube API samples for upload resumable chunk settings if an upload fails.
- **Postiz** (AGPL — read only, do not copy code) and **Mixpost** (MIT) show the TikTok and Meta app review steps and scopes; use them as a checklist for the later platforms.

## Done

- [ ] YouTube Parts 1–2 pass with no open bug; runlog saved
- [ ] every bug has a mock test in the fix
- [ ] user guide updated
- [ ] `docs/tasks/TASK-082.done` (Claude writes it when YouTube passes; TikTok and Meta continue as TASK-082b and 082c if needed)
