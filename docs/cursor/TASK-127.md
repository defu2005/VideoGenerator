# TASK-127 — LLM failover on quota / rate limit, with cooldown 🔀

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** M. **Migration:** none. Cooldowns live in memory, and failover events go to the existing usage and event logs. **New dependency:** none.
**Depends on:** nothing new. It may run beside 126 (different files). Do not run it beside a task that edits `providers/llm/registry.ts`.
**Source:** Hermes `PROPOSALS_AND_BUGS.md` #14 (PROPOSAL-LLM-ROUTING-001).

## Why

Routes already store `fallback` and `fallbacks`, but `providers/llm/registry.ts` only uses `fallback`, and only for `LLM_NOT_CONFIGURED` (~line 448). When Gemini or another provider returns quota exhausted or a rate limit (429, `RESOURCE_EXHAUSTED`, 402), the job fails, even though OmniRoute or another configured model could take the call. Hermes had to re-route tasks by hand through `/api/settings/llm-routing`.

## Read first

- `apps/server/src/providers/llm/registry.ts`: route selection, `resolveFallback`, `generateText`, `generateStructured`, usage recording, and the quota controller (`quota.ts`).
- The error mapping in each provider (`antigravityCli.ts`, `copilotCli.ts`, `claudeCli.ts`, the API providers, OmniRoute): the codes `LLM_QUOTA_EXHAUSTED` (not retryable) and `LLM_RATE_LIMIT` (retryable). Check that the HTTP providers map 429, 402 and `RESOURCE_EXHAUSTED` to these codes; add the mapping where it is missing.
- `apps/server/src/api/llm.ts` (routing settings API) and the routing settings page in web.
- The memory rule on token budget and modes: ECO must not silently start using a paid model.

## Build

1. **Failover chain.**
   - In `generateText` and `generateStructured`, build the chain: the primary route, then `fallback`, then `fallbacks[]`, without duplicates.
   - Move to the next entry on `LLM_NOT_CONFIGURED`, `LLM_QUOTA_EXHAUSTED`, `LLM_RATE_LIMIT` once the provider's own retries are used up, `LLM_PROVIDER_UNAVAILABLE` (if the code exists), and HTTP 402/429/503.
   - Never move on for `LLM_INVALID_OUTPUT`, a prompt or safety refusal, or an abort signal.
2. **Capability check.** Skip a fallback that cannot serve the call:
   - vision tasks need a vision-capable model;
   - structured output needs JSON support;
   - the context must fit.

   Record why each fallback was skipped.
3. **Budget and mode.** Before calling a fallback, apply the same budget and mode checks as the primary route.
   - ECO never fails over to a paid model unless that model is explicitly listed in the route's fallbacks by the user.
   - A pinned model stays pinned unless the route lists fallbacks.
4. **Cooldown.**
   - Keep a map in memory keyed by `provider` (and `provider:model` when the error is model-specific), holding `cooldownUntil` and the reason.
   - `LLM_RATE_LIMIT`: 60 s, doubling up to 15 min while it repeats.
   - `LLM_QUOTA_EXHAUSTED`: until the reset time if the error gives one, else 30 min.
   - While a provider is cooling down, the chain skips it without calling it.
   - A success clears the cooldown.
   - Restarting the server clears all cooldowns. This is acceptable.
5. **When every provider fails**, throw `LLM_ALL_PROVIDERS_EXHAUSTED` (retryable). The message lists each provider and why it failed. The job then follows the normal retry path; TASK-125 overdue checks are not involved.
6. **Visibility.**
   - Each failover writes a usage or event line with `from`, `to`, `reason` and the task name, and the actual provider and model are what get billed.
   - `GET /api/settings/llm-routing` (or a small new `GET /api/llm/health`) returns the active cooldowns.
   - The routing page shows a "đang nghỉ đến HH:MM" badge per provider.
   - Add a supervisor anomaly `llm_failover_storm` when more than 10 failovers happen in 10 minutes.
7. **Tools.** Expose the cooldown and health info through a read tool such as `get_llm_health`, so Hermes no longer needs to re-route by hand. Re-routing stays the existing settings tool or API with its current grant.

## Mã nguồn mở có sẵn (open source)

- **LiteLLM Router** (MIT): its `fallbacks`, `cooldown_time` and "allowed fails" ideas match this task. Use the design only. LiteLLM is Python, so we do not add it.
- **OmniRoute** (already used as a proxy) does failover on its own side. Our chain still matters for direct providers and the CLIs.

## Rules

- README rules 1–11. Tests use mock providers that throw the error codes; no network and no real CLIs.
- Never change a user's routing settings automatically.
- Do not edit `services/visualService.ts` (TASK-126) or `node/*` (TASK-120).

## Tests

- quota error on the primary → the fallback answers, and usage is billed to the fallback;
- rate limit → the provider's retries run first, then failover;
- `LLM_INVALID_OUTPUT` → no failover;
- abort → no failover;
- vision task skips a fallback without vision;
- ECO + a paid fallback that is not listed → skipped; a listed one → used;
- the cooldown skips the provider until it expires (fake timers), a success clears it, and the rate-limit cooldown doubles;
- all providers fail → `LLM_ALL_PROVIDERS_EXHAUSTED` with every reason;
- the health API shows the cooldowns;
- the anomaly fires after 10 failovers.

## Done

- [ ] chain + capability + budget + cooldown + error code
- [ ] usage/event lines, health API, routing page badge, read tool, anomaly
- [ ] tests; suites; typecheck; build
- [ ] user guide + changelog + a status line appended under #14 in `PROPOSALS_AND_BUGS.md`
- [ ] report → `docs/tasks/TASK-127.done`
