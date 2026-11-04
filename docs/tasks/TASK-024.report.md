# TASK-024 report — Publishing framework, token vault, mock publisher

## What changed

### Shared
- `packages/shared/src/schemas/publication.ts` — publication statuses, list/create schemas, PublishInput/Result, TokenSet, app-credentials status
- `packages/shared/src/schemas/profile.ts` — PlatformId `mock`, `USER_FACING_PLATFORMS`, `externalId` / `lastCheckedAt` on accounts, `PublishVisibility` type
- `packages/shared/src/enums.ts` — pipeline stage `PUBLISH` + `isPublishStage` (not in `STAGE_ORDER`)
- `packages/shared/src/index.ts` — export publication schemas

### Server
- `apps/server/src/db/schema.ts` — `platform_credentials`, `platform_app_credentials`, `publications`; `platform_accounts.external_id` / `last_checked_at`
- Migration `apps/server/drizzle/0023_late_wild_pack.sql` (+ meta snapshot/journal)
- `apps/server/src/publishing/` — `tokenVault`, `types`, `registry`, `mockPublisher`, `oauthState`, `guardrail`, `trimMetadata`, `publishService`, `ticker`, Fastify decorate types
- `apps/server/src/stages/publish/publishExecutor.ts` — PUBLISH job executor
- `apps/server/src/api/oauth.ts` — OAuth start/callback (PKCE)
- `apps/server/src/api/publications.ts` — publications CRUD-ish + disconnect / connection detail / app-credentials
- `apps/server/src/pipeline/orchestrator.ts` / `executorRegistry.ts` / `worker` wiring — PUBLISH side-jobs skip stage rows / continueAll
- `apps/server/src/app.ts` — vault, mock registry, ticker, routes, `vgPublish` decorate for tests
- `apps/server/src/lib/config.ts` + `.env.example` — `TOKEN_ENCRYPTION_KEY` (`.env` untouched)
- Tests: `test/tokenVault.test.ts`, `test/publishing.test.ts`

### Web
- `PublishPanel` on render tab + test
- Profile accounts: Kết nối / Kết nối lại / Ngắt kết nối, redirect URI copy
- `PublishCalendarPage` + nav “Lịch đăng”
- `services/publishApi.ts`

### MCP
- Tools `publish_project`, `list_publications` + apiClient methods; tool registry test updated

## Test counts

| Workspace | Before (TASK-023) | After |
|---|---|---|
| shared | 195 | **197** |
| mcp | 12 | **12** |
| server | 376 | **388** |
| web | 81 | **83** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”. No `package.json` / lockfile change.

## Live / browser check
- Covered by server integration tests: mock OAuth connect (PKCE + identity), publish happy path / guardrail private / 429 retry / 401 no-retry / token refresh / schedule ticker / idempotency; API responses asserted free of token strings.
- Web: PublishPanel posts; oauthStartUrl points at `/api/oauth/:platform/start`.
- Did **not** approve gates or render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Deviations from the spec
- Real platform publishers (YouTube etc.) intentionally deferred to TASK-025+.
- `GET /api/settings/vault/export` not provided (per guide).
- App-credentials UI (“Thông tin ứng dụng” form fields) is API-complete; profile page focuses on connect/disconnect + redirect URI. PUT/DELETE app-credentials endpoints exist for later UI polish / YouTube task.
- Daily connection-check runs once per calendar day inside the 60s ticker (not a separate cron).

## Not done
- No commit/push (per rules).
- YouTube / TikTok / Meta publishers (TASK-025, 029, 030).
