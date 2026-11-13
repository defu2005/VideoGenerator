# TASK-119 — Nodes page: add a machine, health, remote config, drain, version and update 🖥️

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** M. **Migration:** yes, one, made with `npx drizzle-kit generate`. **New dependency:** none. **Depends on:** TASK-118 (accepted), BUGFIX-TEAM-REPORTS (accepted; latest migration is 0070).

TASK-118 built worker nodes: join with a one-time token, heartbeat every 15 s, leases with fencing, artifacts by sha256, and remote render. Management today is only a small `WorkerNodesCard` inside the render settings page. This task gives nodes their own page and closes the gaps the TASK-118 report listed:
- the job list does not show which machine ran a job (`JobSchema` already has `nodeId`);
- the capability check only runs `ffmpeg -version` and looks for the hyperframes package, without starting a real browser;
- the agent was never run for real with ffmpeg and HyperFrames.

## Current code (read first)

- Server:
  - `apps/server/src/node/nodeService.ts`: join, heartbeat, `version_mismatch` when `version !== readAppVersion()`, patch, revoke, audit;
  - `leaseService.ts`, `placement.ts`, `artifactService.ts`, `remoteBundle.ts`, `settings.ts` (`remoteRender` off/prefer/only), `tokens.ts`;
  - `agent.ts`: `defaultCapabilities` ~line 74, heartbeat ~196/270, take rule ~302;
  - `apps/server/src/api/nodes.ts`: admin routes `GET /api/nodes`, `POST /api/nodes/join-tokens`, `GET|PUT /api/nodes/settings`, `PATCH /api/nodes/:id`, `POST /api/nodes/:id/revoke`, and the agent routes under `/api/nodes/agent/*`;
  - `auth/routePermissions.ts:164`: `nodes.manage`.
- Shared: `packages/shared/src/schemas/node.ts` (`NodeSchema`, `NodeDesiredConfigSchema`, `HeartbeatRequestSchema` and `HeartbeatResponseSchema`, both strict).
- Web:
  - `apps/web/src/features/settings/WorkerNodesCard.tsx` and its test, used in `RenderSettingsPage.tsx:97`;
  - the job list lives in the pipeline and project features; grep for where jobs are listed.
- Docs: `docs/user-guide/may-worker.md`, `docs/architecture/multi-user-multi-node.md` §nodes, `docs/tasks/TASK-118.report.md`.

## Steps

### 1. Nodes page `/nodes`
- Add a route and a sidebar item in the "Hệ thống" group (or wherever settings and render live; follow TASK-049's grouping). Lazy-load it. Show it only to roles that hold `nodes.manage`, using the existing permission hook.
- Add it to `featureMap` in `@vg/shared`, to the Ctrl+K palette and to the help coverage test.
- Move the content of `WorkerNodesCard` here. Render settings keeps a one-line card: "Máy worker: N đang chạy — Mở trang Máy". Keep the `remoteRender` mode setting on the Nodes page, and keep a read-only mention in render settings.
- **List:** name, status badge (online, offline, draining, revoked, version_mismatch, with Vietnamese labels), version, capabilities, CPU, RAM, free disk, last seen as relative time, running jobs, and slots in use out of concurrency.
  - Poll every 15 s while the tab is visible; reuse the existing hidden-tab pause.
- **Detail drawer or page per node:**
  - running jobs with progress, linked to their project;
  - the last 20 jobs on this node with outcome and duration, read from `jobs.node_id`;
  - the failure count over 24 h;
  - the capability probe result (step 3).
- **Actions:**
  - rename;
  - concurrency 1–8;
  - capabilities toggle;
  - drain and resume;
  - revoke, behind a confirm dialog that says running jobs go back to the queue.

  All of them use the existing PATCH and revoke routes. Add `name` to `NodePatchSchema` if rename is missing, with the same trim and 1–80 rule as join.

### 2. "Thêm máy" dialog
- It calls `POST /api/nodes/join-tokens` and shows the token's expiry, counted down from `expiresAt` (1 h).
- It shows two copyable commands, both built from a pure function `buildJoinCommands({ controlUrl, token, image, version })` in `@vg/shared` or the web feature, with a unit test:
  - **Docker:** use the worker compose or `docker run` form from TASK-117's docs (`VG_ROLE=worker`, `VG_CONTROL_URL`, `VG_JOIN_TOKEN`). The image tag is the control plane's version, so the node starts on the same version.
  - **From source:** the npm form that TASK-118 documented in `may-worker.md`.
- The control URL defaults to `window.location.origin`. The user can edit it, for example when the browser uses localhost but the node needs the LAN IP. Warn when the URL is `localhost` or `127.0.0.1`.
- The token is shown once. It never goes into the URL, logs, toasts or the audit detail. The audit stores only the token id.
- The dialog then waits up to 2 min, polling the list, for a new node to join, and says "Máy X đã kết nối". On timeout it links the troubleshooting section.

### 3. Real capability probe
- In `agent.ts`, replace the shallow check with a probe that proves the machine can render:
  - run `ffmpeg -version`;
  - then do a tiny real render through the same HyperFrames path the render stage uses: one 1-second solid-colour composition at low resolution, into a temp dir, with a 60 s timeout;
  - check the output exists and ffprobe reads a duration greater than 0. Reuse the existing ffprobe helper.
- The probe runs at startup and again every 6 h, or when the desired config turns `render` back on. It never runs while a job is running.
- The result goes in the heartbeat as an optional field. Add `probe: { render: { ok: boolean, reason?: string, checkedAt: string, ms?: number } }.optional()` to `HeartbeatRequestSchema` and `JoinRequestSchema`; the schemas stay strict. Old agents that do not send it still work.
- **Server:** store it in a new nullable `nodes.probe` text column, using `npx drizzle-kit generate`, then a second generate must print "No schema changes". Expose it as `probe` on `NodeSchema`.
  - When `probe.render.ok` is false, the lease service must not give render jobs to that node, even if its capabilities say `render`.
  - The page shows the reason in Vietnamese, for example: "Thiếu ffmpeg", "Không mở được trình duyệt cho HyperFrames", "Hết thời gian".
- Tests inject the probe through `deps.checkCapabilities` (or a new `deps.probe`) and never spawn real binaries. The real probe is covered by step 6.

### 4. Version pin and update
- **Target version:** the control plane's version stays the default target, as today. Add a setting `nodeTargetVersion: "control" | <semver>` to the existing node settings (`node/settings.ts` plus `GET|PUT /api/nodes/settings`), so a user can pin nodes to a version during a rollout.
  - Only versions the control plane can serve a bundle for may be pinned. If the bundle format is tied to the control version, which is likely, allow only `"control"` and say so in the report, then keep the setting read-only on the page. Do not invent compatibility.
- **On the page:** a node on another version shows "Cần cập nhật" with the exact command to update it. For Docker that is `docker compose pull && docker compose up -d` with the worker compose file, or the image tag. For source it is `git pull` plus a build. Use the same builder as step 2.
- **Self-update:** the agent never downloads code. Add an opt-in env `VG_EXIT_FOR_UPDATE=1`. When the heartbeat returns a `targetVersion` different from the node's version, the agent stops leasing new work, waits until its running jobs finish, logs it, and exits with code 75.
  - The worker compose uses `restart: unless-stopped` and `pull_policy: always`, so it comes back on the new image.
  - Document this in `may-worker.md` and add those keys to the worker compose file from TASK-117 (`compose.worker.yml` or whatever it is called). Change nothing else in the compose files.
- **Drain before update:** a "Cập nhật tất cả" button on the page sets drain on every mismatched node and shows the commands. Do not add any remote shell.

### 5. Node name on jobs
- Wherever jobs are listed (the pipeline job list, the project stage view, the dashboard if it lists jobs), show "Máy: <name>" when `nodeId` is set and "Máy chính" when it is not.
- Do it with a join or lookup on the server, and add an optional `nodeName` to the job DTO. Do not make a request per row.
- The supervision snapshot or operator tools, if they list jobs, get `nodeName` too.

### 6. Real end-to-end run (manual, plus one opt-in test)
- Add `apps/server/test/workerNodeE2E.test.ts`, which is **skipped unless `VG_E2E_NODE=1`**. The default suite stays offline and fast. The test:
  - creates a temp `DATA_DIR`;
  - starts the app with `buildApp`, listening on `127.0.0.1` on a random port, which is loopback only;
  - creates a join token;
  - runs the agent in-process with the real ffmpeg and HyperFrames probe;
  - enqueues a tiny render with `remoteRender: "only"`;
  - waits for completion;
  - checks that the artifact sha256 matches and that the job row has `node_id`.
- Run it once on this machine with `VG_E2E_NODE=1 npx vitest run test/workerNodeE2E.test.ts` in `apps/server`. Paste the result in the report.
  - If HyperFrames or Chromium cannot start here, write down exactly what failed. That is a finding, not a reason to fake a pass.
- Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`. The test makes its own throwaway project in the temp DB.

### 7. Tools
- Add the read-only tool `list_nodes` to the shared registry (`assistant/tools.ts` and `auth/toolActions.ts`, mapped to `nodes.manage`, or a read action if the policy has one). It returns the name, status, version, probe ok, running jobs and drain flag. It never returns token hashes.
- Add `set_node_drain`, flagged as confirm risk, so it becomes a pending action that only the user approves.
- Join tokens, revoke and version pin stay **UI only**, with no tool. TASK-059 hard limits apply.
- Update `.agents/skills/` only through the TASK-124 rule:
  - extend the matching `video-*` skill text for nodes, and add the tools to its list;
  - the coverage test (`agentSkillPack.test.ts`) must pass: either the skill covers the new tools, or `UNCOVERED_TOOLS` lists them with a reason.
  - Do not create skills outside that pattern.

### 8. Docs
- Rewrite `docs/user-guide/may-worker.md` around the new page: add a machine, read its health, the probe, drain, update, revoke, and troubleshooting. The troubleshooting covers a node stuck offline, `version_mismatch`, a failed probe, and a localhost control URL.
- Add a changelog bullet in `nhat-ky-thay-doi.md`, and add the page to the user-guide coverage.

## Mã nguồn mở có sẵn (open source)

- **Nomad / Kubernetes node views** (MPL-2.0 / Apache-2.0): use them as UX references only, with no code copied. Their pattern is a status, drain/eligibility toggle, allocations per node and a version column. Follow the same shape.
- **Docker Compose `pull_policy: always` with a restart policy** for self-update. This is the documented Compose pattern, the same way Watchtower-style updaters do it without running Watchtower. Do not add Watchtower: it needs the Docker socket, which is too much privilege.
- **Probe-by-real-work:** health checks in renderers such as Remotion's Lambda "sites" and Puppeteer's `launch()` smoke test do a tiny real render. Copy the idea, not code.
- Nothing new to install. If you find a small permissive project that clearly beats this (for example a ready-made node-agent health library), report it in the report (README rule 11). Do not add it.

## Rules

- AGENTS.md:
  - no commit or push;
  - do not touch `.env`, `.claude/`, `data/` or `scripts/`;
  - no `npm install`;
  - migrations only through drizzle-kit;
  - tests never use the network or real LLM/TTS. The step 6 test is opt-in and loopback only.
- File boundaries:
  - another session may work on guides only, so this task owns `node/*`, `api/nodes.ts`, the node schemas, the new web feature `apps/web/src/features/nodes/`, and the job DTO change;
  - in `routePermissions.ts`, `featureMap` and the tool registry, only append.
- Do not loosen `registry/policy.ts`, the guard, lease fencing or the TASK-059 hard limits.
- Run:
  - the root typecheck;
  - the server suite (rerun any file that fails alone, with fewer workers, before calling it a failure);
  - the web suite;
  - the shared tests;
  - `npx drizzle-kit generate`, which must print "No schema changes".

## Done

- [ ] `/nodes` page (list, detail, actions, polling, permission-gated, featureMap/palette/help) and a slim render-settings card
- [ ] "Thêm máy" dialog with `buildJoinCommands` + test, token shown once, join detection
- [ ] real probe in the agent, `probe` in the heartbeat schema, `nodes.probe` migration, lease skips nodes whose probe failed, tests
- [ ] target version setting (or a documented reason it stays "control"), update commands, `VG_EXIT_FOR_UPDATE` exit 75 after jobs finish + test, compose keys documented
- [ ] node name on every job list without N+1
- [ ] `list_nodes` + `set_node_drain` (confirm risk), skill pack coverage passes
- [ ] opt-in E2E test written and run once here; result in the report
- [ ] user guide + changelog
- [ ] typecheck, server, web and shared suites; drizzle prints "No schema changes"
- [ ] report `docs/tasks/TASK-119.report.md`, including what TASK-120 should know, then `docs/tasks/TASK-119.done`
