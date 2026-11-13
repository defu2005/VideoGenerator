# TASK-127 report: LLM failover chain, cooldown and health

## What was done
- `apps/server/src/providers/llm/failover.ts` (new): in-memory `FailoverTracker`.
  - `isFailoverError`: fail over on quota, rate limit, 402, 429, 503 and unavailable/not configured; never on `LLM_INVALID_OUTPUT`. Aborts are non-`LlmError` and are rethrown, so they never fail over.
  - Cooldown keyed by `provider` (or `provider:model` when the error message is model-specific). Rate limit: 60 s, doubling to a 15 min cap while it repeats. Quota: until the reset time if the error gives one, else 30 min. Success clears it. A restart clears all.
  - Event ring for recent failovers; `snapshot()` feeds the health API.
- `structured.ts` (`routeStructured`): the chain primary → `fallback` → `fallbacks[]` already existed. Added: skip of cooling providers, capability gaps (vision, max images, `caps.json === false`, context fit) with recorded reasons, success/failure recording, failover warn log and event, and `LLM_ALL_PROVIDERS_EXHAUSTED` (retryable, lists every reason, carries earliest retry time) when a multi-step chain is fully unusable. The existing ECO / paid-fallback policy gate is unchanged: a paid fallback is only ever reached if the user listed it, and then only under the `paid_fallback` policy and the daily cap.
- `http.ts`: 402 now maps to `LLM_QUOTA_EXHAUSTED`. `types.ts`: new error code and optional `json` capability. `registry.ts`: `registry.failover`.
- `GET /api/llm/health`; assistant tool and MCP tool `get_llm_health` (read, `settings.read`).
- Supervisor anomaly `llm_failover_storm` (more than 10 failovers in 10 min), wired in `app.ts`, with a Vietnamese label in the web panel.
- Web: `LlmHealthBadges` on the AI settings routing tab, "đang nghỉ đến HH:MM".
- Tests: `apps/server/test/llmFailover.test.ts` (13 tests).
- Docs: `docs/user-guide/mo-hinh-ai.md` (#tu-chuyen), `featureMap` entry `llm-failover`, changelog, status line under #14 in `PROPOSALS_AND_BUGS.md`.

## Deviations / notes
- The guide said the registry only used `fallback` for NOT_CONFIGURED; in fact the chain was already in `structured.ts`, so the work was additive there.
- Rate-limit retries happen inside each provider and are unchanged; the test covers the failover after they are exhausted.
- Cooldown is in memory, so there is no migration. It is separate from the DB-backed quota controller in `quota.ts`.
- ECO/paid behaviour is covered by the existing `llmQuota.test.ts` cases; no new duplicate test.
- No routing settings are ever changed automatically.

## Known unrelated failures (not touched)
See the verification section appended below.

## Verification
- Typecheck clean: server, web, mcp, shared. `npm run build` OK (shared rebuilt after the featureMap edit).
- Tests: web 204/204, mcp 22/22, shared 739/739. Server 1206 passed, 2 failed, both outside this task:
  - `genreDirectives` compareFallback (genre/director code, TASK-112 area; not touched). An earlier run also showed `genreDirector` snapshot drift and the flaky `qualityRepair` shelving test.
  - `workerAgent` update-exit test (known unrelated).
- `llmFailover.test.ts` 13/13. Two fallouts of my own were fixed: the help-search ranking test (reworded my guide section so "Quota" still ranks first) and the agent skill pack coverage test (added `get_llm_health` to `.agents/skills/video-mo-hinh-ai/SKILL.md`).
