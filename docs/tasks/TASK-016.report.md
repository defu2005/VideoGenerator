# TASK-016 report

Copilot started this task; it ran out of quota and the architect finished it.

## Done
- `providers/images/retry.ts`: shared `parseRetryDelay` (seconds or HTTP date, cap 60 s) and `sleepWithAbort`, used by the search client and `ImageStore`.
- `ImageStore` retries 429/503 (and other 5xx), up to 4 attempts: it honours Retry-After, otherwise backs off 2 s → 5 s → 15 s. Abort stops the wait. Other 4xx are not retried. After the last 429 the error is `Máy chủ ảnh đang giới hạn tốc độ (HTTP 429) — thử lại sau ít phút`, marked retryable.
- `HostDownloadRateLimiter`: per-host pacing (`IMAGE_DOWNLOAD_MIN_INTERVAL_MS`, default 1000) plus a shared cooldown after a 429.
- approve-all: each failed item has `retryable`; scenes that succeed stay approved; a second run retries only the failed scenes.
- Web: retryable 429 failures are grouped into one line.
- Subtitles: `wrapLines` never returns a line over the limit when a word boundary exists, and `splitCue` re-splits until every chunk wraps into ≤ 2 lines. `SUBTITLE_FORMAT_VERSION` is now v3.

## Tests
- shared: 125
- server: 266
- web: 63
- other: 10

Typecheck and build pass.

Live check on 56374fb2 after re-running SUBTITLE: 152 cues, longest line 42 characters, 0 lines over 42.
