# TASK-118 — Worker nodes v1: join, heartbeat, lease, artifacts by hash, remote render 🖥️

**Who:** Cursor `grok-4.7-xhigh`, or a new Sonnet 5.5 session (`context: fresh`) while Cursor has no usage. **Size:** L. **Order:** after TASK-115 (it shares `auth/guard.ts`, `db/schema.ts`, the policy actions and the audit helper) and after TASK-117 (Docker, done). **DB change:** yes. Generate it with `npx drizzle-kit generate`.

Read first:
- `docs/cursor/README.md`
- `docs/architecture/multi-user-multi-node.md`: "Decisions", "Data model" and **"Worker protocol (v1)"**. This guide implements that section.
- `docs/cursor/TASK-114.md`, `TASK-115.md`, `TASK-117.md` and their reports in `docs/tasks/`.
- Server:
  - `src/index.ts`: the `VG_ROLE === "worker"` stub that exits today.
  - `src/jobs/worker.ts` (`JobWorker.tick`, `runBudgeted`, `jobErrorFromCaught`), `src/jobs/jobRepository.ts`, `src/jobs/eventBus.ts`.
  - `src/pipeline/orchestrator.ts`: `startJob`, `canStartQueuedJob`, how a job is completed or failed, retry with `run_after`, abort.
  - `src/stages/render/renderExecutor.ts`, `src/services/renderService.ts` (`render()` from line ~656), `src/compose/sceneClip.ts`, `src/compose/hyperframes.ts`.
  - `src/auth/guard.ts` (open allowlist), `src/auth/policy.ts`, `src/auth/routePermissions.ts`, the audit helper from TASK-115.
  - `src/lib/config.ts`, `src/storage/paths.ts`.
- Deploy: `deploy/docker/compose.worker.yml`, `deploy/install.sh`, `deploy/README.md`.

## Why

Render (HyperFrames + ffmpeg) is the heaviest stage. One machine renders one video at a time, and several channels queue behind each other. The user wants to rent cheap VPSes and let them render in parallel. The control plane, its DB, its secrets and its LLM logins stay on one machine. A worker holds no DB and no secrets. It pulls work, renders, and uploads the result.

A single-machine install must keep working exactly as today. With no node joined, nothing changes.

## Mã nguồn mở có sẵn

Nothing new to install. The patterns come from these projects. Read them, copy no code unless the licence is permissive, and keep attribution if you do.
- **Woodpecker CI agent** (Apache-2.0, `woodpecker-ci/woodpecker`, `agent/` and `rpc/`): pull model, agent token, `Next` (lease) / `Extend` / `Update` / `Done` calls, cancel delivered on the next poll. This is the closest model for our protocol.
- **GitHub Actions runner** (MIT, `actions/runner`): long poll for jobs, job-scoped access to what the job needs, and the runner never gets more than the job's scope.
- **graphile-worker** (MIT): `locked_at` / `locked_by` lease columns on the jobs table, and an expired lock goes back to the queue. This is the same idea as our `lease_until`.
- **Bazel remote cache / BuildKit** (Apache-2.0): content-addressed storage by sha256. The client asks only for hashes it lacks, and the server checks the hash on upload.
- **Node 22 built-ins**: `fetch` (undici) with streamed bodies, `stream/promises` `pipeline`, `crypto.createHash("sha256")`. `undici` and `tar-stream` are already in `node_modules` if you truly need them, but plain `fetch` is enough. **Add no dependency.**

If you find a maintained library that does lease plus content-addressed transfer better, report it (README rule 11). Do not add it.

## Design in one picture

```
control plane                                               worker node (VG_ROLE=worker, no DB)
RENDER job QUEUED
  └ prepare (DB reads, compose plan, LLM director)  ─▶ RenderBundle v1 + artifact manifest
                                                      ◀─ POST /api/nodes/agent/lease
                         lease {jobId, leaseId, leaseUntil, bundle} ─▶
                                                      ◀─ GET  /api/nodes/agent/artifacts/:sha256 (only lacking ones)
                                                         execute(bundle) : HyperFrames + ffmpeg, no DB
                                                      ◀─ POST /api/nodes/agent/heartbeat (progress, extends lease)
                                                      ◀─ PUT  /api/nodes/agent/jobs/:id/outputs/:name  (x-sha256)
                                                      ◀─ POST /api/nodes/agent/jobs/:id/complete {leaseId}
  └ finalize (checks, render vision LLM, renders row, originality, thumbnails, shorts)
```

The local in-process worker uses the **same three steps**, with no HTTP in between. That gives one render code path, not two.

## What to do

### 1. Split render into prepare → execute → finalize (refactor first, no behaviour change)

Do this step first, alone, and get every existing render test green before writing any node code.

- **`prepareRender(project, options, signal) → { bundle: RenderBundle; manifest: ArtifactRef[]; reuse?: Render; usage? }`** runs on the control plane and owns everything that needs the DB or an LLM:
  - timeline and `inputHash`, aspect and variant logic;
  - the `visual_crops` lookups;
  - missing-voice and missing-music checks;
  - the ASS text, the compose plan (LLM), the graphic style;
  - the clip hashes;
  - `voice_tracks` words, `sfxCues`, credits text;
  - the reuse check against `renders.input_hash`. When it reuses, there is nothing to execute.
- **`RenderBundle`**: a zod schema in `packages/shared` (`schemas/renderBundle.ts`) with `bundleVersion: 1`, `appVersion`, `COMPOSE_RENDER_VERSION`, the resolved timeline, compose plan, style, ASS text, SFX cues, word timings, clip hashes, credits text and target size.
  - Every file the render reads is referenced by a **logical name** (for example `voice/scene-03.mp3`) that maps to an `ArtifactRef {name, sha256, size}`.
  - It holds no absolute control-plane path and no secret.
- **`executeRender(bundle, io, signal, onProgress) → RenderOutputs`** is pure. It needs no sqlite, no LLM registry and no vault.
  - `io` gives `resolve(name) → localPath`, `clipCacheDir`, `outDir`.
  - It renders scene clips (cached by clip hash in `clipCacheDir`), concat, filter, mix, subtitles and the final file.
  - It returns `{ files: {final, srt, credits, thumbs[]}, reportParts }`.
  - Move code; do not rewrite it.
  - Add a test that reads the import graph of the execute module and fails if it reaches `db/`, `providers/llm`, `vault`, `better-sqlite3` or `auth/`.
- **`finalizeRender(project, prepared, outputs)`** runs on the control plane:
  - the existing checks (`check()`, loudness, render vision);
  - writing the `renders` row;
  - `recheckOriginalitySafely`, `recordFinishedLookSafely`, version pruning.

  Thumbnails and auto-shorts stay in `RenderExecutor` after finalize, as today.
- `RenderService.render()` becomes `prepare → (reuse ? return : execute locally) → finalize`.
- **Done for step 1:**
  - every existing test in `apps/server` that touches render, compose, thumbnails, clips or the quality repair passes unchanged;
  - the `input_hash` and the report of a fake-ffmpeg render are byte-identical before and after (write that test before you move code).

### 2. Schema (one migration)

- **`nodes`**:
  - `id`, `workspace_id` (nullable, the TASK-115 default workspace), `name`, `token_hash` (sha256 of the node token, unique)
  - `status` (`online|offline|draining|revoked|version_mismatch`), `version`
  - `capabilities` json (`render`, cpu count, RAM MB, free disk MB, `gpu` null for v1), `desired_config` json (`concurrency`, `capabilities`, `drain`)
  - `last_seen_at`, `created_at`, `created_by_user_id`, `revoked_at`
- **`node_join_tokens`**: `id`, `token_hash`, `name_hint`, `expires_at` (default 1 hour), `created_by_user_id`, `used_at`, `used_by_node_id`.
- **`jobs`** gets nullable columns: `node_id`, `lease_id`, `lease_until`, `heartbeat_at`.
  - `lease_id` is a fresh uuid per lease. It fences stale nodes (see step 4).
- **`artifacts`**: `sha256` primary key, `size`, `path` (the control-plane file), `mtime_ms`, `created_at`.
  - It caches hashes so a file is hashed once per (`path`, `mtime`, `size`). When the file changes, recompute.

### 3. Join and node identity

- **Owner or admin creates a join token.** `POST /api/nodes/join-tokens` checks `nodes.manage` through the TASK-115 policy, with an entry in `routePermissions.ts`.
  - It returns the token **once**: `vgj_` plus 32 random bytes in base64url.
  - It also returns the ready command, `docker compose … VG_CONTROL_URL=… VG_JOIN_TOKEN=…`, and the `install.sh` line.
  - Only the hash is stored.
  - Audit: `node.join_token_created`.
- **`POST /api/nodes/agent/join`** with `{joinToken, name, version, capabilities}`:
  - it checks that the token exists, is unused and is unexpired, and marks it used **in the same transaction** that creates the node;
  - it returns `{nodeId, nodeToken}` (`vgn_` plus 32 random bytes) and stores only the hash;
  - an unknown, used or expired token all get the same 401 text;
  - it uses the login rate limit;
  - audit: `node.joined`.
- **Node auth:**
  - every `/api/nodes/agent/*` route except `join` needs `Authorization: Bearer vgn_…`, and the node must not be revoked;
  - add the `/api/nodes/agent/` prefix to the guard's open allowlist **only** so a dedicated node preHandler can check the token instead;
  - a user session or API key on these routes gets 401;
  - a node token on any other route gets 401;
  - test both directions.
- **`GET /api/nodes`** (`nodes.manage`): the list with status, version, capabilities, last seen and running jobs.
- **`DELETE /api/nodes/:id`** (`nodes.manage`): revoke. The node is not hard-deleted: set `revoked_at`, clear `token_hash`, and requeue its leased jobs right away. Audit: `node.revoked`.
- **`PATCH /api/nodes/:id`** (`nodes.manage`): `desired_config` (`concurrency` 1–8, `drain`, enabled capabilities).
- TASK-119 builds the Nodes page on these routes. **This task adds no web page** except one card, described in step 7.

### 4. Lease, heartbeat, complete, fail, cancel

- **`POST /api/nodes/agent/heartbeat`** with `{version, capabilities, resources, running: [{jobId, leaseId, progress, message}]}`. The node sends it every 15 s.
  - It updates `last_seen_at`, `status` and `capabilities`.
  - For each running entry whose `leaseId` still matches, it extends `lease_until = now + NODE_LEASE_SEC` (default 60) and forwards the progress to the existing event bus, so the web progress bar works as for local jobs.
  - The reply is `{desiredConfig, targetVersion, cancel: [jobId…]}`. `cancel` lists jobs the user stopped, or jobs whose lease no longer matches.
  - When the node's `version` differs from the control plane's, set status `version_mismatch` and lease nothing to it. The reply says so; the node logs it and keeps sending heartbeats.
- **`POST /api/nodes/agent/lease`** with `{freeSlots}` returns 204, or `{jobId, leaseId, leaseUntil, bundle, manifest}`.
  - It never returns more jobs than `desired_config.concurrency` minus the node's running jobs.
  - Candidates: `QUEUED` RENDER jobs whose `run_after` has passed and that pass `orchestrator.canStartQueuedJob`, in the same order as the local worker uses.
  - Claim through the **same orchestrator path** the local worker uses (`startJob`), so project status, stage and events change exactly as today.
  - Then run `prepareRender` on the control plane. If it reuses an existing render, finalize locally and lease nothing for that job.
  - Then set `node_id`, `lease_id`, `lease_until` and `heartbeat_at`.
  - If prepare throws, fail the job as the local worker would (`jobErrorFromCaught`).
  - **Never lease a job of project `56374fb2-54cf-48ff-9441-2e6c653295d4`.** Add a test.
  - Respect the drain flag from `operator/autopilot.readDrain` and the TASK-121 render budget, exactly as `tick()` does.
- **`GET /api/nodes/agent/artifacts/:sha256`** streams the file.
  - It is allowed only when that hash is in the manifest of a job **currently leased by this node** with a matching lease. Otherwise 404.
  - No path ever comes from the request.
- **`PUT /api/nodes/agent/jobs/:id/outputs/:name`** with headers `x-lease-id`, `x-sha256`, `content-length`.
  - `name` comes from a fixed allowlist: `final.mp4`, `subtitles.srt`, `credits.txt`, `report.json`, and `thumbs/<3 digits>.jpg`. Anything else gets 400, and no traversal is possible.
  - The body streams to a temp file under the job's render folder, while the sha256 is computed. A size over `NODE_MAX_UPLOAD_MB` (default 4096) or a hash mismatch deletes the temp file and returns 422.
- **`POST /api/nodes/agent/jobs/:id/complete`** with `{leaseId, outputs: [{name, sha256, size}], reportParts}`.
  - The lease must match and every listed output must have been uploaded with that hash.
  - Then run `finalizeRender` and complete the job through the same orchestrator path as a local success: thumbnails, auto-shorts and the TASK-121 repair hook all fire as today.
  - A stale or unknown lease gets **409**; delete its uploads.
- **`POST /api/nodes/agent/jobs/:id/fail`** with `{leaseId, error: {code, message, retryable}}` goes through the same retry rules as a local failure.
- **Lease expiry sweep:** on the control plane, every 10 s inside `JobWorker`'s timer, also when `WORKER_ENABLED=false`, find `RUNNING` jobs with a `node_id` whose `lease_until` has passed.
  - Each one goes back to `QUEUED` with `attempt + 1` and the node fields cleared. When it has no attempts left it becomes `FAILED` with code `NODE_LOST` and a Vietnamese message.
  - Also mark nodes with no heartbeat for 45 s as `offline`.
- **Cancel:** when the user stops a remote job, the control plane marks it cancelled at once, as today, and lists it in the node's next `cancel` reply. The node aborts and deletes its temp files. A late `complete` gets 409.
- **Restart safety:** `orchestrator.resumeRunningJobs()` at control-plane startup must not reset jobs that a node still holds with an unexpired lease. Leave them; the sweep handles them.

### 5. Where a RENDER job runs

- An app setting `nodes.remoteRender` (`off | prefer | only`), default **`off`**, stored with the other app settings and changed with `nodes.manage`.
- **`off`:** nothing changes. Nodes get no jobs.
- **`prefer`:** while at least one `online` node with the `render` capability and a free slot exists, the local `JobWorker` leaves RENDER jobs `QUEUED` for up to `remoteWaitSec` (default 30) so a node can lease them. After that, or when no such node is online, it renders locally.
- **`only`:** the local worker never runs RENDER. While no node is online, the job stays queued and the stage summary says "Đang chờ máy worker".
- Other stages always run locally in v1.
- Every job row shows where it ran: add `node_id` to the job API output, and the web job list shows the node name or "máy này". This is a tiny UI change in the existing job/stage component.

### 6. The worker process (`VG_ROLE=worker`)

- Replace the stub in `src/index.ts` with `src/node/agent.ts`.
  - It starts **no** Fastify, no DB and no migrations, and reads no vault.
  - It reads its config from env: `VG_CONTROL_URL`, `VG_JOIN_TOKEN`, `VG_NODE_NAME` (default hostname), `DATA_DIR`.
- **Start:**
  - If `DATA_DIR/secrets/node.token` exists, use it. Otherwise call join with `VG_JOIN_TOKEN` and write the token file with mode 0600.
  - Log "đã tham gia" and never log the token.
  - Refuse `http://` to a public address unless `VG_ALLOW_INSECURE_CONTROL=1`. Loopback, RFC 1918 and Tailscale `100.64.0.0/10` are allowed over http.
- **Loop:**
  - heartbeat every 15 s;
  - when it has a free slot and is not draining or version-mismatched, call lease;
  - for each job: download the missing artifacts into `DATA_DIR/cache/artifacts/<sha256>` and check each hash after download;
  - run `executeRender` with `clipCacheDir = DATA_DIR/cache/clips`, upload the outputs, then complete; on error, fail with `jobErrorFromCaught`;
  - abort on `cancel`.
  - Network errors get exponential backoff with jitter, capped at 60 s. A 401 means the node is revoked: log it clearly and exit with code 0, so Docker does not restart it.
- **Cache limit:** `NODE_CACHE_MAX_GB` (default 20). Evict the least recently used artifacts and clips.
- **SIGTERM:** stop leasing, give running jobs `NODE_SHUTDOWN_GRACE_SEC` (default 120), then send `fail` with `retryable: true` and code `NODE_SHUTDOWN`.
- **Capabilities sent:**
  - `render`, only when ffmpeg and the HyperFrames browser both start, checked once at boot;
  - cpu count, RAM, free disk under `DATA_DIR`;
  - the version from the root `package.json`.
- **Deploy:**
  - In `deploy/docker/compose.worker.yml`, set `restart: on-failure`. Docker then restarts the worker after a crash, which exits non-zero, but not after a clean exit with code 0. So a revoked node must exit with code **0**, not 3; change the agent loop and the tests to match. Check this against the Docker restart-policy docs and state the result in the report.
  - Update `deploy/README.md` (the worker section) and the join flow in `deploy/install.sh`. The `install.sh` change is only the text and the variables it writes.

### 7. Minimal web

- In Settings, add one card "Máy worker (thử nghiệm)", visible with `nodes.manage`:
  - the `remoteRender` select;
  - a "Tạo mã tham gia" button that shows the token and the commands once, with copy buttons;
  - a read-only list of nodes: name, status badge, version, last seen, running job;
  - a revoke button with a confirm.
- The full Nodes page is TASK-119. Keep this card small and say it will move there.
- Add it to the `featureMap` and the Ctrl+K palette.

## Rules

- No commit or push. **No new npm dependency.** Do not run `npm install`, and do not touch `node_modules` or `package-lock.json`.
- One migration, generated by `npx drizzle-kit generate` in `apps/server`. A second run must say "No schema changes".
- You may change `src/services/renderService.ts`, `src/stages/render/**`, `src/compose/sceneClip.ts` and `src/compose/hyperframes.ts` **only to move code** for the prepare/execute/finalize split. Do not change render output, styles, `COMPOSE_RENDER_VERSION` or clip hashing.
- Do not touch:
  - `.env`, `.claude/`, `data/`, `scripts/`
  - `apps/server/assets/**`, `packages/shared/src/style/**`
  - the TASK-121 repair logic beyond calling it through the existing completion path.
- `deploy/` may change only as step 6 says.
- Do not weaken `policy.ts`, the guard, the hard blocks or the TASK-059 limits. The node token is never a user, has no workspace role, and cannot call tools. No registry tool may create join tokens or revoke nodes in this task.
- Never log a join token, a node token, or an artifact's contents.
- Tests:
  - no external network; a server bound to `127.0.0.1` on an ephemeral port is fine;
  - use the fake ffmpeg and fake HyperFrames hooks the render tests already use;
  - no real LLM;
  - never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- **Server tests:**
  - **Step 1:**
    - the import-graph test for `executeRender`;
    - byte-identical `input_hash` and report before and after the split;
    - all existing render, compose, thumbnail, clip and repair tests pass.
  - **Join:**
    - a token works once;
    - an expired, used or unknown token gets the same 401;
    - only hashes are stored;
    - two parallel joins with one token make one node.
  - **Auth scope:**
    - a node token on a user route gets 401;
    - a session or API key on an agent route gets 401;
    - a revoked node gets 401.
  - **Lease:**
    - matches capability and version;
    - respects concurrency;
    - a mismatched version gets nothing;
    - drain and budget are respected;
    - a protected-project job is never leased;
    - a reuse hit finalizes with no lease.
  - **Fencing:** after a lease expires and the job is requeued, the old node's `complete` and uploads get 409 and leave no rows or files behind.
  - **Expiry sweep:**
    - the job is requeued with `attempt + 1`;
    - once attempts run out it fails with `NODE_LOST`;
    - the node becomes `offline` after 45 s.
  - **Artifacts:**
    - a hash outside the node's current manifest gets 404;
    - an upload with a hash mismatch or over the size limit gets 422;
    - a name outside the allowlist or with traversal gets 400.
  - **Complete:** a remote render writes the same `renders` row fields as a local render of the same project, apart from ids and times, and fires thumbnails and the repair hook.
  - **Cancel:** reaches the node in the heartbeat reply, and a late `complete` gets 409.
  - **Placement:**
    - `off` never leases;
    - `prefer` falls back to local after `remoteWaitSec`;
    - `only` never runs RENDER locally.
  - **End to end in one test:** start the app on a temp `DATA_DIR`, join an in-process agent with fake ffmpeg against it, queue a render, and check the `renders` row and the progress events.
- **Web tests:** the worker card shows the token once, hides it from users without `nodes.manage`, and the revoke confirm works (mocked API).
- **Checks:**
  - `npm run typecheck` at the root;
  - `npm test` in `packages/shared`, `apps/server`, `apps/mcp` and `apps/web`;
  - `npm run build`.

  List any failure outside your area, with its file.
- **Manual check** on a temporary `DATA_DIR` (never the real `data/`), on this one Windows machine:
  - start the control plane on port 3999 and create a join token from the card;
  - start a second process with `VG_ROLE=worker`, its own temp `DATA_DIR` and `VG_CONTROL_URL=http://127.0.0.1:3999`;
  - set `remoteRender=only` and render a throwaway project. Make one with the mock TTS and stock-free visuals if needed; **never** use `56374fb2…`;
  - check that the job shows the node name and that the video plays;
  - kill the worker in the middle of a render and check that the job is requeued after the lease expires;
  - revoke the node and check that the worker exits with code 0 after its next heartbeat and is not restarted.
- **User guide:** a new page `docs/user-guide/may-worker.md`. It covers what a worker is, how to add one with Docker, the three `remoteRender` modes, what a worker can and cannot see (no secrets, no DB) and how to revoke one. Add one line to `nhat-ky-thay-doi.md` and a `featureMap` entry.
- **Report:** write `docs/tasks/TASK-118.report.md` in Vietnamese, at most 60 lines:
  - the prepare/execute/finalize file list, and what moved where;
  - the migration name;
  - the protocol routes;
  - the Docker restart finding;
  - test results;
  - the manual check result;
  - anything you decided differently from this guide, and why;
  - what TASK-119 and TASK-120 should know.
- Then create the empty `docs/tasks/TASK-118.done`.
