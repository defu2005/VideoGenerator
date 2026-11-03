# TASK-009 report

## Scope delivered

Implemented the subtitle-generation pipeline and locale-aware multi-language default TTS behavior. The work includes:

- Pure subtitle helpers for cue segmentation, wrapping, timing spread, SRT output, and ASS output.
- Subtitle stage execution with reuse/hash checks and file generation for `.srt` and `.ass`.
- Subtitle API support for read/edit/download behavior and stale invalidation.
- Voice default selection that prefers language match, then multilingual fallback, then English fallback with warnings.
- Web subtitle panel and voice-list ordering updates aligned to the project’s existing pipeline/UI patterns.

## Key decisions

1. Subtitle behavior is deterministic and code-only, without any LLM involvement.
2. Voice default selection is locale-aware and handles Vietnamese, English, locale-specific, multilingual, and fallback cases in order.
3. Subtitle generation reuses prior files when the input hash is unchanged to avoid unnecessary rewrites.
4. User subtitle edits are preserved while the narration/voice hash stays stable, and downstream stages are marked stale when subtitle content changes.
5. The web UI keeps subtitle editing and downloads aligned with project-stage conventions and existing project detail flows.

## Files of note

- `packages/shared/src/subtitles/index.ts`
- `packages/shared/test/subtitles.test.ts`
- `apps/server/src/lib/defaultVoice.ts`
- `apps/server/src/stages/subtitle/subtitleExecutor.ts`
- `apps/server/src/api/subtitles.ts`
- `apps/server/src/api/voice.ts`
- `apps/server/src/stages/voice/voiceExecutor.ts`
- `apps/web/src/features/subtitles/SubtitlePanel.tsx`
- `apps/web/src/features/projects/ProjectDetailPage.tsx`
- `apps/web/src/features/projects/ProjectFormFields.tsx`

## Validation

Executed successfully:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npx drizzle-kit check`

## Test counts

Current validation run:

- Shared: 121 tests passed
- MCP: 10 tests passed
- Server: 246 tests passed
- Web: 57 tests passed

## Open issues

No blocking issues remain at the end of the TASK-009 implementation and validation pass.

## FIX

Completed the TASK-009 follow-up fix set required by `docs/tasks/TASK-009-FIX.md`:

- Added the missing Drizzle migration for `subtitle_tracks` and removed the redundant `subtitle_tracks_project_idx` index so the schema matches the unique project FK.
- Fixed the subtitle writer to use a shared `writeSubtitleFiles(projectDir, cues, sceneOffsets, aspectRatio)` path for both stage generation and patch-time rewrites, with scene offsets applied to keep subtitle files in provisional absolute time order.
- Corrected the ASS font-size bug by falling back to a scaled size whenever `fontSize` is missing or `<= 0`, instead of producing invisible subtitles.
- Ensured `GET /api/projects/:id/subtitles` totals use narrated voice durations, `PATCH` rewrites the on-disk subtitle files consistently, and missing `.srt`/`.ass` downloads return `SUBTITLE_FILE_NOT_FOUND` instead of a 500.
- Applied the aspect-ratio-based subtitle default (`16:9` → 42, `9:16` → 28, `1:1` → 32) while still honoring explicit `settings.subtitles.maxCharsPerLine` overrides.
- Fixed `defaultVoiceFor` locale selection to prefer exact locale matches (`pt-BR` beats `pt-PT`) before same-language fallbacks, while keeping multilingual fallback logic and English fallback warnings intact.
- Added regression coverage for ASS font-size fallback and default voice selection.

## Validation

Executed successfully:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npx drizzle-kit check`

## Test counts

Current validation run:

- Shared: 122 tests passed
- MCP: 10 tests passed
- Server: 248 tests passed
- Web: 57 tests passed

## FIX2

Completed the TASK-009 follow-up fixes required by `docs/tasks/TASK-009-FIX2.md`:

- Registered the subtitle API routes in `buildApp`.
- Wrapped subtitle file output to the configured per-line width (two lines maximum), kept stored cue text unwrapped, and emitted ASS line breaks.
- Clamped absolute cue times to each voice track's scene duration and prevented overlaps between consecutive cues.
- Corrected the ASS default outline color to `&H00000000`.
- Grouped subtitle cues by scene in the web panel and made cue editing genuinely writable.
- Added the required subtitle executor, API, UI, and multilingual voice-group regression tests.

## Validation

Executed successfully:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npx drizzle-kit check` (from `apps/server`)

## FIX2 test counts

Current validation run:

- Shared: 122 tests passed
- MCP: 10 tests passed
- Server: 262 tests passed
- Web: 62 tests passed
