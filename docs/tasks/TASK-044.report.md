# TASK-044 report — Free / quota-limited model manager

## What changed

### Shared
- `packages/shared/src/schemas/llmQuota.ts` — strict quota rule, settings, status, policy body
- `packages/shared/src/llmQuota/windows.ts` — `currentWindowStart`, `nextReset`, local hour and date
- `packages/shared/src/llmQuota/presets.ts` — Gemini flash / flash-lite / pro, OpenRouter `*:free`, Groq, Copilot CLI, Antigravity CLI, Claude CLI; every note is `ước tính, kiểm tra trang nhà cung cấp`
- `packages/shared/src/llmQuota/rules.ts` — user rules replace the same provider+model preset; disable list; kind; ECO reorder
- `packages/shared/src/llmQuota/cooldown.ts` — Retry-After, daily reset, backoff 1m / 5m / 30m / 6h
- `packages/shared/src/schemas/llm.ts` — `fallbacks` (max 4), `fallbackChainOf`, profile `quotaPolicy` and `paidFallbackDailyUsd`
- `packages/shared/src/schemas/job.ts` — `JobError.retryAt`, `LlmCallUsage.fallbackReason`
- `packages/shared/src/schemas/usage.ts` — `fallbackReason` on a usage call
- `packages/shared/src/index.ts` — exports
- `packages/shared/test/llmQuota.test.ts`

### Server
- `apps/server/src/db/schema.ts` — `llm_quota_usage`, `llm_cooldowns`; job/stage error `retryAt`; usage call `fallbackReason`
- `apps/server/drizzle/0032_true_tinkerer.sql` and `apps/server/drizzle/meta/0032_snapshot.json`, journal entry. Second `npx drizzle-kit generate` printed `No schema changes, nothing to migrate`.
- `apps/server/src/providers/llm/quota.ts` — settings key `llmQuota`, counters, cool-downs, policy, paid-fallback notice, daily summary line, advisor fields
- `apps/server/src/providers/llm/structured.ts` — ordered chain, skip unavailable models, quota cool-down, `LLM_QUOTA_WAIT`; real calls recorded via `onRealCall`
- `apps/server/src/providers/llm/registry.ts` — `registry.quota`, route `fallbacks`, budget mode, autonomy, profile id
- `apps/server/src/providers/llm/types.ts` — `LLM_QUOTA_WAIT`, `retryAfterMs`, `retryAt`
- `apps/server/src/providers/llm/http.ts` — 429 body classified as quota or rate limit; Retry-After and `x-ratelimit-reset*`
- `apps/server/src/providers/llm/antigravityCli.ts` — quota / resource_exhausted / exhausted → `LLM_QUOTA_EXHAUSTED` (not retryable); a plain 429 stays `LLM_RATE_LIMIT`
- `apps/server/src/pipeline/orchestrator.ts`, `stageExecutor.ts`, `jobs/worker.ts`, research and script executors — `LLM_QUOTA_WAIT` requeues the same attempt at `retryAt`
- `apps/server/src/api/llm.ts` — `GET /api/llm/quota`, policy, rules, enable, clear cool-down
- `apps/server/src/app.ts` — `attachLlmQuota` (spend from usage, cost from `estimateLlmCost`, notice via `automation_warning`)
- `apps/server/src/notifications/notificationService.ts` — one Quota line on the daily summary
- `apps/server/src/services/modelAdvisor.ts` — catalog `kind`, remaining requests today, status; prompt prefers free models that still have allowance
- `apps/server/src/assistant/tools.ts` — `get_llm_quota_status` (read), `clear_llm_cooldown` (confirm)
- `apps/server/test/llmQuota.test.ts`
- `apps/server/test/antigravityCli.test.ts` — three expectations now `LLM_QUOTA_EXHAUSTED` / not retryable (`quota exceeded`, `RESOURCE_EXHAUSTED`, spawn `QUOTA_EXCEEDED`). `HTTP 429 rate limit` stays `LLM_RATE_LIMIT`.

### Web
- `apps/web/src/features/settings/QuotaPanel.tsx` — tab table, status chips, edit / disable / Xoá chờ, add rule, policy and daily cap
- `apps/web/src/features/settings/FallbackChainEditor.tsx` — ordered chain, add / remove / up / down, status chip
- `apps/web/src/features/settings/AiSettingsPage.tsx` — tabs Định tuyến and Quota
- `apps/web/src/features/settings/AiSettingsPage.test.tsx`
- `apps/web/src/features/profiles/ProfileDetailPage.tsx` — profile override for policy and cap
- `apps/web/src/features/usage/ProjectUsagePanel.tsx` — chip `dự phòng (hết quota)`
- `apps/web/src/services/llmApi.ts`, `apps/web/src/index.css`

### MCP
- `apps/mcp/src/apiClient.ts`, `apps/mcp/src/tools.ts`, `apps/mcp/test/tools.test.ts` — read tool `get_llm_quota_status`

## Test counts

| Workspace | Tests |
|---|---|
| shared | 227 |
| mcp | 12 |
| server | 563 |
| web | 108 |

Above the TASK-017 floors (shared 156, mcp 11, server 295, web 70).

`npm run typecheck`, `npm run build`, and `npm test --workspaces` all passed. No `package.json` or lockfile change. No NUL bytes in the new files. Vietnamese UI text is UTF-8.

## Deviations

1. Settings are one `app_settings` row `llmQuota`: `{ rules, disabled, quotaPolicy, paidFallbackDailyUsd, nearLimitRatio }`. `enabled` defaults to true. Disabling a preset stores `{ provider, model }` in `disabled`. Paid-fallback spend and the once-per-day notice use `llmPaidFallbackSpend` and `llmPaidFallbackNotice`.
2. There is no separate plain-text generate path. Every LLM call goes through `generateStructured`. Recording is the `onRealCall` hook from `generateRoutedStructured`, only after a request is sent. Cache hits and preflight codes (`LLM_NOT_CONFIGURED`, `LLM_LIMIT_TOO_SMALL`, `VISION_PROVIDER_REQUIRED`, `FFMPEG_MISSING`) do not count.
3. Providers with no free rule are treated as paid when they are `anthropic`, `openai`, `deepseek`, or `opencode`, and OpenRouter models that do not end in `:free`. That gate applies only to chain entries after the original primary. The primary is still used when it is available. ECO sorts free/subscription, then unknown, then paid. BALANCED and QUALITY keep the saved order.
4. A wildcard `*` sums usage across that provider. `*:free` matches models ending in `:free`. The more specific rule wins. Cool-downs stay on the concrete provider+model.
5. The old single `fallback` is a chain of one. No JSON migration. The editor writes both `fallbacks` and `fallback` (the first entry).
6. When the primary provider is not configured, the existing failed-route path still calls only the swapped fallback. It does not walk a longer chain.
7. Gateway `only` still does not use the user chain or a direct provider. Gateway `prefer` still tries the direct provider only for connection errors (`LLM_TIMEOUT` / `LLM_UNAVAILABLE` with no status or status ≥ 500), not for `LLM_BAD_REQUEST`.
8. `LLM_QUOTA_WAIT` is thrown only when a quota controller is attached and quota pressure happened (a skip or a quota/rate error) and nothing eligible remains. Without a controller, the last provider error still surfaces, so older routing tests keep `LLM_RATE_LIMIT`. AUTO message is exactly `Chờ quota reset lúc HH:mm`. Other modes use `Hết quota miễn phí. Chờ đến HH:mm.`
9. The paid-fallback Telegram event is `automation_warning` with profile label `LLM`. That kind is already gated by the attention toggle. There is no separate notification kind named `attention`.
10. HTTP 429 with a daily-quota phrase, or a body matching quota / resource_exhausted / exhausted, is `LLM_QUOTA_EXHAUSTED` and not retryable. Other 429s stay `LLM_RATE_LIMIT`.
11. The route card grid is three columns. The chain editor sits on its own row so the card layout stays intact.
12. `nearLimitRatio` defaults to 0.9 and can be set on `PUT /api/llm/quota/policy`. The Quota tab does not show a separate control for it.

## Not done

- Live check was not run. Seeding usage for project `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` would write `data/`, which this task must not touch. No browser tool was available, so the Quota tab was not screenshotted. The web tests cover the three chips, chain reorder, and policy save. Project `56374fb2-54cf-48ff-9441-2e6c653295d4` was not opened, approved, or rendered.
