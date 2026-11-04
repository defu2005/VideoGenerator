# TASK-021 report — Fixes from the first live AUTO run

## What changed

### Shared
- `packages/shared/src/schemas/autoReport.ts` — added `VISUAL_DOWNLOAD_FAILED`
- `packages/shared/src/schemas/imageSources.ts` — `lastBlockedAt` on status rows; `ImageSourcesHealthSchema`

### Server
- `apps/server/src/providers/images/http.ts` — `ImageProviderBlockedError`; Cloudflare challenge (`cf-mitigated` / `challenges.cloudflare.com`) on 403/429 is non-retryable and not retried
- `apps/server/src/providers/images/types.ts` — optional `downloadError` on normalized candidates
- `apps/server/src/settings/imageSources.ts` — `imageSourcesHealth` in `app_settings`; `recordImageSourceBlocked` / `getImageSourcesHealth`; status exposes `lastBlockedAt` (source is **not** auto-disabled)
- `apps/server/src/services/visualService.ts`:
  - `autoResolve` tries up to 5 candidates in rank order; download failures skip to the next; verified-first preserved; fall through to neighbour reuse / skip; writes `VISUAL_DOWNLOAD_FAILED`; never throws for one scene’s download
  - `bestCandidate` / AUTO preselect skip candidates with `download_error`
  - per-run circuit breaker in `searchAcrossProviders` (one `ImageProviderBlockedError` or two consecutive HTTP 403s → skip provider; one warning)
  - stage summary shows e.g. `loc: bị chặn (Cloudflare)`
  - download `AppError` details include `status` / `host`; `isRetryableDownloadError` treats 401/403/404/410 as non-retryable
- `apps/server/src/jobs/worker.ts` — `jobErrorFromCaught` maps `IMAGE_DOWNLOAD_FAILED` / `ImageDownloadError` with correct retryability (no 3× retry on 403)
- Tests: `autoReport.test.ts` (download fallback, neighbour, ASSISTED 422), `visualSearch.test.ts` (circuit breaker), `imageProviders.test.ts` (Cloudflare), `imageSourcesSettings.test.ts` (health), `jobErrors.test.ts`

### Web
- `apps/web/src/features/settings/ImageSourcesSettingsPage.tsx` — “Bị chặn lần gần nhất: …”
- `apps/web/src/features/render/AutoReportPanel.tsx` — label for `VISUAL_DOWNLOAD_FAILED`
- Tests updated for blocked note

## Test counts

| Workspace | Before (TASK-020 report) | After |
|---|---|---|
| shared | 179 | **185** |
| mcp | 12 | **12** |
| server | 346 | **365** |
| web | 77 | **78** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. No schema/migration change (health uses existing `app_settings`). No `package.json` / lockfile change.

## Deviations from the spec

- None material. Live check on throwaway project `eb02c679-…` was **not** run (guide: do not spend real LLM quota; Claude runs after review).
- Circuit-breaker test uses distinct scene queries so provider-call counts are not collapsed by the image search cache.

## Not done

- Live browser / pipeline retry on the throwaway AUTO project (deferred per guide).
- No commit/push (per rules).
