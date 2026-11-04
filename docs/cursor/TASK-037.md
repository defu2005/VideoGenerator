# TASK-037 — Cursor guide (long video → Shorts / Reels clips)

Read `docs/cursor/README.md` first. Projects default to 16:9 long-form. This task turns a finished long render into several vertical 15–60 s clips and adds them to the publish schedule as their own projects.

No new npm dependencies.

## 1. Sources
- **App projects (main path):** a project with a successful 16:9 render. The script, scenes, voice and subtitle tracks already have timings, so no speech-to-text is needed.
- **External video (optional):** the user's own local file (mp4/mov/mkv, ≤ 4 GB) plus an optional `.srt`/`.vtt` for the transcript.
  - Without a transcript file, use a configured local speech-to-text CLI. Add a setting for `whisper` / `whisper.cpp` / `faster-whisper`, following how other CLIs are configured: path, args, and a detection test. If none is configured, disable the feature with the hint "Cần file phụ đề hoặc cấu hình công cụ nhận dạng giọng nói". Tests never run the CLI.
  - The user must confirm "Tôi sở hữu hoặc có quyền dùng video này" before an external import.

## 2. Pick the clips (LLM task `clipPick`, tier strong, budget feature)
- Input:
  - the timed transcript (sentences with start/end), merged into ≤ 6000 tokens; summarize long middles with timestamps kept;
  - the title;
  - the profile direction plus `learnedNotes` (TASK-035) if present;
  - the target count (default 3, max 8) and the length range (default 20–45 s, platform max 60 s for Shorts/TikTok, 90 s for FB Reels).
- Output, zod-validated:
  ```ts
  { clips: { start: number, end: number, hook: string /* ≤ 60 chars overlay for first 2s */, title: string, reason: string, score: number /* 0-100 */ }[] }
  ```
- Validate in code:
  - snap start/end to sentence boundaries (never cut a word);
  - enforce the length range;
  - no overlap above 20%;
  - drop clips whose first sentence starts mid-thought (begins with "và", "nhưng", "thì", "còn" or a lowercase continuation) unless the LLM hook covers it.
- Fallback without the LLM (budget): take the top sentences by keyword density near scene starts, in code.

## 3. Reframe to 9:16 (ffmpeg)
Per clip, cut `[start-0.15, end+0.25]`, then pick a reframe mode:
- **`center`** (default): crop the middle 9:16 of the 16:9 frame.
- **`blur-fill`**: the full 16:9 frame scaled to width 1080, centered over a blurred, zoomed copy that fills 1080×1920. Use it when the important content spans the width, such as text slides and charts. For app projects, if a scene has text overlays or is an infographic, use `blur-fill` for that scene's portion.
- **`smart`** (optional): the per-scene crop offset comes from the visual candidate's focus point if stored. Otherwise use `center`.

Then:
- **Subtitles:** re-generate them from the clip's transcript slice in the vertical style, which is larger and centered lower-third. Reuse the subtitle builder and shift the timings by `-start`.
- **The hook overlay** shows for the first 2 s, in the same drawtext styling as TASK-036.
- **Audio:** keep the voice and music from the original mix, with a 0.15 s fade in/out at the cut edges.
- **Loudness:** normalize like the main render.

## 4. Projects and schedule
- Each clip becomes a child project:
  - `parent_project_id` (new nullable column, migration);
  - `kind: "clip"`;
  - its own metadata (title from the clip, the description links the full video when it is published and the URL is known, plus hashtags from the parent).
- A child project skips the pipeline stages and goes straight to the RENDER output (the clip file), then to publish. It is not shown as a "draft" waiting for script approval.
- **Scheduling:**
  - automation profiles spread the clips over the profile's free slots (reusing TASK-028 slot logic), starting after the parent's publish time;
  - manual mode adds them to the calendar as SCHEDULED with suggested slots the user can drag or edit.
- Thumbnails/covers use TASK-036 on the clip.
- Clips only go to vertical-capable accounts (TikTok, Shorts on YouTube, FB/IG Reels) in the same profile.

## 5. UI
The project page of a long render gets a "Tạo Shorts" panel:
- count, length range and reframe mode;
- a "Tạo đề xuất" button, then a list of proposed clips with the transcript snippet, an inline preview (HTML5 video with `#t=start,end` on the long render), editable start/end/hook/title, and checkboxes;
- "Xuất N clip" renders them (background jobs with progress), and they then appear as child projects linked from the parent.

External import lives on the Projects page: "Nhập video dài".

Profile automation gets the option "Tự cắt Shorts từ video dài" (count per long video). When it is on, clips are proposed and rendered automatically after the long render, with no user gate.

**Assistant (TASK-032):**
- confirm tool `make_shorts` (project, count);
- read tool `list_clips`.

## 6. Tests (mock LLM, mock ffmpeg runner, no network)
- Clip validation:
  - snapping to sentence edges;
  - the length range;
  - the overlap rule;
  - the mid-thought start rejection.
- The fallback picker without the LLM.
- The ffmpeg command builder for `center` and `blur-fill` (snapshot of the args); subtitle timing shift; the hook overlay window.
- Child project creation and slot spreading after the parent's publish time; only vertical accounts.
- External import:
  - refused without the ownership confirmation;
  - refused without a transcript or CLI;
  - an SRT parse works.
- Web: the proposals render, edits are sent, and export creates jobs.

## Done
Done checklist from the README. Write `docs/tasks/TASK-037.report.md` and `docs/tasks/TASK-037.done`.
