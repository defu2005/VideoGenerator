# TASK-009-FIX2 — subtitle routes not registered + missing tests (2nd review)

Live test on project 56374fb2 (65 scenes): the SUBTITLE stage now works (145 cues, files OK),
but the review found these problems. Build on the current tree.

## 1. Bugs (verified live)
a. **All subtitle API routes return 404**: `apps/server/src/app.ts` imports
   `registerSubtitleRoutes` but never calls it. Register it like the voice routes.
b. **Lines are not wrapped**: `.srt` has single lines of ~80 chars
   ("In the hyper-engineered universe of global pop, no group has scaled the heights").
   Each cue's text must go through `wrapLines(text, maxCharsPerLine, 2)` when writing SRT/ASS
   (SRT: real newline; ASS: `\N`). Keep the DB text unwrapped.
c. **Overlap across scenes**: cue 144 ends 00:09:59,810, cue 145 starts 00:09:59,760. When building
   absolute times, clamp each cue's end to its scene's end (offset + voice duration) and make every
   start ≥ previous end.
d. ASS `OutlineColour` is `&H000000` — must be `&H00000000`.

## 2. Tests — REQUIRED (skipped twice; the task is not done without them)
Create these files; each listed case is one `it(...)`:
- `apps/server/test/subtitleExecutor.test.ts` (migrated test DB + mock voice tracks):
  builds cues for 2 scenes and writes both files; 2nd run reuses (file mtime unchanged);
  missing voice → StageError message `Thiếu giọng đọc cho 1 cảnh — chạy bước Giọng đọc trước`;
  USER track with `cues: []` gets timed cues covering its duration; scene 2's first SRT cue starts
  at scene 1's duration; no cue overlaps; SRT lines ≤ maxCharsPerLine and ≤ 2 lines.
- `apps/server/test/subtitleApi.test.ts` (use `buildApp` like `voiceApi.test.ts`):
  GET returns cues; PATCH sets `edited: true`, rewrites the .srt, marks TIMELINE stale;
  PATCH unknown index → 404; download `.srt` and `.ass` → 200 with attachment header;
  download with missing file → 404 `SUBTITLE_FILE_NOT_FOUND`; edited text kept when the stage is
  re-run with the same hash and reset after a narration change; SUBTITLE becomes STALE after a
  voice regenerate.
- `apps/web/src/features/subtitles/SubtitlePanel.test.tsx`: renders cues grouped by scene;
  editing a line + blur calls PATCH; download links point to `file.srt` / `file.ass`;
  over-length warning shows.
- `apps/web/src/features/projects/ProjectFormFields.test.tsx`: add a case — the voice select shows
  a "Giọng đa ngôn ngữ" group containing a `*MultilingualNeural` voice.
Expected: server ≥ 262 tests, web ≥ 62.

## Do not touch
The `IMAGE_SEARCH_USER_AGENT` default (architect change).

## Rules
No new dependencies. No commit/push. `npm run typecheck`, `npm test`, `npm run build`, and
`npx drizzle-kit check` in `apps/server` must pass. Report the new counts.

## Done
Append a "FIX2" section to `docs/tasks/TASK-009.report.md`, create empty
`docs/tasks/TASK-009-FIX2.done`.
