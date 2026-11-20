# TASK-150 — Three small fixes: compose sidecar, inbox self-messages, worker HEALTHCHECK

**Who:** the implementer the user hands it to. **Size:** S. **New dependency:** none. **Migration:** none. Do not touch `data/app.db`.

These are the user-decision items the advisor ruled on 2026-11-19. Item A was revised the same day after a code check (see A). The rest of the rulings are final for this guide.

## A. Keep the plan sidecar in `editSavedComposeShot` (ruling REVISED 2026-11-19; TESTS ONLY, no product change)

- Facts: `preview/planSource.ts:127` reuses the saved plan only when `readPlanInputs(renderDir) === fingerprint`. A missing sidecar means "no valid saved plan", so preview re-plans (`planSource.ts:129–131`) and the user's manual shot edit is lost.
- Facts: `editSavedComposeShot` (`apps/server/src/services/composeBridge.ts:489`) changes the plan, not the inputs that the fingerprint covers. The sidecar stays correct, so it must stay.
- Facts: the sidecar is cleared and rewritten only when a plan is regenerated: `composeBridge.ts:220` (clear, then write plan) and `renderService.ts:747` (clear, write plan, `writePlanInputs`).
- Ruling: do NOT clear the sidecar in `editSavedComposeShot`. Leave its write order unchanged. The earlier ruling (clear first, same as `composeBridge.ts:220`) was wrong because it ignores the reader above.
- Test: after `editSavedComposeShot`, (1) the sidecar still exists and still equals the current fingerprint; (2) `planSource` returns the edited shot and does not add the re-plan note. Add one test pinning the reader: a missing sidecar causes a re-plan.

## B. `inbox()` excludes the reader's own role-addressed messages

- Facts: `inbox()` (`apps/server/src/supervision/mailbox.ts:128`) has no sender exclusion. `toRow` maps `from_instance` to `fromInstance` (`mailbox.ts:35`), and the insert stores `from_instance` (`mailbox.ts:113`), so the sender is stored.
- Ruling: in `inbox()`, drop a row when `row.fromInstance === instance` AND the row is addressed to a role (the `toKind` value used for duty; read the mailbox code for the exact string, do not guess it). Keep direct messages addressed to the reader's own instance.
- Test: re-pin `apps/server/test/dutySelfReport.test.ts`. Its header says "Documents current behaviour"; change it to expect that the duty holder's own report is NOT returned. Add a second case: a direct message from self to self IS still returned.

## C. Worker HEALTHCHECK is role-aware, with no new listener

- Facts: `apps/server/src/index.ts` with `VG_ROLE=worker` runs `runWorkerAgent()` and exits before `app.listen`, so the worker serves no HTTP. The Dockerfile HEALTHCHECK (`deploy/docker/Dockerfile:187–188`) only fetches `http://127.0.0.1:${PORT}/api/health`, so it always fails for a worker container run directly with `docker run`. `deploy/docker/compose.worker.yml` already sets `healthcheck: disable: true`, so the compose path is unaffected.
- Facts: the worker heartbeat (`apps/server/src/node/agent.ts`, loop at about 356–396) defaults to `heartbeatMs = 15_000` (`agent.ts:175`). The data dir is `DATA_DIR`, default `./data` (`agent.ts:171`). The image sets `DATA_DIR=/data` (`deploy/docker/Dockerfile:113`), and `compose.worker.yml:16` sets it too. `VOLUME /data` at `Dockerfile:184`.
- The liveness file does not exist until the first successful heartbeat. The implementer must check that `--start-period=40s` (`Dockerfile:187`) covers registration and the render probe; if it does not, the start period must grow, and the report must say by how much.
- Ruling: after each successful heartbeat (the `if (!response.ok) throw` at about `agent.ts:376` passes), write `${DATA_DIR}/worker-alive` containing a timestamp. Replace the Dockerfile HEALTHCHECK with a role-aware command: when `VG_ROLE=worker`, pass only if that file's mtime is under 60 seconds old (4× the 15 s heartbeat); otherwise keep the existing `/api/health` check. No new listener.
- Accepted consequence: if the control plane is unreachable, heartbeats fail, the file goes stale, and the container reports unhealthy. This is intended. Say so in the Dockerfile comment and in the runbook.
- Test: a unit test for the liveness write after a successful heartbeat (inject the fake clock through `heartbeatMs` / the existing deps), and no write after a failed one.
- The write must not fail the heartbeat if the directory is missing: catch and log, as the existing `warmProjects.prune` call does (`agent.ts:393`).

## Attachments (closed, no guide)

No sender passes `attachments` with a meaning today (grep 2026-11-19: `apps/mcp/src`, `apps/server/src/api`, `apps/server/src/assistant`, `apps/server/src/node` have none). The only check is the length and count check in `supervision/mailbox.ts:276`. Decision: format check only until a sender exists. No guide.

## Tests and check

- Run only the new or changed test files, then `tsc --noEmit` in `apps/server`. Do not run the full suite for this step.

## Mã nguồn mở có sẵn (open source)

Không cần thư viện ngoài. Dùng `fs` của Node cho file liveness; dùng lại logic sẵn có trong `apps/server/src/compose/planInputs.ts` cho sidecar; dùng `inbox()` và kiểu tin sẵn có trong `supervision/mailbox.ts`.

## Done when

- A, B and C each have passing tests and a file:line in the report.
- `tsc --noEmit` exits 0.
- Dispatch is the user's step under their 2026-11-17 rule; this guide is not dispatched by Claude.
