# TASK-122 — Hermes supervises the operator: one chain of command, no conflicts 🧭

**Who:** Cursor, model `grok-4.7-xhigh`. This is concurrency and permission work across the registry, the operator and the MCP server. **Size:** L. **Migration:** one, generated with `npx drizzle-kit generate` in `apps/server`. **New dependency:** none.

**Order:** after TASK-114. You need its machine keys (`x-api-key`), because agent identity must come from the key and not from a header the agent fills in itself. Run it before TASK-123 (the Hermes fleet), which builds on the tables added here. Coordinate with TASK-115 (roles): if 115 has landed, use its role model; if not, use the `agent_keys` columns below and leave a `// TASK-115` note.

## Goal

The app gets two kinds of agent that work together:

| Agent | Brain | Lives | Job |
|---|---|---|---|
| **Operator** | API key through `modelRuntime` (or Cursor runtime) | inside the app process, always on | daily routine: standing orders, queue, gates within autonomy, quality repair (TASK-121) |
| **Hermes** (one or more instances) | its own model via OmniRoute | its own container or WSL, talks to the app via MCP | **supervisor on duty 24/7**: watches the operator, handles escalations, unsticks stalls, gives the operator tasks, overrides wrong decisions, and can run the app itself with the same rights as the operator |
| AutonomySupervisor (code) | none | inside the app | deterministic safety checks; never stops |
| **User** | — | web, Telegram | above everyone |

Chain of command: **user > Hermes on duty > operator > supervisor code.** An agent lower in the chain can never undo or block an agent above it.

The hard limits from TASK-059 stay for **every** agent, Hermes included:
- no secrets;
- no money;
- no changes to its own permissions (policy rule 4);
- no hard deletes;
- the protected project stays off limits;
- confirm-risk pending actions are approved only by the user.

"Full rights" for Hermes means the full operator tool registry at the current autonomy level. It never means getting past those limits. Do not add any bypass.

## Read first

- `docs/cursor/README.md`; `docs/cursor/TASK-064.md` (agent identity, claims); `docs/cursor/TASK-114.md` and its report (machine keys)
- `apps/server/src/reports/agentIdentity.ts`: `parseAgentIdentity` (today the kind is self-declared)
- `apps/server/src/registry/invoke.ts`, `registry/policy.ts` (`hardBlockMessage`, `APPROVE_PENDING_TOOLS`, `forcesUserPending`, `shouldCreatePending`), `registry/audit.ts`
- `apps/server/src/operator/service.ts` (queue, runs, orders, `resolveRuntime`, `failInterruptedOperatorRuns`), `supervisor.ts`, `loopGuard.ts`, `circuitBreaker.ts`, `undo.ts` (`undoAudit`), `autopilot.ts` (`createUserRequest`)
- `apps/server/src/api/operator.ts`: existing REST routes; reuse them, do not duplicate the logic
- `apps/server/src/events/` (agentBus, SSE `/api/events`, webhooks)
- `apps/server/src/assistant/telegramBridge.ts` and the Telegram poller
- `apps/mcp/src/apiClient.ts` (headers ~360), `apps/mcp/src/tools.ts` (`operatorOnly` ~106)
- `apps/server/src/db/schema.ts`: `skillClaims`, `autonomyJobClaims`

## What to do

### 1. Trusted agent identity

- Bind the agent identity to the machine key from TASK-114. Each key record gets:
  - `agentKind` (`operator` | `hermes` | `codex` | `cursor` | `claude` | `other`);
  - `instanceName`;
  - `canSupervise` (bool, default false; only the user sets it, in Settings).
- `parseAgentIdentity` takes the kind from the key. A header that claims another kind is ignored and logged at `warn`. Keep the headers for the name, model and environment labels.
- The in-process operator uses an internal identity (`operator`, instance `app`). It never goes through a key.
- Policy rule 4 also covers `agentKind` and `canSupervise`, so no agent can set them on itself or on another key.

### 2. Leases: one writer per object

New table `agent_leases`:
- `resourceKind`: `project` | `profile_automation` | `publication` | `account` | `operator_run`
- `resourceId`, `holderKind`, `holderInstance`, `reason`
- `acquiredAt`, `expiresAt` (TTL 10 min, renewed on each write)
- `preemptedBy`, `releasedAt`

Rules:
- In `registry/invoke.ts`, before any **mutating** tool runs, resolve which resource it touches. Add a small `resourceOf(toolName, args)` map, with a test that every mutating tool is either mapped or explicitly marked `global`.
  - If another live holder has the lease, the tool returns a structured `LEASED` result: holder, reason, expiry. It does not throw, so agents can read it and back off.
- **Priority:** user > Hermes on duty > other Hermes > operator.
  - A higher-rank caller may **preempt**: it takes the lease and writes `preemptedBy`.
  - The operator run that lost the lease sees this at its next step. It writes a checkpoint, stops work on that object, and adds a line to its run log: "Hermes đã tiếp quản …".
  - The operator can never preempt Hermes.
- A user action from the web or Telegram always succeeds. It ends any agent lease on that object and notifies the holder through the event bus.
- Read-only tools never need a lease.
- Idempotency: mutating tools accept an optional `idempotencyKey`. The registry stores `(agentInstance, key) → result` for 24 h and returns the stored result on a repeat. This stops double posts when two agents or a retry send the same action.

### 3. Duty: exactly one Hermes is in charge

- A lease with `resourceKind = duty`, id `hermes`. Only a key with `canSupervise` can hold it.
- Tool `hermes_duty_heartbeat` (sends `{instance, version}`, returns `{onDuty, holder, expiresAt}`):
  - TTL 3 min;
  - the first live caller gets duty;
  - any other caller gets `onDuty: false` and works as a **standby**: read-only, plus work the user gives it directly.
- Supervisor tools (§4) refuse a caller that is not on duty, with a clear `NOT_ON_DUTY` message.
- New table `agent_instances` (TASK-123 extends it): `instance`, `kind`, `environment`, `version`, `lastSeenAt`, `lastToolAt`, `onDuty`.
  - Update it on every authenticated MCP or REST call.
  - Losing duty creates an event `hermes.duty_lost`; gaining it creates `hermes.duty_taken`.

### 4. Supervisor tools (registry → MCP; duty holder only)

Each one wraps the existing `operator` service or REST logic. Do not write a second implementation.

| Tool | Does |
|---|---|
| `supervision_snapshot` | One compact object built by **code**, no LLM: operator state (running run, queue length and age of the oldest item, last 5 runs with status), breaker state, budget used vs limit, held gates (`autonomy.heldGates`), open repairs and SHELVED projects (TASK-121), FAILED jobs in the last 24 h, publish failures, open escalations, pending actions awaiting the user, Telegram conflict flag (§7), and an `anomalies: {kind, severity, ref, detail}[]` list. Anomalies come from fixed code rules (stuck run > 20 min with no step, queue item older than 2 h, the same tool failing 3 times, breaker open, budget > 80 %, a gate held > 6 h, a job FAILED twice on the same stage, escalation past its deadline). Keep it under ~3 KB of JSON so a calm check costs few tokens. |
| `operator_runs_list`, `operator_run_get` | Runs with their steps, tool calls and audit ids |
| `operator_pause` `{reason, untilMinutes ≤ 360}` / `operator_resume` | The operator queue and standing orders stop taking new work. The run in progress finishes its current step and checkpoints. The supervisor code keeps running. |
| `operator_stop_run`, `operator_new_session` | Wrap the existing routes |
| `operator_enqueue` `{instruction, profileId?, projectId?, priority}` | Gives the operator a task. Tagged `assignedBy: hermes/<instance>`. |
| `operator_orders_list` / `operator_order_upsert` / `operator_order_disable` | Standing orders. Anything that enables automation still goes through `forcesUserPending` exactly as today. |
| `operator_override` `{auditId, reason}` | Reverts one operator action through `undoAudit`. A reason is required. Refused when the action cannot be undone. |
| `escalation_list` / `escalation_claim` / `escalation_resolve` `{id, outcome, note}` / `escalation_forward_to_user` | See §5 |
| `agent_events_poll` `{sinceId, limit ≤ 100, kinds?}` | Reads the agentBus journal. MCP over stdio cannot hold SSE open, so this is how Hermes catches up. Use the same ids as SSE `last-event-id`. |

Hermes also gets the full operator tool set it already sees with `VG_TOOL_SOURCE=operator`. When it acts directly on an object, it takes the lease (§2).

### 5. Escalation: the operator asks Hermes before the user

New table `agent_escalations`:
- `id`, `fromKind`, `fromInstance`, `toKind` (`hermes` | `user`)
- `kind`, `objectRef`, `summary`, `evidence` (JSON)
- `status`: open | claimed | resolved | forwarded
- `deadlineAt`, `hops`, `resolvedBy`, `outcome`

Routing, in one function with unit tests:
- When the operator, the gates or TASK-121's repair would call `createUserRequest` or record a held gate:
  - **if** a Hermes is on duty **and** the kind is agent-solvable (held quality gate, repair exhausted, stuck job, provider failing, publish failure, unclear instruction), create an escalation to Hermes with a 30-min deadline (setting `escalation.hermesDeadlineMin`). Do not message the user yet.
  - **else**, keep today's path to the user.
- **Always straight to the user:**
  - pending confirm-risk actions;
  - anything touching secrets, money or permissions;
  - deletes;
  - the protected project;
  - anything the user asked to see.
- Hermes resolves it, or forwards it with its own note. A deadline that passes forwards it automatically with "Hermes chưa xử lý kịp". If duty is lost, all open escalations go to the user at once.
- Ping-pong guard:
  - each enqueue → escalate round on the same `objectRef` increments `hops`;
  - at 3 hops, forward to the user;
  - reuse `loopGuard` where it fits.
- The user sees every escalation, whoever resolved it, on the operator page (new "Hermes" tab, §8) and in the daily digest (`digestLine`).

### 6. Fail-safe in both directions

- **Hermes down** (no duty heartbeat for 3 min):
  - the operator keeps working exactly as today;
  - escalations go to the user;
  - an operator pause set by Hermes is lifted after 10 min without duty, with one user notification ("Hermes offline, operator tự chạy lại");
  - one Telegram message to the user per outage, not one per minute.
- **Operator stuck:** the code anomaly rules (§4) flag it. Hermes may stop the run, start a new session, or take the object over by preempting the lease.
- **Pause cap:** a pause can never be longer than 6 h. When it ends, the operator resumes on its own.
- **Both down:** the supervisor code and today's user notifications still run.
- **Startup:** `failInterruptedOperatorRuns` also releases leases held by `operator/app`. Leases from remote instances expire by TTL.

### 7. One Telegram voice

- The app's poller owns the bot token. Hermes must not poll the same bot:
  - Telegram returns HTTP 409 when two clients call `getUpdates`;
  - detect that in the poller, set the flag `telegram.conflict` (shown in `supervision_snapshot` and Settings), and back off instead of looping.
- Hermes reaches the user through the app: tool `notify_user` `{text, severity}`. It goes out via the app's Telegram, rate-limited and tagged "🤖 Hermes". If a notify tool already exists, reuse it and add the tag.
- The user's Telegram commands keep working. Add `/hermes` to show duty holder, last seen, open escalations and the last 5 Hermes actions. `/stop` now also pauses the operator for 1 h. Hermes cannot undo a user `/stop`: a user pause outranks Hermes (chain of command).

### 8. Web

- On the operator page, add a **Hermes** tab:
  - duty holder and standby instances, with last seen times;
  - open and recent escalations, with their outcome;
  - Hermes actions (from audit, filtered by kind `hermes`);
  - current leases;
  - pause state, with who paused and until when.
- In Settings → machine keys, add the `canSupervise` toggle and the agent kind for each key.
- Use the existing shared ui components. No new design work.

### 9. Hermes skill pack (repo, no code)

Add `.agents/skills/vg-supervise/SKILL.md` (Agent Skills format, the same shape as the TASK-063 skills):
- the supervision loop:
  1. heartbeat;
  2. snapshot;
  3. **no anomalies and no open escalations → stop here, write nothing**;
  4. otherwise handle each one with the tools above;
- what to fix itself and what to forward;
- the hard limits;
- never pause the operator without a reason;
- always put a reason on an override.

Add `.agents/skills/vg-escalation/SKILL.md` for handling a single escalation.

In `deploy/README.md` (or `docs/user-guide`), give the Hermes cron line the user runs:

```
hermes cron create "every 15m" "Run the vg-supervise skill" --skill vg-supervise --name vg-supervise
```

Say that the cron job needs the Hermes gateway running (its scheduler ticks in the gateway).

## Open source (Mã nguồn mở có sẵn)

- **Hermes Agent** (Nous Research, MIT): MCP client (stdio and Streamable HTTP with `headers`), skills in Agent Skills format, cron (`hermes cron create … --skill …`, stored in `~/.hermes/cron/jobs.json`). Docs: https://hermes-agent.nousresearch.com/docs. We do not change Hermes; we only give it tools, skills and a cron line.
- **Agent Skills** (agentskills.io) `SKILL.md` format, already used in `.agents/skills/`.
- Leases with TTL plus fencing are the standard leader-election pattern (as in Kubernetes `Lease` objects and etcd). Implement it in SQLite with one `UPDATE … WHERE expiresAt < now OR holder = me` inside a transaction. No library is needed.
- If you find a maintained, permissive-licence library for idempotency keys or leases on SQLite that fits better, report it (README rule 11). Do not add it.

## Tests (no network, no real LLM)

- Identity: a key with kind `operator` that sends header `x-vg-agent-kind: hermes` is treated as operator. Changing `agentKind`/`canSupervise` through any tool is hard-blocked.
- Leases:
  - operator holds a project and Hermes preempts it; the operator's next step checkpoints and stops;
  - operator vs Hermes-held project → `LEASED`;
  - a user action breaks any lease;
  - an expired lease can be taken;
  - every mutating tool is mapped in `resourceOf` (coverage test).
- Idempotency: the same key twice → one effect, the same result.
- Duty:
  - two instances heartbeat and only one is on duty;
  - when the holder stops, the other takes duty after the TTL;
  - a non-duty caller of `operator_pause` → `NOT_ON_DUTY`;
  - a key without `canSupervise` can never take duty.
- Escalation routing table:
  - every kind maps to hermes or user;
  - pending confirm-risk always → user;
  - deadline → forwarded;
  - duty lost → all forwarded;
  - 3 hops → user.
- Fail-safe: a Hermes pause is lifted 10 min after duty is lost; a pause is capped at 6 h; a user `/stop` cannot be resumed by Hermes.
- `supervision_snapshot`: each anomaly rule fires on a fixture; the JSON stays under the size cap; a calm state gives `anomalies: []`.
- Telegram 409 → conflict flag set, with backoff (mock fetch).
- `agent_events_poll` returns events after `sinceId` in order.
- Hard limits: Hermes calling an approve-pending tool, a secret key, the protected project or a hard delete is still blocked.

## Rules

- No commit or push. No new npm dependency. One generated migration. Never hand-write SQL migrations.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`.
- Do not change TASK-059 hard limits, `APPROVE_PENDING_TOOLS`, or the meaning of the autonomy grants. Hermes uses the same effective autonomy level as the operator.
- Do not add a way for any agent to approve pending actions, read secrets, or edit its own key.
- Tests: no network, no real LLM or TTS. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- `npm run typecheck` at the root. `npm test` in `apps/server`, `apps/mcp`, `packages/shared`. List any failure outside your area, with its file.
- One line in `docs/user-guide/nhat-ky-thay-doi.md`. Add a short page or section in `docs/user-guide` explaining operator vs Hermes, duty, escalation and the hard limits (the coverage test from TASK-048 must stay green).
- `docs/tasks/TASK-122.report.md` in Vietnamese, at most 60 lines:
  - tables and tools added;
  - the `resourceOf` map summary;
  - the escalation routing table;
  - how identity is bound to keys;
  - test results;
  - anything you could not finish.
- Then create the empty `docs/tasks/TASK-122.done`.
