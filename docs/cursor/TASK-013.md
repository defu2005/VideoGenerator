# TASK-013 — Cursor guide

Read `docs/cursor/README.md` first. Spec: `docs/tasks/TASK-013.md` (read it fully).

**Depends on:** TASK-019 (`video_metadata`, for `metadata_snapshot` and `metadata.txt`). TASK-018 is optional: if it is not merged, write `review_thread_id = null`.

## File map
- **Render service:** `apps/server/src/services/renderService.ts`:
  - `renderDir(projectId)` (line ~93) returns `<project>/render`. Add `versionDir(projectId, renderId)`.
  - `render()` (line ~172): today `thumbsDir`, `output.mp4`, `credits.txt` and `subtitles.srt` all go to `renderDir`. Generate the `renderId` (`randomUUID()`) **before** rendering and write those files into `versionDir`. Keep `clipsDir`, `clips.txt` and the filter script in `renderDir` (shared, temporary). FFmpeg runs with `cwd: renderDir` and writes `output.part.mp4`, so either change `cwd` or pass a relative path to the version folder. Then rename `output.part.mp4` to `versions/<id>/output.mp4`.
  - Reuse check (line ~204): search **all** DONE rows of the project with that `input_hash` whose `output_path` exists and `deleted_at` is null, not only `latestRow`.
  - `file()` (line ~156): today it builds the thumb path from `renderDir/thumbs`. Use the version folder of that row. Old rows have no version folder, so fall back to `renderDir/thumbs`. Add a `renderId?` argument.
  - `latestRow` must skip deleted rows.
- **DB:** `apps/server/src/db/schema.ts`, `renders` table (line ~322). Add the columns from spec §2, then run `npx drizzle-kit generate` in `apps/server`.
- **Routes:** `apps/server/src/api/render.ts`. Reuse `sendFile` and `baseName` for the new per-version routes.
- **Settings:** find where app settings live (the TASK-017 `guidelines/settings.ts` stores packs in app settings; follow the same pattern) and add `renderKeepVersions`. The web settings page is near `apps/web/src/features/guidelines/GuidelineSettingsPage.tsx`. Find the general settings page and add a "Render" section.
- **Metadata:** the TASK-019 `MetadataService` (get the effective metadata). Build `metadata.txt` with a pure function in shared (`buildMetadataText(metadata)`) so it is testable.
- **Zip:** new `apps/server/src/lib/zip.ts`. Store-only, streaming, data descriptors, `zlib.crc32`.
- **Shared:** `packages/shared/src/schemas/render.ts` gets `RenderVersionSchema`, `RenderVersionListSchema`, `RenderVersionPatchSchema`.
- **Web:** `apps/web/src/features/render/RenderPanel.tsx` (+ its test). Put the list in a new `RenderHistory.tsx`. The API hooks go in the existing render API service file (find it from `RenderPanel.tsx` imports).
- **MCP:** `apps/mcp/src/tools.ts`, `apiClient.ts`, tests.

## Steps
1. **Shared:** schemas, `buildMetadataText`, tests. Build shared.
2. **Server DB:**
   - add the columns, generate the migration, run it a second time and expect "No schema changes";
   - backfill `version` for old rows, numbering by `created_at` per project, in a small idempotent function called from the `RenderService` constructor or on first list.
3. **Server render:** per-version folders, the reuse check over all versions, retention after a new render, the `metadata_snapshot` and `review_thread_id` fields.
4. **Server API:** the new routes, the zip writer and the export, then the tests (spec §7).
5. **Web:** history list, version switch, note/pin/delete, export button, the "Render" settings field, tests.
6. **MCP:** the two tools + tests.
7. **Browser check** on a throwaway project with a finished timeline: render twice (change one scene duration in between), see v1 and v2, play both, export v2, open the zip in Windows Explorer, delete v1. **Never press Render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**
8. Run the README done checklist, then write the report and the `.done` file.

## Watch out
- Windows: you cannot delete an MP4 while it is being streamed. Catch `EBUSY`/`EPERM` on delete: return `409 RENDER_IN_USE` from DELETE, and retry the retention cleanup on the next render instead of failing the render.
- Keep the existing `GET /render*` routes working: the RenderPanel test and the MCP tools use them.
- Do not change `RENDER_FORMAT_VERSION`. Clip hashes must stay valid so the clip cache keeps working.
