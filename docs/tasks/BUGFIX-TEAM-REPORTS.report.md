# BUGFIX-TEAM-REPORTS report

## What changed
**Bug 1 — monthly_reports per workspace**
- `apps/server/src/db/schema.ts`: `workspace_id` NOT NULL, PK `(workspace_id, month)`; the old workspace index is gone (the PK covers it).
- `apps/server/drizzle/0069_monthly_reports_backfill.sql` (made with `drizzle-kit generate --custom`): NULL rows go to the oldest organization (same rule as `defaultWorkspaceId`); if none exists they are deleted (reports are rebuilt on demand, noted in the SQL).
- `apps/server/drizzle/0070_long_the_twelve.sql` (drizzle-kit generated): recreates the table and copies all 4 columns. A third `generate` prints "No schema changes". Snapshots and journal are drizzle-kit output.
- `apps/server/src/finance/financeService.ts`: upsert is `ON CONFLICT(workspace_id, month)`. The three reads already use `scopeSql`.
- Tests: new `apps/server/test/monthlyReportsWorkspace.test.ts` (two workspaces, rebuild touches only its own row, NULL rejected, backfill SQL with and without an organization).

**Bug 2 — service key revoke**
- `apps/server/src/auth/teamRoutes.ts`: `canRevokeKey` (owner: any key; admin: only their own, never `local-services`). List returns `canRevoke`. DELETE returns 403 `FORBIDDEN` with a Vietnamese message and writes an audit row `apikey.revoke_denied` (outcome `denied`). `auditTeam` gained an optional `outcome`.
- Restart behaviour: `ensureLocalServiceKey` verifies the stored key and creates a new one when it is disabled, so a restart does recreate it. The existing UI warning now says so.
- `apps/web/src/services/teamApi.ts` (`canRevoke` on `ServiceKey`), `apps/web/src/features/team/ServiceKeysCard.tsx` (hides the button when `canRevoke` is false).
- Tests: `apps/server/test/team.test.ts` (admin → owner key 403, admin → local key 403, admin own key 200, owner → admin key 200, `canRevoke` per viewer, denied audit rows); `apps/web/src/features/team/team116.test.tsx` (button hidden).

**Docs:** `docs/user-guide/khong-gian-va-quyen.md`, `docs/user-guide/nhat-ky-thay-doi.md`.

## Other tables with a global key plus ON CONFLICT (not fixed)
- `payout_thresholds` `ON CONFLICT(account_id)`: account ids are unique uuids, so it is already per workspace in practice.
- `agents` `ON CONFLICT(kind, name, environment)` (`agents_identity_uq`) and `knowledge_entries` `ON CONFLICT(id)`: global keys on tables that have `workspace_id`. Different workspaces using the same agent identity or entry id would collide. Fixing needs a schema/index change, so I left both for a follow-up.
- `revenue_entries` unique `(source, external_key)`: could collide if two workspaces sync the same external video. Unlikely, also left.

## Deviations
- `apps/server/test/finance.test.ts` (monthly report test): now seeds one `organization` row, because `workspace_id` is NOT NULL and the test DB had no workspace. A real install always has one.

## Tests
- `npm run typecheck`: passes.
- Web: 70 files, 195 tests pass.
- Server: the full run had 52 failures in 32 files, caused by machine load and timeouts (the whole run took very long). Those 32 files were rerun alone with fewer workers and all pass (421 tests). The one real failure, the finance test above, was fixed. Full run counts were 1010 passed, 23 skipped.
- Shared and mcp: not changed, not rerun. `npm run build` completed in an earlier run.
- Not done: no browser check of the Team page (covered by the web test only).
