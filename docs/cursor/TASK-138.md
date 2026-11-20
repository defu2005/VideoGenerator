# TASK-138 — Safe garbage collection and file lifecycle ♻️🗄

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`; deleting files is irreversible, so rate it hard). **Size:** M. **Migration:** one (drizzle-kit only). **New dependency:** none.
**Depends on:** 137 (`blobs` table, providers) and 134 (`pipeline/dataContract.ts`, file references in `inputVersion.ts`). Run it alone among migration tasks.
**Source:** PROPOSAL-STORAGE-004 part 2 and [SCALE-PLAN.md](SCALE-PLAN.md) row 3.

## Why

At volume, `data/projects/*` and the bucket only grow:
- footage candidates never selected;
- old render versions;
- voice takes replaced by edits;
- preview files;
- finished uploads.

Nothing knows which files are still referenced, so nothing can be deleted safely. A disk-full event stops every job.

## Read first

- `pipeline/dataContract.ts` and `pipeline/inputVersion.ts` (how rows point to files; reuse this, do not write a second file-reference scanner).
- `storage/provider.ts`, `blobs` (137), `node/uploadStore.ts` cleanup, `worker.setSweep` in `app.ts` (~line 690).
- Render versions and `keepVersions` (`services/renderService.ts`, `settings/render.ts`), the undo/revision store (TASK-019/049 revision tokens), publications (`publishing/`), clips (`CLIP` side job), the footage library.
- `projects.archivedAt` and project delete.

## Build

### 1. Reference graph (code, no LLM)

- `collectReferences(db)` returns `Map<sha256 | localPath, Ref[]>`. Each `Ref` is `{ projectId, table, rowId, kind }`.
- It walks every table in the data contract registry with file columns or JSON file refs, plus:
  - render versions inside `keepVersions`;
  - revision snapshots inside the undo window;
  - publications (the published render and thumbnail);
  - clips;
  - the shared footage and music libraries;
  - pending uploads of running or finalizing jobs.
- **Asset classes:**
  - `global`: library footage and music, style assets; never collected automatically;
  - `shared`: a channel or profile asset used by several projects;
  - `project`: owned by one project;
  - `ephemeral`: previews (139), contact sheets, temp uploads, cache.

### 2. Two-phase delete

- Migration: add `orphaned_at` and `purge_after` to `blobs`. Add a `file_gc_runs` table for the run log: counts, bytes, duration, dry-run flag, error.
- **Mark** (daily sweep, and on demand):
  - a blob or project file with zero references gets `orphaned_at = now`;
  - `purge_after = now + grace`, with grace 14 days by default (setting, 7–60), and 1 day for `ephemeral`;
  - a blob that gains a reference again clears both fields.
- **Purge:**
  - only rows past `purge_after` that are still unreferenced at purge time (re-check inside the same transaction as the delete row);
  - delete the local file and the provider object, then the row;
  - log every purge in `file_gc_runs`.
- **Never purge:**
  - anything referenced by a publication;
  - anything for the protected project `56374fb2-…`;
  - anything under a project with a running job;
  - `global` assets.

### 3. Lifecycle after publish

- Seven days after a publication succeeds (setting), a project's intermediate files are marked:
  - footage candidates not selected;
  - render versions other than the published one and the newest;
  - preview and review artifacts.
- The script, timeline, selected visuals, voice, subtitles, published render and thumbnail stay, so the project can still be re-rendered or translated.
- Archived projects: the same rule, run right after archive.
- Deleting a project marks its `project` assets, with the normal grace period, so a mistaken delete can be undone by restoring the DB row.

### 4. Disk guard

- The resource governor (129b) already reads free disk. Below 15 % free:
  - run mark and purge for `ephemeral` at once;
  - raise an anomaly with the top 10 projects by bytes.
- Below 5 % free: stop claiming new RENDER and MEDIA_FETCH jobs until space returns, with a clear Vietnamese reason on the dashboard.

### 5. UI and tools

- Settings → "Lưu trữ" (shared with 137):
  - bytes by class and by project;
  - orphaned bytes and their purge dates;
  - "Chạy thử (không xoá)" (dry run, shows what would go);
  - "Dọn ngay" for items past grace (a confirm dialog listing counts and bytes);
  - grace settings.
- Registry tool `storage_report` (read-only) for agents. Purge stays a UI action for the user. Agents never get a purge tool.

## Mã nguồn mở có sẵn (open source)

- **git gc / restic prune**: mark unreferenced, keep for a grace period, then prune. Idea only.
- **S3 lifecycle rules**: an optional second safety net for the bucket. Document it in `deploy/README.md`; the app does not depend on it.

## Rules

- README rules 1–11. Migration only through drizzle-kit.
- Every delete is preceded by a reference re-check in the same transaction. A dry run must never delete.
- Tests use temporary data dirs and the fake provider from 137.

## Tests

- A selected visual, a published render and a file in the undo window are never marked.
- An unselected candidate is marked, then purged after grace, and the file and provider object are gone.
- A blob that gains a reference before `purge_after` is kept and its marks are cleared.
- Purge with a reference added between mark and purge keeps the file.
- The post-publish lifecycle keeps what re-render needs, and a re-render after the lifecycle succeeds.
- The protected project and global assets are never touched.
- The disk guard at 15 % and 5 % behaves as above.
- A dry run reports the same set the real run purges and deletes nothing.

## Done

- [ ] reference graph from the data contract; asset classes
- [ ] mark/purge with grace, run log; lifecycle after publish and archive
- [ ] disk guard via governor; UI; `storage_report` tool
- [ ] tests; server + web suites; typecheck; build
- [ ] `docs/ARCHITECTURE.md`, user guide (Lưu trữ), changelog
- [ ] report → `docs/tasks/TASK-138.done`
