# TASK-139 — Fast previews for agents: frame, scene contact sheet, 3-second clip 👁⚡

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** M. **Migration:** none (previews are files plus an `app_settings` index, or derived on demand). **New dependency:** none.
**Depends on:** 068/070 (compose render), 109/111 (`style/frames.ts`, `style/preview.ts`). It may run beside 136. It does not edit `node/*`, `providers/llm/*` or `api/llm*`.
**Source:** RESEARCH-076 P0 "fast frame, contact-sheet and 3 s previews for agents" and [SCALE-PLAN.md](SCALE-PLAN.md) row 4.

## Why

- An agent or a user only sees the result after the full RENDER: minutes per video.
- A wrong crop, unreadable text, an off-topic footage shot or a broken template is found too late, and the fix costs a whole re-render.
- The compose engine already renders one scene at a time (`compose/composeService.ts` `renderSceneClip`, `compose/render/{still,footage,graphic}.ts` `renderShot`). Style preview (`style/preview.ts`) already renders 3 frames.
- A cheap preview at the timeline stage lets the agent check and repair before RENDER, and gives 140 the evidence it needs.

## Read first

- `compose/composeService.ts` (`renderSceneClip`, plan building), `compose/render/*`, `compose/hyperframes.ts`.
- `style/preview.ts` and `style/frames.ts` (frame extraction, hashing, caching).
- `stages/render/*` and `services/renderService.ts` (targets, sizes, scene clip cache by hash).
- `agents/toolDefs.ts`, `agents/visualToolkit.ts`, `registry/` (how tools are declared and their sources).
- `services/visionVerify.ts` (how images go to a vision model, if the caller wants that).

## Build

### 1. Preview service (`apps/server/src/preview/service.ts`)

- `previewFrame(projectId, { atSec | sceneId + offsetSec }, size)`: one JPEG frame of the composed shot at that time.
  - Render only the shot that covers that time, with the same code as RENDER but at preview size.
  - Size: 480 px on the long side by default, 1280 max.
- `sceneContactSheet(projectId, sceneId | "all")`: one JPEG grid with the first, middle and last frame of each shot.
  - Each tile carries the scene index, the shot kind and the time.
  - Reuse the tiling from TASK-090 if it is already in code. Otherwise put the tiling in a shared helper that 090 will reuse.
- `previewClip(projectId, sceneId, { startSec?, durationSec ≤ 3 })`: a low-res MP4 with that scene's voice and subtitles burned in.
  - 480p, `-preset ultrafast`, 15 fps.
- **Input:** the current timeline and compose plan. When TIMELINE is not DONE, use the scene plan and selections and say so in the result (`basis: "timeline" | "selection"`).

### 2. Cost and caching

- Cache key: sha256 of (shot spec from the plan, the input files' sha256, size, fps, the renderer version).
- Files go under `data/projects/<id>/preview/<key>.(jpg|mp4)` as the `ephemeral` class for 138.
- Budget per call: one frame under 3 s, a contact sheet for 10 scenes under 20 s, a 3 s clip under 15 s on the user's CPU. Measure and report the real numbers.
- Run through the resource governor (129b) as a light job class, so previews never starve RENDER. If the governor is saturated, refuse with `PREVIEW_BUSY` and a retry hint.

### 3. Agent tools and API

- Registry tools, all read-only and available to every source:
  - `preview_frame`;
  - `preview_contact_sheet`;
  - `preview_clip`.
- Each returns a file id, a URL on the app API, and the facts below. An MCP image content block is returned when the client supports images; otherwise the URL only.
- **Facts** (code, no LLM), returned with every preview:
  - per shot: kind, template, footage id, text on screen with characters per second;
  - safe-area overflow (text box outside the title-safe area of the aspect ratio);
  - average luma (too dark or blown out);
  - perceptual hash, and the distance to the neighbour shot (near-duplicate shots).
- API routes under `/api/projects/:id/preview/*`, same permission as reading the project.

### 4. UI

- Timeline page: "Xem trước nhanh" per scene (frame strip and a 3 s play button) and "Contact sheet" for the whole video.
- No auto-run on page load. The user or the agent asks for it.

## Mã nguồn mở có sẵn (open source)

- **FFmpeg `tile` / `select` filters**: contact sheets in one pass. Already used in the repo.
- **HyperFrames** (Apache-2.0, already vendored as a dependency): render one template shot at a time at small size.
- **Remotion `renderStill`**: idea of a still-frame API next to the full render. Not added (see ARCHITECTURE §11).

## Rules

- README rules 1–11. Tests use the existing fixture images and the fake ffmpeg path used by render tests where possible.
- Preview output never changes a stage state and never enters `inputVersion` (previews are derived data).
- Never render on the protected project `56374fb2-…`: previews are allowed there only as read-only frames from existing files. If that cannot be guaranteed, refuse with the standard protected-project error.

## Tests

- **Frame:** at a time inside shot k → only shot k is rendered (spy); the second call hits the cache.
- **Contact sheet:** N scenes → one image with the expected tile count; the facts list one entry per shot.
- **Clip:** duration ≤ 3 s, audio present, subtitles burned (probe stream count and duration).
- **Facts:** text outside the safe area is flagged; two near-identical shots are flagged; a dark frame is flagged.
- **Governor:** saturated → `PREVIEW_BUSY`.
- **Basis:** TIMELINE not DONE → `basis: "selection"`.
- **State:** stage states and input versions are unchanged after previews.

## Done

- [ ] preview service (frame, contact sheet, clip) + cache + governor class
- [ ] facts; tools; API; timeline UI
- [ ] tests; server + web suites; typecheck; build
- [ ] timing numbers in the report; user guide (Xem trước nhanh); skill note for agents in `.agents/skills/` (when to preview before render); changelog
- [ ] report → `docs/tasks/TASK-139.done`
