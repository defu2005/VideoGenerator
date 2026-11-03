# TASK-009 — SUBTITLE stage (from voice cues) + multi-language default voice

Read `docs/ARCHITECTURE.md` (§5 `SubtitleTrack`, §8 render: "burn ASS + export separate .srt"),
then `docs/tasks/TASK-008.md` and the committed TASK-008 code (`stages/voice/voiceExecutor.ts`,
`api/voice.ts`, `providers/tts/*`, `features/voice/VoicePanel.tsx`). Follow the same patterns.
**0 LLM calls in every budget mode** — subtitles are pure code.

## Facts verified on this machine
- Edge TTS cues are **sentence-level**, not word-level. A real 6.6 s scene returned one cue
  `{ startSec: 0.1, endSec: 6.637, text: "<whole sentence of 120 chars>" }`. So long cues must be
  split by code.
- `voice_tracks.cues` is JSON `[{ startSec, endSec, text }]`, relative to the start of that scene's
  audio. USER-uploaded tracks have `cues: []`.

## Part A — SUBTITLE stage
1. **DB** table `subtitle_tracks` (generate with `npx drizzle-kit generate` in `apps/server`, never
   hand-write SQL): `id, project_id (fk cascade, unique), cues (json), srt_path, ass_path,
   input_hash, created_at, updated_at`. Cue = `{ index, sceneId, startSec, endSec, text }` with times
   **relative to the scene's voice audio** (TASK-011 timeline shifts them to absolute time;
   the stage also writes files with a provisional absolute time = scenes concatenated back-to-back
   by voice duration, which TASK-011 will overwrite).
2. **Shared** `packages/shared/src/subtitles/` (pure functions, unit-tested):
   - `splitCue(cue, opts)`: split long text into chunks that fit `maxCharsPerLine × maxLines`
     (16:9 → 42 × 2, 9:16 → 28 × 2, 1:1 → 32 × 2). Split preferably at sentence end, then `, ; :`,
     then spaces; never inside a word; keep punctuation with the preceding word. Time is shared in
     proportion to character count; each chunk ≥ 1.0 s when possible (merge tiny tail chunks); no
     overlaps; gaps < 0.15 s are closed.
   - `wrapLines(text, maxCharsPerLine, maxLines)`: balanced 2-line wrap.
   - `cuesWithoutTimings(narration, durationSec, opts)`: for USER tracks (no cues) and any track
     whose cues are empty: split the narration into sentences/chunks and spread over the duration
     by character count.
   - `toSrt(cues)` and `toAss(cues, style)`. ASS style: font Arial (configurable later), size scaled
     to the video height (resolution from aspect ratio: 1920×1080, 1080×1920, 1080×1080), white text,
     black outline 3, bottom-centre margin 8 % of height, `WrapStyle: 2` (we wrap ourselves).
     Escape `{ } \` correctly; keep Vietnamese diacritics (UTF-8 with BOM for `.srt`? — **no BOM**;
     ASS file UTF-8).
3. **SubtitleExecutor** (`apps/server/src/stages/subtitle/subtitleExecutor.ts`, registered as
   `SUBTITLE` in `app.ts`):
   - Needs a voice track for every narrated scene; otherwise non-retryable `StageError`
     "Thiếu giọng đọc cho N cảnh — chạy bước Giọng đọc trước".
   - `inputHash` = sha256 of (each scene's voice `input_hash`/`narration_hash`, aspect ratio,
     style version). Same hash and files exist → reuse, no rewrite.
   - Writes `<DATA_DIR>/projects/<id>/subtitles/subtitles.srt` and `.ass`.
   - Stage message: `N dòng phụ đề · M cảnh`.
   - `stageExecutors.subtitle === "USER"` not needed — the user edits text instead (below).
4. **API** (`apps/server/src/api/subtitles.ts`):
   - `GET /api/projects/:id/subtitles` → `{ cues, totalDurationSec, updatedAt }`.
   - `PATCH /api/projects/:id/subtitles/cues/:index` `{ text }` → edit one cue's text (times
     unchanged), rewrite both files, `markStaleFrom(…, "SUBTITLE")` so TIMELINE/RENDER go stale.
     Manual edits survive re-runs **only** while the input hash is unchanged; store `edited: true` on
     the cue and say in the UI that changing narration/voice resets edited lines.
   - `GET /api/projects/:id/subtitles/file.srt` and `file.ass` → download.
5. VOICE track changes already mark later stages stale — check that SUBTITLE becomes STALE after a
   voice regenerate/upload (test it).

## Part B — Web
- New tab panel `apps/web/src/features/subtitles/SubtitlePanel.tsx` mounted on the existing
  `subtitle`-ish tab of `ProjectDetailPage` (add a "subtitles" tab after "voice" if there is none;
  keep the existing tab order otherwise).
- Header: line count, button "Tạo phụ đề" (runs the SUBTITLE stage like VoicePanel runs VOICE),
  links "Tải .srt" / "Tải .ass".
- List grouped by scene: time range `0:03.2 → 0:06.6`, editable text (inline input, save on blur /
  Enter, shows "đã sửa"), warning when a line is longer than the max characters, and a small
  ▶ button that plays the scene's voice audio from the cue start (reuse the voice audio URL).

## Part C — Multi-language default voice (from TASK-008 review)
Today a project in any language other than Vietnamese with no chosen voice falls back to
`TTS_VOICE_EN` (e.g. a Japanese project is read in English). Fix:
1. Server helper `defaultVoiceFor(language, voices, config)` used by VoiceExecutor **and** the
   regenerate route: `vi*` → `TTS_VOICE_VI`; `en*` → `TTS_VOICE_EN`; otherwise the first voice whose
   locale matches the project language (`ja` matches `ja-JP`; `pt-BR` exact first), preferring a
   female then male neural voice; if no voice matches → a `*MultilingualNeural` voice; if the voice
   list is unavailable → `TTS_VOICE_EN` and a stage warning.
2. `GET /api/tts/voices` gains `multilingual: boolean` (name contains `Multilingual`). The voice
   select in `ProjectFormFields` shows matching-language voices first, then a group
   "Giọng đa ngôn ngữ" with the multilingual voices, for every project language.
3. Tests: ja → a ja-JP voice, pt-BR exact, unknown language → multilingual, list failure → EN.

## Tests (Vitest, no network, no real edge-tts/ffmpeg)
- Shared: splitCue (the real 120-char Vietnamese sentence above at 16:9 and 9:16; never splits a
  word; times monotonic, cover the cue; min duration), wrapLines, cuesWithoutTimings, toSrt (exact
  text fixture), toAss (escaping, header resolution per aspect ratio).
- Server: executor builds cues for mock voice tracks, reuses on second run, fails clearly when a
  voice track is missing, USER track (no cues) gets timed cues; API get/patch/download; edited
  text kept while hash unchanged, reset after narration change; SUBTITLE stale after voice change.
- Web: panel renders cues, editing a line calls PATCH, download links present; voice select
  groups multilingual voices.

## Rules
- No new dependencies. No `git commit`/`push`. Do not run real copilot/claude/agy/edge-tts.
- `npm run typecheck`, `npm test`, `npm run build`, `npx drizzle-kit check` must pass.
- The report must list the new test counts (current: shared 117, mcp 10, server 246, web 57).

## Done
Write `docs/tasks/TASK-009.report.md` (files, decisions, test counts, open issues) and an empty
`docs/tasks/TASK-009.done`.
