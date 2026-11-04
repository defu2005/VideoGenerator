# TASK-013 report — Render versions, history and export

## What changed

### Shared
- `packages/shared/src/schemas/render.ts` — `RenderVersionSchema`, `RenderVersionListSchema`, `RenderVersionPatchSchema`, `RenderSettingsSchema`, `DEFAULT_RENDER_KEEP_VERSIONS`
- `packages/shared/src/metadata/exportText.ts` — `buildMetadataText`
- `packages/shared/src/index.ts` — exports
- Tests: `packages/shared/test/metadata.test.ts` (`buildMetadataText`)

### Server
- `apps/server/src/db/schema.ts` — `renders` columns: `version`, `note`, `pinned`, `deleted_at`, `review_thread_id`, `metadata_snapshot`
- Migration: `apps/server/drizzle/0017_sour_amazoness.sql` (+ snapshot)
- `apps/server/src/settings/render.ts` — `renderKeepVersions` in `app_settings` (default 5, range 1–50)
- `apps/server/src/lib/zip.ts` — store-only streaming zip with data descriptors + `zlib.crc32`
- `apps/server/src/services/renderService.ts` — per-version folders, reuse across all DONE versions, retention, soft delete, backfill versions, export helpers
- `apps/server/src/api/render.ts` — list/get/patch/delete/export per version; `GET|PUT /api/settings/render`; existing `/render*` routes kept as “current”
- `apps/server/src/app.ts` — pass sqlite into render routes
- Tests: `apps/server/test/render.test.ts` — versions, retention, delete fallback, legacy rows, export zip, zip writer

### Web
- `apps/web/src/services/renderApi.ts` — list/patch/delete/export/settings helpers; versioned file URLs
- `apps/web/src/features/render/RenderHistory.tsx` — history list, note/pin/delete, compare summary, export
- `apps/web/src/features/render/RenderPanel.tsx` — selected version player + history
- `apps/web/src/features/settings/RenderSettingsPage.tsx` — Cài đặt → Render
- `apps/web/src/App.tsx`, `AppLayout.tsx`, `index.css`
- Tests: `RenderPanel.test.tsx`, `RenderSettingsPage.test.tsx`

### MCP
- `apps/mcp/src/apiClient.ts` — `listRenders`, `getRenderExportUrl`
- `apps/mcp/src/tools.ts` — `list_renders`, `get_render_export_url`
- `apps/mcp/test/tools.test.ts` — tool list + list/export URL

## Test counts

| Workspace | Before (TASK-017 README) | After TASK-013 |
|---|---|---|
| shared | 156 | **170** |
| mcp | 11 | **12** |
| server | 295 | **316** |
| web | 70 | **74** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. Second `drizzle-kit generate` → “No schema changes”.

## Deviations from the spec

- **Browser live check:** not run in this session (no throwaway project rendered). Covered by unit/API tests instead; do not press Render on `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- **Compare UI:** text diff of duration / issues / clips reused (+ metadata presence note), not a full metadata title diff parser.
- **Export metadata chapters:** `metadata.txt` uses snapshot draft + credits file; chapters text is empty at export unless already in the draft description (chapters remain a live MetadataPanel concern).

## Not done

- Live browser check on a throwaway project (render twice, open zip in Explorer).
- No commit/push (per rules).
