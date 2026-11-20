# TASK-143 — Control plane resilience: SQLite under load, restore drill, two-machine check 🛡🗃

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`; mostly measurement and small fixes). **Size:** M. **Migration:** none. **New dependency:** none.
**Depends on:** 137 (storage provider, so files are not only on the control disk), 129b (governor). It may run beside 129a/129c if it does not edit `fleet/*` or placement.
**Source:** [SCALE-PLAN.md](SCALE-PLAN.md) row 10 (single SQLite and single control plane).

## Why

- One control server with one SQLite file holds every project, job, lease, usage row and audit entry.
- With many workers, agents and the relay (136) writing at once, write contention (`SQLITE_BUSY`) and slow hot queries become the next limit. Nobody measures them today.
- Litestream is configured in `deploy/docker/litestream.yml`, but a restore has never been tested. A backup that was never restored is not a backup.
- No real run with a second machine has been checked end to end after 134/135a.
- Moving to Postgres is out of scope (see SCALE-PLAN "không làm"). This task makes SQLite measurable and safe, and says with numbers when it would stop being enough.

## Read first

- `apps/server/src/db/*` (connection, pragmas: `journal_mode`, `busy_timeout`, `synchronous`), `jobs/jobRepository.ts`, `jobs/worker.ts`, `node/leaseService.ts` heartbeats, `services/usageService.ts`, audit writes.
- `deploy/docker/litestream.yml`, `entrypoint.sh`, `compose.control.yml`, `deploy/README.md`.
- `/api/health` and metrics if present.

## Build

### 1. Measure

- Wrap the DB handle with a light timer (code, no dependency): per statement name (prepared statement key), count, p50/p95/max ms, `SQLITE_BUSY` retries.
- Expose `GET /api/admin/db-stats` (settings permission) and a small "Cơ sở dữ liệu" card in Settings → Hệ thống: top 10 slow statements, busy count, DB and WAL size, last checkpoint.
- A load script under `apps/server/test/load/` (not in the normal suite; run with an env flag): N fake nodes heartbeating, M relay calls writing usage, the worker claiming jobs. Report p95 and busy counts in the task report for N = 5, 20, 50.

### 2. Fix the hot writes found

- Expected candidates (confirm with numbers first):
  - node heartbeats and lease renewals: coalesce into one write per node per interval, skip unchanged rows;
  - relay and LLM usage rows: buffer in memory and flush in one transaction every 1–2 s (flush on shutdown);
  - audit and log rows: same batching.
- Pragmas: confirm WAL, `busy_timeout` ≥ 5000, `synchronous=NORMAL`, periodic `wal_checkpoint(TRUNCATE)` when the WAL grows over a size limit.
- Every change must keep tests and behaviour the same; batching must not lose rows on a clean shutdown (test it).

### 3. Startup checks and restore drill

- Startup: `PRAGMA quick_check` (fast) and a warning when it fails; log the Litestream status when the env is set.
- `deploy/README.md` "Khôi phục": the exact restore commands for Litestream to a fresh volume, then start the control container on it.
- A script `deploy/docker/restore-drill.sh` (not under `scripts/`): restore the latest replica into a temp dir, open it read-only, run `quick_check`, count rows of the main tables, print the replica lag. Document running it weekly.
- Run the drill once against a local MinIO or file replica and paste the output in the report.

### 4. Two-machine checklist

- `docs/RUNBOOK-two-machines.md`: control + one worker (Docker `compose.worker.yml`) + one Hermes (`compose.hermes.yml`) using the 136 relay:
  - setup steps, what each machine needs (only `VG_API_URL` and its key);
  - a scripted smoke: create a test project (never the protected one), run to RENDER on the worker, check the lease, uploads, relay usage and the finalize claim;
  - failure drills: kill the worker mid-render (lease expires and the job retries), cut the network for 2 min (resume upload from 134), restart control during a lease.
- Run what can be run on the user's machine (two containers on one host count) and record results; mark what needs real hardware as "chưa chạy".

### 5. Limits written down

- In `docs/ARCHITECTURE.md`, a short "Giới hạn đo được" section: measured writes per second, the node count where p95 crosses 50 ms, and the signals that would mean it is time to move off SQLite.

## Mã nguồn mở có sẵn (open source)

- **Litestream** (Apache-2.0, already used): restore and replica checks.
- **better-sqlite3** docs: WAL and checkpoint advice.
- **LiteFS / rqlite**: not adopted; mention only in the limits section.

## Rules

- README rules 1–11. No migration. Do not touch `scripts/` or `data/`.
- The load test never runs in the normal suite and never uses the network.
- Never use the protected project `56374fb2-…` in drills.

## Tests

- Stats wrapper counts and times statements; busy retries counted.
- Batched usage and audit rows are all written after a clean shutdown; a crash test shows the documented maximum loss window.
- Heartbeat coalescing: unchanged heartbeats do not write; a state change writes at once.
- `quick_check` failure at startup gives a warning, not a crash.

## Done

- [ ] DB stats + card; load script with numbers in the report
- [ ] hot-write fixes backed by numbers; pragmas; checkpoint
- [ ] startup checks; restore drill script + README; drill output in the report
- [ ] two-machine runbook; what was run and what was not
- [ ] limits section in ARCHITECTURE; changelog
- [ ] tests; server suite; typecheck; build
- [ ] report → `docs/tasks/TASK-143.done`
