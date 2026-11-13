# TASK-056 — Cursor guide (set everything up in the app: keys, AI providers, many platform accounts)

Read `docs/cursor/README.md` first. No new npm dependencies. Tests never use the network, a real LLM, or a real OAuth server: use the mock provider and `fetch` fixtures. Update the user guide, `featureMap` and `nhat-ky-thay-doi.md` (README rule 10).

This task does not depend on TASK-051…055. It touches the LLM registry, the settings pages and the profile/account pages, so run it alone, not in parallel with a task that edits those files.

## Why

The user should never have to open a file to make the app work. Today a new user must edit `.env` and restart the server for most things:

| Area | Where it is set today |
|---|---|
| AI providers: Anthropic, Gemini, OpenAI, OpenRouter, DeepSeek, Groq, OmniRoute endpoint key, OpenCode, Custom OpenAI-compatible, Remote Ollama, Ollama URL | `.env` only (`apps/server/src/providers/llm/registry.ts` reads `config.*_API_KEY` once at startup; the "not configured" hints say "Set X_API_KEY") |
| CLI providers (Claude CLI, Copilot CLI, Antigravity CLI): enable + path | `.env` only |
| Stock image keys: Pexels, Pixabay, Unsplash, Smithsonian, Europeana, Flickr, Openverse client id/secret | `.env` only (`apps/server/src/settings/imageSources.ts` `keyConfigured`) |
| Web image search: Brave key | `.env` only (`apps/server/src/settings/webImage.ts`) |
| Platform developer apps (YouTube client, TikTok client key, Meta app) | per account or per profile in the UI (`TokenVault.storeAppCredentials`), otherwise `.env` fallback (`publishing/envAppCredentials.ts`). No app-wide UI value. |
| TTS keys, Telegram bot token, OmniRoute management token | already in the UI and the encrypted vault ✅ |
| Platform account tokens (OAuth) | already saved automatically after login ✅ |

Platform accounts work, but they are hidden inside each profile page. Seeing every channel, which ones need reconnecting, or adding a second YouTube channel takes many clicks and some knowledge of developer consoles.

Goal: one place to connect things, in plain Vietnamese, with **Đăng nhập** wherever the provider supports it, a paste box with a **Mở trang lấy key** link where it does not, a **Kiểm tra** button for each one, and no restart.

## Rules for this task

- **Precedence:** value saved in the app (vault) → `.env` → nothing. `.env` keeps working as a fallback so nothing breaks for an existing install. The UI always shows where the active value comes from: chip `Đã lưu trong app` or `Từ file .env`.
- **Secrets never go back to the browser.** The API returns only `configured`, `source`, `hint` (last 4 characters) and `updatedAt`. No route, assistant tool, MCP tool or operator tool can read a secret. Saving or deleting a secret is not a registry tool at all (the existing "no credential or token tools" test must keep passing).
- Secrets are stored with the existing `TokenVault.storeSecret / loadSecret / deleteSecret / hasSecret` (AES-256-GCM). Non-secret settings (base URL, default model, enabled flags, CLI paths, custom provider list) go into the existing `app_settings` table as JSON. Prefer no migration. If you really need a table, add it to `schema.ts` and run `npx drizzle-kit generate` (never hand-write SQL).
- Never log a secret or put it in an error message, URL query, user agent or job payload. Redact with the existing helpers.
- Stay out of scope: `PORT`, `HOST`, `DATA_DIR`, `DATABASE_PATH`, `TOKEN_ENCRYPTION_KEY`, `CORS_ORIGIN`, the worker knobs and the per-minute and timeout tuning values stay in `.env`. They are needed before the database opens or are expert-only.
- Do not touch `.env`. You may update comments in `.env.example` to say the app UI is the preferred place.
- README rule 6 still holds: the app never reads Google CLI credentials (`~/.gemini/oauth_creds.json`). Gemini is set with an API key.

## 1. One secret resolver (server)

Add `apps/server/src/settings/secrets.ts`:

```ts
type SecretSource = "app" | "env" | "none";
resolveSecret(id: SecretId): { value: string | null; source: SecretSource; hint: string | null }
describeSecret(id: SecretId): { configured: boolean; source: SecretSource; hint: string | null; updatedAt: string | null }
saveSecret(id: SecretId, value: string): void   // trims; empty string = delete
deleteSecret(id: SecretId): void
```

`SecretId` is a closed list in `packages/shared` (for example `llm.anthropic.apiKey`, `llm.openrouter.apiKey`, `llm.custom.<slug>.apiKey`, `image.pexels.apiKey`, `image.openverse.clientSecret`, `web.brave.apiKey`, `platform.youtube.app`). Each id maps to its `.env` fallback name. Unknown ids are refused with 400.

Replace direct `config.X_API_KEY` reads with `resolveSecret` in:

- `providers/llm/registry.ts` (provider build, `listModels`, the "configured" status);
- `settings/imageSources.ts` and the stock image providers that read keys;
- `settings/webImage.ts` and the Brave client;
- `publishing/envAppCredentials.ts`: the lookup order becomes account → profile → app-wide (`platform.<id>.app`, JSON `{ clientId, clientSecret }`) → `.env`.

Keep existing TTS / Telegram / OmniRoute-management keys where they are, but report them through `describeSecret` so the overview page can show them.

If a stored secret can't be decrypted (the user changed `TOKEN_ENCRYPTION_KEY` or lost `data/secrets/token.key`), `describeSecret` returns `source: "app"`, `configured: false` and the error code `UNREADABLE`. The UI shows `Không đọc được khóa đã lưu. Hãy nhập lại.` Never crash startup.

## 2. AI providers without restart

### 2a. Hot reload

Add `LlmRegistry.reload()`. It rebuilds the provider entries from `.env` plus the app settings plus the vault. Call it after any save or delete in this task. In-flight calls keep the old provider object; new calls use the new one. The response cache and usage rows are untouched. Routes, fallbacks and the model advisor see the new provider list immediately.

### 2b. Provider settings

Store non-secret settings in `app_settings` key `llmProviders`:

```ts
{
  providers: Record<BuiltInProviderId, { enabled: boolean; baseUrl?: string; defaultModel?: string; vision?: boolean }>,
  custom: Array<{ slug: string; label: string; baseUrl: string; defaultModel?: string; vision?: boolean; enabled: boolean }>,
  cli: Record<"claude-cli" | "copilot-cli" | "antigravity-cli", { enabled: boolean; path?: string; model?: string }>
}
```

- **Several custom OpenAI-compatible providers** (not just one `CUSTOM_LLM_*`). Provider id `custom-<slug>`, label chosen by the user. The `.env` `CUSTOM_LLM_*` one still appears as `custom`.
- `baseUrl` must be `http(s)://`. Local addresses are allowed (Ollama, OmniRoute, LM Studio).
- Turning a provider off hides it from routing without deleting its key.

### 2c. Routes

In `apps/server/src/api/llm.ts` (or a new `api/connections.ts`):

- `GET  /api/settings/llm-providers`: list with `configured`, `source`, `hint`, `enabled`, `baseUrl`, `defaultModel`, `keyPageUrl`, `supportsLogin`, last check result.
- `PUT  /api/settings/llm-providers/:id`: non-secret fields plus an optional `apiKey` (write-only).
- `DELETE /api/settings/llm-providers/:id/key`
- `POST /api/settings/llm-providers/custom` and `DELETE …/custom/:slug`
- `POST /api/settings/llm-providers/:id/test`: lists models with the saved key (reuse `listModels`), returns `ok`, the model count, and a short Vietnamese error (`Sai key`, `Hết hạn mức`, `Không kết nối được tới địa chỉ`, `Hết thời gian chờ`). It never echoes the key. Store the last result and its time.
- `POST /api/settings/import-env`: copies every `.env` value that has a `SecretId` into the vault when the app has none yet. It returns which ones were copied (names only). It is never automatic. The user clicks **Chuyển từ file .env vào app**.

### 2d. "Đăng nhập để lấy key" (OpenRouter)

OpenRouter can hand out a user API key through an OAuth PKCE flow. Check its current docs before coding. At the time of writing: redirect the browser to `https://openrouter.ai/auth?callback_url=<our callback>&code_challenge=<S256>&code_challenge_method=S256`, then exchange `code` + `code_verifier` with `POST https://openrouter.ai/api/v1/auth/keys` for `{ key }`. If the docs differ, follow the docs and note it in the report.

- Reuse the PKCE and state helpers from `publishing/oauthState.ts`. State expires in 10 minutes and is single use.
- Callback route `GET /api/settings/llm-providers/openrouter/callback` saves the key into the vault, calls `reload()`, and redirects to the settings page with `?connected=openrouter`. The key never appears in the redirect URL.
- Tests stub `fetch`. No real call.

Other providers have no login flow for API keys. For those, show **Mở trang lấy key** (opens the provider's key page in a new tab) and a paste box. Keep the URLs in one shared catalog (`packages/shared`, for example `CONNECTION_CATALOG`) with `label`, `keyPageUrl`, a 1–3 step Vietnamese how-to, whether it is free or paid, and whether it supports vision. Cover the AI providers, image sources, Brave, and the three platform developer consoles.

## 3. Image sources and web search keys in the UI

- `ImageSourcesSettingsPage`: each source that needs a key gets the same key row as AI providers (paste, **Mở trang lấy key**, **Kiểm tra**, source chip, **Xoá**). **Kiểm tra** runs one tiny search through the provider with a fixture in tests.
- Openverse has two fields (client id + secret).
- `WebImageSettingsPage`: same row for Brave.
- A source with no key stays visible with `Cần key` and a short reason. Keyless sources (Wikimedia, Openverse anonymous, NASA, Met, LOC) show `Không cần key`.

## 4. Platform accounts: one page for all channels

### 4a. Page **Tài khoản nền tảng**

New route in the web app (in the sidebar group with Hồ sơ; add it to the Ctrl+K palette and the `featureMap`). It lists every account of every profile:

- columns: platform icon, display name / handle, profile, format (long/short), connection state, token expiry (`Hết hạn sau 5 ngày`), last check, enabled toggle;
- filters: platform, profile, `Cần kết nối lại`;
- row actions: **Kết nối lại**, **Kiểm tra**, **Tạm tắt**, **Chuyển sang hồ sơ khác**, **Xoá** (the delete goes through the existing confirm dialog);
- **Kiểm tra tất cả**: runs the existing connection check for each account, one at a time;
- a banner at the top when any account needs reconnecting, also counted in the dashboard **Cần bạn xử lý** list.

Server: `GET /api/accounts` (all profiles, same row shape as the profile page plus `profileName`) and `POST /api/accounts/:id/move` (`{ profileId }`; refused while the account has a publication in `UPLOADING`). Keep the existing profile-scoped routes; the profile page keeps working.

### 4b. **Thêm tài khoản** wizard

One dialog, used from both the new page and the profile page:

1. **Chọn nền tảng và hồ sơ.** Platform cards (YouTube, YouTube Shorts, TikTok, Facebook Reels, Instagram Reels) and a profile picker (default: the current profile, or the only one).
2. **Ứng dụng nhà phát triển.** Resolve with the order in section 1. If one is found, show `Đã có (…abcd, nguồn: app/hồ sơ/.env)` and skip ahead. If none is found, show the guided form:
   - the redirect URI to register, with a **Sao chép** button (build it from the server's own address, e.g. `http://127.0.0.1:3001/api/oauth/youtube/callback`);
   - **Mở bảng điều khiển** (the console link from the catalog) and a short Vietnamese checklist (e.g. YouTube: create an OAuth client, enable YouTube Data API v3, add yourself as a test user; refresh tokens expire after 7 days while the consent screen is in Testing);
   - client id / secret fields;
   - a choice: **Dùng cho mọi hồ sơ** (app-wide, `platform.<id>.app`) or **Chỉ hồ sơ này** (existing profile-level storage).
3. **Đăng nhập.** The button opens the existing `/api/oauth/:platform/start` in a popup (fall back to a full redirect if popups are blocked). The page polls the account's connection state, or listens for a `postMessage` from a small callback page. Tokens are saved automatically by the existing callback.
4. **Chọn kênh / trang.** YouTube: show the channel the login returned (name, avatar, handle) and fill the account's display name and `externalId` from it. If the user wants a different brand channel, tell them to pick it on Google's account chooser and offer **Đăng nhập lại**. Meta: reuse the existing Page / IG picker (`meta-target`). TikTok: show the returned user.
5. **Xong.** Summary: name, profile, format, and buttons **Đăng thử ở chế độ riêng tư** (only creates a draft publication for the user to press; never uploads by itself) and **Thêm tài khoản khác**.

Rules:

- Many accounts per platform and per profile are allowed (there is no unique index today; keep it that way).
- If the same `externalId` + platform is already connected in any profile, warn `Kênh này đã được kết nối ở hồ sơ "X"` and offer **Mở tài khoản đó** or **Vẫn thêm**.
- The wizard can be closed at any step. A half-finished account stays as `NOT_CONNECTED` and shows **Tiếp tục kết nối**.
- Never ask for a platform password. Login always goes through the platform's own page.

## 5. Page **Kết nối** (overview) and first-run checklist

New page **Kết nối** (Settings group). It is the hub, not a copy of every settings page:

- sections **AI**, **Giọng đọc**, **Ảnh và video**, **Tài khoản nền tảng**, **Thông báo**;
- each row: name, state chip (`Sẵn sàng`, `Cần key`, `Lỗi khi kiểm tra`, `Đã tắt`), source chip, last check, and the main action (**Nhập key**, **Đăng nhập**, **Kiểm tra**, or **Mở cài đặt** linking to the existing TTS / Telegram / OmniRoute pages);
- AI rows are fully editable here (section 2). Other rows may link to their own page;
- the **Chuyển từ file .env vào app** button (section 2c) with a list of what will be copied, shown only when `.env` holds values the app does not;
- a short safety note: keys are encrypted on this computer; back up `data/secrets/token.key` together with the database, or the keys can't be read after a restore.

Dashboard: a **Thiết lập ban đầu** card while any of these is missing: at least one AI provider ready (or the mock-only setup), a TTS voice, at least one image source, at least one connected platform account. Each line links to the right place. The card hides itself when all four are done, or when the user clicks **Ẩn** (stored in `app_settings`).

Replace every remaining Vietnamese or English UI hint that tells the user to edit `.env` with a link to the right page. Example: the registry hints `Set ANTHROPIC_API_KEY…` become `Nhập key trong Kết nối → AI`. Keep the `.env` name in a small secondary line for advanced users.

## 6. Assistant, MCP, operator

- Add read-only tools `list_connections` (same safe shape as the overview: states and sources, no hints beyond the last 4 characters, no secrets) and `list_platform_accounts` (all profiles), via the shared registry so the assistant, MCP and operator get them together.
- No tool saves, reads or deletes a secret. No tool starts OAuth. When the user asks the assistant to "add a key", it replies with the page link.
- Keep the catalog test under its size limit (see `assistant.test.ts` "compact arg signatures").

## 7. Tests (no network)

Shared:
- `SecretId` ↔ `.env` name map is complete for every id; the catalog has a `keyPageUrl` for every provider that needs a key.

Server:
- Precedence: vault beats `.env`; deleting the vault value falls back to `.env`; both empty means `none`.
- `GET` routes never contain the secret value (assert on the raw JSON string with a known fake key).
- Save a fake Anthropic key → `reload()` → the provider appears in `/api/llm/providers` without rebuilding the app; delete → it disappears.
- Two custom providers with different slugs both route; a disabled one is skipped by routing.
- **Kiểm tra** maps fixture 401 / 429 / ECONNREFUSED / timeout to the four Vietnamese messages.
- OpenRouter PKCE: start produces a state + S256 challenge; callback with a stubbed exchange stores the key, rejects a reused or expired state, and the redirect URL has no key.
- Import from `.env` copies only missing values and reports names only.
- Unreadable vault entry → `UNREADABLE`, startup still succeeds.
- Platform app-credential order: account → profile → app-wide → `.env`.
- `GET /api/accounts` returns accounts from two profiles; `move` refuses while uploading; the duplicate `externalId` warning fires across profiles.
- Image source and Brave **Kiểm tra** use fixtures; the image provider uses the vault key when present.
- Registry: `list_connections` output contains no secret; no tool name matches the existing secret pattern.

Web:
- Key row: paste → saved chip with hint; **Xoá**; source chip `Từ file .env` when the server says so; test result message.
- Wizard: no developer app → guided form with the copy button; with an app → skips to **Đăng nhập**; duplicate warning shown.
- Accounts page filters `Cần kết nối lại`.
- Dashboard checklist hides when all four are ready.

Test counts must not go down.

## 8. Live check

Use a throwaway profile and fake keys only. **Never touch project `56374fb2-54cf-48ff-9441-2e6c653295d4`**, and do not change the user's real accounts or keys. Do not run a real OAuth login and do not paste a real key.

- Open **Kết nối**: rows render, a fake key saves and shows `…abcd`, **Xoá** works, and no restart is needed for the provider to appear in **Cài đặt AI**.
- Open **Tài khoản nền tảng**: accounts from at least two profiles appear; the wizard reaches the **Đăng nhập** step with the mock platform.
- Screenshots at 1280 px and 390 px, with no real keys or personal data visible.

## Done

Done checklist from the README, including the user guide (a new page `docs/user-guide/ket-noi.md`, links from `bat-dau-nhanh` and `dang-bai`, and the changelog entry). Write `docs/tasks/TASK-056.report.md` and an empty `docs/tasks/TASK-056.done`.
