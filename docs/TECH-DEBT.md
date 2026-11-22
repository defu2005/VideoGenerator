# Technical debt

Each entry is one line: what, `file:line`, risk, deadline (if any). Debt is recorded here and fixed in a later task, not in the task that found it (see the "Delivery first" section of `AGENTS.md`). Dated entries become the next task before their date.

| # | What | Where | Risk | Deadline |
|---|------|-------|------|----------|
| 1 | File GC marks `render/compose-plan.json` as unreferenced. Readers return 404 (`COMPOSE_PLAN_MISSING`) when it is missing, and the preview rebuilds it from the timeline. The plan is not a regenerable cache: it holds user shot edits (kind, reroll, locked). Fix: protect the file from GC, or reference it from the DB. | `apps/server/src/storage/references.ts`, `apps/server/src/api/render.ts:91`, `apps/server/src/registry/tools/system.ts:100` | Low now: the four affected plans have zero user edits, and backups are in `videoGenerator-backups`. Re-created on the next render. Rises once users edit shots. | First purge 2026-11-30 (`1ef6de1f`, `ecd9c862`). `5e81276c` and `b1ca31b8` follow 14 days after the first sweep. |
| 2 | TASK-146 outline reopen is not built. The spec asks for it. | `docs/cursor/TASK-146.md:95` | Medium: the outline the spec asks for is missing from the shipped feature. | None |
| 3 | `capSec` limit in the beat motion code. | `packages/shared/src/motion/beatMotion.ts:24-55` | Risk not assessed: this row was written without reading the code. A fixed cap may clip long beats. | None |
