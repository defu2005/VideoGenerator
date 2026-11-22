# Technical debt

Each entry is one line: what, `file:line`, risk, deadline (if any). Debt is recorded here and fixed in a later task, not in the task that found it (see the "Delivery first" section of `AGENTS.md`). Dated entries become the next task before their date.

| # | What | Where | Risk | Deadline |
|---|------|-------|------|----------|
| 1 | File GC marks `render/compose-plan.json` as unreferenced. Readers return 404 (`COMPOSE_PLAN_MISSING`) when it is missing, and the preview rebuilds it from the timeline. The plan is not a regenerable cache: it holds user shot edits (kind, reroll, locked). Fix: protect the file from GC, or reference it from the DB. | `apps/server/src/storage/references.ts`, `apps/server/src/api/render.ts:91`, `apps/server/src/registry/tools/system.ts:100` | Low now: the four affected plans have zero user edits, and backups are in `videoGenerator-backups`. Re-created on the next render. Rises once users edit shots. | First purge 2026-11-30 (`1ef6de1f`, `ecd9c862`). `5e81276c` and `b1ca31b8` follow 14 days after the first sweep. |
