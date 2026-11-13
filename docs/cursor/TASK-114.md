# TASK-114 — Auth core: login, first-run owner, every route protected, API keys 🔐

**Who:** Cursor, model `grok-4.7-xhigh`. Security code that touches every route, and mistakes here are expensive. **Size:** L. **Order:** first task of the multi-user plan. **DB change:** yes. Generate it with `npx drizzle-kit generate` in `apps/server`; never write it by hand.

Read first:
- `docs/cursor/README.md`
- `docs/architecture/multi-user-multi-node.md`: the whole design. This task is row 114.
- `apps/server/src/app.ts` (how routes, CORS and services are registered)
- `apps/server/src/lib/config.ts`
- `apps/server/src/publishing/tokenVault.ts` (how a key file under `DATA_DIR/secrets/` is created)
- `apps/mcp/src/apiClient.ts`
- `apps/server/src/assistant/telegramBridge.ts`
- `apps/server/src/operator/`
- `apps/web/src` (the router and the API client)

## Why

The API has no auth and trusts anyone who reaches the port. Before the app can have many users or remote worker nodes, every request must come from a known user or a known machine key.

## Mã nguồn mở có sẵn

- **Better Auth** (MIT, `better-auth@1.7.21`): add it as a dependency (rule 2 allows it for this task). Use:
  - email + password
  - its sessions (httpOnly cookie)
  - the built-in rate limit
  - the `twoFactor` plugin (backend only; the UI comes in TASK-116)
  - the `apiKey` plugin
  - the drizzle adapter on our existing SQLite connection

  Read its Fastify integration docs and the docs inside `node_modules/better-auth` (offline).
- Do not add the `organization` plugin yet (TASK-115). Do not write your own password hashing, session store or token format.

## What to do

1. **Install:**
   - From Windows, in the repo root, run `npm install better-auth@1.7.21 --save-exact -w @vg/server`.
   - Then check that `node_modules/@esbuild` and `node_modules/@rollup` still hold their `win32` packages and the Linux ones they had before; list both folders before and after.
   - If a platform package disappeared, stop and report. Do not try to fix `node_modules`.
2. **Schema:**
   - Add the Better Auth tables (`user`, `session`, `account`, `verification`, plus the tables its `twoFactor` and `apiKey` plugins need) to `apps/server/src/db/schema.ts`, matching what Better Auth expects for drizzle.
   - You may print the schema with the Better Auth CLI to copy it. The migration itself only comes from `npx drizzle-kit generate`.
   - Run generate twice; the second run must say there are no changes.
3. **Auth module** in `apps/server/src/auth/` (new folder):
   - Create the Better Auth instance and mount its handler at `/api/auth/*`.
   - The secret comes from config `BETTER_AUTH_SECRET`. When that is unset, create a random key file under `DATA_DIR/secrets/` the same way `TokenVault` does. Never log it.
   - Cookies: `httpOnly`, `SameSite=Lax`, and `Secure` when the request is HTTPS.
   - The trusted origins come from a new config list (default: the local web origins used today).
4. **First-run setup:**
   - `GET /api/setup/status` returns whether any user exists.
   - `POST /api/setup/owner` creates the first user (name, email, password) and marks it `role=owner` (a column or Better Auth's admin role; say which).
   - It works only while there are zero users, and only from a loopback address or with a one-time setup code that the server prints to its log at startup while there are no users.
   - It must refuse a second time, including two requests at the same moment.
5. **Protect every route:**
   - Add one Fastify `onRequest` hook that covers every `/api/*` route. It accepts a valid session cookie or a valid API key (`x-api-key`), and otherwise returns 401 with a Vietnamese message.
   - It puts `request.actor = { kind: "user" | "apikey", userId, keyId? }` on the request.
   - Only an explicit allowlist stays open:
     - `/api/health`
     - `/api/auth/*`
     - `/api/setup/*`
     - the OAuth callback routes (find them with grep; they are already protected by `state`)
     - anything else that an outside service must call (list each one in the report with the reason)
   - SSE routes (`pipeline.ts`, `agentEvents.ts`) are protected too.
   - Restrict CORS to the trusted origins, with credentials.
6. **Machine clients:**
   - **Local service key:** at startup, create (or reuse) one API key named "local-services", owned by the owner. Store it under `DATA_DIR/secrets/`, not in `.env`.
   - **MCP:** `apps/mcp/src/apiClient.ts` sends `x-api-key` from env `VG_API_KEY`, falling back to that local secret file when it runs on the same machine. Say which in the report.
   - **In-process callers:** the Telegram bridge, the assistant and the operator. If they call services in process, nothing changes. If any of them calls the HTTP API, it uses the local key. Check each one and list it.
   - **Telegram:** a Telegram chat that was paired before keeps working. Pairing stays the Telegram-side auth; it maps to the owner for now.
7. **Web** (`apps/web`):
   - A login page and a first-run setup page (Vietnamese, using the shared UI components from TASK-049).
   - A 401 from any query sends the user to login and back afterwards.
   - A logout item in the user menu.
   - The user name shows in the sidebar.
   - No team management yet (TASK-116).
8. **Tests:**
   - `buildApp` gets a **test-only** option to inject a fixed actor, so the roughly 970 existing tests keep passing without logging in.
   - That option must not be reachable from env or from config files. A test asserts that a production build ignores it.

## Rules

- No commit or push. The only new dependency is `better-auth@1.7.21`. Migration only through `npx drizzle-kit generate`.
- Do not touch:
  - `.env`, `.claude/`, `data/`, `scripts/`
  - `apps/server/src/pipeline/**`, `apps/server/src/compose/**`, `apps/server/src/style/**`, `apps/server/assets/**`, `packages/shared/src/style/**` (TASK-110 is running there)
  - `apps/server/src/jobs/**`
- You may add the new config keys to `.env.example`.
- Do not log passwords, cookies, API keys or the auth secret. Error messages must not reveal whether an email exists.
- Tests: no network, no real LLM. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- **Tests:**
  - an unauthenticated `/api/projects` returns 401
  - session login works, and so does logout
  - an API key works; a revoked key returns 401
  - the allowlist stays open
  - setup works once only (including a parallel race), and is refused from a non-loopback address without the code
  - an SSE request without auth returns 401
  - the MCP client sends the key
  - the test-only actor option cannot be switched on from env
  - the login rate limit kicks in
- **Checks:** `npm run typecheck` at the root; `npm test` in `packages/shared`, `apps/server`, `apps/mcp` and `apps/web` (if it has tests). Failures outside your area: list them with the file.
- **Manual check:**
  - With the dev server running, open the web app, do first-run setup on a **copy** of the database (point `DATA_DIR` at a temp folder), log in, open a project and log out.
  - Do not touch the real `data/`.
- **User guide:** a short page "Đăng nhập và tài khoản" in `docs/user-guide/`, plus one line in `nhat-ky-thay-doi.md`.
- **Report:** write `docs/tasks/TASK-114.report.md` in Vietnamese, at most 50 lines:
  - the migration file name
  - the allowlist, with the reason for each entry
  - how each machine client authenticates
  - the before/after check of `node_modules` platform packages
  - test results
  - **what the user must do after restarting** (the first-run owner setup on the real app, and where the setup code is printed)
- Then create the empty `docs/tasks/TASK-114.done`.
