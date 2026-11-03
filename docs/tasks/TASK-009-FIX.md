# TASK-009-FIX — finish TASK-009 (review found it incomplete)

`docs/tasks/TASK-009.md` is the contract. Build on the current working tree (do not start over).
Test counts did not change for server (246) and web (57) — the required tests were not written.

## 1. Migration missing (blocker)
`subtitle_tracks` is in `schema.ts` but no migration exists (latest is `0009_damp_vanisher.sql`).
Run `npx drizzle-kit generate` **inside `apps/server`** (that is where `drizzle.config` lives) and keep
the SQL + meta. Drop the redundant `subtitle_tracks_project_idx` (the unique index already covers it).

## 2. Bugs
a. **Invisible subtitles**: `subtitleExecutor.ts` calls `toAss(…, { fontSize: 0 })` and `toAss`
   uses `style.fontSize ?? …`, so the ASS font size is 0. Remove `fontSize: 0`; make `toAss` treat
   a missing/≤0 size as "scale to height". Test it.
b. **Files use per-scene times**: every scene's cues start at 0, so the `.srt`/`.ass` overlap.
   The DB keeps scene-relative times, but the files must use provisional absolute time = scenes
   back-to-back by voice `duration_sec` (TASK-009 §A1). The PATCH route must write files the same
   way — put one shared function `writeSubtitleFiles(projectDir, cues, sceneOffsets, aspectRatio)`
   used by both. Test: scene 2's first cue in the .srt starts at scene 1's duration.
c. **`pt-BR` exact first** (`lib/defaultVoice.ts`): an exact locale match must win over a
   same-language match (pt-BR male beats pt-PT female). Test it.
d. `GET /subtitles` `totalDurationSec` = sum of narrated scenes' voice durations (not cue sums);
   download route returns 404 `SUBTITLE_FILE_NOT_FOUND` when the file is missing (not a 500).
   Also respect `settings.subtitles.maxCharsPerLine` only as an override — the default must come
   from the aspect ratio (16:9 42, 9:16 28, 1:1 32), not a fixed 42.

## 3. Tests (all from TASK-009 "Tests", none written yet for server/web)
- Server: executor builds cues for mock voice tracks against a **migrated** DB; second run reuses
  (files not rewritten); missing voice → the Vietnamese StageError; USER track (`cues: []`) gets
  timed cues; API get / patch (sets `edited`, rewrites files, marks TIMELINE stale) / download
  srt+ass; edited text kept while hash unchanged, reset after narration change; SUBTITLE becomes
  STALE after a voice regenerate or upload; defaultVoiceFor cases (ja, pt-BR exact, unknown →
  multilingual, list failure → EN + warning).
- Web: SubtitlePanel renders cues grouped by scene, editing a line calls PATCH, download links
  present, over-length warning; voice select shows the "Giọng đa ngôn ngữ" group.

## Do not touch
`IMAGE_SEARCH_USER_AGENT` default in `config.ts` and `.env.example` was changed by the architect
on purpose — keep it.

## Rules
No new dependencies. No commit/push. `npm run typecheck`, `npm test`, `npm run build`, and
`npx drizzle-kit check` (run in `apps/server`) must pass. The report must list the new counts.

## Done
Append a "FIX" section to `docs/tasks/TASK-009.report.md` and create an empty
`docs/tasks/TASK-009-FIX.done`.
