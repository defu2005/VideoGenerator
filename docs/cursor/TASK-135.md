# TASK-135 — Node runs the whole pipeline, control only commands 🛰🗄

**Who:** one new Sonnet 5.5 session per part (or Cursor `grok-4.7-xhigh`; rate all three parts hard).
**Size:** 135a M, 135b L, 135c M. **Migration:** 135a only (drizzle-kit). **New dependency:** none.
**Depends on:** TASK-134. It provides the table registry (`pipeline/dataContract.ts`), `inputVersion`, the completion guard, lease-first finalize, and resumable uploads with `have`. Order: 134 → 135a → 135b → 135c. Each part runs alone: they all touch the orchestrator, the node API and `node/agent.ts`.
**Priority:** the user asked on 2026-11-16 to build this branch first, before 129a/129c and wave 4.

## The branch in one picture

Today (TASK-118–120) the **control server runs the pipeline**. It sends single jobs (RENDER, VOICE, MEDIA_FETCH) to nodes and takes the results back. Every stage boundary goes through control.

The new branch adds a second **execution mode** per project:

| | `control` (today, default) | `node` (new) |
|---|---|---|
| Who runs stages | control, with single jobs sent to nodes | one node runs a whole **segment** of stages |
| Source of truth | control DB | control DB (the node holds a working copy) |
| Data over the network | every stage's inputs and outputs | one snapshot in, one **checkpoint** per finished stage out |
| What stays on control | — | gates for humans, USER and agent executors (TASK-128), PUBLISH, OAuth tokens, operator, notifications, the cost ledger |

**Segment.** The longest run of stages, starting where the project is now, that a node may run without control. It stops before the first **control-held** stage:
- a gate that needs a human under the project's autonomy level (`GATES`: VISUAL_REVIEW, MUSIC_REVIEW, FINAL_APPROVAL);
- a stage whose executor is `USER` or `agent`;
- PUBLISH and every other side job that is not MEDIA_FETCH or CLIP;
- a stage that needs a capability the chosen node does not have.

**One code path.** A node runs the **same orchestrator and executors** as control, on its own SQLite copy of one project, so the output is the same as running on control. There is no second pipeline implementation. What the node may not do (publish, notify, call the operator, talk to agents) is set once in the composition root by a `RuntimeRole`, never by `if` checks spread through the code.

```
control                                          node (VG_ROLE=worker, capability "project")
───────                                          ──────────────────────────────────────────
plan segment ──grant run lease──────────────────▶ import snapshot into runs/<id>/db.sqlite
                                                  run orchestrator until stopBefore
      ◀──── checkpoint seq=n (rows of finished stage + files by sha256 + costs)
apply in one tx (lease, seq, inputVersion) ─ok──▶ continue
user edits on control ──command "rebase"───────▶ pull delta, guard marks stages STALE, continue
      ◀──── 409 RUN_REBASE on a checkpoint built on old inputs
gate reached ◀──── last checkpoint, run ends PAUSED_AT_GATE (dir kept warm)
user approves ──new segment, same node preferred──▶ reuse local DB if baseVersion matches
heartbeat lost ─▶ run LOST, resume from last applied checkpoint on another node or control
```

## Read first (all parts)

- TASK-134 report and `pipeline/dataContract.ts`.
- `node/*` (`agent.ts`, `leaseService.ts`, `remoteBundle.ts`, `remoteRunners.ts`, `leaseSecrets.ts`, `secretBox.ts`, `placement.ts`, `probe.ts`, `nodeService.ts`, `settings.ts`, `tokens.ts`) and `api/nodes.ts`.
- `pipeline/orchestrator.ts` (`continueAll`, run modes, `unmetDependency`) and `jobs/worker.ts` (how jobs are claimed, `localMayTake`, the 129b governor).
- `app.ts` / the server composition root: how services are built and wired.
- `agents/stageService.ts` (TASK-128 agent executors) and the autonomy and gate settings that decide whether a gate waits for a human.
- `budget/*` and `cost_entries` writers; `providers/llm/*` routing (OmniRoute, failover from 127), and TTS provider selection.
- `deploy/docker/*`, `deploy/README.md`.

---

## TASK-135a — Project snapshot, checkpoint apply, run lease (control side) 🗄

### Build

1. **Migration.**
   - `project_runs`: `id`, `project_id`, `workspace_id`, `node_id`, `lease_id`, `lease_until`, `heartbeat_at`, `status` (`GRANTED|RUNNING|PAUSED_AT_GATE|DONE|LOST|CANCELLED|FAILED`), `from_stage`, `stop_before` (json), `base_version`, `last_seq`, `budget_cap_usd`, `created_at`, `ended_at`, `end_reason`.
   - `run_checkpoints`: `run_id`, `seq`, `stage`, `input_version`, `applied_at`, `rows`, `bytes`, `result` (`applied|rebase|rejected`).
   - `projects.execution_mode` (`control|node`, default `control`) and `projects.execution_node` (nullable: pinned node).
2. **Snapshot export** (`node/projectSnapshot.ts`):
   - rows of every registry table whose `owner` is not `"control"`, for one project;
   - a **context pack** of workspace-level read-only data the stages read: channel profile, style, genre packs, guideline packs, the knowledge entries the project uses, prompt overrides, model routing and TTS settings. List these by reading what the executors import; a test must fail when an executor reads a workspace table that is neither in the pack nor in the context RPC (step 5);
   - a file manifest: every file a row points to, as `files/<sha256><ext>` (reuse `remoteBundle` rewriting and `ArtifactService.register`). The node downloads files through the existing artifact endpoint.
   - The format is versioned JSON (`snapshotVersion`, `schemaHash` = drizzle journal tag). A node with another `schemaHash` is refused with a clear message (update the node).
3. **Snapshot import** (used by the node in 135b, written here so one module owns both directions): an empty SQLite with migrations applied, rows inserted, file refs rewritten to local cache paths. **Round-trip test:** export → import into an empty DB → export again gives identical JSON.
4. **Checkpoint apply** — `POST /api/nodes/agent/runs/:id/checkpoint`:
   - body: `leaseId`, `seq`, `stage`, `inputVersion`, the rows of tables owned by `stage` (full replacement for this project), new file refs (uploaded with 134's resume and `have`), cost entries, a short log summary;
   - in one transaction:
     - lease held;
     - `seq = last_seq + 1` (the same `seq` sent again with the same content → `200` and no change);
     - control's `inputVersion(projectId, stage)` equals the node's, otherwise `409 RUN_REBASE` with the delta the node needs;
     - replace the rows;
     - set the stage `DONE` with `input_version`;
     - add the costs to the ledger;
   - after commit: the control-only hooks that `completeJob` runs today (events, agent bus, notifications), so a stage finished on a node looks exactly like one finished on control.
5. **Context RPC** for data too big to ship: `POST /api/nodes/agent/runs/:id/context/:kind`, read-only, scoped to the run's workspace, rate-limited. Start with `retrieve` (RAG chunks) and `analytics` if executors need them. Each kind is an allowlisted function; no generic SQL.
6. **Run lease service** (`node/runService.ts`): grant, heartbeat (reuse the node heartbeat), expire → `LOST`, cancel. A `LOST` or `CANCELLED` run never applies another checkpoint (fencing by `lease_id`, same as jobs).

### Tests (135a)

- **Round-trip:** export → import → export is identical, and the file manifest is complete.
- **Registry:** a table owned by `"control"` never appears in a snapshot.
- **Checkpoint:**
  - applied in order;
  - a duplicate `seq` is idempotent;
  - a gap in `seq` → `409`;
  - a wrong lease → `409 LEASE_STALE`;
  - an edit on control → `409 RUN_REBASE` with a delta that, applied on the node, makes the next checkpoint pass;
  - costs reach the ledger once.
- **Snapshot and workspaces:** another workspace's rows never appear; a node restricted to a workspace (TASK-132 rule) cannot get a run of another one.

---

## TASK-135b — Node project runner, segment planner, command channel

### Build

1. **Segment planner** (control, `node/segmentPlanner.ts`): from the project's stages, autonomy level, executors and the node's capabilities, return `{ fromStage, stopBefore[], needs[] }`. Pure function with table-driven tests. VOICE ∥ VISUAL_SEARCH branches stay inside one segment (`STAGE_DEPENDS` already allows it).
2. **Capabilities.** Extend `probe.ts`. A node reports:
   - `project` (it can run segments);
   - `llm:<provider>` (a logged-in CLI or the node's own key);
   - `tts:<provider>`, `search:<provider>`, `render`, `ffmpeg`, `gpu`.
   - Keys from control are lent per run only for providers marked "cho phép gửi ra node", through `leaseSecrets`/`secretBox`. They stay in memory and are wiped at run end.
   - Never lent: OAuth or publish tokens, the vault key, auth secrets.
3. **Placement.**
   - When `execution_mode = node`, the orchestrator does not enqueue local jobs for the segment. It creates a run, using the pinned node or the best free node with all `needs`, preferring the node that ran the previous segment of this project (warm cache).
   - No such node within `remoteWaitSec` → run on control as today (setting `execution.fallback`: `control` default, or `wait`).
4. **Runner** (node, `node/projectRunner.ts`, started by `agent.ts` for leases of kind `project`):
   - `runs/<runId>/` holds `db.sqlite` and links to the content-addressed cache;
   - import the snapshot (135a), build the services with `RuntimeRole = "node-runner"`, run the stock orchestrator in run-all mode with `stopBefore`;
   - the per-stage remote placement of 118–120 is off inside a runner (no sub-delegation);
   - after each stage `DONE`: build and send the checkpoint (`inputVersion` from 134); on `409 RUN_REBASE`, apply the delta, let 134's guard mark stages `STALE`, and continue;
   - the run ends at `stopBefore`, at the budget cap, on cancel, or on a stage failure that the node's own retry policy gives up on. The failure is reported as a checkpoint with `result: failed` and the job error, so control shows it like a local failure.
5. **RuntimeRole "node-runner"** (composition root): publish, notifications, operator, agent bus and Telegram are replaced by no-op or forwarding stubs. A test builds the runner container and asserts that none of the real ones are constructed.
6. **Command channel** (no inbound ports on the node): `GET /api/nodes/agent/runs/:id/commands?after=<n>` long-poll (25 s). Commands:
   - `pause`;
   - `cancel`;
   - `rebase` (control data changed, pull the delta now instead of waiting for a 409);
   - `budget` (a new cap);
   - `stopBefore` (the user changed autonomy).
7. **Budget.** The run carries `budget_cap_usd` (the remaining project or mode budget). The runner pauses with reason `BUDGET` when its local cost reaches it. Control stays the ledger.
8. **Failover.**
   - When the heartbeat is lost for 90 s (setting), the run becomes `LOST`. The project resumes from control's last applied checkpoint: a new run on another node, or on control per `execution.fallback`.
   - Files already uploaded are reused through `have`.
   - The dead node's `runs/<id>` is removed when that node comes back (it receives `cancel` for the unknown run).
9. **Warm reuse after a gate.** A node keeps `runs/<id>` for 30 min (setting). The next segment for the same project on the same node reuses the DB when its `base_version` matches control, and imports fresh otherwise.

### Tests (135b)

- **Planner:**
  - autonomy "all gates human" → stops before VISUAL_REVIEW;
  - full autonomy → to RENDER;
  - an agent executor on VISUAL_SEARCH → stops before it;
  - a node without `tts:edge` → VOICE is excluded and the segment ends before it.
- **In-process loopback E2E** (fake providers, like `workerNodeE2E`):
  - a project in `node` mode runs RESEARCH → … → the first gate on a runner;
  - every stage arrives as a checkpoint;
  - control's DB equals the runner's for the owned tables;
  - gate approval on control → a second segment on the same node reuses the DB → RENDER → final video registered on control.
- **Edit during a run:** the user edits the script on control while VOICE runs on the node → `rebase` → VOICE and downstream are redone, and no stale output becomes `DONE`.
- **Failover:** kill the runner mid-stage → `LOST` → resumed on control from the last checkpoint, with the same final output as a clean run.
- **Security:**
  - RuntimeRole stubs are used;
  - no OAuth token is in a snapshot or a lent-secret set;
  - a run lease cannot read another project's context.

---

## TASK-135c — UI, settings, real-machine check, docs

### Build

1. **Project settings:** "Nơi chạy" = `Máy chính` / `Node (tự chọn)` / `Node: <name>`; fallback; a short line under it saying which stages will stay on the main machine and why (from the planner).
2. **Workspace and channel default** for the execution mode. A new project inherits it.
3. **Project page:** "Đang chạy trên node X — stage Y", a run timeline (granted, checkpoints, rebase, pause at gate, lost or resumed), and Cancel / Pause / Move to the main machine.
4. **Nodes page:** active runs per node, the warm runs kept, capabilities as chips, and the reason a node was not chosen.
5. **Real container check** (Claude runs it with you; not a test):
   - rebuild the image (`deploy/docker`), since the last build was in TASK-117, before the worker code;
   - run control and a worker as two containers on separate networks on this machine; join with a token;
   - run one non-protected project in `node` mode to the first gate and then to RENDER;
   - write the timings and problems into `deploy/README.md` "Kiểm tra thực tế".
   - A second physical machine is then the user's step, with a checklist in that README.
6. **Docs:** user guide "Chạy cả dây chuyền trên node"; runbook (node lost mid-run, `schemaHash` mismatch, budget pause); changelog.

### Tests (135c)

- The web settings form saves and loads the mode.
- The run timeline renders all statuses.
- The "stays on the main machine" explanation matches the planner output for 4 fixtures.

---

## Mã nguồn mở có sẵn (open source)

Ideas to follow; copy no code unless the licence is permissive, and keep attribution if you do.

- **GitHub Actions runner** (MIT) and **Buildkite agent** (MIT): an agent polls for a job, runs every step locally, streams logs, uploads artifacts, and gets cancelled through the poll. This is the model for the runner and the command channel.
- **Woodpecker CI** (Apache-2.0) agent/server split over long-poll and gRPC: the control/agent protocol shape.
- **Temporal** (MIT): the opposite model (central workflow, remote activities) is what `control` mode does today. Its heartbeats and fencing ideas remain the reference for leases.
- **Dagster** (Apache-2.0) data versions: the 134 input versions the checkpoint check relies on.
- **tus 1.0** and **restic/git have-negotiation**: from 134, reused for checkpoint files.
- **Litestream** (Apache-2.0): **not** used for the node copy. Streaming the whole DB would leak other projects and workspaces. A per-project snapshot plus checkpoints is the right granularity.

If you find a better-fitting project, report it (README rule 11); do not add it.

## Rules (all parts)

- README rules 1–11. Migration only in 135a, through drizzle-kit.
- Never approve gates or render on project `56374fb2-…`, in tests or in the real-container check.
- Control stays the source of truth. A node's DB is a disposable working copy; nothing on control may read it.
- No secret, token or TOTP value in snapshots, logs, checkpoints or reports.
- `control` mode must behave exactly as today. The full suites must pass with `execution_mode` left at its default.

## Done

- [ ] 135a: migration, snapshot export/import + round-trip, checkpoint apply, context RPC, run lease → report `docs/tasks/TASK-135a.done`
- [ ] 135b: planner, capabilities, placement, runner + RuntimeRole, commands, budget, failover, warm reuse, loopback E2E → `TASK-135b.done`
- [ ] 135c: UI, settings, real-container check, docs → `TASK-135c.done`
- [ ] each part: shared + server + web suites; typecheck; build; user guide + changelog
