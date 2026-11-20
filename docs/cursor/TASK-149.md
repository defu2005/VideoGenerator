# TASK-149 — Publishers for `budget_wait` and `needs_user` (TASK-060 §5.1) 🔔

**Who:** the implementer the user hands it to (Codex, or Sonnet 5.5 / Cursor `grok-4.7-xhigh`). **Size:** S. **New dependency:** none.
**Migration:** none. Do not touch `data/app.db`.

**Source:** TASK-060 §5.1 requires both types (`docs/cursor/TASK-060.md:139`). `packages/shared/src/events/agentEvents.ts` declares them. Neither has a publisher in `apps/server/src` (grep 2026-11-19).

## Facts checked before writing (2026-11-19)

- `AgentEventSchema` (`packages/shared/src/events/agentEvents.ts:63`) is `.strict()` with fields `id, type, version, at, projectId?, projectTitle?, stage?, gate?, retryAt?, link, summary`. There is NO `profileId`, `kind` or `title`. Send only `type`, `summary`, `link` (and `projectId` only if the publisher has one).
- `publishAgentEvent(input, { workspaceId })` (`apps/server/src/events/agentBus.ts:11–14`). Without `link`, it defaults to `/` (`agentBus.ts:20`).
- `publishAgentEvent` calls every subscriber in a plain loop with no try/catch (`apps/server/src/events/agentBus.ts:25`). The webhook subscriber guards itself (`apps/server/src/app.ts:927–935`). The SSE subscriber does not (`apps/server/src/api/agentEvents.ts:55–58`). A throwing subscriber would therefore reach the publisher. Fact, not yet fixed: the loop has no isolation. Do not change `agentBus.ts` in this task; guard at the publisher instead.
- Workspace for a profile: `publishFindingOpened` (`apps/server/src/operator/findingEvents.ts:18–25`) reads `profiles.workspace_id`, falls back to `defaultWorkspaceId(db)`, and uses no workspace when the profile is null. Reuse exactly that rule; extract it into a shared helper rather than copying it.
- Gate for `budget_stop`: in the `scope` loop of `apps/server/src/operator/autonomyBudget.ts`, the insert is `if (insert.run(...).changes)` (about line 168). Right after it, `findings.push(...)` and `publishFindingOpened(db, ...)` (about lines 175–176) already run, so `supervisor_finding` is published there today. Do not replace that call.
- `findings` entries carry no `stop` flag today. Add `stop: boolean` to the entry, or compute `kind === "budget_stop"` at the push site.
- `createUserRequest` (`apps/server/src/operator/autopilot.ts:149`) has THREE exits that do not write a new `operator_requests` row. None may publish `needs_user`:
  1. Dedupe hit, lines 166–167: `return { id, created: false }`.
  2. Hermes branch, lines 202–217: `openEscalation(...)` then `return { id: esc.id, created: true }`. No `operator_requests` row. Escalation is a separate event path, not `needs_user`.
  3. `QUESTION_CAP` throw: `AppError(429)` before the INSERT.
- The only publish point is AFTER the INSERT (`INSERT INTO operator_requests`, about line 230) and before the final `return { id, created: true }`.
- Callers of `createUserRequest` (11 call sites): `api/autonomy.ts:122`, `assistant/tools.ts:1004, 1021, 1039, 1155, 1646`, `events/webhooks.ts:171`, `operator/qualityGates.ts:303`, `operator/qualityRepair.ts:651`, `providerIntel/toolDefs.ts:181`, `services/visualPolicy.ts:70, 84`. None of those files contains `.transaction(`. That does not prove the outer chain is outside a transaction, so the implementer must check it with a test that asserts `sqlite.inTransaction === false` at publish time (the same check the Telegram burst test uses).

## What to build

### 1. `budget_wait` (only for `budget_stop`)

- In the `scope` loop of `autonomyBudget.ts`, right after `publishFindingOpened(...)`, when `stop` is true, call `publishAgentEvent({ type: "budget_wait", summary, link: "/" }, { workspaceId })`.
- `workspaceId` comes from the shared helper above, with the same profile/null rule as `publishFindingOpened`.
- `summary` must name the scope, since there is no profile field. Use `Ngân sách kênh đã đạt 100% hạn mức (<trong ngày|trong tháng>)` for a profile, and `Ngân sách toàn ứng dụng đã đạt 100% hạn mức (<trong ngày|trong tháng>)` when `profileId` is null. No ids, no amounts beyond what the existing message shows, no secrets.
- Emit NOTHING for `budget_warn` (80%). That stays a `supervisor_finding` only.
- Keep `supervisor_finding` as it is. `budget_wait` is an added signal, not a replacement.

### 2. `needs_user` (only on a new row)

- Publish in `createUserRequest` AFTER the INSERT, before `return { id, created: true }`. Do not publish on any of the three exits above.
- `workspaceId`: the same profile/null rule, from `input.profileId`. Do not add a workspace parameter; the function already has `profileId`.
- `summary`: `[kênh]` or `[toàn ứng dụng]` prefix, then `input.title`, the whole string cut to 200 characters. `whyVi` is NOT sent.
- `link`: `input.actionUrl`. It is required in the input, so pass it through.
- Guard: wrap EACH new publish (`budget_wait` in `autonomyBudget.ts`, `needs_user` in `autopilot.ts`) in try/catch and log it. A failing listener must not change the return value of `createUserRequest` and must not skip the remaining scopes of the budget loop.
- `kind` is not a field. If the implementer wants it visible, it may go into `summary`; the default is to leave it out.

## Tests

New file `apps/server/test/budgetNeedsUserEvents.test.ts`. Use `TEST_WORKSPACE_ID` and `TEST_OTHER_WORKSPACE_ID` from `test/testActor.ts`.

- `budget_wait`:
  - crossing 100% publishes exactly one `budget_wait`;
  - a repeat with the same key publishes none (the dedupe key is `budget_stop:<scope>:<period>`);
  - 80% (`budget_warn`) publishes none, and `supervisor_finding` still publishes;
  - `workspaceId` matches the profile's workspace; a null profile uses no workspace filter.
- `needs_user`:
  - a new row publishes exactly once;
  - a dedupe hit (same `dedupeKey`, row still open) publishes none;
  - the QUESTION_CAP throw publishes none;
  - the Hermes-escalation branch publishes none (set Hermes on duty in the test);
  - `summary` is at most 200 characters and contains no key or token text.
- Throwing subscriber: `publishFindingOpened` has no try/catch (`apps/server/src/operator/findingEvents.ts:18–25`), so the test listener must throw ONLY for `budget_wait` and `needs_user`, never for `supervisor_finding`. Then `createUserRequest` still returns `{ id, created: true }`, the row exists, and the other budget scopes still run.
- Transaction check: publish runs with `sqlite.inTransaction === false` at the publish point, for `createUserRequest` and for the budget path.

Run the new file alone, then `tsc --noEmit` in `apps/server`. Do not run the full suite for this step.

## Mã nguồn mở có sẵn (open source)

Không cần thư viện ngoài. Dùng `publishAgentEvent` (`apps/server/src/events/agentBus.ts`) và helper trong `operator/findingEvents.ts`.

## Done when

- Both types have a publisher with file:line in the report.
- The tests above pass, and `tsc --noEmit` exits 0.
- The PROPOSALS_AND_BUGS.md entry "publisher" is marked resolved and points at this guide.
- Dispatch is the user's step under their 2026-11-17 rule; this guide is not dispatched by Claude.
