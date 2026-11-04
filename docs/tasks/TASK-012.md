# TASK-012 — FFmpeg render

RENDER turns the approved timeline (TASK-011) into one MP4. It is pure code with 0 LLM calls. FFmpeg comes from the existing `ffmpeg-static` and `ffprobe-static` dependencies, and `FFMPEG_PATH` / `FFPROBE_PATH` still override them.

## 1. Steps (`apps/server/src/services/renderService.ts`)

### 1.1 Scene clips
There is one clip per scene, cached at `render/clips/<hash>.mp4`. The hash covers:
- the render format version and the target;
- the frame counts;
- the visuals: path, file size and mtime, plus motion;
- the fades.

How a clip is built:
- **Image:** the first frame only, then:
  - scale to cover the frame at 2× the target size (this reduces zoompan jitter), then crop;
  - `zoompan`, moving from `motion.from` to `motion.to`: `{zoom, x, y}`, where x and y are the centre as fractions of the image, eased with smoothstep;
  - exactly `frames` frames.
- **Placeholder:** a grey `color` source (#374151). Grey rather than black, so blackdetect does not flag it.
- **Several visuals in one scene:** they are concatenated. Frame counts come from the visuals' times, and the last visual takes the remainder, so the sum equals `durationFrames`.
- **Fades:** `fade` in and out inside the clip, from black.
- **Encoding:** `libx264 -preset veryfast -crf 20 -pix_fmt yuv420p`, at the target fps, with no audio.

### 1.2 Final pass
The final pass is a single FFmpeg command. The filtergraph is written to a file (`-filter_complex_script`) so the Windows command-line length limit never bites.
- **Video:**
  - the concat demuxer over the clips;
  - burned ASS subtitles when subtitles are on. The ASS file is copied into the render folder and passed by relative name, so Windows drive paths are never escaped.
- **Voice:** each voice file is resampled to 48 kHz stereo, then `adelay`ed to `voice.startSec`. The voices are mixed with `amix normalize=0` and padded or trimmed to the total length.
- **Music:**
  - `-stream_loop -1` when `loop` is set; `atrim` from `startOffsetSec`;
  - `volume` from the music volume setting;
  - ducking as a deterministic `volume` expression over the known voice intervals. Intervals closer than 0.6 s are merged, and each has a 0.25 s ramp. The gain is `10^(duckingDb/20)`;
  - `afade` in and out.
- **Master:** `loudnorm I=-14 TP=-1.5 LRA=11`, then 48 kHz, AAC 192 kbps.
- **Output:** `+faststart`, written to `render/output.mp4`, with progress parsed from `-progress pipe:1`.

### 1.3 Credits and sidecars
- **`render/credits.txt`:** per scene, every used visual with its title, author, license name, license URL, source URL and attribution text; then the music; then the license summary. License is metadata only, so a missing license prints "chưa rõ" and never blocks.
- **`render/subtitles.srt`:** a copy of the retimed SRT, for platforms that take a subtitle file.

### 1.4 Checks (code only)
- **ffprobe:**
  - the duration is within ±0.2 s of the timeline;
  - the width and height match the target;
  - a video stream and an audio stream are present.
- **`blackdetect d=1 pix_th=0.10`:** reports black intervals longer than 1 s, mapped to scenes.
- **Mid-frame thumbnails:** one JPEG per scene, 320 px wide, saved as `render/thumbs/<sceneId>.jpg`. The UI shows them, and the MAX vision check reuses them later.
- **Report:** `{ ok, issues[] }`. Issues are warnings and never delete the output.

**Not in this task:**
- The MAX vision check on frames (TASK-004G §6). The LLM providers have no image input yet; it gets its own task once they do.
- The subtitle timing check: cues are built from the same voice offsets, so they cannot drift.

## 2. Caching and staleness
- **The render input hash** covers:
  - the timeline `inputHash`;
  - the render format version;
  - the subtitle file content;
  - the hashes of each clip.

  When the hash matches the latest render and its file exists, RENDER reuses that render without running FFmpeg.
- **Staleness:** anything that rebuilds the timeline already marks RENDER stale (`markStaleFrom`).
- **Cancel:** aborting the job kills FFmpeg. Partial outputs are written to `*.part.mp4` and renamed only on success.

## 3. Storage
The `renders` table has these columns:
- id, project_id, input_hash, status (DONE / FAILED), output_path, credits_path, srt_path;
- duration_sec, size_bytes, width, height, report (JSON), created_at.

The latest row is the current render. TASK-013 builds versioning on these rows.

## 4. API
- `GET /api/projects/:id/render`: `{ render: Render | null }`.
- `GET /api/projects/:id/render/video`: the MP4, with Range support so the player can seek.
- `GET /api/projects/:id/render/credits` and `/render/subtitles`: downloads.
- `GET /api/projects/:id/render/thumbs/:sceneId`.

## 5. Web: the Render tab
- **Status line:** RENDER stage state and progress.
- **Buttons:** "Render" or "Render lại" (runs RENDER), plus "Tải video", "Tải credits" and "Tải phụ đề".
- **A `<video>` player.**
- **The report:** duration, size, resolution and issues.
- **The thumbnail strip:** one per scene, labelled with the scene name.
- **No timeline yet:** the tab says to finish the Timeline tab first.

## 6. Tests
- **Pure builders:**
  - frame split;
  - zoompan expressions;
  - ducking expression and interval merging;
  - the filtergraph for voice and music;
  - credits text.
- **Service with a fake FFmpeg runner:**
  - the argument flow;
  - the clip cache is reused;
  - the whole render is reused when the hash matches;
  - a failure leaves no output;
  - abort kills the process.
- **One real-FFmpeg smoke test:** a tiny 160×90, 2-scene timeline with a generated image and a sine-tone voice. It checks the ffprobe duration and the report.
- **Web:** the empty state, and the render view with player, report and thumbnails.
- **No network**, no TTS and no LLM in tests.
