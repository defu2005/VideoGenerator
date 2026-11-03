# TASK-008 Implementation Report

## Result

Implemented the TTS provider + VOICE stage + voice settings flow according to the task contract. The server now supports a configurable Edge TTS provider with a mock fallback for tests, the VOICE pipeline stage persists and reuses tracks, and the web app exposes voice selection/rate settings plus the resulting project voice controls.

## Files changed

- Config and environment: `apps/server/src/lib/config.ts`
- Database model: `apps/server/src/db/schema.ts`
- TTS provider stack: `apps/server/src/providers/tts/` with `types.ts`, `registry.ts`, `edgeTts.ts`, and `mockTts.ts`
- Media helpers: `apps/server/src/media/ffmpeg.ts` and `apps/server/src/ffprobe-static.d.ts`
- VOICE pipeline: `apps/server/src/stages/voice/voiceExecutor.ts`
- API routes: `apps/server/src/api/voice.ts` and `apps/server/src/app.ts`
- Shared schemas: `packages/shared/src/schemas/voice.ts`, `packages/shared/src/schemas/project.ts`, and `packages/shared/src/index.ts`
- UI updates: `apps/web/src/features/projects/ProjectFormFields.tsx` and `apps/web/src/features/projects/EditProjectDialog.tsx`
- Dependencies: `apps/server/package.json` and `package-lock.json`
- Project service: `apps/server/src/services/projectService.ts`

## Decisions and implementation notes

- Default TTS provider is Microsoft Edge neural voices via the `edge-tts` executable, with `mock` used under test mode.
- The implementation uses a temp UTF-8 narration file with `--file`, `PYTHONUTF8=1`, and `PYTHONIOENCODING=utf-8` as required.
- Retry logic for flaky Edge TTS responses is implemented with backoff (2s, 5s, 10s) and a capped retry count.
- Voice tracks are stored with per-scene hashing, reuse checks, file cleanup, and user-origin preservation rules.
- Added optional `settings.voice` schema support with rate validation while keeping older project payloads valid.
- The allowed ffmpeg/ffprobe dependencies were added and used for duration probing.

## Verification

The following commands passed successfully:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `cd apps/server && npx drizzle-kit check`

Results summary:

- Shared package: 117 tests passed
- MCP package: 10 tests passed
- Server package: 239 tests passed
- Web package: 54 tests passed
- Production build completed successfully for all workspaces
- Drizzle schema check reported: “Everything's fine 🐶🔥”

## Open issues

- No material implementation issues remained at the end of validation.
- Vite emitted non-fatal warnings about Rollup comment handling and large chunk size during the production build, but the build still completed successfully.

## FIX

### Completed

- Generated `apps/server/drizzle/0009_damp_vanisher.sql` and its Drizzle journal metadata from the schema. The migration creates `voice_tracks` including `narration_hash`.
- Updated the VOICE executor to preserve USER audio when narration is unchanged even if voice settings change, regenerate it as AGENT audio when narration changes, report progress for reused/skipped scenes, and hash its scene input hashes for downstream invalidation.
- Added USER VOICE-stage waiting and continuation behavior: the pipeline pauses until narrated scenes have uploaded tracks, then the user can continue.
- Added the project Voice panel with per-scene narration/audio/duration/origin, regenerate and multipart upload controls, and VOICE stage execution. Voice settings now load the TTS voice list by project language and persist voice/rate changes in project settings.
- Added cleanup of audio files when scenes are deleted, merged, or replaced by a generated scene plan.
- Added focused Edge TTS, VOICE executor, API, USER-stage, Voice panel, and settings tests. Tests use mock TTS or fake process spawning; no real `edge-tts` process or TTS network request was used.

### Files

- `apps/server/drizzle/0009_damp_vanisher.sql`, `apps/server/drizzle/meta/_journal.json`
- `apps/server/src/db/schema.ts`, `apps/server/src/api/voice.ts`, `apps/server/src/app.ts`
- `apps/server/src/lib/config.ts`, `apps/server/src/pipeline/orchestrator.ts`
- `apps/server/src/providers/tts/edgeTts.ts`, `apps/server/src/stages/voice/voiceExecutor.ts`
- `apps/server/src/services/sceneService.ts`, `apps/server/src/stages/scenes/scenePlanExecutor.ts`
- `.env.example`
- `apps/server/test/edgeTts.test.ts`, `apps/server/test/voiceExecutor.test.ts`, `apps/server/test/voiceApi.test.ts`, `apps/server/test/orchestrator.test.ts`
- `apps/web/src/features/voice/VoicePanel.tsx`, `apps/web/src/features/voice/VoicePanel.test.tsx`
- `apps/web/src/services/voiceApi.ts`, `apps/web/src/features/projects/ProjectDetailPage.tsx`
- `apps/web/src/features/projects/ProjectFormFields.tsx`, `apps/web/src/features/projects/EditProjectDialog.tsx`
- `apps/web/src/features/projects/ProjectFormFields.test.tsx`, `apps/web/src/features/projects/ProjectDetailPage.test.tsx`, `apps/web/src/index.css`

### Verification

- `npm run typecheck` — passed.
- `npm test` — passed: shared **117**, MCP **10**, server **246**, web **57** tests (**430 total**).
- `npm run build` — passed for all workspaces.
- `cd apps/server && npx drizzle-kit check` — passed (“Everything's fine”).

### Open issues

- No known functional issues remain. The build reports non-fatal Rollup comment-position and bundle-size warnings.
