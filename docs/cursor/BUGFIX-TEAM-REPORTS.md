# BUGFIX-TEAM-REPORTS — monthly reports per workspace, and admins cannot revoke an owner's keys 🩹

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`). **Size:** S. **Migration:** yes. Generate it only with drizzle-kit, as described below. **New dependency:** none.

Two small bugs found while reviewing TASK-115 and TASK-116.

## Bug 1 — `monthly_reports` is shared across workspaces (data leak + overwrite)

**Now:**
- `apps/server/src/db/schema.ts` ~1009: `monthly_reports` has `month` as the **only** primary key. TASK-115 (migration 0067) added a nullable `workspace_id`.
- `apps/server/src/finance/financeService.ts` ~694 writes with `ON CONFLICT(month) DO UPDATE SET json = ..., created_at = ...`.
- So when workspace B builds its report for a month that workspace A already has, B's numbers overwrite A's row. The row keeps A's `workspace_id`, which means **A now sees B's report**, and B's read (`WHERE month = ? AND workspace_id = B`) finds nothing.

**Fix:**
1. In the schema, `workspaceId` becomes `.notNull()` and the primary key becomes composite `(workspace_id, month)`, using drizzle's `primaryKey({ columns: [...] })` in the table callback. Keep the `monthly_reports_workspace_idx` index only if it still helps; the composite PK already covers lookups by workspace.
2. Migrations, both made with drizzle-kit (never hand-create a migration file):
   - First run `npx drizzle-kit generate --custom --name monthly_reports_backfill` in `apps/server`. This creates an empty migration that drizzle-kit tracks. Fill it with a backfill **before** the table change:
     - set `workspace_id` on rows where it is NULL to the default workspace, using the same rule as the startup backfill in `apps/server/src/auth/workspaces.ts`, which lists `monthly_reports`. Read that file and use the same choice, usually the oldest `organization`;
     - if no organization exists, delete the NULL rows. Reports are rebuilt from revenue and cost data on demand; say so in a SQL comment.
   - Then run `npx drizzle-kit generate` for the schema change. drizzle-kit will recreate the table and copy the rows; check the generated SQL copies every column.
   - Run `npx drizzle-kit generate` once more and expect "No schema changes".
3. In `financeService.ts`, change the upsert to `ON CONFLICT(workspace_id, month) DO UPDATE ...`. Check every other `monthly_reports` statement: they must all filter by workspace (the reads at ~591, ~607 and ~621 already use `scopeSql`).
4. Grep for any other table from the `workspaces.ts` list that also has a global PK or unique index plus `ON CONFLICT` on that key. List what you find in the report. Fix only `monthly_reports` here, unless another one is the same one-line pattern; then fix it too and say so.

**Tests** (add them to the existing finance test file, or create `apps/server/test/monthlyReportsWorkspace.test.ts`):
- two workspaces build reports for the same month, and each reads back its own numbers;
- rebuilding a workspace's report updates only that workspace's row;
- a migrated DB with a legacy NULL `workspace_id` row ends up with the default workspace. If a migration test helper exists, use it; if none exists, cover the backfill SQL logic in a small unit test instead.

## Bug 2 — an admin can revoke the owner's keys, including the local service key

**Now:** in `apps/server/src/auth/teamRoutes.ts` ~331, `DELETE /api/workspace/service-keys/:id` allows any key whose holder is an owner or admin. An admin can therefore disable the **owner's** keys, including the local service key (`LOCAL_SERVICE_KEY_NAME`). MCP, the operator and Hermes use that key, so all of them lose access. The list route ~308 shows those keys to admins with no limit.

**Fix:**
- An admin may revoke only their **own** keys. The owner may revoke any key in the workspace.
- The local service key can be revoked only by an owner. The UI must warn that MCP, the operator and Hermes will stop working until the server restarts and recreates the key. Check `ensureLocalServiceKey`; if a restart does not recreate a *disabled* key, say what does and put that in the warning text.
- Return 403 `FORBIDDEN` with a clear Vietnamese message.
- In the list response, add `canRevoke: boolean` per key, computed on the server. The web list (`apps/web/src/features/team/` or `account/`, wherever the service-key list is) hides the revoke button when `canRevoke` is false. The server still decides.
- Audit the refused attempt the same way other refused team actions are audited, if there is such a pattern; if not, skip that.

**Tests** in `apps/server/test/team.test.ts`:
- an admin revoking the owner's key gets 403;
- an admin revoking the local service key gets 403;
- an admin revoking their own key gets 200;
- the owner revoking the admin's key gets 200;
- `canRevoke` is right for each viewer.

Add a web test if the button logic is not trivial.

## Mã nguồn mở có sẵn (open source)

- Nothing new to adopt. drizzle-kit (already used) supports composite primary keys (`primaryKey({ columns })`) and `generate --custom` for data migrations; see the drizzle-kit docs. Better Auth's api-key plugin (already used) owns the `apikey` table; do not change its schema.

## Rules

- AGENTS.md rules: no commit or push; do not touch `.env`, `.claude/`, `data/` or `scripts/`; no `npm install`. Never hand-write a migration file; use drizzle-kit as above.
- Do not loosen `registry/policy.ts`, the guard or the TASK-059 hard limits.
- Run the root typecheck, the server suite (rerun any file that fails alone before calling it a failure) and the web suite.
- Update `docs/user-guide/khong-gian-va-quyen.md` (who can revoke which key) and add a changelog bullet in `nhat-ky-thay-doi.md`.

## Done

- [ ] composite PK + backfill, two drizzle-kit migrations, a third generate prints "No schema changes"
- [ ] upsert keyed by workspace; the two-workspace test passes
- [ ] key revoke rules + `canRevoke` + UI + tests
- [ ] user guide + changelog
- [ ] typecheck, server and web suites
- [ ] report `docs/tasks/BUGFIX-TEAM-REPORTS.report.md`, then create `docs/tasks/BUGFIX-TEAM-REPORTS.done`
