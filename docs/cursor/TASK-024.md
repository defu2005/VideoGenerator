# TASK-024 — Cursor guide (Publishing framework, token vault, mock publisher)

Read `docs/cursor/README.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
A platform-neutral publishing layer: connect accounts with OAuth, keep their tokens safe, queue publish jobs with a schedule, retry, and show the status. Real platforms come in TASK-025 (YouTube) and TASK-029…031. This task ships a **mock publisher** so all of it is testable without the network.

## User decisions (do not change)
- Default visibility is **public, on a schedule**, fully automatic, but only when the account's `publishSettings.autoPublish` is on (off by default, TASK-022).
- **Safety guardrail:** a video with open MUST guideline findings, a `RENDER_VISION_ISSUE` WARN in the AUTO report, or a failed render check is uploaded as **private** instead of public, and the publish record says why. The user can then publish it by hand.
- Tokens are stored **encrypted on the user's machine** and are never sent anywhere except the platform's own API.

## Token vault (`apps/server/src/publishing/tokenVault.ts`)
- AES-256-GCM with `node:crypto` (no new dependency).
- The key comes from env `TOKEN_ENCRYPTION_KEY` (base64, 32 bytes) when set. Otherwise the app creates a random key file at `<DATA_DIR>/secrets/token.key` on first use, with file mode 0600 where the OS supports it. Add `TOKEN_ENCRYPTION_KEY` to `.env.example` with a comment; do not touch `.env`.
- Table `platform_credentials`: `account_id` (PK, FK cascade), `ciphertext`, `iv`, `auth_tag`, `scopes`, `expires_at`, `updated_at`. Only the vault reads or writes it.
- Never log tokens, never return them from any API, never put them in errors or the AUTO report. Add a test that serialises every publishing API response and checks that no token string appears.
- `DELETE /api/profiles/:id/accounts/:accountId/connection` ("Ngắt kết nối") deletes the credential row and sets `connection` to `NOT_CONNECTED`. It also calls the platform's revoke endpoint when the publisher supports it.

## Account credentials and automatic sign-in (user request)
Each account signs in **automatically** and stays managed without the user, using OAuth only:
- **App credentials per account.** Every platform account can carry its own developer-app credentials (YouTube `clientId`/`clientSecret`, TikTok `clientKey`/`clientSecret`, Meta `appId`/`appSecret`). The user enters them in the account form ("Thông tin ứng dụng"). They are stored **encrypted in the vault** (table `platform_app_credentials`: `account_id` PK or `profile_id`, so one app can be shared by all accounts of a profile; plus `platform`, ciphertext, iv, auth tag, `updated_at`). The `.env` values (`YOUTUBE_CLIENT_ID`…) are only the fallback. The API returns just "đã cấu hình" + the last 4 chars of the id, never the secret.
  - Why per account: YouTube quota is per Google Cloud project (about 6 uploads a day), so separate projects for separate channels multiply the quota; different brands may also want different apps.
- **Auto sign-in = refresh tokens.** After the first consent click, the app refreshes access tokens by itself before every upload and in a **daily connection check** (the ticker calls `fetchIdentity` once a day per connected account). A failure sets `EXPIRED` or `ERROR`, writes an automation log entry and shows a red badge plus a "Kết nối lại" button (one click → consent page → back).
- **Account management:** the account page shows the platform identity (name, handle, external id), token expiry, scopes granted, last check time, and the app credentials status. Actions: "Kiểm tra kết nối", "Kết nối lại", "Ngắt kết nối", "Xóa thông tin ứng dụng".
- **Not allowed (do not build, even as an option):** storing platform passwords or 2FA codes, or signing in by driving a browser (Puppeteer/Playwright, cookie import, headless login). Platforms treat that as automation abuse, it triggers CAPTCHAs and account locks, and it breaks the rule against bypassing bot checks. OAuth gives the same "always signed in" result safely.
- **Backup/move:** `GET /api/settings/vault/export` is **not** provided. Moving to another machine means reconnecting the accounts.

## Publisher interface (`apps/server/src/publishing/types.ts`)
```ts
interface Publisher {
  platform: PlatformId;
  oauth: {
    buildAuthUrl(input: { accountId: string; redirectUri: string; state: string; codeChallenge: string }): string;
    exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }, signal: AbortSignal): Promise<TokenSet>;
    refresh(tokens: TokenSet, signal: AbortSignal): Promise<TokenSet>;
    revoke?(tokens: TokenSet, signal: AbortSignal): Promise<void>;
    fetchIdentity(tokens: TokenSet, signal: AbortSignal): Promise<{ displayName: string; handle?: string; externalId: string }>;
  };
  upload(input: PublishInput, tokens: TokenSet, signal: AbortSignal, onProgress: (p: number) => void): Promise<PublishResult>;
  limits: { maxDurationSec: number; maxTitleChars: number; maxDescriptionChars: number; maxTags: number; supportsScheduledPublishAt: boolean };
}
```
`PublishInput` holds: the video file path, format, title, description, tags, thumbnail path (optional), visibility, `publishAt` (optional), language, and `madeForKids: false`. Add an AI-disclosure flag for platforms that ask for one ("altered or synthetic content"); set it **true**, since the voice is TTS.

Register publishers in a `PublisherRegistry`. Add `MockPublisher` (platform `mock`, only when `LLM_ENABLE_MOCK=true` or in tests). It "uploads" by copying nothing and returning a fake URL.

## OAuth flow (shared by every platform)
- `GET /api/oauth/:platform/start?accountId=` → generates `state` + a PKCE verifier (stored in memory with a 10-minute TTL), then redirects to `buildAuthUrl`.
- `GET /api/oauth/:platform/callback` → checks `state`, exchanges the code, stores the tokens in the vault, calls `fetchIdentity` (fills `display_name`, `handle`, and a new `external_id` column on `platform_accounts`), sets `CONNECTED`, then redirects to the profile page in the web app.
- The redirect URI is `http://127.0.0.1:<API port>/api/oauth/<platform>/callback`. Show it on the account form so the user can paste it into the platform's developer console.
- Token refresh happens just before an upload when `expires_at` is less than 5 minutes away. A refresh failure sets `EXPIRED` and the publish job fails with "Cần kết nối lại tài khoản".
- The app never sees the user's password. The user clicks consent on the platform's own page.

## Publish jobs
- Table `publications`: `id`, `project_id`, `render_id`, `account_id`, `status` (`QUEUED` | `SCHEDULED` | `UPLOADING` | `PUBLISHED` | `FAILED` | `CANCELLED`), `visibility_requested`, `visibility_used`, `guardrail_reason` (nullable), `scheduled_for` (nullable), `external_id`, `external_url`, `attempts`, `last_error`, `progress`, `created_at`, `updated_at`, `published_at`.
- **Metadata:** use the project's video metadata (TASK-019). Trim to the publisher's limits in code. Hashtags for TikTok/Reels come from the tags.
- **Render choice:** the latest finished render whose aspect ratio matches the account format. If none exists, the job enqueues the variant render (TASK-023 `render-variants`) and waits for it.
- **Runs in the existing job worker** (`apps/server/src/jobs/`) as a new job type `PUBLISH`. Retry with backoff on network/5xx/429 (max 3 attempts). No retry on 4xx auth/validation; those set `FAILED` with a Vietnamese message.
- **Schedule:** if `scheduled_for` is in the future and the platform supports `publishAt`, upload now as private with `publishAt` (the platform publishes it). Otherwise keep the job `SCHEDULED` and start the upload when the time comes; a small in-process ticker (every 60 s, started with the worker) picks due jobs. It must survive restarts (state is in the DB).
- **Idempotency:** never upload the same render to the same account twice unless the user asks ("Đăng lại").

## API
| Method | Path | |
|---|---|---|
| GET | `/api/projects/:id/publications` | list |
| POST | `/api/projects/:id/publications` | body: `accountIds[]`, optional `scheduledFor`, optional `visibility` override |
| POST | `/api/publications/:id/cancel` | only before `UPLOADING` |
| POST | `/api/publications/:id/retry` | |
| GET | `/api/publications?status=&profileId=` | global list for the calendar |

## Web
- On the render/result screen: a **"Đăng"** panel. It lists the project's profile accounts with checkboxes, a "Thời gian đăng" picker (default: now), the visibility (default from the account), and a "Đăng" button. Then progress and status per account, with a link to the published video.
- The guardrail reason is shown clearly when a video went up private.
- The profile page "Tài khoản" tab: a **"Kết nối"** button per account (opens `/api/oauth/:platform/start` in a new window), the connection badge, "Ngắt kết nối", and the redirect URI to copy.
- A **"Lịch đăng"** page: upcoming and past publications across profiles, grouped by day.

## MCP
`publish_project` (accountIds, scheduledFor) and `list_publications`.

## Tests (no network)
- Vault: encrypt/decrypt round trip, tampered ciphertext fails, key file created once, no token in API output.
- OAuth routes with the mock publisher: state check, PKCE, `CONNECTED`, identity stored, bad state → 400.
- Publish job: happy path; guardrail → private with reason; 429 then success; 401 → `FAILED`, no retry; refresh before upload; schedule ticker picks a due job; idempotency.
- Web: publish panel renders and posts; connect button URL.

## Steps
1. Shared schemas (publication, publish input, statuses).
2. Server: vault, tables + drizzle generate, registry + mock, OAuth routes, PUBLISH job + ticker, routes, tests.
3. Web: publish panel, connect UI, "Lịch đăng" + tests. MCP tools.
4. Done checklist (browser: connect the mock account and publish a throwaway project to it). Write `docs/tasks/TASK-024.report.md` and `docs/tasks/TASK-024.done`.
