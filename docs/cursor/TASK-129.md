# TASK-129 — Mission control: one command → publish → analytics, two-way agent bus, full use of machine resources 🛰️⚙️

**Who:** Cursor `grok-4.7-xhigh` (or a Sonnet 5.5 session). **Size:** L, three parts:

| Part | Content | Migration |
|---|---|---|
| **129a** | §1–§2: two-way bus (app → agent push, agent ↔ agent mailbox) | one |
| **129b** | §3: resource governor (adaptive concurrency on the control machine and nodes) | none expected; if it needs one, it runs alone |
| **129c** | §4–§6: missions (one user command runs to publish and analytics), with the orchestrator on duty 24/7 | one |

**Depends on:**
- TASK-122: identity, leases, duty, escalations, `agent_events_poll`, `notify_user`;
- TASK-123: fleet, remote MCP over Streamable HTTP;
- TASK-128a/b: agents own stages, assignments, roles;
- TASK-119/120: nodes, probe, capability info;
- TASK-121: quality repair;
- TASK-125: overdue checks;
- TASK-059/066: autopilot, autonomy levels and gates;
- TASK-028: topic queue.

If 122, 123 or 128a has not landed, stop 129a/129c and report.

**129b runs early**, right after TASK-120, because it only needs the worker and the node probe. If TASK-127 or TASK-128 has not landed yet:
- the `llm` class uses a fixed cap, with a `// TASK-127` note;
- the `agent` class is left out, with a `// TASK-128` note.

**New dependency:** none.

**Source:** user decision 2026-11-13:
- always make full use of the machine's resources;
- an orchestrator agent supervises 24/7;
- agents and the app talk both ways: sub-agent ↔ orchestrator, the app tells agents everything, agents control the app;
- push automation to the maximum, so the user only gives a command and the agents carry it through to publishing and then analyse the results.

## What already exists (do not rebuild)

| Need | Already there |
|---|---|
| Agents control the app | Shared tool registry (TASK-047), remote MCP (TASK-123), leases (TASK-122) |
| Orchestrator on duty 24/7 | Hermes duty lease, escalations, `operator_enqueue`, supervisor anomalies (TASK-122) |
| App → agent events | `events/agentBus.ts`, SSE `/api/events`, signed webhooks (`events/webhooks.ts`), `agent_events_poll` |
| Agents run stages, in parallel | TASK-128 claim protocol, assignments, roles |
| Pipeline autopilot + gates | `operator/autopilot.ts`, `qualityGates.ts`, `qualityRepair.ts`, autonomy levels |
| Topics, publishing, analytics | topic queue (028), publications + schedule, `analytics/syncService.ts`, `learning/*` |

This task **connects** these into one loop and fills three gaps:
1. Push to agents. Today an agent only learns of an event when it polls.
2. Agents cannot message each other.
3. Worker concurrency is a fixed `WORKER_CONCURRENCY` (default 3, `lib/config.ts:59`), so the machine sits idle or gets overloaded.

## 129a — Two-way bus

### 1. App → agent push (the app tells agents everything)

- **Subscriptions.** Each agent instance registers a subscription, stored per instance: `{kinds[], scope (profile/project/stage), delivery}`.
- **Delivery modes, best first:**
  1. **Webhook** to the instance's own endpoint, signed with the existing `webhookSign.ts`, with retry and backoff from `webhooks.ts`. Read the Hermes docs (https://hermes-agent.nousresearch.com/docs) for the entry point that wakes the agent from an HTTP call (gateway, webhook or API server). Use the real key names, and write them in the report.
  2. **SSE** over the TASK-123 remote MCP or `/api/events` with `last-event-id`.
  3. **Code-only poller sidecar.** For instances that cannot receive HTTP, extend the TASK-123 sync sidecar to call `agent_events_poll` every 15 s. It wakes the agent only when a subscribed event arrives, so **idle costs no tokens**.
- **Event coverage.** Every pipeline transition goes on the bus:
  - stage started / finished / failed / handed off;
  - gate held;
  - repair started / exhausted;
  - overdue;
  - publish scheduled / published / failed;
  - analytics synced;
  - anomaly;
  - quota exhausted / failover;
  - node online / offline;
  - mission state changes (§4).

  Add the kinds that are missing. Each event carries ids and a short Vietnamese text, never secrets.
- **Routing.** An event goes to the instances whose assignments (TASK-128 §5) match its scope. Events with no scope go to the agent on duty. Escalations keep the TASK-122 rules.

### 2. Agent ↔ agent mailbox (sub-agents talk to the orchestrator)

- New table `agent_messages`:
  - `id`, `threadId`;
  - `from` (instance, taken from the key);
  - `to` (instance | `role:<name>` | `duty`);
  - `kind`: `directive` | `report` | `question` | `answer` | `handoff`;
  - `missionId?`, `projectId?`;
  - `body` (≤ 8 KB), `attachments` (ids of app objects only);
  - `createdAt`, `deliveredAt`, `ackedAt`;
  - `expiresAt`.
- **Tools:**
  - `agent_send {to, kind, body, threadId?, missionId?}`;
  - `agent_inbox {sinceId?, limit}`;
  - `agent_ack {id}`;
  - `agent_thread {threadId}`.

  New messages are pushed like events (§1).
- **Rules:**
  - Identity comes from the key; an agent cannot write as another agent.
  - A `directive` from a lower rank to a higher rank is turned into a `question` (TASK-122 chain of command).
  - The user sees every thread on the fleet page and can post into it. A user post counts as a directive from the top rank.
  - Rate limit: 60 messages per instance per minute.
  - An unacked `question` older than 15 min goes to the duty agent; one older than 60 min goes to the user (via `notify_user`).
- **Sub-agent reports.** A role agent (for example a `visual_scout`) sends the orchestrator a `report` when it claims, finishes or releases a stage job. The app also emits these automatically from the TASK-128 tools, so a silent agent is still visible.

## 129b — Resource governor (use the machine fully, never overload it)

### 3. Adaptive concurrency

- Classify stages by bottleneck, and keep the table in code:
  - `cpu`: render, compose, ffmpeg;
  - `gpu`: local TTS, local vision, when present;
  - `io`: downloads, crawl, image search;
  - `llm`: script, vision, rerank;
  - `agent`: handed-off jobs.
- **Governor** (new `jobs/resourceGovernor.ts`):
  - It samples the control machine every 5 s: CPU load, free RAM, free disk under `DATA_DIR`, and GPU utilisation when `nvidia-smi` exists. Use `os` and a child process; no new dependency.
  - Nodes already report their capacity through the TASK-118/119/120 probe and heartbeat.
  - Per class it keeps a slot count that it raises while usage stays under the targets (default: CPU 85 %, RAM 85 %, disk free > 5 GB) and lowers fast when a target is crossed (AIMD).
  - `llm` slots also respect the provider limits and cooldowns (TASK-127). `agent` slots are the agents' free `maxConcurrent` (TASK-128).
- **Worker integration.** `worker.ts` asks the governor for a slot of the job's class instead of comparing with the fixed `WORKER_CONCURRENCY`.
  - `WORKER_CONCURRENCY` and `RENDER_CONCURRENCY` become **upper bounds**. Defaults: `WORKER_CONCURRENCY` raised to `cpu count × 2` (cap 32), `RENDER_CONCURRENCY` kept as the render cap.
  - A setting `governor.enabled` (default on) and per-class min/max live in the settings page.
- **Idle work.** When slots stay free for 10 min and the topic queue (TASK-028) has approved topics for a profile with autopilot on, the governor asks the duty agent (bus event `capacity_idle`) whether to start the next topic early. It never starts a topic on its own, and never past the profile's publish schedule or budget.
- **Placement.** Render prefers a free node over the control machine when the control machine is above target (TASK-118 placement settings decide).
- **Visibility.** The dashboard tile "Tài nguyên" shows usage, slots per class, and jobs waiting per class. Add supervisor anomaly `resource_starved` (jobs waiting > 15 min while slots are full) with a hint: add a node, add a scout, or raise a cap.

## 129c — Missions: one command to publish and analytics

### 4. Mission object

- New table `missions`:
  - `id`, `createdBy` (user), `command` (raw text), `channelProfileId`, `projectIds[]`;
  - `plan` (json steps), `state`;
  - `owner` (duty instance);
  - `autonomyLevel` (snapshot);
  - `deadline?`, `budgetUsd?`;
  - `report`, `createdAt`, `updatedAt`.
- **States:**
  1. `planning`
  2. `producing` (the pipeline runs)
  3. `waiting_user` (only for gates the autonomy level does not allow agents to pass, and for confirm-risk actions)
  4. `scheduled`
  5. `published`
  6. `measuring`
  7. `done`

  Plus `failed` and `cancelled`.
- **Start.** The user gives a command from the web, Telegram (`/mission <lệnh>`) or the assistant chat, for example "làm 3 video về Berserk cho kênh A, đăng tuần này rồi báo kết quả". The duty orchestrator receives a `mission_created` event and writes the plan through tools:
  - topic(s) into the topic queue;
  - projects created;
  - stage executors (app / agent);
  - the publish slot.
- **The loop, driven by existing machinery:**
  - autopilot runs the stages;
  - TASK-128 hands stages to agents;
  - quality repair (121) fixes held gates;
  - overdue (125) handles slow stages;
  - publishing posts on schedule;
  - analytics sync pulls numbers.
- **Measuring.** The mission reads the analytics at checkpoints of +2 h, +24 h, +72 h and +7 d after publishing (configurable). It writes a Vietnamese report with views, retention, CTR, revenue where available, and a comparison with the channel's median. The lessons go to `learning/*` and to the topic queue scoring.
- **Report out.** At each checkpoint the user gets one Telegram message with a link. The final report closes the mission.

### 5. Maximum automation, inside the hard limits

- What runs without the user is decided only by the profile's autonomy level (TASK-059/066). The mission page shows at the start which steps will stop for the user at this level, so the user can raise the level for that mission if they want. A per-mission level is allowed, never above the profile maximum the user set.
- **Hard limits stay** for every agent, in every mission:
  - confirm-risk pending actions are approved only by the user;
  - no secrets, no money;
  - no changes to the agent's own permissions;
  - no hard deletes;
  - project `56374fb2-54cf-48ff-9441-2e6c653295d4` is untouchable.

  No mission flag bypasses them.
- **Stuck missions.** If a mission waits on the user for a gate, it pings once, then reminds at most every 6 h.
- **Duty handover.** If the duty agent changes, the new holder inherits ownership of all open missions (`owner` updated, event emitted).

### 6. Orchestrator 24/7

- **Duty watchdog.** The TASK-122 duty lease stays. Add a code watchdog: if no duty heartbeat arrives for 5 min, alert the user once and fail over to a standby instance with `canSupervise`. Open missions keep running on app machinery meanwhile.
- **Morning and evening digest from the orchestrator.** It covers missions in flight, published items, results, problems and resource use. Reuse the existing digest code and add a mission section.

## Mã nguồn mở có sẵn (open source)

| Project | Licence | Use |
|---|---|---|
| Our `agentBus`, `webhooks`, `webhookSign`, SSE, TASK-122/123/128 | ours | the base; extend, do not duplicate |
| Hermes Agent gateway / webhook / cron (Nous Research) | MIT | how an instance is woken by a push. Check the docs before using key names |
| AIMD congestion control (TCP), Kubernetes HPA ideas | — | design for the governor; no library |
| Temporal (MIT) / Inngest (server SSPL: do **not** copy its code) "durable workflow" model | mixed | design idea for missions as durable state machines with checkpoints; we keep SQLite + our job queue |
| A2A protocol (Agent2Agent, Linux Foundation, Apache-2.0) | Apache-2.0 | message shapes (`task`, `message`, `artifact`) as a reference for `agent_messages`; do not add an SDK |

If a maintained, permissive-licence project fits better, report it under README rule 11. Do not add it.

## Rules

- README rules 1–11.
- Tests use fake agents with fake keys, a fake `os` load sampler, fake timers and mock analytics. No network, no real Hermes, no real LLM.
- Never auto-approve confirm-risk actions. Never raise a profile's autonomy maximum in code.
- Never start, render, publish or approve anything on `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Do not edit `services/visualService.ts` unless 128 has landed and no other task holds it.
- After any `packages/shared` edit, run `npm run build -w @vg/shared`.

## Tests

**129a**
- A subscription filters by kind and scope.
- Webhook delivery is signed, retried and backed off.
- The poller wakes the agent only on a subscribed event.
- Mailbox:
  - identity comes from the key;
  - a lower→higher directive becomes a question;
  - an unacked question escalates at 15 / 60 min;
  - the rate limit holds;
  - a user post is a top-rank directive.

**129b**
- The governor raises slots under target and halves them over target.
- The `llm` class honours cooldowns.
- The worker uses class slots and the caps are respected.
- `capacity_idle` asks the duty agent and never starts a topic by itself.
- `resource_starved` fires.

**129c**
- A command creates a mission and the plan.
- A full happy path with mock stages, publish and analytics reaches `done`, with checkpoint reports.
- A gate the autonomy level does not allow → `waiting_user`; after user approval it continues.
- A confirm-risk action is never auto-approved.
- Duty handover moves ownership.
- The protected project is refused.

## Done

- [ ] 129a: subscriptions, push (webhook/SSE/poller), event coverage, mailbox + tools, fleet page threads, migration, tests
- [ ] 129b: governor, worker integration, settings, dashboard tile, anomaly, tests
- [ ] 129c: missions table + states, `/mission` on Telegram/web/chat, checkpoints and reports, autonomy preview, duty watchdog, digest section, migration, tests
- [ ] full suites; typecheck; build
- [ ] user guide: "Giao việc một lệnh (Mission)", "Tài nguyên máy", "Agent nói chuyện với nhau"; `featureMap`; changelog
- [ ] report per part: `docs/tasks/TASK-129a.report.md` → `.done`, and the same for 129b and 129c
