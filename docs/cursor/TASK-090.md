# TASK-090 — The agent reviews its own render (`review_render`) 👀

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M. **Migration:** yes, the `render_reviews` table (🗄; one migration task at a time); drizzle-kit only. **New dependency:** none; ffmpeg is already used.
**Depends on:** TASK-085.

## Why

Today nobody "watches" the finished MP4 before the review gate: the checks look at the plan, not the output. Problems such as these are only found by the user:
- frozen frames and black gaps;
- text too dense to read, or captions off-sync;
- loudness jumps;
- a cut landing mid-word.

Code can measure the facts, and an agent (Hermes, the operator or the in-app LLM) can look at a contact sheet and judge.

## Read first

- `apps/server/src/review/` (the TASK-018 review chat), `originality/`, and `style/frames.ts` (TASK-109 already extracts frames and hashes; reuse it).
- The render output layout: the MP4, the word timings, the compose plan and the subtitles.
- `docs/ARCHITECTURE-TARGET.md` §3 `render_reviews`.

## Build

1. **Facts (code, ffmpeg + data we have).** `buildRenderReview(renderId)` produces:
   - a **contact sheet**: one JPEG grid, one frame per shot plus every 3 s, with the time on each tile, kept under `data/renders/<id>/review/`;
   - a **timed transcript** from the word timings, and the **cut list** with shot times, kinds and templates, flagging cuts within 80 ms of a word's middle;
   - **loudness**: integrated LUFS, true peak, and the momentary range per 1 s (ffmpeg `ebur128`), flagging jumps over 6 LU between scenes and LUFS off the platform target;
   - **text density**: characters per second on screen per shot, from the plan, flagging any above a threshold (later a TASK-088 param);
   - **black and frozen frames** with ffmpeg `blackdetect` and `freezedetect`;
   - **caption sync**: the subtitle start minus the word start, as p50 and p95.
2. **Table `render_reviews`** (ARCHITECTURE-TARGET §3): render id, `publicationId?`, kind (`pre_publish` now; `post_7d` is filled by TASK-089), facts JSON, contact sheet path, issues, judge (none, llm or agent), verdict (`ok|fix|block`), notes, created_at.
3. **Judgment.**
   - QUALITY mode: one vision LLM call with the contact sheet and facts returns a verdict plus up to 5 concrete fixes, each naming a shot.
   - BALANCED: code issues only, with an LLM only if a code issue is `block`.
   - ECO: code only.
   - The result shows at the review gate and in the originality panel area.
   - A `block` moves the project to manual review; it never re-renders on its own.
4. **Tools.**
   - `review_render(renderId)`: safe; it builds the facts if they are missing and returns them, plus the contact sheet path or URL so Hermes can look at the image.
   - `record_render_review(renderId, verdict, notes)`: safe, with the actor recorded.

   Update the `video-render-va-thumbnail` skill: after each render, call `review_render` and give the user a short verdict.

## Mã nguồn mở có sẵn (open source)

- **ffmpeg** filters `ebur128`, `blackdetect`, `freezedetect`, `tile` (LGPL/GPL, already a runtime dependency): use them, do not reimplement.
- **auto-editor** (Unlicense) and **PySceneDetect** (BSD-3) are references for cut and silence detection. Copy the threshold ideas with credit, not the code.
- **EBU R128 / YouTube −14 LUFS** guidance for the targets.

## Rules

README rules 1–11. Never render on the protected project. A review never changes the render.

## Tests

On a tiny ffmpeg-generated MP4 (made in the test, no network):
- black and freeze detection;
- loudness numbers;
- a cut near a word middle is flagged;
- text density;
- the contact sheet file exists with the right tile count;
- ECO makes no LLM call;
- an injected vision verdict is stored;
- a `block` goes to manual review;
- the tools.

## Done

- [ ] facts + contact sheet + table
- [ ] mode-based judgment; gate routing
- [ ] tools + skill update
- [ ] tests; suites; migration
- [ ] user guide + changelog
- [ ] report `docs/tasks/TASK-090.report.md` with one real contact sheet from the dev DB (read-only, not the protected project), then `docs/tasks/TASK-090.done`
