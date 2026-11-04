# TASK-021 — Cursor guide (fixes from the first live AUTO run)

Read `docs/cursor/README.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## What happened
A live AUTO run (claude-cli, 3-minute Vietnamese video, 26 scenes) failed at VISUAL_SEARCH after all searches finished:

```
VISUAL_SEARCH FAILED  Image server returned HTTP 403.  (STAGE_EXECUTION_FAILED, 3 attempts)
```

Two separate problems.

### Bug 1 — one failed image download fails the whole stage (must fix)
- `VisualSearchExecutor.run` (`apps/server/src/stages/visuals/visualSearchExecutor.ts`) calls `approveAll`, then `autoResolve`.
- `approveAll` already catches download errors per scene.
- `VisualService.autoResolve` (`apps/server/src/services/visualService.ts` ~671) calls `forceApproveCandidate` → `approveSelected` (~910). When `imageStore.download` fails (here an image host answered 403), `approveSelected` stores `download_error` on the candidate and **throws** `AppError(422, "IMAGE_DOWNLOAD_FAILED")`. Nothing in `autoResolve` catches it, so the stage fails. The job retry then repeats the same failure 3 times.

**Fix:**
- In `autoResolve`, every approve attempt goes through one helper that tries candidates in rank order (the same order `bestCandidate` uses). On a download failure, skip that candidate (it already gets `download_error`) and try the next one. Try at most 5 candidates per scene.
- Keep the verified-first rule: try all verified candidates (up to the cap) before any unverified web candidate, as today.
- If every try fails, fall through to the existing chain: reuse the neighbour's image (`VISUAL_REUSED_NEIGHBOUR`), else skip (`VISUAL_SKIPPED`).
- Add a report entry `VISUAL_DOWNLOAD_FAILED` (WARN, Vietnamese message, `data`: the failed candidate ids, hosts and HTTP status) whenever at least one download failed for a scene. Add the code to the shared enum.
- Candidates with a `download_error` must not be picked again by `bestCandidate` in AUTO, and not by the AUTO preselect either.
- `autoResolve` must never throw because of one scene's image. Only an abort signal or a programming error may escape.
- ASSISTED/MANUAL behaviour does not change: the user's own "Duyệt" click still shows the 422 error.

### Bug 2 — Library of Congress is blocked by Cloudflare (must fix)
`https://www.loc.gov/photos/?fo=json` now answers `403` with header `cf-mitigated: challenge` (a Cloudflare bot challenge) for every request, also from plain curl. **Do not try to get around the challenge** (no browser emulation, no fake browser user agents, no challenge solving). Treat it as "the source is unavailable":
- In `apps/server/src/providers/images/http.ts`, detect a 403 or 429 whose response has a `cf-mitigated` header, or whose HTML body contains `challenges.cloudflare.com`. Raise a typed `ImageProviderBlockedError` (non-retryable) instead of retrying.
- In `VisualService.searchAcrossProviders`, add a per-run circuit breaker. After a provider raises `ImageProviderBlockedError` once, or fails with HTTP 403 twice in a row, skip that provider for the rest of the stage run. Log one warning, not one per query. Today the log shows about 80 identical 403 warnings for `loc`.
- Show it to the user:
  - the stage summary line gets e.g. `loc: bị chặn (Cloudflare)`;
  - the "Nguồn ảnh" settings page (`/settings/image-sources`) shows a "Bị chặn lần gần nhất: <time>" note for that source. Store the last block time in app_settings, e.g. key `imageSourcesHealth`. Do **not** turn the source off automatically.
- The same circuit breaker applies to every image provider, not just LoC.

### Bug 3 — the stage retried a deterministic failure
`IMAGE_DOWNLOAD_FAILED` from a 403 is not retryable, yet the job ran 3 attempts. After Bug 1 is fixed this path should not fail the stage at all. Still, check that `isRetryableDownloadError` / the stage error mapping marks a 401/403/404/410 download as non-retryable, so a future failure does not repeat 3 times.

## Tests (no network)
- `autoResolve` in AUTO:
  - the best candidate's download fails with 403 → the second candidate gets approved, a `VISUAL_DOWNLOAD_FAILED` entry is written, and the stage passes;
  - all downloads fail → the neighbour's image is reused, or the scene is skipped;
  - the run does not throw.
- The circuit breaker: a fake provider that returns a Cloudflare challenge 403 is called once, then skipped for the remaining queries. The other providers keep working. The settings status shows the block time.
- `http.ts`: a challenge response raises `ImageProviderBlockedError` without a retry.
- ASSISTED: a manual approve with a failing download still returns 422.

## Live check
Use only throwaway project `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` (`[TEST] Chinh phục Mặt Trăng`, AUTO, claude-cli routing). Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- **Do not** run the live check yourself: it spends the user's real LLM quota. Claude will run it after review.
- Make sure `POST /api/projects/:id/pipeline/stages/VISUAL_SEARCH/retry` resumes from VISUAL_SEARCH without redoing RESEARCH/SCRIPT/SCENE_PLAN.

## Steps
1. Shared: add `VISUAL_DOWNLOAD_FAILED` to the report codes.
2. Server: the `autoResolve` fallback loop, the blocked-provider error and circuit breaker, health storage, retryability, tests.
3. Web: the blocked note on the image sources page, plus a test.
4. Run the README done checklist, then write `docs/tasks/TASK-021.report.md` and `docs/tasks/TASK-021.done`.
