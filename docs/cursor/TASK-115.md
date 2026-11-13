# TASK-115 — Workspaces, roles, channel grants, one policy check, audit log 🛡️

**Who:** Cursor `grok-4.7-xhigh`, or a new Sonnet 5.5 session (`context: fresh`) while Cursor has no usage. This is security code that touches every route and every tool, and a mistake here leaks one team's data to another. **Size:** L. **Order:** after TASK-114 (auth) and after TASK-121 has generated its migration, because both touch `schema.ts` and `app.ts`. **DB change:** yes. Generate it with `npx drizzle-kit generate` in `apps/server`; never write it by hand.

Read first:
- `docs/cursor/README.md`
- `docs/architecture/multi-user-multi-node.md`: the whole design, especially "Decisions", "Data model", "Roles" and "Request flow". This task is row 115.
- `docs/cursor/TASK-114.md` and `docs/tasks/TASK-114.report.md`: what auth already does.
- `apps/server/src/auth/`: `instance.ts` (Better Auth setup), `guard.ts` (`request.actor`), `actor.ts`, `setup.ts` (first owner), `localKey.ts` (the "local-services" key).
- `apps/server/src/registry/`: `invoke.ts` (`invokeRegistryTool`), `policy.ts` (hard blocks, autonomy), `audit.ts` (`logToolAudit` → `operator_tool_audit`).
- `apps/server/src/api/projects.ts` and `apps/server/src/api/profiles.ts`: the routes use `:id` for the project or profile.
- `apps/server/src/db/schema.ts`: `profiles`, `projects`, and every table with a `profile_id` column.

## Why

After TASK-114, every request comes from a known user or a known key, but every logged-in user can still do everything. Before a second person joins, three things must hold:
- each person sees only their workspace;
- inside it, only the channels they are given;
- they can only do what their role allows.

The check must be the same whether the call comes through the web (API routes) or through an agent (assistant, MCP, operator, later Hermes), all of which act through the shared tool registry. Every change must be recorded with who made it.

## Mã nguồn mở có sẵn

- **Better Auth `organization` plugin** (MIT, already installed as part of `better-auth@1.7.21`, so this adds no new dependency). It stores workspaces (`organization`), members with a role (`member`) and invitations (`invitation`), and keeps the active workspace on the session (`activeOrganizationId`). TASK-116 builds its UI on the plugin's own endpoints (invite, accept, change role, remove). Read the plugin docs in `apps/server/node_modules/better-auth/dist/plugins/organization` offline.
- **Better Auth access control** (`better-auth/plugins/access`, `createAccessControl`): define our six roles there so that the plugin's own endpoints (invite, update role) respect them.
- Do **not** add CASL or any other library. The design says to add CASL only if the rules outgrow one module. If you think they already do, say so in the report instead of adding it.

## Decisions (do not change without saying why in the report)

| Topic | Decision |
|---|---|
| Workspace | One Better Auth organization = one workspace. On first start after this task, create a default workspace "Không gian chính" owned by the instance owner (the `user.role = "owner"` user from TASK-114), and put every existing row into it. When `/api/setup/owner` creates the first owner on a fresh install, it creates that workspace too. |
| Roles | `owner`, `admin`, `editor`, `reviewer`, `publisher`, `viewer`, exactly as in the design doc's "Roles" table. A new member defaults to `viewer`. |
| Source of truth | One pure module `apps/server/src/auth/policy.ts`. Better Auth roles hold membership; `policy.ts` decides. Routes and tools never compare role strings themselves. |
| Channel grants | Table `channel_grants` (`id`, `workspace_id`, `user_id`, `profile_id`, `role`, `created_at`, `created_by`), unique on (`workspace_id`, `user_id`, `profile_id`). A member with **no** grants sees every channel in the workspace. A member with **one or more** grants sees only those channels. The grant's `role` can only lower the member's workspace role for that channel, never raise it: effective role = the lower of the two. Owners and admins ignore grants. |
| Projects without a channel | A project with `profile_id = NULL` belongs to the workspace. Only members without grants (and owners/admins) see it. |
| Not found vs forbidden | A resource in another workspace, or a channel the actor cannot see, returns **404** with the normal "not found" message, so nobody learns that it exists. A visible resource with a missing permission returns **403** "Bạn không có quyền làm việc này." |
| Settings and secrets | `app_settings`, `app_secrets` and the TokenVault stay **instance-wide** in this task. Reading settings needs `settings.read` (editor and up); changing them needs `settings.write` (admin and up); secrets need `secrets.write` (owner only). Per-workspace settings come later. Say in the report which settings you think should become per-workspace. |
| Protected project | The hard blocks in `registry/policy.ts` stay exactly as they are and run **before** roles. Do not add a new API-level block for project `56374fb2-…`: the user still opens it in the UI. |

## What to do

### 1. List the root tables first (no code yet)

Put the list at the top of the report. A table is a **root table** when it holds tenant data and has no required `project_id` or `profile_id` that already leads to a workspace. Expected roots (confirm each one, and add any that are missing):
- `profiles`
- `projects` (its `profile_id` is nullable)
- `style_packs`
- `video_looks`
- `knowledge_entries`
- `webhook_endpoints`
- `assistant_conversations`
- `operator_conversations`
- `standing_orders`
- `operator_goals`
- `operator_preferences`
- `revenue_entries`, `cost_entries`, `payout_thresholds`, `monthly_reports`
- `agents`

Explicitly **global**, so they get no `workspace_id`: caches and provider data (`llm_cache`, `image_search_cache`, `provider_intel_*`, `model_*`, `llm_quota_usage`, `llm_cooldowns`, `currency_rates`, `routing_canaries`, `change_*`), `jobs` (each job reaches a workspace through its project), auth tables, `app_settings`, `app_secrets`.

Child tables (anything with a required `project_id` or `profile_id`) get no column; they reach the workspace through their parent.

### 2. Schema

- Turn on the `organization` plugin in `auth/instance.ts`, with `ac` and the six roles. Add its tables (`organization`, `member`, `invitation`, plus the session column `activeOrganizationId`) to `schema.ts`, the way TASK-114 added the core tables.
- Add `workspace_id text` (nullable at the DB level, with an index) to each root table.
- Add `channel_grants` and `audit_log`.
- Then run `npx drizzle-kit generate` twice. The second run must report no changes. Check that the SQL holds only your changes, and put the file name in the report.
- Why nullable: SQLite cannot add a NOT NULL column without rebuilding these large tables. Instead, the code guarantees the value:
  - the startup backfill fills every NULL;
  - every insert path sets `workspace_id`;
  - a test checks that no root row has a NULL `workspace_id` after the standard test flows run.

### 3. Startup bootstrap (code, idempotent)

In `auth/workspaces.ts`, run after migrations and after the auth instance exists:
- If an owner exists and has no workspace, create the default workspace with the owner as member `owner`.
- Backfill: `UPDATE <root> SET workspace_id = ? WHERE workspace_id IS NULL` for each root table. Do it in one transaction and log the counts.
- A second start changes nothing.
- On a fresh install, `setup.ts` calls the same function right after the owner is created.

### 4. Who is acting, and where

Extend `AuthActor` to:

```ts
{ kind: "user" | "apikey" | "system"; userId: string; keyId?: string;
  workspaceId: string; role: WorkspaceRole; channelIds: string[] | "all"; isInstanceOwner: boolean }
```

Resolve it in the guard after authentication:
- **Session:** use `activeOrganizationId`. If it is unset and the user has exactly one membership, use that one and set it as active. If there are several memberships and none is active, return 409 `WORKSPACE_REQUIRED` with a Vietnamese message.
- **API key:** use the `x-workspace-id` header when it is present, and it must be a workspace the key's user belongs to. Otherwise use the user's only workspace. Otherwise return 409 `WORKSPACE_REQUIRED`. MCP reads `VG_WORKSPACE_ID` from env and sends it when it is set.
- **Not a member** of the requested workspace: 404.
- **In-process callers** (the operator loop, the scheduler, autopilot, Telegram, the job worker) act as `kind: "system"` for the **owner** of the workspace that owns the object they touch. Build one helper `systemActorFor(workspaceId)`. Do not let any of them run without an actor.
- **The test actor from TASK-114** becomes an owner of the default workspace with `channelIds: "all"`, so the roughly 990 existing tests keep passing. Add a second test helper to build an actor with any role and grants.

### 5. The policy module

`auth/policy.ts` exports:
- the `Action` union;
- `can(actor, action, resource?)`, returning `{ ok: true } | { ok: false; status: 403 | 404; reason }`;
- `visibleProfileIds(actor)`;
- `scopeFor(actor)`, which list queries use.

Actions (keep the list short and add one only when a route really needs it):
- `project.read`, `project.write`
- `stage.run` (all stages up to render), `gate.approve` (gates and the originality review)
- `publish` (publish, schedule, change the schedule)
- `channel.read`, `channel.manage` (create, edit and delete channels, platform accounts and OAuth connect)
- `comments.reply`
- `analytics.read`, `finance.read`, `finance.write`
- `settings.read`, `settings.write`, `secrets.write`
- `members.manage`, `audit.read`
- `operator.use`, `automation.manage` (autonomy, standing orders, autopilot)
- `nodes.manage` (reserved for TASK-118)

Role matrix:
- Follow the design doc's "Roles" table.
- `viewer` gets `*.read` only, including `finance.read`. Add a workspace switch `hideFinanceFromViewers`, stored in the organization's metadata, default off.
- `operator.use` is owner only, plus admin when the workspace metadata flag `adminsCanUseOperator` is on.
- `automation.manage` is owner and admin.

`resource` is `{ workspaceId, profileId?: string | null }`. Resolve it in this order:
1. A different workspace → 404.
2. The channel is not visible → 404.
3. The effective role (with the grant) lacks the action → 403.

Unit tests cover the full matrix as a table: role × action, with and without grants.

### 6. Routes: one map, no unprotected route

- **`auth/routePermissions.ts`:** a table from `METHOD /api/path/pattern` to `{ action, resource }`. `resource` is one of:
  - `"project:id"` (load the project's workspace and profile from `params.id`);
  - `"profile:id"`;
  - `"account:id"`, `"publication:id"`, `"comment:id"` (resolve the profile through the parent);
  - `"workspace"` (lists and creates);
  - `"instance"` (settings, secrets).
- **One `preHandler` hook** looks up the route by `request.routeOptions.url` and method, loads the resource, and calls `can`. It also puts `request.scope = scopeFor(actor)` on the request for list handlers.
- **Coverage test:** collect every registered route with Fastify's `onRoute` hook. The test fails if any `/api/*` route other than the TASK-114 allowlist has no entry in the map. A route added later without an entry breaks the test, so nothing can slip through.
- **Lists must filter, not only check.** Every list or search endpoint that returns tenant rows must filter by `request.scope` (workspace plus visible channels): projects, profiles, publications, comments, analytics, finance, dashboard, the topic queue, the knowledge base, the assistant and operator conversations, and the "Cần bạn xử lý" counts. Pass the scope into the service function, and filter in SQL rather than after loading. List every endpoint you changed in the report.
- **Creates:** a new root row takes `workspace_id` from the actor. A new project with a `profileId` must point to a visible channel.
- **SSE streams:** the pipeline stream checks `project.read` on its project. The agent and notification event streams drop any event whose project or channel the actor cannot see.

### 7. Tools: the same check

- `invokeRegistryTool` takes `actor` (required).
- Add a `TOOL_ACTIONS` map from each tool name in `ASSISTANT_TOOLS` to `{ action, resource }`, built the same way as the route map. A test fails if any tool is missing from it.
- Order inside `invokeRegistryTool`:
  1. hard blocks (unchanged);
  2. then `can`, and on failure return a refusal with the Vietnamese reason, audited as `refused`;
  3. then the existing autonomy and pending logic.
- **Pending actions remember who asked.** Add `actor_user_id` and `workspace_id` to `assistant_pending_actions`. Only a user whose role allows the action, in the same workspace, may approve it, and never the agent itself (that rule stays as it is).
- **Who the agents act as:**
  - the assistant acts as the logged-in user who is chatting;
  - MCP acts as its API key's user;
  - the operator, scheduler, autopilot and Telegram act as `systemActorFor(workspace)`.

  Write this in the report as a table.

### 8. Audit log

`audit_log` columns:
- `id`, `at`
- `workspace_id`
- `actor_kind`, `actor_user_id`, `actor_key_id`
- `action`, `target_type`, `target_id`
- `outcome` (`ok`, `denied`, `error`), `status_code`
- `source` (`api`, `assistant`, `mcp`, `operator`, `system`)
- `summary`
- `payload` (redacted JSON, at most 4 KB)
- `request_id`

Indexes on (`workspace_id`, `at`) and (`actor_user_id`, `at`).

Writes:
- **API:** an `onResponse` hook writes one row for every non-GET request that passed the guard. Include 403 and 404 denials as `denied`. Skip `/api/auth/*`, because Better Auth has its own session table, but do record sign-in failures as `denied` with no payload.
- **Tools:** `logToolAudit` also writes one `audit_log` row with the actor, and links back with `target_type = "tool_audit"`. Keep `operator_tool_audit` as it is, since other code reads it.
- **Redaction:** reuse `maskSecretArgs` and `redactOperatorText` from `registry/audit.ts`. Never store passwords, cookies, API keys, tokens or file contents.
- **Read API:** `GET /api/audit?workspace&actor&action&from&to&cursor`, needs `audit.read` (owner and admin), with cursor paging. There is no UI in this task; TASK-116 adds the view.
- **Retention:** keep 180 days. Delete older rows in the existing daily cleanup if there is one; otherwise add a cleanup step at startup and in the daily cron. This is the one hard delete allowed, and it applies only to audit rows older than the limit.

### 9. Web (minimal; the team UI is TASK-116)

- When the user belongs to more than one workspace, show a workspace switcher in the user menu. It calls the plugin's `setActive` and then reloads the queries.
- Hide nav items and buttons that the user's role cannot use. The server decides; the client only hides. Get the role and the allowed action list from one new `GET /api/me` (user, workspace, role, `channelIds`, allowed actions). Do not copy the matrix into the web code.
- A 403 shows a toast "Bạn không có quyền làm việc này." A 409 `WORKSPACE_REQUIRED` opens the switcher.

## Rules

- No commit or push. No new npm dependency. The migration comes only from `npx drizzle-kit generate`. Do not run `npm install` and do not touch `node_modules` or `package-lock.json`.
- Do not touch:
  - `.env`, `.claude/`, `data/`, `scripts/`
  - `deploy/`
  - `apps/server/src/pipeline/**`, `apps/server/src/compose/**`, `apps/server/assets/**`, `packages/shared/src/style/**`
  - the quality-repair files from TASK-121
- Do not weaken the TASK-059 hard limits or the hard blocks in `registry/policy.ts`. Do not let any agent change roles, grants or memberships: add `members.manage` to the forbidden keys or tools, so a tool call that tries it is refused like an autonomy change.
- Do not log passwords, cookies, keys or tokens.
- Tests: no network and no real LLM. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- **Tests:**
  - the policy matrix (role × action, with and without grants, effective role is the lower one);
  - every route is mapped and every tool is mapped (coverage tests);
  - workspace isolation: user B in workspace 2 gets 404 for workspace 1's project by id, and its lists do not show it (projects, profiles, publications, comments, finance, dashboard counts);
  - a channel grant hides other channels' projects from lists and returns 404 by id;
  - a viewer gets 403 on `POST` stage run; an editor cannot approve a gate; a reviewer cannot publish; an admin cannot use the operator until the flag is on;
  - the assistant refuses a tool the chatting user's role does not allow, and audits it as `refused`;
  - a pending action cannot be approved by a user without the right role, or from another workspace;
  - the API key with `x-workspace-id` of a workspace its user is not in gets 404;
  - startup backfill puts existing rows in the default workspace, and a second start changes nothing;
  - no root row has a NULL `workspace_id` after the test flows;
  - the SSE pipeline stream returns 404 for another workspace's project;
  - audit rows are written for a write, a denial and a tool call, with secrets masked; `GET /api/audit` is refused for an editor;
  - the existing test suite still passes with the owner test actor.
- **Checks:** `npm run typecheck` at the root; `npm test` in `packages/shared`, `apps/server`, `apps/mcp` and `apps/web`. List any failure outside your area, with its file. `apps/server/test/render.test.ts` is known to time out on ffmpeg.
- **Manual check:** on a temporary `DATA_DIR` (never the real `data/`):
  - set up the owner and confirm the default workspace exists;
  - create a second user through the plugin API as a viewer with a grant on one channel;
  - log in as that user and check that only that channel's projects show, and that running a stage is refused;
  - read `GET /api/audit` as the owner.
- **User guide:** a page "Không gian làm việc và quyền" in `docs/user-guide/` covering the roles table in Vietnamese, what a channel grant does, and what the audit log records. Add one line to `nhat-ky-thay-doi.md`. Update the featureMap and coverage test from TASK-048 if they require it.
- **Report:** write `docs/tasks/TASK-115.report.md` in Vietnamese, at most 60 lines:
  - the root table list (step 1)
  - the migration file name
  - the actor table (who each agent or in-process caller acts as)
  - the list endpoints you changed
  - settings that should become per-workspace later
  - test results
  - anything you decided differently from this guide, and why
- Then create the empty `docs/tasks/TASK-115.done`.
