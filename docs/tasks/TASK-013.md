# TASK-013 — Render versions, history and export

Status: spec written 2026-11-04, not started. Depends on TASK-012 (render), TASK-019 (metadata, for the export), TASK-018 (review chat, optional link).

## Problem
`RenderService.render` (TASK-012) always writes into the same folder: `<project>/render/output.mp4`, `credits.txt`, `subtitles.srt`, `thumbs/`. Each new render therefore **overwrites** the files of the previous one, while the `renders` table still keeps the old rows, which then point to the overwritten files. The user cannot compare versions or go back to one.

## Goal
Every successful render is a **version** with its own files. The user can:
- see the history;
- play or download any version;
- add a note to a version;
- pin a version;
- delete one;
- export a version as one zip ready to upload.

## 1. Storage layout
- **Per-version folder:** `<project>/render/versions/<renderId>/` holds `output.mp4` (via `output.part.mp4`), `credits.txt`, `subtitles.srt` and `thumbs/`.
- **Clip cache:** `<project>/render/clips/` stays shared between versions (it is keyed by content hash).
- **Old rows from TASK-012:** they keep their stored absolute paths. They are shown in the history as long as their files exist. Do not move old files. Mark an old row "Bản cũ (có thể đã bị ghi đè)" when two or more old rows share the same `output_path`. Only the newest of those can still be correct, so hide the older ones.
- **Reuse:** if the new input hash equals the hash of **any** DONE version whose files still exist, return that version (`reused: true`) and make no new row. Today this only checks the latest version.

## 2. Table changes (`renders`, drizzle-kit migration)
- `version` integer not null. It is 1, 2, 3… per project, assigned at insert as max + 1. The migration's default for old rows is 0; then a one-off backfill in code runs at startup (or in the service on first read), numbering by `created_at`. A data backfill is not a hand-written migration, and that is allowed.
- `note` text, nullable, max 500.
- `pinned` integer boolean, default false.
- `deleted_at` text, nullable. A deleted version keeps its row (for the history and usage) but its files are removed.
- `review_thread_id` text, nullable. It stores the TASK-018 thread id that was current when the render ran, so the UI can say "Bản này được render sau cuộc trò chuyện góp ý". If TASK-018 is not merged yet, leave the column and write null.
- `metadata_snapshot` JSON, nullable. The TASK-019 metadata (edited if present, else draft) at render time, used by the export.

## 3. Retention
- A setting `renderKeepVersions` in app settings (default 5, range 1–50), shown under "Cài đặt → Render".
- After each successful new render, delete the files of the oldest versions beyond the limit: never pinned ones, never the newest. Set `deleted_at`.
- A version is never auto-deleted while it is being streamed or exported. Simple rule: skip a version that was read in the last 60 s (an in-memory map is fine).

## 4. API
Keep the existing routes. They now mean "the current version", which is the newest non-deleted DONE version.

New routes:
- `GET /api/projects/:id/renders` returns `{ renders: RenderVersion[] }`, newest first, deleted ones included with `deleted: true`.
- `GET /api/projects/:id/renders/:renderId` returns one `RenderVersion`.
- `GET /api/projects/:id/renders/:renderId/video|credits|subtitles|thumbs/:sceneId` serves the files of that version (same Range support and `?download=1` as today).
- `PATCH /api/projects/:id/renders/:renderId` with `{ note?, pinned? }`.
- `DELETE /api/projects/:id/renders/:renderId` removes the files and sets `deleted_at`. Deleting the only non-deleted version is allowed.
- `GET /api/projects/:id/renders/:renderId/export` streams a **zip** (`<title> - v<N>.zip`) containing:
  - `<title>.mp4`;
  - `<title>.srt` if present;
  - `credits.txt`;
  - `metadata.txt`, built from `metadata_snapshot` or, if that is missing, the current metadata. It holds the titles, the description with chapters and credits, tags, hashtags and the AI disclosure, in plain text;
  - `render-report.json`.

  **No new dependency.** Write a small store-only (no compression) zip writer in `apps/server/src/lib/zip.ts` that streams files one by one. Use `zlib.crc32` (Node ≥ 22.2; the repo uses Node 24). Use data descriptors so a file is never loaded fully into memory. Use ZIP64 only if a file is > 4 GB: reject with `413 EXPORT_TOO_LARGE` instead.

`RenderVersionSchema` (shared) = the existing `RenderSchema` plus `version`, `note`, `pinned`, `deleted`, `reviewThreadId`, `hasMetadata`.

## 5. Web (Render tab)
- The player plays the selected version (the current one by default).
- **"Lịch sử bản render"** is a list under the player. Each row shows:
  - `v3 · 12/11 14:05 · 1:02 · 18 MB`;
  - an OK or issues badge;
  - a pin icon and the note (editable inline);
  - buttons "Xem", "Tải MP4", "Xuất gói (.zip)", "Xoá" (with a confirm).
- Deleted rows are greyed out with "Đã xoá file".
- **"So sánh với bản trước":** a simple diff from the render reports (duration, number of issues, clips reused) and, when both have `metadata_snapshot`, a changed-title note. No video diff.
- The "Thông tin đăng tải" panel (TASK-019) stays tied to the current metadata, not the selected version.

## 6. MCP
- `list_renders {projectId}`.
- `get_render_export_url {projectId, renderId}` returns the local URL. The MCP server never streams the zip itself.

## 7. Tests (no network)
- **Server**, with a fake FFmpeg runner or the existing render test setup. Look at how the TASK-012 tests avoid running real FFmpeg; if they do run the real binary, keep using it as they do.
  - two renders with different inputs → two folders, both playable, version 1 and 2;
  - same input as an older version → reused, no new row;
  - retention deletes the oldest unpinned version and keeps pinned ones;
  - delete then current = the previous version;
  - old TASK-012 rows still list.
- **Zip writer:** the produced zip is readable. Verify by parsing the central directory in the test and checking CRCs. A bytes round-trip with `unzip` is not available on Windows, so don't depend on it.
- **Export:** the zip lists the expected names; `metadata.txt` contains the title and the AI disclosure line.
- **Web:** the history list renders, PATCH note, delete confirm, version switch changes the player source.

## Do not
- Do not move or rewrite the clip cache.
- Do not delete files of a version the user pinned.
- Do not add npm dependencies (no archiver/jszip).
