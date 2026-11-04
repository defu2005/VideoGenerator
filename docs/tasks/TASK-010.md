# TASK-010 — Background music: search, ranking, Music Review

Implemented by the architect (Copilot quota is used up). 0 LLM calls in every budget mode.
`musicAssist` stays a hook for later.

## Sources (verified 2026-11-04)
- **Openverse audio** (`https://api.openverse.org/v1/audio/?q=…&category=music`): no key, CC
  tracks (mostly Jamendo) with tags, genres, duration (ms), license, creator. Jamendo `url`
  downloads directly (`audio/mpeg`). Reuse `OPENVERSE_CLIENT_ID` when set.
- **Local library** `MUSIC_LIBRARY_DIR` (default `<DATA_DIR>/music`): mp3/wav/ogg/m4a files.
  Optional `library.json` `[{ file, title?, artist?, tags?, mood?, license? }]`. Duration via
  ffprobe.
- **User upload** in the Music panel (mp3/wav/ogg/m4a ≤ 30 MB).
- `mock` provider for tests.
- Config `MUSIC_PROVIDERS` (default `openverse,local`; tests use `mock`).
  `MUSIC_SEARCH_TIMEOUT_MS` defaults to 30000 (Openverse audio often takes about 20 s).

## Ranking (pure code, `packages/shared/src/music`)
- Query from the script's `music` (mood + keywords) and the scenes' `musicMood`. No
  `instrumental` word: Openverse matches every word, so extra words empty the results.
  The Openverse provider retries with shorter queries (first + last word, then first word)
  when a query finds nothing.
- Score:
  - tag and genre overlap with the mood words;
  - an instrumental bonus, and a penalty for vocal tags (vocals clash with narration);
  - duration fit (≥ video duration is best; shorter tracks loop with a small penalty;
    under 20 s is dropped);
  - energy words;
  - a small bonus for licenses that allow commercial reuse. The license is never a hard block.

## Stage behaviour
- **MUSIC_SEARCH**:
  - `settings.music.enabled === false` → no search; selection `NONE`.
  - Otherwise: hash of query, providers and duration bucket. Same hash and candidates still
    there → reuse.
  - Else search every provider (one failing provider does not fail the stage), rank, and keep
    the top 12. Uploaded candidates are kept.
  - The top track is preselected (`REVIEW_REQUIRED`, AGENT) unless the user already picked one.
  - AUTO mode downloads the top track and approves it.
- **MUSIC_REVIEW gate**: can be approved when the selection is `APPROVED` with a local file,
  or `NONE` (no music), or music is disabled.
- **Selection** stores `volume` (project default), `fadeInSec` 2, `fadeOutSec` 3,
  `duckingDb` -12, `startOffsetSec` 0. TASK-011/012 use these.

## API
- `GET /api/projects/:id/music` → `{ enabled, query, mood, candidates, selection, selectedCandidate, videoDurationSec }`.
- `POST /music/search {query?}`: saves the query override, forces a new search, preselects
  the top track (unless the user picked one), and marks stale. It returns 502
  `MUSIC_SEARCH_FAILED` when no tracks were found because a provider failed.
- `POST /music/select {candidateId}`: downloads the track (SSRF guard as for images; sniff
  mp3/ogg/wav/m4a/flac), probes its duration, and sets it `APPROVED` by the USER.
- `POST /music/none`: sets the selection to `NONE`.
- `PATCH /music/settings`: `{ volume?, fadeInSec?, fadeOutSec?, duckingDb?, startOffsetSec?, query? }`.
  The query override is used by the next search.
- `POST /music/upload`: raw audio or multipart.
- `GET /music/:candidateId/audio`: serves a local file, with Range support.
- Any selection or settings change runs `markStaleFrom(…, "MUSIC_REVIEW")`.

## Web
The Music tab:
- The current track: player, volume, fades, ducking, "Không dùng nhạc".
- The candidate list: remote preview player, tags, duration, license badge, "Dùng bản này".
- A search box with "Tìm nhạc" (saves the query and runs MUSIC_SEARCH).
- Upload.
- "Duyệt nhạc" when the gate is waiting.

## Tests
- Ranking.
- Openverse parsing with a fake fetch.
- The local library with a fake probe.
- The executor: reuse, a provider failing, keeping the user's pick, AUTO approve.
- The API: select/none/settings/upload/audio Range.
- The gate check.
- Web panel.
