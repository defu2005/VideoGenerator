# TASK-136 — LLM relay: every machine uses the server's OmniRoute key 🔑🧠

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`; it touches auth, secrets and streaming, so rate it hard). **Size:** M–L. **Migration:** one (drizzle-kit only). **New dependency:** none. Use Node's built-in `fetch` and stream bodies.
**Depends on:** 127 (LLM failover), 123 (Hermes fleet bundle), 120 (lease secrets), 132 (workspace-scoped API keys). It may run beside 139.
**Source:** user decision 2026-11-16: "từ giờ llm sẽ được phân phối qua api key từ omniroute của máy chủ". See [SCALE-PLAN.md](SCALE-PLAN.md) row 1.

## Why

- Today each extra machine needs its own LLM access:
  - Hermes containers get a hand-filled `VG_HERMES_MODEL_KEY` (`deploy/docker/hermes.env.example`, `fleet/service.ts` `configPatch.providers`);
  - 135a lends raw provider keys (`llm:anthropic`, `llm:gemini`… in `node/leaseSecrets.ts` `PROJECT_PROVIDER_KEYS`);
  - CLI providers (`claude-cli`, `copilot-cli`, `antigravity-cli`) need a logged-in machine.
- Quota, cost and rate limits are therefore spread over many keys that the app cannot see or balance.
- **The decision:** one OmniRoute on the server holds all upstream provider accounts. Every LLM call from any machine goes through a relay on the control server. The relay attaches the server's `OMNIROUTE_API_KEY`. No other machine ever holds an LLM key.

## Read first

- `apps/server/src/lib/config.ts` (`OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY`, `OMNIROUTE_MODEL`).
- `providers/llm/`:
  - `registry.ts`, `openaiCompatible.ts`, `gatewaySettings.ts` (modes `off | prefer | only`);
  - `failover.ts`, `quota.ts`, `omnirouteCatalog.ts`, `omnirouteQuotaStore.ts`, `pricing.ts`.
- `services/usageService.ts` and the `llm_quota_usage` and `cost_entries` tables (`db/schema.ts`).
- Auth:
  - `auth/guard.ts` (API key → `keyId`);
  - `supervision/identity.ts` (`TrustedAgent`, `agent_key_profiles`);
  - `node/nodeService.ts` `authenticate(bearer)` and the node routes in `api/nodes.ts`.
- `node/leaseSecrets.ts` (`PROJECT_PROVIDER_KEYS`, `ProjectLeaseSecrets`, `execution.lendProviders`).
- `fleet/service.ts` `buildFleetBundle` (`configPatch.model`/`providers`), `deploy/docker/compose.hermes*.yml`, `hermes.env.example`, `deploy/README.md` (OmniRoute section).
- `registry/policy.ts` (blocked fields and secret rules).

## Build

### 1. The relay endpoint (OpenAI-compatible, server side)

- Mount `/api/llm/relay/v1/` with:
  - `POST chat/completions` (JSON and `stream: true` SSE);
  - `POST embeddings`;
  - `GET models`.
- Nothing else is proxied: no admin, key or settings paths of OmniRoute.
- **Forwarding:**
  - send to `OMNIROUTE_BASE_URL` with `Authorization: Bearer <OMNIROUTE_API_KEY>`;
  - drop the caller's `Authorization`, cookies and any `x-*` header not on an allowlist;
  - stream the upstream body back chunk by chunk; abort upstream when the caller disconnects.
- **Callers and identity.** Accept exactly two credentials:
  - an agent API key (the existing better-auth key with an `agent_key_profiles` row): caller `agent:<instance>`;
  - a worker node token (`nodes.authenticate`): caller `node:<nodeId>`.
  - Browser sessions and keys without a profile get 403. The in-process pipeline does **not** use the relay; it keeps calling OmniRoute directly (step 4).
- If OmniRoute is not configured, or `/models` fails at the health probe, answer 503 `LLM_RELAY_UNAVAILABLE` with a Vietnamese message. Never fall back to a direct provider key for a relay caller.

### 2. Per-caller policy (migration)

- New table `llm_relay_grants`, one row per caller, edited only by a user with settings permission, never by an agent tool. Columns:
  - `caller` (`agent:<instance>` | `node:<id>` | `*` default);
  - `workspace_id`;
  - `models` (JSON allowlist of OmniRoute model or combo ids; empty = the workspace default list);
  - `rpm`, `tpm`, `daily_usd_cap`, `enabled`, `updated_at`.
- New table `llm_relay_usage`:
  - `id`, `caller`, `workspace_id`, `model`;
  - `job_id` (nullable, from header `x-vg-job-id`, accepted only when that job is leased to this caller);
  - `input_tokens`, `output_tokens`, `cost_usd` (nullable), `status`, `latency_ms`, `created_at`.
- Before forwarding, check in this order:
  1. enabled;
  2. model allowed;
  3. `rpm`/`tpm` (in-memory token bucket per caller, persisted counters per minute are not needed);
  4. today's `cost_usd` sum under `daily_usd_cap`;
  5. the existing workspace budget and paid-fallback rules from 127.
  - A refusal gives 429 or 403 with a stable code: `RELAY_MODEL_NOT_ALLOWED`, `RELAY_RATE_LIMITED` (with `retry-after`), `RELAY_BUDGET_EXCEEDED`, `RELAY_DISABLED`.
- Read usage from the upstream response (`usage` in JSON, or the final SSE chunk; request `stream_options.include_usage`). Price it with `providers/llm/pricing.ts`. When usage is missing, estimate with `tokenEstimate.ts` and mark it estimated.
- Feed the existing quota store (`llm_quota_usage`, cool-downs from 127), so a 429 from OmniRoute cools the model for every caller, local or remote.
- Write the per-job cost into the job's usage the same way local calls are written (`provider: "relay:<caller>"`), so finance, usage pages and budgets count it once.

### 3. Stop lending LLM keys

- Remove the `llm:*` scopes from `PROJECT_PROVIDER_KEYS` and from the `execution.lendProviders` UI. TTS and image/search keys keep their current lending rules.
- A stored `execution.lendProviders` that lists `llm:*` is ignored with one audit entry. Do not migrate secrets.
- The node probe reports `llm: "relay"` when it can reach the relay with its token, so placement can treat LLM-needing work as runnable on that node.

### 4. Server pipeline defaults

- When `OMNIROUTE_API_KEY` is set and the catalog loads, the **default** gateway mode for new installs becomes `only`. Existing installs keep their saved mode, and the settings page offers the switch with one sentence explaining the decision.
- CLI providers stay available on the control machine only, as an explicit per-task route. They are never offered to remote callers.
- Remote agents never pick an upstream provider. They pick an OmniRoute model or combo id from `GET /models`, filtered by their grant.

### 5. Hermes fleet and deploy

- `buildFleetBundle` `configPatch`:
  - `base_url` = `${VG_API_URL}/api/llm/relay/v1`;
  - `api_key` = `${VG_API_KEY}` (the agent's own key);
  - `default` = the grant's default model.
  - Delete `VG_HERMES_MODEL_KEY` from `hermes.env.example`, both compose files and `deploy/README.md`, with a migration note in the changelog.
- `deploy/README.md`: OmniRoute runs only on the control machine. Workers and agents need only `VG_API_URL` and their own key. Keep the `host.docker.internal` note for the control container.

### 6. UI

- Settings → "LLM qua máy chủ": relay status (OmniRoute reachable, model count), a table of callers with today's tokens and cost, and an editor for grants (models, rpm, tpm, daily cap, on/off).
- Fleet and Nodes pages show each machine's relay usage today and its last refusal code.

## Mã nguồn mở có sẵn (open source)

- **OmniRoute** (already the gateway): the relay only forwards to it. Do not re-implement routing, combos or provider failover that OmniRoute already does.
- **LiteLLM Proxy** (MIT core): "virtual keys" with per-key model lists, rpm/tpm and budgets. Take the policy shape; do not add LiteLLM.
- **OpenAI streaming spec** (`stream_options.include_usage`): read usage from the last chunk.

## Rules

- README rules 1–11. Migration only through drizzle-kit.
- The OmniRoute key never appears in a response, log, audit payload, fleet bundle, snapshot or test snapshot. Add a test that greps the bundle and the relay responses for it.
- Agent tools cannot read or edit grants (policy rule for settings fields).
- Tests: no network. Use an in-process fake OpenAI-compatible server (Fastify on a random port, or an injected `fetch`).
- Never approve gates or render on project `56374fb2-…`.

## Tests

- **Auth:** agent key with profile → ok; node token → ok; browser session, key without profile, revoked node → 403; OmniRoute missing → 503.
- **Forwarding:**
  - caller headers are stripped and the server key is attached;
  - streaming arrives in chunks;
  - a caller abort aborts upstream;
  - `/models` filtered by grant.
- **Policy:** model not allowed, rpm exceeded (with `retry-after`), daily cap exceeded, disabled grant: each gives its code. An upstream 429 cools the model for local calls too.
- **Usage:** JSON and SSE usage recorded; missing usage estimated and marked; `x-vg-job-id` accepted only for the caller's own lease; job usage and finance count the call once.
- **Lending:** `llm:*` is no longer lendable; old setting ignored with an audit row; TTS lending unchanged.
- **Fleet:** the bundle points at the relay and contains no secret.

## Done

- [ ] relay routes, auth, forwarding, streaming
- [ ] grants + usage tables, policy, quota and cost integration
- [ ] `llm:*` lending removed; probe reports relay; gateway default `only` for new installs
- [ ] Hermes bundle + deploy files + README updated
- [ ] UI (settings, fleet, nodes)
- [ ] tests; shared + server + web suites; typecheck; build
- [ ] `docs/ARCHITECTURE.md` §3 (gateway) and §9 updated; user guide; changelog
- [ ] report → `docs/tasks/TASK-136.done`
