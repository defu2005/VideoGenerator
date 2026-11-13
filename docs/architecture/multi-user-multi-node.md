# Multi-user, multi-node and packaging

Status: design, 2026-11-12. Owner: Claude (Fable is out of usage). Tasks: TASK-114 … TASK-120 in `docs/ROADMAP.md`.

## Where we are

- **One user, one machine.**
  - The API (`apps/server`) listens on `127.0.0.1:3001` with no auth at all.
  - The web (Vite) proxies `/api` to it.
  - MCP (`apps/mcp`), the Telegram bridge and the Cursor operator call the same API without a token.
- **State:**
  - one SQLite file (about 100 tables, drizzle migrations run at startup in `src/db/migrate.ts`);
  - project files under `DATA_DIR/projects/<uuid>/`;
  - secrets in `TokenVault`, AES with a key from env or `DATA_DIR/secrets/`.
- **Jobs:** `JobWorker` (`src/jobs/worker.ts`) polls the `jobs` table inside the server process and runs stages in process. One stage = one job.
- **Install:** clone, `npm install`, `.env`, `npm run dev`. No Docker image.

Exposing this to a network as it is would hand the whole app (OAuth tokens, publishing, the operator that runs `cursor-agent`) to anyone who can reach the port. **Auth comes before any remote access**, including remote nodes.

## Goals

1. **Many users** with logins, roles and per-channel access. Every action is recorded with who did it.
2. **Many machines:**
   - one **control plane** (UI, API, DB, scheduler);
   - any number of **worker nodes** on VPSes that run heavy stages in parallel.
3. **Install in minutes** with one Docker image, for both roles.
4. **Configure every node from the control plane UI:** add, set up, update, drain and remove. Nobody edits files over SSH on each VPS.

Non-goals for now: a public SaaS with billing, Postgres, Kubernetes.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Auth library | **Better Auth** (MIT, 1.7.x) with its drizzle adapter on our SQLite | It covers email and password, sessions, TOTP 2FA, API keys, admin, organizations and access control. It is TypeScript and fits drizzle. Writing auth by hand is a security risk. |
| Tenancy | **Workspace** = a Better Auth organization. Every channel (profile) and project belongs to one workspace. | Today: one workspace for your team. Later: other customers get their own workspace without a rewrite. |
| Permissions | Workspace roles from Better Auth access control, plus our own **channel grants**. Checked in one policy module. | Two places use the same check: API routes and the shared tool registry (TASK-047), because the assistant, MCP and the operator all act through tools. Add CASL (MIT) only if the rules outgrow this. |
| Machine identity | API keys (Better Auth API key plugin) for MCP, Telegram and scripts. A **node token** for worker nodes. | Machines never use a user's password or cookie. |
| DB | **SQLite stays**, on the control plane only. Workers have no DB. | One writer, no migration risk on 100 tables. Postgres is a later, separate decision. |
| Backup | Litestream (Apache-2.0), optional container that streams the SQLite file to S3-compatible storage or a folder | A control plane on a VPS needs point-in-time backup. |
| Remote jobs | **Pull model:** workers ask the control plane for work over HTTPS. They hold a lease and send heartbeats, download inputs, run the stage and upload outputs. | Same model as GitHub Actions runners and the Woodpecker CI agent (Apache-2.0). Workers need no inbound port, and no Redis or broker is added. A lost worker's lease expires and the job is requeued. |
| What runs remotely first | **Render** (HyperFrames + ffmpeg), then local TTS (Piper or VieNeu). LLM calls stay on the control plane at first. | Render is the heaviest step and needs no secrets. LLM calls need provider keys and CLI logins (claude, codex, cursor-agent), which belong to one machine. |
| Packaging | One Docker image `vg` (node, ffmpeg, chromium for HyperFrames, Be Vietnam Pro). Its role comes from env: `VG_ROLE=control` or `worker`. Docker compose files plus a one-line install script. Caddy (Apache-2.0) in front for HTTPS. | One image means one build and the same versions everywhere. |
| Network between machines | Recommended: a private network with Tailscale or a self-hosted Headscale (BSD-3). Otherwise public HTTPS through Caddy. Either way, node tokens and TLS. | The control plane should not need to sit on the open internet. |
| Fleet management | Built in: a **Nodes** page, an enrollment command, desired config sent back in the heartbeat reply, version pinning and drain. | Configure every VPS from this machine. Coolify (Apache-2.0) can manage the VPS boxes themselves (Docker, OS), but it does not know our jobs, so it is optional and documented, not required. Dokploy has a mixed licence, so we skip it. |

## Data model (new tables; generate with drizzle-kit)

- **Better Auth tables:**
  - `user`, `session`, `account`, `verification`
  - `organization` (workspace), `member` (`role`), `invitation`
  - `apikey`, `twoFactor`

  Use the Better Auth CLI only to print the schema, then copy it into `schema.ts`. The migration still comes from `npx drizzle-kit generate`.
- **`workspace_id`** on the root tables only: `profiles`, `projects`, topic queue, settings that are per tenant, vault entries, notification targets. Child tables reach the workspace through their project or profile. TASK-115 lists the root tables before changing anything. On migration, all existing rows go into a default workspace whose owner is the first user.
- **`channel_grants`** (`workspace_id`, `user_id`, `profile_id`, `role`): optional narrowing. A member with grants sees only those channels.
- **`audit_log`**: actor (user, API key or node), action, target, workspace, time, and a redacted payload. The TASK-047 tool audit writes here too.
- **`nodes`**:
  - `id`, `name`, `token_hash`, `status`, `version`
  - `capabilities` json, `desired_config` json
  - `last_seen_at`, `drain`
- **`job_leases`** (or new columns on `jobs`): `node_id`, `lease_until`, `heartbeat_at`, `attempt`.
- **`artifacts`**: content hash, size, project and path, so workers download each input once and the control plane checks uploads.

## Roles

| Role | Can |
|---|---|
| owner | everything, including users, nodes, secrets and the operator (`cursor-agent`) |
| admin | users (not owners), channels, nodes, settings; no operator unless the owner allows it |
| editor | create and edit projects and scripts, run stages up to render |
| reviewer | editor rights plus approving gates and the originality review |
| publisher | reviewer rights plus publishing and changing the schedule |
| viewer | read only, including analytics and finance (finance can be hidden per workspace) |

Hard blocks from TASK-047 stay above roles. Project `56374fb2-…` stays blocked for everyone.

## Request flow

```
browser ─cookie─▶ Caddy ─▶ control plane API ─▶ auth preHandler (session | API key)
                                        └▶ policy.can(actor, action, resource) ─▶ route / tool
worker  ─node token─▶ /api/nodes/* (heartbeat, lease, artifacts) only
```

- Every route is protected by default. Only an allowlist is open: `/api/health`, the auth routes, first-run setup, and the OAuth callbacks (these are checked by `state`).
- SSE streams check the session as well.

## Worker protocol (v1)

1. **Join:** `docker run … VG_ROLE=worker VG_CONTROL_URL=… VG_JOIN_TOKEN=<one-time token>`. The control plane exchanges the one-time token for a long-lived node token and stores only its hash.
2. **Heartbeat** every 15 s. The node sends its version, capabilities (render, `tts:piper`, CPU, RAM, free disk, GPU) and its running jobs. The reply carries the desired config: concurrency, enabled capabilities, target version and drain.
3. **Lease:** `POST /api/nodes/lease` returns at most one job that matches the node's capabilities, with `lease_until`. Each heartbeat extends the lease. When a lease expires, the job goes back to the queue and its attempt count goes up, using the existing retry rules.
4. **Inputs:** a manifest of artifacts by hash. The node downloads the ones it lacks into a cache.
5. **Outputs:** upload by hash, then `complete`. The control plane checks the hash and writes the DB rows, as the in-process worker does today.
6. **Secrets:** RENDER sends none. See "Remote stages and lease secrets" below.

## Remote stages and lease secrets (TASK-120)

Nodes run more than RENDER. Capabilities are `render`, `tts:<provider>` and `media_fetch`, reported with a version in `capabilityInfo`. CLI TTS providers are declared only when the tool exists; key-based ones are listed by the operator in `VG_NODE_TTS`.

- **Placement** (`node/placement.ts`): per stage `off | prefer | only`, stored in `nodes.remoteStages`. Defaults: RENDER keeps its old setting, VOICE and MEDIA_FETCH are `off`. A job is leased only to a node with the matching capability. For VOICE and MEDIA_FETCH, `only` means "not on the control plane while a capable node is available"; retries (attempt above 1) and stages whose key is local-only run on the control plane.
- **Jobs:** VOICE uses real VOICE jobs and a TTS bundle; MEDIA_FETCH is a side-job stage with a media bundle (https URLs, size cap). The node returns `result.json` or `report.json` plus the files; the control plane checks sha256, size and type before use, and a malformed result is a 422.
- **Lease secret** (`node/secretBox.ts`, `leaseSecrets.ts`): the node sends a fresh X25519 public key with each lease request. The control plane seals the provider key (ephemeral ECDH, HKDF-SHA256, AES-256-GCM, AAD = scope and expiry) into the lease response only. Expiry is lease TTL plus 5 minutes and is never extended by a regrant. Only `tts.<id>.apiKey` vault keys can be lent; `.env`, OAuth and publish tokens never. The control plane stores a hash and metadata in `node_lease_secrets` (migration 0073), writes an audit row ("Node X got key Y for job Z, expires at …") and revokes on complete, fail, cancel, node loss or revoke. After expiry or revoke the node gets 410 `SECRET_GONE`. The node keeps the key in memory and wipes it after use.
- **Local-only keys:** `nodes.localOnlyKeys` lists vault keys that are never sent; their stage stays on the control plane.

The control plane keeps its in-process worker. A single-machine install works exactly as today.

## Tasks

| Task | What | Model | Depends on |
|---|---|---|---|
| 114 | Auth core: Better Auth, first-run owner, login, every route protected, API keys for MCP, Telegram and operator, web login | grok-4.7-xhigh | — |
| 115 | Workspaces, roles, channel grants, the policy module in routes and tools, `workspace_id` on root tables, audit log | grok-4.7-xhigh | 114 |
| 116 | Team UI: invite, roles, grants, 2FA, sessions, API keys, audit view | grok-4.7-medium | 115 |
| 117 | Packaging: Dockerfile, compose (control and worker), Caddy, install script, Litestream option, docs | grok-4.7-medium | — (parallel) |
| 118 | Worker nodes v1: node table, join, heartbeat, lease, artifacts, remote render | grok-4.7-xhigh | 114, 117 |
| 119 | Nodes page: add-node command, health, desired config, drain, version pin and self-update | grok-4.7-medium | 118 |
| 120 | More remote stages (local TTS, media fetch) and scoped secrets for nodes | grok-4.7-xhigh | 119 |
