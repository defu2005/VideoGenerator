# TASK-104 — Video length and ad break suggestions ⏱️🔴

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`). **Size:** S. **Migration:** none expected. **New dependency:** none.
**Depends on:** TASK-091. It needs a channel **in YPP** for the RPM part; the length part works without it.

## Why

Length changes RPM: mid-rolls start at 8 min, and watch time changes with length. There is no API to place VOD mid-rolls (`docs/research/api-capabilities/youtube.md`), but we can suggest good break points and measure.

## Read first

- `docs/research/api-capabilities/youtube.md` (mid-roll section), `docs/research/monetization/streams.md`.
- The TASK-089 retention map and the script structure (sections).

## Build

1. **Length param.** `targetLengthBand` per profile in the TASK-088 registry (short < 4 min, mid 4–8, long 8–15, xl > 15). The script prompt aims at the band. The agent may set it within user bounds.
2. **`suggest_ad_breaks(projectId)`** (read): break points at section boundaries and natural pauses (word timings with a gap ≥ 400 ms), never within 30 s of the start or end, at least 2 min apart, and not in a sponsor segment (102b). Each point has its time and a reason.
3. **"Cần bạn" flow.** After publish, a request says "đặt mid-roll tại …" with a checkbox "đã đặt". The confirmation is stored, so the measurement knows which videos really had breaks.
4. **`get_length_stats(profileId)`** (read): RPM, watch time and retention by length band, and with or without confirmed breaks. It uses the same windows (087) and the n ≥ 5 rule (091).

## Mã nguồn mở có sẵn (open source)

- Nothing to adopt.

## Rules

README rules 1–11. Never claim breaks were placed without the user's tick.

## Tests

- the band in the prompt;
- the break rules (start and end, spacing, sponsor, pause);
- the "Cần bạn" tick stored;
- length stats with the n rule.

## Done

- [ ] param + suggest + request + stats
- [ ] tools; skill (`video-doc-so-lieu`)
- [ ] tests; suites
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-104.done`
