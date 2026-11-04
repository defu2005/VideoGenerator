# TASK-010 report

## Scope delivered

Background music stages: MUSIC_SEARCH, plus the MUSIC_REVIEW gate and a Music panel.

- **Sources**:
  - Openverse audio (category music);
  - a local library folder (`MUSIC_LIBRARY_DIR`, optional `library.json`);
  - user upload (≤ 30 MB, content sniffed);
  - a `mock` provider for tests.
- **Ranking is pure code** in `packages/shared/src/music` (0 LLM calls in every budget mode). It scores:
  - tag and genre overlap with the mood;
  - an instrumental bonus and a vocal penalty;
  - duration fit;
  - energy words;
  - a small commercial-license bonus.

  The license is metadata only, never a block.
- **The stage**:
  - reuses the last search when its hash is unchanged;
  - tolerates one provider failing, and fails retryably when all fail;
  - keeps the top 12 and preselects the top track for review;
  - never overrides the user's pick;
  - in AUTO mode, downloads and approves the top track, or falls back to "no music".
- **The gate** opens when a track is approved with a local file, or when "no music" is chosen, or when music is disabled.
- **API**: `GET /music`, plus `POST /music/search`, `/select`, `/none` and `/upload`, `PATCH /music/settings`, and `GET /music/:id/audio` (Range/206). Every change marks TIMELINE onward stale.
- **Web**: `MusicPanel` on the Music tab, with:
  - the current track and a preview player;
  - volume, fade in/out and ducking;
  - "Không dùng nhạc" and upload;
  - a search box and a candidate list with license badges and a "sẽ lặp lại" hint for short tracks;
  - "Duyệt nhạc → tiếp tục" when the gate is waiting.

## Decisions

1. The mix settings are stored on the selection: volume, fades, ducking −12 dB, start offset. TASK-011/012 read them.
2. Downloads reuse the image SSRF guard (blocked hosts, DNS resolution) and sniff the audio bytes.
3. **Live check finding:** Openverse matches every word, and audio search takes about 20 s.
   - The query no longer adds "instrumental".
   - The provider retries with shorter queries.
   - The timeout default rose to 30 s.
   - `POST /music/search` returns 502 with a Vietnamese message instead of an empty list when the provider failed.

## Validation

- `npm run typecheck`: clean.
- `npm test`: all pass.
  - shared: 129
  - server: 278 (12 new music tests)
  - web: 64 (1 new MusicPanel test)
  - mcp: 10
- `npm run build`: OK.
- **Live run** on project 56374fb2:
  - Upload of a generated mp3 → APPROVED/USER, duration 20 s probed, Range 206 OK.
  - The panel renders the track, mix controls and candidates.
  - Openverse returned HTTP 504 after 60 s during the check, an outage on their side. The app reported a clear error.

## Not done / follow-ups

- No real Openverse result was seen end-to-end because of the outage. Retry later from the Music panel.
- Music is not mixed into the video yet. That is TASK-011 (timeline) and TASK-012 (render).
