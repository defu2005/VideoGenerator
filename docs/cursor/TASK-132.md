# TASK-132 — Workspace scoping: global keys on workspace tables, API keys bound to a workspace 🏢

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`; data migration, rate it hard). **Size:** M. **Migration:** one (drizzle-kit only). **New dependency:** none.
**Depends on:** the migration slot. Run it alone among migration tasks (not beside 122, 128a/b, 129a/c).
**Source:** "Known follow-ups" from the workspace task (TASK-116 era), kept in the handoff memory.

## Why

Most tables carry `workspace_id`, but four places still key data globally, so two workspaces can collide or see each other's rows.

- **`agents`** (`db/schema.ts` ~1603): `agents_identity_uq` is on `(kind, name, environment)`. When workspace B's Hermes reports, it updates workspace A's row. The writer is `reports/skillReportService.ts:287`, a raw INSERT without `workspace_id`.
- **`knowledge_entries`** (~1675): `id` is the primary key and is used as a slug (e.g. `guideline.<pack>`).
  - `knowledge/service.ts:237` inserts without `workspace_id`.
  - One workspace's guideline pack or source note therefore overwrites another's.
  - `knowledge_revisions` points at the entry id.
- **`revenue_entries`** (~975): `revenue_entries_source_external_uidx` is on `(source, external_key)`. Two workspaces importing the same YouTube channel report, or reusing the same manual key, collide, and the second import is silently dropped. Writers: `finance/financeService.ts:168,345` and `finance/youtubeRevenue.ts:188`.
- **API keys** (`apikey`, better-auth plugin): a key belongs to a user (`referenceId`), not to a workspace. `auth/guard.ts` ~line 53 accepts any `x-workspace-id` that the key's user may enter, so a key created for one workspace works in all of that user's workspaces.

## Read first

- `apps/server/src/auth/requestContext.ts` (workspace scope helpers, `defaultWorkspaceId`), `auth/workspaces.ts`, `auth/guard.ts` and `resolveWorkspace`.
- The files named above, plus every reader of these tables (grep `knowledgeEntries`, `knowledge_entries`, `revenue_entries`, `FROM agents`).
- `apps/server/drizzle/` for how earlier workspace migrations backfilled `workspace_id`, so this one follows the same style.
- The API key UI in web (team or account page) and `apps/mcp` key handling.

## Build

1. **Schema (one migration, generated).**
   - `agents`: unique on `(workspace_id, kind, name, environment)`.
   - `revenue_entries`: unique on `(workspace_id, source, external_key)`.
   - `knowledge_entries`:
     - keep `id` as a generated surrogate key (uuid) and add a `key` column holding today's slug;
     - unique on `(workspace_id, kind, key)`;
     - `knowledge_revisions.entry_id` keeps pointing at the surrogate id.
   - **Backfill:**
     - rows with null `workspace_id` get the default workspace (`defaultWorkspaceId`);
     - existing knowledge ids become both `key` and `id`, so old revisions stay linked;
     - generate the migration with `npx drizzle-kit generate`.
   - If drizzle-kit cannot express the backfill, write it as a guarded one-time step in the migration runner, the way earlier tasks did. Never hand-edit SQL files.
2. **Writers and readers.**
   - Every insert and upsert for these tables sets `workspace_id` from the current scope.
   - Every lookup filters by it.
   - The knowledge service API stays slug-based (`get(kind, key)`); the workspace is implicit.
   - Background jobs that run outside a request use the job's project workspace, never the default.
3. **API keys bound to a workspace.**
   - When a key is created, store its workspace in the key's `metadata` (`{ workspaceId }`); the better-auth API key plugin supports metadata.
   - In `guard.ts`, when the key has a workspace, it overrides `x-workspace-id`. A different requested workspace → 403 with a clear message.
   - Keys without a workspace (old keys) keep working in the user's default workspace only, and the key list marks them "chưa gắn workspace" with a button to bind them to the current one.
   - The team or account key UI shows each key's workspace.
   - Local keys and node join tokens: check them against the same rule and note in the report what you found.
4. **Audit.** Log key-workspace denials to the auth audit log. Do not log the key value.

## Mã nguồn mở có sẵn (open source)

- **better-auth** (MIT, already used): the API key plugin's `metadata` and the organization plugin. Use them; do not fork the plugin.
- Nothing else to add.

## Rules

- README rules 1–11. Migration only through drizzle-kit.
- Back up nothing yourself and touch nothing in `data/`; the migration runs on the user's next start. The report must say clearly that it changes unique keys.
- No secrets in logs or reports.

## Tests

- Two workspaces each report the same Hermes agent → two rows, no cross-update.
- Two workspaces store the same knowledge slug → two entries, each reads its own, and revisions stay per entry.
- Two workspaces import the same `(source, external_key)` → both are stored.
- **Migration on a fixture DB with null `workspace_id` rows:**
  - rows are backfilled to the default workspace;
  - old knowledge revisions still resolve;
  - unique constraints hold.
- **API keys:**
  - a key bound to A used with `x-workspace-id: B` → 403;
  - a bound key with no header → A;
  - an unbound old key → default workspace only;
  - the bind action works.
- A background job writes with its project's workspace.

## Done

- [ ] migration + backfill; writers/readers scoped
- [ ] key binding in guard, UI, audit
- [ ] tests; server + web + mcp suites; typecheck; build
- [ ] user guide (API keys section) + changelog
- [ ] report → `docs/tasks/TASK-132.done`
