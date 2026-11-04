# TASK-011 — Timeline: one clock for voice, visuals, music and subtitles

Implemented by the architect (Copilot quota is used up). Pure code, 0 LLM calls in every budget mode.
Takes in the reasonable points from `docs/reviews/2026-11-04-external-critique.md`:
- a strict media contract;
- fades inside clips, so durations never change;
- hashes that include settings;
- subtitles retimed on the timeline clock.

## Contract (`packages/shared/src/schemas/timeline.ts`)
`Timeline` has `formatVersion` and `target {width, height, fps}` (from the aspect ratio):
- 16:9 → 1920×1080;
- 9:16 → 1080×1920;
- 1:1 → 1080×1080;
- 30 fps for all of them.

It also has:
- `totalDurationSec`;
- `scenes[]`, where each scene holds:
  - its start, end, duration and `durationFrames`;
  - `voice` or null;
  - `visuals[]`: IMAGE or PLACEHOLDER, with the motion and the license;
  - its fades;
- `music` or null: loop, offset, volume, fades, ducking, license;
- `subtitles {srtPath, assPath, cueCount}` or null;
- `warnings[]`;
- `licenseSummary`.

## Rules (`packages/shared/src/timeline/build.ts`)
- **Scene order** is `scenes.order`. Every scene starts on a frame boundary at 30 fps.
- **A voiced scene** lasts 0.1 s lead + voice + 0.3 s tail.
  - A manual duration override can make it longer, never shorter.
  - A shorter override is ignored with the warning `DURATION_OVERRIDE_TOO_SHORT`.
- **A silent scene** lasts the override, else the estimate, with a minimum of 1 s.
- **Fades:**
  - 0.5 s in at the start of the video;
  - 0.8 s out at the end;
  - 0.25 s between scenes;
  - always inside the clip and capped at a third of the scene, so no overlap ever changes the length.
- **Visuals:**
  - ready slots split the scene evenly;
  - the default motion alternates Ken Burns zoom in and zoom out;
  - with no ready slot the scene gets a PLACEHOLDER, with the warning `VISUAL_MISSING` or `VISUAL_NOT_APPROVED`;
  - a `noVisual` scene gets no warning.
- **Music:**
  - loops when the track is shorter than the video;
  - "No music" or music disabled means there is no track and no warning;
  - music enabled but not ready gives `MUSIC_NOT_READY`.
- **Licenses** produce warnings only:
  - `LICENSE_UNKNOWN`;
  - `LICENSE_NON_COMMERCIAL` for the NC kinds.

  They never block. `licenseSummary` counts the kinds, and TASK-012 writes `credits.txt` from it.

## Server
- **Table** `timelines` (one row per project), migration `0012`.
- **`TimelineService`:**
  - collects the scenes, voice tracks, visual selections with their candidates, music, subtitle cues and settings;
  - hashes them, together with the format version and `maxCharsPerLine`;
  - reuses the row when the hash and the subtitle files are unchanged;
  - otherwise builds the timeline;
  - writes the retimed `timeline/subtitles/subtitles.srt` and `.ass` (which fixes the subtitle offset after silent scenes);
  - updates `projects.duration_sec`.
- **Errors** are `StageError`, not retryable:
  - `TIMELINE_NO_SCENES`;
  - `VOICE_TRACK_MISSING`;
  - `VOICE_FILE_MISSING`;
  - `SUBTITLE_TRACK_MISSING` (only when subtitles are on).
- **Stage** `TIMELINE`: `TimelineExecutor`.
- **Gate** `FINAL_APPROVAL` opens only once a timeline exists. The AUTO path now checks every gate's `canApprove`.
- **API:** `GET /api/projects/:id/timeline` → `ProjectTimeline`.

## Web
The Timeline tab's `TimelinePanel` shows:
- the duration, resolution and fps;
- "Chạy bước Timeline" and "Duyệt & render";
- the warnings, marked as not blocking, and the license summary;
- proportional tracks (Hình / Giọng / Nhạc / Phụ đề) and a scene table.

## Tests
- shared: 7 builder tests;
- server: 4 tests (executor, reuse, no music or subtitles off, errors, API);
- web: 2 panel tests.
