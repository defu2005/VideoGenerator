# TASK-008 — TTS provider + VOICE stage + Voice UI

Read `docs/ARCHITECTURE.md` (§5 data model `VoiceTrack`, §7 providers, §8 render, §10) first.
Follow the existing patterns: stage executors in `apps/server/src/stages/*`, providers in
`apps/server/src/providers/*`, CLI spawning like `apps/server/src/providers/llm/cliProvider.ts`,
uploads like `POST /api/projects/:id/scenes/:sceneId/visuals/upload` in `apps/server/src/api/visuals.ts`.

## Decisions already made (verified on this machine)
- **Default TTS = Microsoft Edge neural voices via the Python CLI `edge-tts`** (free, no key,
  good Vietnamese: `vi-VN-HoaiMyNeural` female, `vi-VN-NamMinhNeural` male). The Node package
  `msedge-tts` was tested and fails here — do NOT use it. Spawn the `edge-tts` executable.
- The Edge service is **flaky**: the same request sometimes returns `NoAudioReceived` / empty
  file, then works seconds later. Retry each scene up to 3 times with backoff (2 s, 5 s, 10 s).
- Spawn with env `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8`, pass the narration through a
  UTF-8 temp file (`--file`), never on the command line. `shell: false`, `windowsHide: true`.
- Command: `edge-tts --voice <voice> --rate <+0%> --file <txt> --write-media <out.mp3> --write-subtitles <out.srt>`.
  Parse the `.srt` into cues `{ startSec, endSec, text }` and keep them (TASK-009 uses them).
- Duration: add dependencies **`ffprobe-static@3.1.0` and `ffmpeg-static@5.3.0`** to
  `apps/server` (explicitly allowed for this task; they are needed by TASK-010/012 too).
  Create `apps/server/src/media/ffmpeg.ts` exporting `resolveFfmpegPath()`, `resolveFfprobePath()`
  (env `FFMPEG_PATH` / `FFPROBE_PATH` first, then the static packages) and
  `probeDurationSec(file, signal)`. TTS duration = ffprobe on the produced file.

## Server
1. **Config** (`apps/server/src/lib/config.ts`): `TTS_PROVIDER` (`edge-tts` | `mock`, default
   `edge-tts`; tests use `mock`), `EDGE_TTS_PATH` (default: resolve `edge-tts` on PATH, then on
   Windows `%APPDATA%\Python\Python3*\Scripts\edge-tts.exe` and
   `%LOCALAPPDATA%\Python\*\Scripts\edge-tts.exe`), `TTS_VOICE_VI` (default `vi-VN-HoaiMyNeural`),
   `TTS_VOICE_EN` (default `en-US-AriaNeural`), `TTS_RATE` (default `+0%`), `TTS_TIMEOUT_MS` (60000).
2. **Provider** `apps/server/src/providers/tts/`: `types.ts` (`TtsProvider { id; label;
   isAvailable(); listVoices(): Promise<TtsVoice[]>; synthesize({ text, voice, rate, outPath,
   signal }): Promise<{ durationSec; cues }> }`), `edgeTts.ts`, `mockTts.ts` (writes a valid
   silent **WAV** sized from text length ≈ 14 chars/sec, returns cues per sentence; no network,
   no ffprobe needed), `registry.ts`. `listVoices` runs `edge-tts --list-voices` once, caches
   10 min, falls back to a static list of the vi-VN and en-US voices. Missing binary →
   non-retryable `StageError` with message `Chưa cài edge-tts — chạy: pip install edge-tts`.
3. **DB** table `voice_tracks`: `id, project_id (fk cascade), scene_id (fk cascade, unique),
   provider, voice, rate, origin ('AGENT'|'USER'), audio_path, duration_sec, cues (json),
   input_hash, created_at, updated_at`. Generate the migration with
   `npx drizzle-kit generate` in `apps/server` (do not hand-write SQL).
4. **Shared**: `packages/shared/src/schemas/voice.ts` (VoiceTrack, TtsVoice, API payloads),
   export from index. Project settings gain optional `voice: { voice?: string; rate?: string }`
   (rate pattern `^[+-]\d{1,3}%$`). Keep old projects valid.
5. **VoiceExecutor** (`apps/server/src/stages/voice/voiceExecutor.ts`), registered as `VOICE`
   in `app.ts`:
   - Voice = project `settings.voice.voice` → language default (`vi*` → `TTS_VOICE_VI`, else
     `TTS_VOICE_EN`). Rate = project setting → `TTS_RATE`.
   - For each scene in order with non-empty narration: `inputHash = sha256(narration, voice,
     rate, provider)`. If a track with that hash exists and its file exists → reuse (no call).
     Else synthesize to `<DATA_DIR>/projects/<projectId>/voice/<sceneId>-<hash8>.mp3`
     (`.wav` for mock), upsert the row, delete the old file. Report progress per scene.
   - Never overwrite a scene's `origin: 'USER'` track unless its narration changed (then
     regenerate and say so in the stage message).
   - Delete tracks (and files) for scenes that no longer exist.
   - Stage message: `N cảnh · tổng X:YY · Z tạo mới, W dùng lại`. Scene durations are NOT
     written back to the scenes table in this task (TASK-011 timeline uses voice durations).
   - `stageExecutors.voice === "USER"`: follow the pattern used for `script === "USER"` in
     `apps/server/src/pipeline/orchestrator.ts` — the stage waits for the user
     (`WAITING_USER`) until every narrated scene has an uploaded track, then the user continues.
6. **API** (`apps/server/src/api/voice.ts`, register in `app.ts`):
   - `GET /api/tts/voices` → voices (language, gender, name).
   - `GET /api/projects/:id/voice` → `{ voice, rate, provider, tracks[], totalDurationSec, missingSceneIds[] }`.
   - `GET /api/projects/:id/voice/:trackId/audio` → streams the file with correct content-type
     and range support (HTML `<audio>` seeking).
   - `POST /api/projects/:id/scenes/:sceneId/voice/regenerate` (optional body `{ voice?, rate? }`)
     → synthesizes that one scene now, returns the track.
   - `POST /api/projects/:id/scenes/:sceneId/voice/upload` (multipart, mp3/wav/m4a/ogg,
     ≤ 25 MB) → `origin: 'USER'`, duration via ffprobe.
   - Any change to a track marks stages after VOICE stale (`markStaleFrom(…, "VOICE")`).

## Web (`apps/web/src/features/voice/`)
- A **Voice panel** in the project detail page (same place/style as the visuals/scenes panels):
  per scene — label, narration (2 lines, expandable), `<audio controls>`, duration vs scene
  estimate (warn when off by > 30%), voice + origin badge ("AI" / "Của bạn"), buttons
  "Tạo lại" and "Tải lên giọng của tôi". Header: chosen voice, speed, total duration, button
  "Tạo giọng đọc" (runs the VOICE stage through the existing pipeline run API).
- **Project Advanced settings** (`ProjectFormFields.tsx`): "Giọng đọc" select from
  `/api/tts/voices` filtered to the project language (+ "Mặc định"), and "Tốc độ" select
  (-20%, -10%, +0%, +10%, +20%). Saved in `settings.voice`. Note: TASK-014 may be editing this
  file right before you — build on whatever is there, don't revert it.

## Tests (Vitest; `TTS_PROVIDER=mock`; never run the real edge-tts or hit the network)
- edge-tts adapter with a fake spawn: args (no text on the command line, `--file` used),
  UTF-8 env set, retry on `NoAudioReceived`/empty file then success, missing binary error, SRT parsing.
- VoiceExecutor: creates tracks for narrated scenes, reuses on second run (0 synth calls),
  regenerates only the scene whose narration changed, removes tracks of deleted scenes,
  keeps USER tracks.
- API: voices list, project voice summary, regenerate, upload (wav fixture generated in test),
  audio route returns 206 for a Range request.
- Web: Voice panel renders tracks and triggers regenerate/upload; settings voice select saves.

## Rules
- Only the two dependencies above may be added. No `git commit`/`push`.
- Do not run real copilot/claude/agy/edge-tts in tests.
- `npm run typecheck`, `npm test`, `npm run build` must pass; `npx drizzle-kit check` clean.

## Done
Write `docs/tasks/TASK-008.report.md` (files, decisions, test results, open issues) and an
empty `docs/tasks/TASK-008.done`.
