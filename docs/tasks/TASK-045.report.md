# TASK-045 report — Live provider quota from OmniRoute

## What changed

### Shared
- `packages/shared/src/schemas/llmQuota.ts` — `lifetime` window, `credits_usd` limits, live OmniRoute view schemas, token body, status fields `freeCreditSpendUsd` and `omniroute`
- `packages/shared/src/llmQuota/windows.ts` — lifetime window starts at the epoch and does not reset
- `packages/shared/src/llmQuota/rules.ts` — credit remaining, near ($0.50, 10%, or expiry within 3 days), exhausted
- `packages/shared/src/llmQuota/presets.ts` — disabled credit placeholders for OpenRouter and DeepSeek, note still `ước tính, kiểm tra trang nhà cung cấp`
- `packages/shared/src/llmQuota/live.ts` — provider map, usage parse, family / provider-wide matcher, email mask, live status, refresh gate
- `packages/shared/src/index.ts` — exports
- `packages/shared/test/omnirouteQuota.test.ts`

### Server
- `apps/server/src/db/schema.ts` — `llm_provider_quota_snapshots`, `llm_quota_usage.credits_usd`
- `apps/server/drizzle/0034_nice_jackpot.sql`, `apps/server/drizzle/meta/0034_snapshot.json`, journal entry. Second `npx drizzle-kit generate` printed `No schema changes, nothing to migrate`.
- `apps/server/src/providers/llm/omnirouteQuotaStore.ts` — snapshot replace, sync state, masked account
- `apps/server/src/providers/llm/omnirouteQuotaView.ts` — cards, missing routed models, live match
- `apps/server/src/services/omnirouteQuotaSync.ts` — management token or `OMNIROUTE_API_KEY`, 10s timeout, one connection at a time, 60s gap, 5-minute interval
- `apps/server/src/providers/llm/quota.ts` — live override, credit spend, backfill `llmQuotaUsageBackfillV1`, limiting reset window, `earliestRetryAt` null when credit has no reset
- `apps/server/src/providers/llm/structured.ts` — refresh before a covered job, `LLM_QUOTA_EXHAUSTED` when credit cannot wait for a reset
- `apps/server/src/api/llm.ts` — refresh, save token, remove token; responses expose only the last 4 characters
- `apps/server/src/app.ts` — vault key `omniroute.managementToken`, sync start/stop
- `apps/server/test/omnirouteQuota.test.ts`

### Web
- `apps/web/src/features/settings/QuotaPanel.tsx` — “Từ OmniRoute (số thật)”, token form, live cards, missing models, credit rule form
- `apps/web/src/services/llmApi.ts` — refresh / save / remove token
- `apps/web/src/index.css` — live card layout
- `apps/web/src/features/settings/AiSettingsPage.test.tsx` — live cards, masked token, missing-model rule

### MCP
No code change. `get_llm_quota_status` already reads `GET /api/llm/quota`, which now includes the live view.

## Test counts

| Workspace | Tests |
|---|---|
| shared | 251 |
| mcp | 12 |
| server | 576 |
| web | 112 |

Above the TASK-017 floors (shared 156, mcp 11, server 295, web 70).

`npm run typecheck`, `npm run build`, and `npm test --workspaces` all passed. No `package.json` or lockfile change. No NUL bytes in the changed files. Vietnamese UI text is UTF-8. Tests use mocked `fetch` only.

## Deviations

1. Credit placeholder presets keep the existing note `ước tính, kiểm tra trang nhà cung cấp`, with `enabled: false` and `creditsUsd: 0`. The preset test requires that exact note.
2. `codex` is not an `LlmProviderId`. It is mapped for display. A manual rule is prefilled as provider `omniroute` and model `codex/*`. `modelMatchesRule` does not treat `prefix/*` as a wildcard.
3. Rate-limit payloads are stored as a short note, not the raw body.
4. Snapshot rows also store `remaining`, `masked_account`, `active`, and `rate_limit_note`. The OmniRoute connection id is stored so usage can be fetched and replaced. Emails are masked. The management token is not stored in the snapshot table.
5. While `VITEST` is set, the 5-minute interval and the pre-job refresh do not call OmniRoute. `shouldRefreshLiveQuota` is unit-tested. Production `npm run dev` does not set `VITEST`.
6. `earliestRetryAt` can return null. Routing then fails with `LLM_QUOTA_EXHAUSTED` and `Hết credit, cần nạp hoặc tạo quy tắc mới` instead of waiting on a reset that never comes.
7. The generic Bật control still does not turn a preset whose own `enabled` is false into a user rule. A real credit amount is saved from the rule form.
8. A fresh snapshot with `fractionReported: false` is treated as not exhausted, so it overrides the local estimate. A stale or missing snapshot still uses local counting.
9. DeepSeek credit balances arrive with `unlimited: true`. The parser stores them as not unlimited so the UI can show `còn $X.XX`.
10. The management token and `OMNIROUTE_API_KEY` are both sent as `Authorization: Bearer`. Manual refresh shares the one-per-minute gap. Saving or removing the token clears that gap.
11. Freshness: a snapshot younger than 20 minutes overrides the estimate; a job refreshes when the snapshot is older than 15 minutes; the page and the interval refresh when the sync is older than 5 minutes.
12. Backfill uses the matching rule timezone, otherwise UTC. The minute window is not rebuilt. Lifetime credit rows are not pruned.
13. `fractionReported: false` shows the chip `Chưa rõ`.

## Not done

- The Quota tab was not screenshotted. This session has no browser tool. The running app was checked over HTTP only.
- With OmniRoute up and no token, `GET /api/llm/quota` returned `needs_token`, `tokenSaved: false`, `tokenLast4: null`, dashboard `http://127.0.0.1:20128`, and `OmniRoute từ chối quyền đọc quota.` `POST /api/llm/quota/omniroute/refresh` returned 200. No token was created and the OmniRoute dashboard was not opened.
- That same read ran the one-time backfill. `copilot-cli` month usage is 20 requests. Day windows on the other presets are 0. Live used/total cards stay empty until a read-only token is saved.
- Project `56374fb2-54cf-48ff-9441-2e6c653295d4` was not opened, approved, or rendered.
