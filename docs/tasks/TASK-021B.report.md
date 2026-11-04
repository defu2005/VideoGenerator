# TASK-021B report — edge-tts retry + NASA listed sizes

## What changed

### Server
- `apps/server/src/providers/tts/edgeTts.ts` — 6 attempts with backoff `NO_AUDIO_BACKOFF_MS = [3000, 10000, 20000, 40000, 60000]`; retries 2–6 pass `--pitch` cycling `+1Hz`, `-1Hz`, `+2Hz`, `-1Hz`, `+1Hz`; abort checked before each attempt and after each wait; Vietnamese `TTS_NO_AUDIO` message; one `console.warn` line per retry (file name, attempt, pitch; no text content).
- `apps/server/test/edgeTts.test.ts` — updated existing backoff expectations; added tests for pitch nudges after 2 failures, full 6-attempt exhaustion, abort during wait, and non-NoAudioReceived immediate throw.
- `apps/server/src/providers/images/nasa.ts` — `imageUrl` only from `links` with `render === "image"` (no `~thumb`→`~large` guess); prefer smallest longer-side ≥ 1920 else largest; skip > 25 MB; suffix rank when width missing; real width/height or 1280×720; drop when known longer side < 640; `previewUrl` from `rel === "preview"` or smallest image.
- `apps/server/test/fixtures/nasa-search-sizes.json` — three live shapes (full sizes, tiny orig, suffix-only).
- `apps/server/test/imageProviders.test.ts` — NASA listed-size selection test; legacy fixture asserts no guessed `~large`.

## Test counts

| Workspace | Before (TASK-021 report) | After |
|---|---|---|
| shared | 185 | **185** |
| mcp | 12 | **12** |
| server | 365 | **370** |
| web | 78 | **78** |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass. No schema/migration change. No `package.json` / lockfile change.

## Deviations from the spec

- None. Browser / live check deferred (guide: Claude runs live check after review).

## Not done

- Live verification of edge-tts / NASA on a throwaway project (deferred per guide).
- No commit/push (per rules).
