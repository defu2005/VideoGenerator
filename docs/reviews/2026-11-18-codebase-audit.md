# Codebase audit: server structure (read-only), 2026-11-18

**Scope:** server structure only (`apps/server/src`). Web, mcp, shared and dead-code analysis are not covered.
**Method:** read-only. Import graph parsed with a scratch script (no new dependencies). Strongly connected components via Tarjan, `import type` skipped. No source edited, no git write command, no install run.
**Tree state:** `dev` checkout with uncommitted work from in-flight tasks. Those files are not a clean baseline.

## 1. Measured numbers

| Signal | Value | How |
|---|---|---|
| Server source files (`apps/server/src/**/*.ts`) | 526 | `find` (tests live in `apps/server/test`, not counted) |
| Cross-app import violations (shared→app, web→server, server→web, mcp→server) | 0 | import scan |
| Import cycle clusters (non-trivial SCCs, runtime imports only) | **2 clusters, 9 and 3 files, 12 files total** | Tarjan |
| Route registrations in `app.ts` | 67 calls to `register*Routes(...)`; 63 files in `api/` | grep |
| Migrations | 88 journal entries = 88 `.sql`; last `0087_right_catseye` | journal vs disk |
| Explicit `any` | 31 across all four workspaces | regex |
| TODO/FIXME | 2 | regex |
| NUL bytes in .ts/.tsx | 0 | grep |

### 1a. Largest server files now

| File | Lines now | TASK-085 guide | ARCHITECTURE-TARGET §7 |
|---|---|---|---|
| `apps/server/src/services/visualService.ts` | 3 712 | ~3 380 | 3 017 |
| `apps/server/src/db/schema.ts` | 2 284 | ~1 930 | 1 601 |
| `apps/server/src/assistant/tools.ts` | 2 272 | ~2 100 | 2 028 |
| `apps/server/src/operator/service.ts` | 1 629 | not listed | 1 560 |
| `apps/server/src/services/renderService.ts` | 1 347 | not listed | 1 323 |

All three sources disagree with each other on line counts. Use `wc -l` at dispatch time, not any quoted number.

## 2. Findings

### F1. Two import-cycle clusters (medium payoff, medium risk)
- **Cluster A (9 files):** `assistant/tools.ts`, `fleet/service.ts`, `fleet/toolDefs.ts`, `operator/skillEval.ts`, `operator/skillVersions.ts`, `registry/catalog.ts`, `settings/notifications.ts`, `supervision/snapshot.ts`, `supervision/toolDefs.ts`.
- **Cluster B (3 files):** `auth/auditLog.ts`, `auth/guard.ts`, `registry/audit.ts`.

Cluster A is the important one. The tool hub `assistant/tools.ts` sits inside it, so adding tools to that file can change load order. The cycle path goes through `fleet/service.ts` and `settings/notifications.ts`, not a direct two-file import.

Cluster B is separate from the `db/` files. An earlier path `db/client.ts → db/stats.ts → auth/auditLog.ts` is not a cycle; it only leads into cluster B. `db/stats.ts` appears in the TASK-143 report, which is in-flight review work.

Count note: an earlier pass listed 30 cycles. That was an artifact of a DFS back-edge count with a cap. The correct figure is the two clusters above.

### F2. Oversized files (high payoff, high collision risk)
`visualService.ts` (3 712), `db/schema.ts` (2 284), `assistant/tools.ts` (2 272). Already scoped in TASK-085 and ARCHITECTURE-TARGET §7 (table row "Tách hoặc refactor"). No new plan needed; use the target doc's own line counts only as a rough guide.

### F3. Target layout already exists (fact, not a finding)
`docs/ARCHITECTURE-TARGET.md` §7 lists the planned splits: `visuals/`, `registry/tools/<nhóm>.ts`, `db/schema/<miền>.ts`, `operator/service.ts` (only when 074 touches it), `render/legacy` vs `render/compose` (after compose is default), `lab/` consolidation. The restructure below extends that section. It does not supersede it.

### F4. Folder layout drift (low payoff)
`apps/server/src` has 50 top-level entries (directories and files). Several are 1–3 files. `ARCHITECTURE-TARGET` §7 does not mention many of them. Consolidate per folder only after R2 (no folder moves before the big splits land).

### F5. Docs drift (zero risk, quick)
- `docs/cursor/README.md:266` says dev is "API on 3001, web on 5180". Evidence is mixed: `apps/web/vite.config.ts:11` sets `port: 5173` with strictPort; `.claude/launch.json` and the server default `WEB_BASE_URL` (`apps/server/src/lib/config.ts:59`) use 5180. The README is not simply wrong. It conflates the dev server port with the preview/launch port. Fix the line to name both.
- `docs/cursor/README.md:268` test counts frozen at "after TASK-017". Refresh or label as historical.
- `docs/cursor/TASK-085.md` size table is stale (see §1a).

### F6. Type safety (low payoff)
31 `any` occurrences. Densest: `retrieval/indexer.ts` (15), `operator/runtime.ts` (4), `api/retrieval.ts` (3). Fix when those files are touched for other reasons.

### F7. Working tree is not a clean baseline (blocker for any move)
The session-start status lists 357 modified or untracked files. Verified from that status: `assistant/tools.ts`, `fleet/service.ts`, `auth/auditLog.ts`, `auth/guard.ts`, `db/client.ts`, `operator/skills.ts`, `pipeline/orchestrator.ts` are all modified. These are exactly the files in cluster A and B.

Owners in flight (from `tmp/opencode-shared-rules.md`, read at this turn):
- TASK-145 (script engine): owns script service/API/UI; migration 0087 generated and frozen.
- TASK-147a (stage adapters): `stageService.ts`, `assignments.ts`, `stageAdapters/*`. Awaiting review.
- TASK-143 (db resilience): db client/stats/checkpoint, `auditLog`, `orchestrator` usage batching. Awaiting review. Owns `db/stats.ts`.
- TASK-138/139 (storage/preview GC): `storage/references.ts`, `storage/fileGc.ts`, `preview/*`. Fix2 in progress.
- TASK-141 (continuity, opencode takeover): `continuity/*`, `scenePlanExecutor`, `sceneService`, `visualService`, `visualSearchExecutor`, `agents/visualToolkit.ts`.

The rules file also says only workers relaunched by Codex are active. Check the live process list before editing any file in §3.

Consequence: a behaviour-preserving move cannot be verified against a clean baseline until these tasks are accepted and committed. Committing is the user's call (TASK-080 says so).

## 3. Restructure, sequenced

Each row extends an existing guide or target section. Order is fixed: move-only work before cycle work, because TASK-085 is move-only and must not mix with behaviour edits.

| Step | Work | Extends | File boundary | Gate |
|---|---|---|---|---|
| R0 | Fix README port and test-count lines (F5) | `docs/cursor/README.md` | README only | none (but the supervising agent edits README; coordinate) |
| R1 | TASK-085 split: `db/schema/`, `registry/tools/`, `visuals/` | TASK-085, ARCHITECTURE-TARGET §7 | the three big files and their new folders | after TASK-080 commit; runs alone |
| R2 | Break cluster A through the tool hub: move shared types/ports out of `fleet/`, `supervision/`, `settings/notifications.ts` into a leaf module | new guide (next free number) | cluster A files only | after R1, after 147a, 141, 143 are accepted |
| R3 | Break cluster B: `auth/auditLog.ts`, `auth/guard.ts`, `registry/audit.ts` | new guide | auth + registry audit only | after 143 is accepted (it touches `auditLog`) |
| R4 | Folder consolidation (F4), decided per folder | new guide | server `src/` layout | after R1–R3 |
| R5 | `any` cleanup in `retrieval/indexer.ts`, `operator/runtime.ts`, `api/retrieval.ts` (F6) | none | those three files | when touched for other reasons |

Note: R1 is not "new". It is TASK-085 as already written. Dispatch it as is, with the corrected line counts from §1a.

## 4. Decision needed

- Does this session apply R0–R5 itself, or write guides for the implementer?
- Does the user commit the accepted in-flight tasks (138, 139, 143, 145, 147a) before R1?
