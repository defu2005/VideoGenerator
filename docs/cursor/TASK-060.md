# TASK-060 — Cursor guide (fixes from the Hermes Agent report: quota provider match, scene image relevance, catalog sync and capability detection, quota hot-swap, push events for external agents)

Read `docs/cursor/README.md` first. Tests never use the network: mock `fetch` for every Brave, Wikimedia, OmniRoute and webhook call. Update the user guide, `featureMap` and `nhat-ky-thay-doi.md` (README rule 10).

No new npm dependencies (HMAC uses `node:crypto`). Schema changes go in `schema.ts`; then run `npx drizzle-kit generate` in `apps/server`.

**Order:** run after TASK-059. Sections 4 and 5 hook into the TASK-059 supervisor (`quota_wait` playbook) and its findings. If TASK-059 is not finished, stop after section 3 and say so in the report.

## Why

The user ran the app through Hermes Agent (an external agent over MCP) on a Berserk project. Hermes found these problems. Each one was checked against the code:

| # | Hermes said | Checked in code | Result |
|---|---|---|---|
| 1 | `sopen/gemini-3.8-flash-high` was matched to `grok-cli`, whose weekly quota was used up, so the project went into `LLM_QUOTA_WAIT`. | `callTargetsOmniProvider` in `packages/shared/src/llmQuota/live.ts` compared `appProviderForOmniroute(prefix) === appProviderForOmniroute(wanted)`. Both return `null` for unknown prefixes, and `null === null` is true. | **True.** Hermes patched it in the working tree (null guard). There is no test. |
| 2 | Scene images are wrong: a Flickr photo, a cosplay photo, a "Golden Hawks" marching band. | `rank.ts` sets `lowRelevance` only when `keyword === 0`. One shared word such as "Berserk" or "Hawk" makes a candidate relevant. Web search in `visualService.ts` (about line 1346) runs only when **every** candidate of a scene is `lowRelevance`, so Brave never ran (`braveRequestsThisMonth: 0`). | **True.** |
| 2b | (not in report) | The vision check (about lines 1488–1530) runs **after** the web-search decision. A candidate that vision rejects never leads to a web search. | **True, extra gap.** |
| 3 | The model catalog is not synced in the background. | `omnirouteCatalog.ts` has `CATALOG_TTL_MS = 10 min` and refreshes only when something asks. | **True.** |
| 4 | New models get no automatic capability or vision detection. | `inferVision` reads `vision`, `supports_vision` or modality fields, and otherwise falls back to name rules or a fixed table. Nothing probes the model. | **True.** |
| 5 | No hot-swap failover when quota runs out. | `structured.ts` already walks the route's `fallback`/`fallbacks` steps and the paid-fallback policy. It throws `LLM_QUOTA_WAIT` only when every configured step is blocked. | **Partly true.** Configured failover works. What is missing is finding an equivalent model from another provider when the user configured no fallback. |
| 6 | External agents must poll; there are no push events. | SSE `GET /api/projects/:id/events` serves the web UI only. `emitWaitingApproval` and stage finish go to `NotificationService`, which has only the `telegram` channel. No webhook code exists. | **True.** |

Hermes also changed things outside the normal flow: it edited `live.ts`, rebuilt `packages/shared/dist`, and created project `1ef6de1f-cf84-4552-8aed-8958f290bc0e` and its LLM config directly in SQLite. Keep the `live.ts` fix (section 1). Do not touch that project's data.

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks) spec + reference libs | MIT (spec Apache-2.0) | Follow its header names (`webhook-id`, `webhook-timestamp`, `webhook-signature`), the `v1,<base64 HMAC-SHA256>` format over `id.timestamp.body`, and its retry schedule. Write the signer with `node:crypto` (about 20 lines) instead of adding the npm package; credit the spec in a comment. |
| [Svix](https://github.com/svix/svix-webhooks) | MIT | Design reference only: delivery log, retries with backoff, disable an endpoint after repeated failures. Do not run Svix. |
| [OmniRoute](https://github.com/cheaper-inference/OmniRoute) | MIT | `/v1/models` fields and `/api/monitoring/model-health` for capabilities and health (section 4). Already used by the app. |
| [LiteLLM `model_prices_and_context_window.json`](https://github.com/BerriAI/litellm) | MIT | Data file with `supports_vision`, `supports_function_calling`, `max_input_tokens` per model. Copy a trimmed snapshot into `packages/shared/src/llm/modelCapabilities.data.json` with the source URL, date and MIT notice. It is a fallback for models whose catalog row has no capability fields. Never fetch it at runtime. |
| [MCP spec: notifications/resources subscribe](https://modelcontextprotocol.io/specification) | MIT | Shape of the MCP side in section 6 (`resources/subscribe` + `notifications/resources/updated`), if the MCP SDK in `apps/mcp` supports it. Otherwise use the pull tool described there. |

Image relevance: a CLIP-style local model would need new dependencies, so it is out of scope. Use the vision LLM check that already exists (section 2).

If you find a better project, report it (README rule 11).

## Rules for this task

- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Webhook secrets live in TokenVault. They are shown once when created, never returned again, never logged and never put in a URL. No assistant, MCP or operator tool may create, read or delete a webhook secret.
- Webhook payloads hold ids, kinds, stage names, titles and app links only. No narration text, script text, keys, tokens or OAuth data.
- Allowed webhook targets: `https://` anywhere, or `http://` only to `localhost`, `127.0.0.1` or `[::1]`. Resolve the host before sending and refuse private or link-local addresses for `https://` targets (SSRF guard), except when the user ticks "Cho phép mạng nội bộ" for that endpoint.
- Copyrighted web images stay off by default (section 2.4).
- Do not edit `packages/shared/dist` by hand. It is built.

## 1. Quota provider match (problem 1)

- Keep Hermes's guard in `callTargetsOmniProvider`: two app providers match only when both are non-null and equal.
- Search for the same pattern elsewhere: any `a(x) === a(y)` where `a` can return `null` or `undefined` in `packages/shared/src/llmQuota/`, `apps/server/src/services/omnirouteQuota*`, `apps/server/src/providers/llm/`. Fix each one the same way.
- Tests in `packages/shared/test/llmQuota.test.ts`:
  - `callTargetsOmniProvider("omniroute", "sopen/gemini-3.8-flash-high", "grok-cli")` is `false`;
  - an unknown prefix never matches an unknown provider;
  - a known alias still matches (pick one from `appProviderForOmniroute`'s table);
  - a model with no `/` is `false`.
- Add a server test: a blocked `grok-cli` weekly quota does not put a route using `sopen/...` into `LLM_QUOTA_WAIT`.

## 2. Scene image relevance (problem 2, 2b)

### 2.1 Stronger relevance in `packages/shared/src/visuals/rank.ts`

- Split the scene terms into **entity terms** and **context terms**. Entity terms are the topic's named subject (project topic, `profile`/series name, proper nouns in `visualQueries.primary`). Add an optional `entities: string[]` to the scene/query input. The script stage already has the topic; fill `entities` there with code (capitalised words and the project topic). An LLM may add entities only in the existing scene-planning call, with no new call.
- New rule: `lowRelevance` is true when the keyword score is below `0.34`, **or** when the scene has entities and the candidate matches none of them as a whole word or phrase (title, description, tags, filename).
- A candidate that matches only a common word (`hawk`, `band`, `sword`) and not the entity is low relevance. "Golden Hawks marching band" for "Band of the Hawk (Berserk)" must be low relevance.
- Add a small negative list in code for fan or event photos when the scene is about a fictional work: `cosplay`, `convention`, `con 20`, `fan art`, `costume`, `marching band`. Matching one sets a penalty and `lowRelevance` unless the scene text itself asks for it.
- Keep the existing return shape; add `reasons: string[]` for the UI and the report.

### 2.2 Web search triggers in `visualService.ts`

- Run web search for a scene when **its best candidate** is low relevance, not only when all candidates are.
- Move or repeat the decision after the vision check: when vision rejects the chosen candidate, or its vision score is below the profile threshold, put the scene in the web-search list, still under `webImageSearchSceneCap(budget.webImageSearch)`.
- Order scenes for the cap by worst relevance first.
- When Brave and Gemini grounding are both off or have no key, do not fail. Set a scene warning "Ảnh có thể không đúng chủ đề — bật Brave hoặc tự chọn ảnh" and raise a TASK-059 "Cần bạn" item once per project (not once per scene).
- Record why each web search ran (`reason: "low_relevance" | "vision_reject"`) in the visual stage summary.

### 2.3 Re-search one project

- Add `POST /api/projects/:id/visuals/research` with `{ sceneIds?: string[], reason }`. It reruns search for those scenes (default: scenes flagged low relevance or vision-rejected). It respects budget caps and never runs on a locked or rendering project.
- Add the same as a tool `research_scene_visuals` in the shared tool registry (risk: `write`, not `confirm`), so the assistant, MCP and operator can call it. It is blocked on project `56374fb2-54cf-48ff-9441-2e6c653295d4` only if that project is rendering. Reading is fine.
- A web button "Tìm lại ảnh cho cảnh lệch chủ đề" on the visuals step.

### 2.4 Copyrighted stills (manga, anime, film frames)

Brave results are `unknownWebLicense()` with `licenseVerified: false`, and licence scoring gives them 0. Hermes asked to use real Berserk manga and anime images. Those are copyrighted. Using them can trigger Content ID claims, demonetisation or strikes even in commentary.

- Add a profile setting `visuals.allowCopyrightedStills: "off" | "commentary"`, default `"off"`.
- `"off"`: today's behaviour. Unverified web images can still be picked only when no licensed candidate is relevant, and they get the existing licence warning.
- `"commentary"`: unverified web images are allowed to win on relevance. Each one is marked `usage: "commentary"` in the asset record. The render keeps them on screen for at most 4 seconds per use, and the publish checklist shows "Video có ảnh có bản quyền — rủi ro Content ID" with the count.
- The settings UI explains the risk in plain Vietnamese. The assistant and the operator may not change this setting (add it to the TASK-059 hard-limit list). Only the user changes it.

### 2.5 Tests

- `rank.test.ts`: the three Hermes examples (a Flickr photo with only "Berserk" in tags but a different subject, a cosplay photo, "Golden Hawks marching band") are low relevance for a Berserk "Band of the Hawk" scene. A real match stays relevant.
- `visualService` test with mocked Brave: a vision-rejected scene triggers exactly one Brave call; the cap is respected; worst scenes go first; no key gives a warning and one "Cần bạn" item.
- Setting `"off"` never lets an unverified web image beat a relevant licensed one; `"commentary"` marks usage and the checklist line.

## 3. Background catalog sync and capability detection (problems 3, 4)

### 3.1 Background sync

- New job in the existing scheduler (same style as `omnirouteQuotaSync.ts`): `omnirouteCatalogSync` refreshes the OmniRoute catalog every 15 minutes, and once at startup after 30 seconds. It skips when OmniRoute is not configured and backs off to 60 minutes after 3 failures in a row.
- Keep the 10-minute TTL for on-demand reads, but on-demand reads now return the last good catalog at once and refresh in the background (stale-while-revalidate). A failed refresh never empties the cache.
- On each sync, compute a diff: models added, removed, and capability changes. Store the last diff in memory and write one row to the existing event or notification log when models are added or removed. A route that points at a removed model becomes a TASK-059 supervisor finding (`model_removed`), not a silent failure.

### 3.2 Capability detection

Order, first hit wins, per field (`vision`, `tools`, `jsonMode`, `contextTokens`):

1. A user override in LLM settings (new optional `capabilityOverrides[modelId]`).
2. Fields from the OmniRoute catalog row (today's `inferVision` and any `capabilities` object).
3. The LiteLLM snapshot (see open source), matched by model id with the provider prefix removed.
4. Today's name rules.
5. An optional **probe**: for a model still marked unknown for vision, and only when the user clicks "Kiểm tra khả năng" or the supervisor needs a vision model, send one tiny request with a 1×1 PNG and a fixed question. Mark `vision: true` only on a correct answer. Cache the result for 7 days. The probe counts toward budget and never runs in tests.

- Show the source of each capability in the model list ("từ OmniRoute", "từ bảng LiteLLM", "đã thử", "tự đặt").
- Tests: each step of the order; a catalog row with no fields falls to the snapshot; probe parsing with a mocked provider.

## 4. Quota hot-swap to an equivalent model (problem 5)

Configured fallbacks already work. Add discovery when a route step is blocked by quota and no configured step is free.

- Add `findEquivalentModel(step, catalog, quota, policy)` in `packages/shared/src/llm/` (pure function). Candidate models must:
  - have every capability the stage needs (vision for vision check, tools for tool calls, JSON mode for structured stages, context at least the stage's measured input size);
  - not be blocked by live quota (`quota.ts`, `omnirouteQuotaStore.ts`), with the provider match from section 1;
  - respect the paid-fallback policy and the project budget mode (ECO never moves to a paid model unless the profile pins it);
  - be in the same quality tier or higher (use the tier table from the model advisor; if a model has no tier, treat it as lower).
- Rank by: same family first (e.g. another provider serving the same model id), then tier, then price, then health from `/api/monitoring/model-health` when present.
- In `structured.ts`, when all ordered steps are quota-blocked and the profile has `llm.autoSwapOnQuota` on (new setting, default **on** for autonomy level `supervised` and `autonomous`, **off** for `off`/`assist`), try the best equivalent once. Log the swap in the route log with `reason: "quota_swap"` and the original model. The swap applies to that call only; it never rewrites the user's route.
- If no equivalent exists, keep today's `LLM_QUOTA_WAIT` with `retryAt`. The TASK-059 supervisor `quota_wait` playbook may then suggest a permanent fallback; reuse `findEquivalentModel` there instead of writing a second picker.
- Tests: a vision stage never swaps to a non-vision model; ECO never swaps to paid; a same-model-other-provider swap wins; no candidate keeps `LLM_QUOTA_WAIT` with the same `retryAt`.

## 5. Push events for external agents (problem 6)

### 5.1 Event model

Define one event list in `@vg/shared` (`packages/shared/src/events/agentEvents.ts`), with a zod schema and a version field:

`stage_started`, `stage_finished`, `stage_failed`, `waiting_approval`, `quota_wait`, `budget_wait`, `render_finished`, `published`, `publish_failed`, `needs_user` (TASK-059 "Cần bạn"), `supervisor_finding`.

Payload: `{ id, type, version: 1, at, projectId?, projectTitle?, stage?, gate?, retryAt?, link, summary }`. `summary` is one short Vietnamese line made by code. Emit from the places that already call `safeNotify` and from the orchestrator stage start/finish/fail paths. One emitter (`AgentEventBus`) fans out to SSE, webhooks and the MCP feed.

### 5.2 Outbound webhooks

- Table `webhook_endpoints` (id, name, url, event types, enabled, allow private network, created at, failure count, disabled reason) and `webhook_deliveries` (id, endpoint id, event id, attempt, status code, error, at). Secrets in TokenVault keyed by endpoint id.
- Sign each request by the Standard Webhooks scheme. Headers `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64>`. Timeout 10 seconds. Retry on network error or 5xx/429 after 5 s, 5 min, 30 min, 2 h, 5 h, 10 h. Disable the endpoint after 3 days of failures and raise a "Cần bạn" item.
- Deliveries run in the job worker, never inline in the orchestrator, so a slow receiver can't block the pipeline.
- API: `GET/POST/PATCH/DELETE /api/webhooks`, `POST /api/webhooks/:id/test` (sends a `ping` event), `POST /api/webhooks/:id/rotate-secret` (returns the new secret once), `GET /api/webhooks/:id/deliveries`.
- Web: a "Webhook" card in Settings → Thông báo with add, test, rotate, the delivery log and a short code sample in the user guide for checking the signature.
- No tool in the registry manages webhooks (secrets). Tools may only list endpoint names and status.

### 5.3 Global SSE

- Add `GET /api/events` (all projects) next to the per-project stream, using the same auth as the API. Support `Last-Event-ID` with a ring buffer of the last 500 events, so a client that reconnects gets what it missed.

### 5.4 MCP

- Add tool `get_events({ since?: eventId, types?, projectId?, limit? })` that reads the same ring buffer. This gives agents like Hermes one cheap call instead of polling many endpoints.
- If the MCP SDK version in `apps/mcp` supports resource subscriptions, also expose resource `vg://events` and send `notifications/resources/updated` when new events arrive. If not, say so in the report and keep only `get_events`.

### 5.5 Tests

Signature matches the Standard Webhooks test vector from the spec; retries follow the schedule (fake timers); SSRF guard refuses `https://10.0.0.1`; the secret never appears in API output or logs; `Last-Event-ID` replay; `get_events` filters; a slow webhook does not delay a stage.

## 6. Live check

Run the app with the dev config. Do not use real keys.

1. Create a test project on a fictional-work topic (not `56374fb2-…`). With Brave off, the visual stage shows the relevance warning and one "Cần bạn" item.
2. Point a webhook at a local receiver (`http://127.0.0.1:<port>`, a tiny script in the scratchpad, not in `scripts/`). Run the pipeline to the first gate. The receiver gets `stage_started`, `stage_finished`, `waiting_approval` with valid signatures.
3. Call MCP `get_events` and see the same events.
4. With a mocked OmniRoute catalog, add a model and see the diff entry after a sync.

Write what you saw in `docs/tasks/TASK-060.report.md`.

## 7. User guide

- Visuals page: why images may be off-topic, the re-search button, the copyrighted-stills setting and its risk.
- New page "Kết nối agent bên ngoài": webhooks, global SSE, MCP `get_events`, how to check a signature.
- LLM page: background catalog sync, where capabilities come from, "Kiểm tra khả năng", auto-swap on quota.
- `featureMap` entries for the new routes and the webhook card; `nhat-ky-thay-doi.md` line.

## Done

- [ ] Section 1 tests pass, and no other nullable comparison is left.
- [ ] The three Hermes examples are low relevance; vision rejects lead to web search under the cap.
- [ ] Copyrighted stills default off; only the user can turn them on; the publish checklist warns.
- [ ] Catalog syncs in the background and keeps the last good copy; capability sources are shown.
- [ ] Quota swap never breaks capability, budget mode or paid policy, and is logged.
- [ ] Webhooks are signed, retried, SSRF-guarded, and secrets never leave TokenVault.
- [ ] `GET /api/events` and MCP `get_events` work with replay.
- [ ] All workspaces' tests and typecheck pass; live check written in the report; user guide updated.
- [ ] No commit, no push, no edits to `.env`, `.claude/`, `data/`, `scripts/`, or hand-edited `dist`.
