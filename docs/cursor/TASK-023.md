# TASK-023 — Cursor guide (Render variants: 16:9 and 9:16 from one project)

Read `docs/cursor/README.md` first. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
A profile can have a landscape account (YouTube) and vertical accounts (TikTok, Reels, Shorts). One project must give both videos **without** redoing research, script, voice, visuals or music. Only the render differs.

## First, investigate (write the findings in the report)
- How the renderer (`apps/server/src/render/` or wherever the FFmpeg graph is built) uses `settings.aspectRatio`: output size, image scaling/cropping (cover/contain, Ken Burns), subtitle position and line width.
- Whether the TIMELINE stage stores anything that depends on the aspect ratio. If it does, the variant must recompute that part in code (no LLM).

## What to build
- A render can carry a **variant**: `aspectRatio` (`16:9` | `9:16`). The project's own aspect ratio stays the main one.
  - `renders` table: add `aspect_ratio` (nullable means "project default") and `variant_of` (nullable render id). Drizzle generate.
  - `POST /api/projects/:id/render` accepts an optional `aspectRatio`. If it differs from the project's, the render uses the same timeline, voice, music and selected images, and only the frame size changes.
- **Image framing for vertical output:** scale to cover and crop to the centre. If the visual has stored focus data (vision fit or saliency, if any exists), use it to pick the crop centre. Otherwise centre. No LLM call.
- **Subtitles for vertical output:** narrower line width (about 60% of the landscape `maxCharsPerLine`, minimum 16), larger font relative to the width, placed in the lower third but above the bottom 15% safe zone that TikTok/Reels UI covers.
- **Duration rule:** vertical platforms prefer short videos. Do not cut the video automatically. In the render result, add a warning when a vertical variant is longer than 180 s (TikTok/Reels limits differ; just warn).
- The render history (TASK-013) shows the variant label ("Dọc 9:16" / "Ngang 16:9"). Export includes each variant.
- `POST /api/projects/:id/render-variants` renders, one after the other, every format that the project's profile accounts need and that has no finished render yet. It is used later by automation.

## Web
- On the render screen, a **"Định dạng"** select next to the render button (default: the project's). A "Render cho mọi tài khoản của hồ sơ" button when the project has a profile.
- The player shows vertical renders in a vertical frame.

## Tests (no network, FFmpeg allowed as the existing render tests use it)
- A 9:16 variant of a tiny fixture project renders with the right output size (ffprobe), without re-running earlier stages (job list shows only RENDER).
- Subtitle layout values for vertical (pure function test).
- `render-variants` picks the missing formats from the profile's accounts.

## Steps
1. Investigate and write findings.
2. Server: columns + drizzle generate, variant render path, framing, subtitles, `render-variants`, tests.
3. Web: format select, variant labels, vertical player + tests.
4. Done checklist. In the browser, render a 9:16 variant of a small throwaway project (never project `56374fb2-54cf-48ff-9441-2e6c653295d4`). Write `docs/tasks/TASK-023.report.md` and `docs/tasks/TASK-023.done`.
