# TASK-036 — Cursor guide (auto thumbnails)

Read `docs/cursor/README.md` first. Here is what exists today:
- the metadata step already produces `thumbnailText` (2 short overlay ideas);
- `projects.thumbnail_path` exists, but nothing fills it (it is always null);
- the YouTube publisher already calls `thumbnails.set` when a landscape publication has `thumbnailPath`.

This task generates thumbnails and covers for every render and uses them when publishing.

No new npm dependencies. Use ffmpeg (already used by the render) for frame grabs and compositing. Fonts come from the existing subtitle font setup.

## 1. Candidate frames (code)
After a successful render, pick up to 8 candidate frames from the final video:
- one per scene at 40% of the scene duration, skipping the first 0.5 s of fades;
- plus the hook scene at 1.0 s.

Extract them with `ffmpeg -ss <t> -i <video> -frames:v 1` as PNG at the render resolution. Score each frame in code:
- sharpness: variance of the Laplacian via ffmpeg `blurdetect` or a simple edge-count proxy (pick whichever ffmpeg filter is available in the bundled ffmpeg, and check with a capability probe);
- brightness: mean luma between 60 and 200 is best;
- not mostly one colour.

Drop the black or blank frames.

## 2. AI pick (optional, LLM vision)
Add a new LLM task `thumbnailPick` (stage RENDER, tier fast, vision, budget feature). Look at how `visionVerify.ts` sends images, and reuse it.
- Send the top 4 frames by score (downscaled to 512 px), the video title and the `thumbnailText` options.
- It returns the best frame index, the best overlay text (≤ 32 chars, may rewrite the idea), and the text position (`top` | `bottom` | `center`), avoiding faces and subjects.
- When the budget mode or the provider has no vision, fall back to the highest code score, the first `thumbnailText`, and position `bottom`.

## 3. Composite (ffmpeg)
Make one thumbnail per aspect needed by the project's target accounts:
- **YouTube landscape:** 1280×720 JPG, ≤ 2 MB (the YouTube limit). Lower the quality until it fits.
- **Vertical cover** (TikTok/Reels/Shorts): 1080×1920 JPG.

Styling:
- the frame is cropped or scaled to fill (center crop; use the subject position if the LLM gave one);
- a subtle dark gradient behind the text;
- big bold text: max 2 lines, auto-fit the font size, a stroke/outline and a shadow;
- the profile brand colour (profiles have a hex colour) for one highlighted word;
- escape the text for the ffmpeg `drawtext` filter (`:` `'` `\` `%`).

Vietnamese diacritics must render: use the same font file as the subtitles, and add a test with "Bí ẩn đại dương".

Store the files under the project's render output dir. Save:
- `projects.thumbnail_path` for landscape;
- a new `projects.cover_path` for vertical (migration via drizzle-kit);
- `thumbnail_meta` json (frame time, text, position, source `ai` | `auto` | `manual`).

## 4. Use when publishing
- **YouTube:**
  - landscape uses the existing `thumbnails.set` path;
  - Shorts cannot get a custom thumbnail through the API, so skip it and add no warning.
- **TikTok Direct Post:** set `post_info.video_cover_timestamp_ms` to the chosen frame time. TikTok has no image upload for covers.
- **Instagram Reels:** set `thumb_offset` (ms) to the chosen frame time. `cover_url` needs a public URL, which this local app does not have, so do not use it.
- **Facebook Reels:** if the Reels publish API in the current Graph version accepts a thumbnail upload, use it. Otherwise skip it and record a one-line warning in the publication warnings.

## 5. Manual override (Web)
In the project's Publish panel (or render result), add a "Thumbnail" card:
- the current thumbnail and cover;
- the candidate frames as a grid; clicking one recomposes;
- a text field and position select, with "Tạo lại";
- "Tải ảnh lên" to use the user's own image (PNG/JPG ≤ 5 MB, resized to the target sizes).

Manual choices set source `manual`, and an automatic re-render does not overwrite them unless the user presses "Tạo lại tự động".

Automation projects (TASK-028) generate the thumbnail automatically before publishing, with no gate.

## 6. Tests (no network, mock LLM, ffmpeg allowed only if the existing render tests already run it; otherwise mock the ffmpeg runner like the render tests do)
- The frame pick skips fades and black frames, and the score ordering works.
- An LLM pick is used when available; the fallback is used when the budget or vision is unavailable.
- The drawtext escaping covers `: ' \ %` and Vietnamese text.
- The YouTube JPG is ≤ 2 MB (the quality loop).
- Publishing:
  - YouTube landscape sends the thumbnail;
  - a Short does not;
  - TikTok gets `video_cover_timestamp_ms`;
  - IG gets `thumb_offset`.
- A manual choice survives the automatic regeneration.
- Web: selecting a frame calls the API, and an upload validates the size and type.

## Done
Done checklist from the README. Write `docs/tasks/TASK-036.report.md` and `docs/tasks/TASK-036.done`.
