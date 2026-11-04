# TASK-016 — Image downloads survive HTTP 429 (approve-all failing)

## Problem (seen by the user)
"Duyệt tất cả" on a 56-scene project failed for ~25 scenes with `Image server returned HTTP 429.`
`visualService.approveAll` downloads scenes one after another with **no pause**, and
`ImageStore.fetchAttempt` (`apps/server/src/services/imageStore.ts`) turns any 4xx — including 429 —
into a non-retryable `ImageDownloadError`. upload.wikimedia.org rate-limits bursts and asks clients
to send a User-Agent with contact info; ours is `VideoAgent/0.1 (local)`. The search client
(`providers/images/http.ts`) already honours `Retry-After`; downloads do not.

## Fix
1. **Retry 429 and 503 in `ImageStore`**: honour `Retry-After` (seconds or HTTP date, cap 60 s),
   otherwise exponential backoff 2 s → 5 s → 15 s, max 4 attempts. Reuse the `retryDelay` parsing
   from `providers/images/http.ts` (move it to a shared helper, don't copy). Abort signal must stop
   the wait immediately. Other 4xx stay non-retryable. Final error message:
   `Máy chủ ảnh đang giới hạn tốc độ (HTTP 429) — thử lại sau ít phút`.
2. **Per-host pacing**: downloads to the same host are at least `IMAGE_DOWNLOAD_MIN_INTERVAL_MS`
   apart (config, default 1000; 0 in tests). Check whether `providers/images/rateLimiter.ts` can be
   reused. After a 429 from a host, later downloads to that host also wait out the Retry-After
   (shared cooldown), so approve-all doesn't fire 25 doomed requests.
3. **User-Agent — ALREADY DONE by the architect** (root cause, verified with curl: the old UA got
   `429 … retry-after: 600` on every download; a UA with a contact URL got 200 at once). Default is
   now `VideoAgent/0.1 (https://github.com/defu2005/videoGenerator)` in `config.ts` and
   `.env.example`. Add a config test that the default UA contains `http` and that
   `ImageStore` sends it.
4. **approveAll**: keep the current behaviour (successful scenes stay approved, failures listed).
   Add `retryable: boolean` per failed item; progress events unchanged. Running approve-all again
   only processes scenes not yet approved (already true — add a test).
5. **Web**: where approve-all failures are shown, group 429 failures into one line
   "N cảnh bị máy chủ ảnh giới hạn tốc độ — bấm Duyệt tất cả lần nữa sau ít phút" instead of N
   identical lines; other errors stay per scene.

6. **Also (small, from the TASK-009 review) — subtitle lines over the limit**: on project 56374fb2
   the `.srt` has 27 lines of 43–45 chars with `maxCharsPerLine` 42, e.g.
   "stadium tours, Jisoo, Jennie, Rosé, and Lisa" (45). Cause: `wrapLines` in
   `packages/shared/src/subtitles/index.ts` allows `safeMaxChars + 1`, and `splitCue` only checks
   chunk length ≤ max × 2, not whether the chunk can actually be wrapped into 2 lines ≤ max.
   Fix: `wrapLines` must never return a line > max when a word-boundary split exists; `splitCue`
   must split further when `wrapLines(chunk, max, 2)` gives > 2 lines or a line > max (a single
   word longer than max is the only allowed exception). Bump `SUBTITLE_FORMAT_VERSION` in
   `subtitleExecutor.ts` to `"v3"`. Shared tests: the 45-char example above at 42, and a property
   test over the existing Vietnamese fixture that every wrapped line ≤ max.

## Tests (Vitest, fake fetch + fake timers, no network)
- 429 with `Retry-After: 2` then 200 → success after one wait; HTTP-date Retry-After parsed.
- 429 four times → the Vietnamese rate-limit error; 404 → no retry.
- Abort during the backoff wait rejects quickly.
- Two downloads to the same host respect min interval; a 429 cooldown delays the next download.
- approveAll: one scene fails with 429, others approved; second run only retries the failed one.
- Web: grouped 429 message.

## Rules
No new dependencies. No `git commit`/`push`. `npm run typecheck`, `npm test`, `npm run build`
must pass. Report new test counts.

## Done
Write `docs/tasks/TASK-016.report.md` and an empty `docs/tasks/TASK-016.done`.
