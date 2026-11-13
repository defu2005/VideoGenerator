# TASK-128 — Agents own whole stages: handoff, many agents in parallel, role skills, shared cache 🤝

**Who:** Cursor `grok-4.7-xhigh` (or a Sonnet 5.5 session). **Size:** L, split in two parts:

| Part | Content | Migration |
|---|---|---|
| **128a** | §1–§4: stage handoff protocol + the VISUAL_SEARCH toolkit | one (`npx drizzle-kit generate` in `apps/server`) |
| **128b** | §5–§8: assignments by scope, role skills, shared cache, scaling | one |

**Depends on:**
- TASK-122: trusted identity, `agent_leases`, `agent_instances`;
- TASK-123: fleet, skill hub;
- TASK-126: `visualService.ts` reuse plan and the second vision pass;
- TASK-127: `LLM_ALL_PROVIDERS_EXHAUSTED`.

If one of them has not landed, stop and report. Do not build a stand-in. Only one migration task may run at a time.

**New dependency:** none.

**Source:** user decision 2026-11-13. "An agent may take full charge of a stage. When the configured providers (Brave, Gemini…) are out of usage, the agent searches and approves the images itself. Many agents run at once, for example one agent per channel or one agent per image-search stage of one video, and they must not collide. Skills are written for specific sub-agents and shared, and the cache is shared too."

## Goal

External agents (Hermes instances, and later other agent shells) can **claim and finish a pipeline stage job themselves**. They use their own model and their own web and vision tools.

- **First stage: VISUAL_SEARCH.** The protocol is stage-agnostic, so MUSIC, SCRIPT research and others can be added later without a new protocol.
- **Many agents run in parallel.** Claims and leases make sure two agents never write the same job or scene.
- **Agents share** skills by role, and share a cache of image verdicts and search results.
- **The app stays the source of truth.** Every image an agent picks becomes a normal `visual_candidates` row, with its source, file hash and verdict. Visual Review, render and quality repair (TASK-121) work unchanged.

## Read first

- `docs/cursor/README.md`; the guides and reports for TASK-118 (job lease, fencing, `nodeId/leaseId/leaseUntil/heartbeatAt`), 122 and 123, 125 (overdue checks), 126 and 127.
- `apps/server/src/jobs/worker.ts` (`startJob`, `runBudgeted`), `jobs/jobRepository.ts`, `node/*`, `api/nodes.ts`. Reuse the TASK-118 lease and fencing code for agent claims; do not write a second lease system.
- `apps/server/src/services/visualService.ts`: `searchVisuals`, `candidatePassesGate`, `attachVisionFile`, the selection step, `planSceneReuse` (TASK-126).
- `apps/server/src/providers/images/webCrawl.ts` (`followRedirectsSafely`, size and type limits), the phash helpers, `db/schema.ts` `visualCandidates`, `visualSearchState`.
- `apps/server/src/registry/*` (grants, policy, audit), `apps/mcp/src/tools.ts`.
- `apps/server/src/operator/skillVersions.ts`, `repoSkills.ts`, and the TASK-123 skill hub and bundle.

## 128a — Stage handoff

### 1. Execution mode per stage

- A per-stage setting `executor`. Resolve it with the existing profile → project override order, the same way stage modes are resolved.
  - `app`: today's behaviour.
  - `agent`: the job always goes to an agent.
  - `app_then_agent` (**default for VISUAL_SEARCH**): the app runs first. The job is handed to an agent when the app cannot finish.
- **Handoff triggers:**
  - `LLM_ALL_PROVIDERS_EXHAUSTED` (TASK-127);
  - `LLM_QUOTA_EXHAUSTED` on the vision path;
  - Brave or image provider quota or rate-limit errors after retries;
  - `vision_unavailable` scenes (TASK-126);
  - after TASK-121 repair, scenes that still have no selection.
- **On handoff:**
  - The job is not failed. It moves to an agent-queued state, keeping the scenes already done.
  - The job records `handoffReason` and lists the scenes still open.
  - Only the open scenes are handed over. Scenes with a valid or protected selection stay untouched.
- **When no agent is online with a matching role or assignment:**
  - After `agentWaitMinutes` (default 30), the job falls back to today's error path, with a clear message ("không có agent nào nhận").
  - It never waits forever.
  - TASK-125 overdue checks apply as usual.
- The migration adds job columns: `executor` (`app` | `agent`), `handoffReason`, `handoffAt`, `agentInstance`. Reuse `leaseId`, `leaseUntil` and `heartbeatAt` from TASK-118.

### 2. Claim protocol (stage-agnostic MCP and REST tools)

| Tool | What it does |
|---|---|
| `stage_claim_next {stages?, projectId?, profileId?}` | Atomically claims one agent-queued job that matches the caller's role and assignments (§5). It is a single `UPDATE … WHERE` in a transaction, like the TASK-118 node claim. It returns the job, a fencing `leaseId`, and a **stage context pack** (§3). If nothing matches, it returns `null`, not an error. |
| `stage_heartbeat {jobId, leaseId, progress?, note?}` | Extends the lease (default TTL 10 min). A wrong `leaseId` → 409 `LEASE_LOST`. The heartbeat feeds the TASK-125 `childAlive` signal. |
| `stage_complete {jobId, leaseId, summary}` | Runs the same post-stage checks as the app executor: selection count, gate and summary text. Then the pipeline continues as if the app had finished. |
| `stage_release {jobId, leaseId, reason}` | Gives the job back to the queue, or to `app` if the reason is `cannot_do`. |

- Identity always comes from the machine key (TASK-122). An agent cannot claim for another instance.
- A user action on the project breaks the agent lease (TASK-122 rule).
- Hard limits stay:
  - the protected project `56374fb2-54cf-48ff-9441-2e6c653295d4` is never handed off or claimable;
  - no secrets, no money, no changes to the agent's own permissions or to project settings such as `copyrightMode`;
  - confirm-risk actions still go to the user.

### 3. VISUAL_SEARCH toolkit (the agent decides and approves)

The **context pack** the claim returns holds:
- the open scenes, with narration, subject, the search queries already used, and the rejected candidates with reasons;
- the style pack notes;
- aspect ratio and size limits;
- the project `copyrightMode`;
- a budget hint.

The agent can then call:

| Tool | What it does |
|---|---|
| `visual_submit_candidates {jobId, leaseId, sceneId, items[]}` | Each item: `imageUrl`, `sourcePageUrl`, `title`, `why`, `licenseNote?`. The app downloads each image through `webCrawl` safe fetch (same limits, no private IPs), computes `sha256` and `phash`, and drops duplicates by phash. It stores the image as a `visual_candidates` row with `origin='agent'` and `provider='agent:<instance>'`, and returns the candidate ids. |
| `visual_get_candidate_image {candidateId, maxSide?}` | Returns the stored file, resized (default 768 px), as MCP image content. The agent judges exactly the bytes the app will render. |
| `visual_record_verdict {jobId, leaseId, candidateId, verdict, subjectMatch, reason, model}` | `verdict` is `pass` or `reject`. Writes `visionCheck` in the same shape the app's vision pass writes, plus `checkedBy: {kind:'agent', instance, model}` and the `sha256` that was judged. **This is the agent's approval.** `candidatePassesGate` accepts it like any vision check. Do not change any other gate condition. |
| `visual_select {jobId, leaseId, sceneId, candidateId}` | Sets the selection through the existing selection code, so the crop, consistency and dedupe steps all run. It refuses a candidate whose verdict is not `pass` or whose `sha256` changed. |

**Copyright:**
- An agent-found image gets `licenseVerified = false`, unless `licenseNote` names a licence from a site on the existing verified-provider allowlist.
- The project's `copyrightMode` decides as it does today. The context pack tells the agent the mode up front, so it does not waste work.
- The agent cannot change the mode.
- Source attribution (`sourcePageUrl`, `sourceSite`) is required for every agent candidate.

**Usage:** the agent may report its own model usage on `stage_complete`. It is stored under `usage.calls` with `provider='agent:<instance>'`. The cost is unknown unless reported, and is never charged against the app's provider keys.

### 4. Visibility (128a)

- **Job page:** "Agent `<instance>` đang xử lý (từ HH:MM, lý do: hết quota Brave)", plus a live heartbeat and a button to take it back. Taking it back breaks the lease; it is a user action.
- **Visual Review:** each candidate shows "Hermes-2 tìm, Hermes-2 duyệt (model …)".
- **Events:** `stage_handoff`, `stage_claimed`, `stage_completed_by_agent`, `stage_released`.
- **Supervisor anomaly:** a job claimed and released more than 3 times.

## 128b — Many agents, roles, shared skills and cache

### 5. Assignments: who works where

New table `agent_assignments`:
- `instance` (or `*` for a role pool);
- `role` (`channel_manager` | `visual_scout` | free text);
- scope: `profileId?`, `projectId?`, `stage?`;
- `maxConcurrent` (default 1);
- `active`;
- `createdBy`.

**Rules:**
- **Only the user sets assignments** (settings page, plus an API with a user-only grant). An agent may *request* one through the existing escalation or improvement-request path.
- `stage_claim_next` returns only the jobs that match the caller's assignments. The most specific scope wins (project+stage > profile+stage > stage > role pool).
- An instance never holds more claimed jobs than its `maxConcurrent`.
- **No collisions:**
  - One stage job has exactly one holder (job lease).
  - Writes to a scene need the lease of the job that owns the scene.
  - A `channel_manager` holding the profile does not block a `visual_scout` working on a stage job inside that channel. The TASK-122 project and profile leases cover pipeline control; job leases cover stage work. Document this nesting rule in code and test it.
- **Example setups the settings page must make easy:**
  - "Hermes-1 quản lý kênh A";
  - "Hermes-2 và Hermes-3 tìm ảnh cho mọi video" (pool, `maxConcurrent` 2 each);
  - "Hermes-4 chỉ tìm ảnh video X".

### 6. Role skills, shared

- Skills in the TASK-123 hub get an optional `roles: [...]` frontmatter field.
- The bundle a given instance receives puts its role skills first. **Every skill stays readable by every instance (shared).** Roles only change what loads by default.
- Add a starter skill `visual-scout` under `.agents/skills/visual-scout/SKILL.md`. It covers:
  - how to read the context pack;
  - search tactics per subject type (anime/manga, real people, places, products);
  - how to judge subject match and quality;
  - when to release;
  - copyright modes.

  Write it in the Agent Skills format. The TASK-074b eval and shadow path applies to later versions.
- Lessons that one role agent writes (`skill_manage` drafts) flow through the TASK-123 hub to all instances of that role after the usual approval.

### 7. Shared cache (hub, used by agents **and** the app)

**`image_verdicts`**
- Keyed by `(phash, subjectKey)`. `subjectKey` is a normalised scene subject, e.g. `berserk|guts|dragonslayer`.
- Fields: `verdict`, `reason`, `checkedBy`, `model`, `createdAt`.
- **Read:**
  - Tool `visual_cache_lookup {phash | candidateId | imageUrl, subjectKey}`.
  - The app's own vision pass reads it too, so a verdict made once is not paid for again.
  - A `reject` is reused only for the same subjectKey.
  - Verdicts expire after 90 days.
- **Write:** only through `visual_record_verdict` and the app's vision pass.

**`search_query_cache`**
- Keyed by `(source, normalisedQuery)`, with `results` (URLs plus metadata) and a TTL of 7 days.
- Brave, the stock providers and agent submissions write into it.
- Agents read it through `visual_cache_query` before they search the web themselves.

**Source notes**
- Per-site notes, such as "wallhaven: nhiều fan art, giấy phép chưa xác minh, hợp anime" or "site X chặn bot".
- They go into the existing knowledge base (TASK-073 knowledge entries) under kind `source_note`. Do not create a new table.

**Rules for both caches**
- Workspace-scoped, like other workspace tables.
- Never cache secrets or signed URLs.

### 8. Scaling ("nhân lên")

- The app does not spawn agents. Agents run outside it (TASK-123 fleet).
- Add a `deploy/` compose example `hermes-scout` with N replicas. Each replica gets **its own data volume and instance name**, because Hermes must never share one `~/.hermes`.
- The fleet page shows the queue depth per role, the claimed jobs per instance, and the median time per scene. It shows the hint "nên thêm visual_scout" when agent-queued VISUAL_SEARCH jobs wait longer than `agentWaitMinutes / 2`.
- Inside one Hermes instance, its own sub-agent delegation (`delegate_task`) may split scenes across sub-agents. They share the instance's lease. The heartbeat must keep running while they work.

## Mã nguồn mở có sẵn (open source)

| Project | Licence | Use |
|---|---|---|
| Our TASK-118 job lease + fencing, TASK-122 `agent_leases` | ours | the claim and lease base; extend it |
| Hermes Agent (Nous Research) sub-agent delegation, skills, `skills.external_dirs` | MIT | in-instance parallelism, role skill loading. Read the docs at https://hermes-agent.nousresearch.com/docs before relying on a key name |
| Agent Skills `SKILL.md` format | open spec | the role skills |
| Queue claim pattern from graphile-worker / pg-boss (`SKIP LOCKED`) | MIT | design idea only; SQLite does it with one guarded `UPDATE` in a transaction |
| Our phash helpers | ours | cache key and dedupe |

If you find a maintained, permissive-licence project that fits better (for example a shared perceptual-hash verdict cache), report it under README rule 11. Do not add it.

## Rules

- README rules 1–11.
- Tests use mock agents (direct calls with fake machine keys), mock HTTP fixtures for image downloads, and fake timers. No network, no real Hermes, no real LLM.
- No gate loosening: `candidatePassesGate` accepts the agent's verdict as a vision check and changes nothing else. The render gate is unchanged.
- Agents never change assignments, `copyrightMode`, routing or their own grants.
- Never hand off, claim, approve or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- After any `packages/shared` edit, run `npm run build -w @vg/shared`.

## Tests

**128a**
- Mode resolution: `app_then_agent` + all providers exhausted → the job is handed off, keeps the finished scenes, and lists the open scenes.
- No agent within `agentWaitMinutes` → normal error path with a clear message.
- Claim:
  - two agents race for one job → exactly one wins;
  - a wrong `leaseId` → 409;
  - an expired lease can be re-claimed;
  - a user takeover breaks the lease.
- Submit → the download uses the safe fetch fixtures, phash dedupe works, and the row has `origin='agent'`, the source fields and `licenseVerified=false`.
- A `pass` verdict lets `candidatePassesGate` pass; a `reject` does not; a `sha256` mismatch → refused.
- `visual_select` with no `pass` verdict → refused.
- With `copyrightMode` off, an unverified agent image cannot be selected.
- `stage_complete` → the pipeline moves to the next stage.
- The protected project is never handed off.

**128b**
- Assignments filter claims, the most specific scope wins, and `maxConcurrent` is enforced.
- A channel_manager profile lease does not block a scout's job lease, and the scout cannot write scenes of another job.
- An agent cannot create or edit assignments.
- The verdict cache hits for the same subjectKey and misses for another. The app vision pass uses the cache, so the mock LLM call count drops.
- The query cache honours its TTL.
- Role skills: the bundle order puts the role first, and all skills are still listed.

## Done

- [ ] 128a: executor mode, handoff, claim protocol, VISUAL_SEARCH toolkit, visibility, migration, tests
- [ ] 128b: assignments, role skills + `visual-scout` starter skill, shared caches, scaling example and fleet page, migration, tests
- [ ] full server and web suites; typecheck; build
- [ ] user guide: new page "Agent nhận stage" (modes, assignments, how to add more scouts, copyright); `featureMap`; changelog
- [ ] report `docs/tasks/TASK-128a.report.md` → `.done`, then the same for `TASK-128b`
