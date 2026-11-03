# TASK-004G — MAX mode: no token saving, verified visuals and verified render

## GOAL
Add budget mode **`MAX`** ("Tối đa chất lượng — không tiết kiệm token").

The product owner wants a mode where images, and later the rendered video, are **checked to actually fit** the narration. Cost is not a concern in this mode.

MAX uses every text feature at its strongest. It adds **vision verification** of image candidates, with an automatic re-search loop, and defines the **post-render verification** that TASK-012 will implement.

Being honest about limits: no system can *guarantee* fit. MAX guarantees that every scene is either **verified by a vision model above a threshold** or **explicitly flagged for the user**. A scene that failed or was never verified is never passed through silently.

## CONTEXT
- `docs/ARCHITECTURE.md` §4 (budget modes, LLM rules, per-task routing from TASK-004F), §6 (visual model, scene visual status).
- TASK-004F gives per-task routes (`visionCheck` task exists) and `usage.calls`.
- TASK-006 gives candidates, ranking and `assignDistinct`.
- TASK-007 gives local download of previews and selected images, plus the review UI.
- **Vision-capable transports** (verified 2026-11-03):
  - `copilot-cli` 1.0.105: `--attachment <path>` attaches an image file to the prompt.
  - ~~`gemini-cli`~~: Google sign-in for individuals discontinued (TASK-004H on hold). Use the `gemini` API provider (AI Studio key, free tier available) for Gemini vision.
  - `claude-cli`: allow read access to one temp dir (`--add-dir <dir> --allowedTools Read`) and reference the image path in the prompt.
  - `anthropic` / `gemini` / `openai`-compatible APIs: multimodal message content. The current adapters send text only and must be extended.
  - `mock`: deterministic fake scores for tests.

## DEPENDENCIES
TASK-004F (routing) and TASK-007 (local image download + review UI). Render verification (§6) is implemented in TASK-012, but its contract is defined here.

## REQUIREMENTS

### 1. Mode preset
`BudgetModeSchema` = `ECO | BALANCED | QUALITY | MAX | CUSTOM`. Everything from QUALITY, plus:

| Feature | MAX |
|---|---|
| research | deep (16 facts) + **fact-check pass**: one extra call that checks script claims against the research notes and fixes or softens unsupported claims |
| scriptReview | 2 passes (review → polish) |
| repairAttempts | 2 |
| outputHeadroom | 2× |
| sceneQueries | per-scene English `visualDescription` + 6 queries |
| visual search breadth | stop only at ≥ 16 relevant candidates per scene (instead of 8) |
| semanticImageRerank | on |
| **visionCheck** | **on** (MAX only, plus CUSTOM opt-in) |
| **visionRetryRounds** | 2 |
| **visionThreshold** | 7 / 10 |
| **renderVerify** | on (implemented in TASK-012) |
| musicAssist, metadata | on |

Estimate: ≈ 10 text calls + vision calls. Vision calls = scenes × ⌈5 images / imagesPerCall⌉ + retries. Show the estimate (calls, approximate tokens, premium requests where known) **before running, with no cap**. The UI labels MAX: "Không tiết kiệm token — kiểm tra ảnh bằng AI nhìn".

### 2. Vision capability
- `LlmProvider.capabilities = { vision: boolean, maxImagesPerCall: number }`:
  - copilot-cli: true, 5
  - claude-cli: true, 5
  - anthropic: true, 10
  - gemini: true, 10
  - openai-compatible: configurable `*_VISION=true`
  - ollama: model-dependent, default false
  - mock: true, 10
- Extend `generateStructured` with optional `images: { path: string, label: string }[]`. Each adapter sends images in its native way:
  - copilot `--attachment` (repeatable)
  - claude-cli: copy the images into a per-call temp dir, `--add-dir` + `--allowedTools Read`, then delete the dir afterwards
  - APIs: base64 parts
- Before sending, images are resized/compressed by code to ≤ 768 px on the long side (JPEG q80). **No new dependency:** use the FFmpeg binary (`ffmpeg -i in -vf scale=...`), which is required anyway for TASK-012. If FFmpeg is missing, fail preflight with `FFMPEG_MISSING` and a clear message.
- The vision cache key includes the image content hash + model.
- The `visionCheck` route must resolve to a vision-capable provider. If not, MAX **refuses to start VISUAL_SEARCH verification** with `VISION_PROVIDER_REQUIRED`. The UI links to `Cài đặt → Mô hình AI`. The user may then switch the mode or route; nothing is silently skipped.

### 3. Vision verification (VISUAL_SEARCH, MAX)
For each scene, after code ranking + text rerank:
1. Take the top 5 distinct candidates. Their previews must already be downloaded locally (TASK-007 downloader).
2. Make one vision call per scene (batches of `maxImagesPerCall`). Input: narration, `visualDescription`, project aspect, and the labelled images. Output per image:
   ```
   { fit: 0–10, depicts: string, issues: ("watermark"|"text_overlay"|"wrong_subject"|"wrong_era"|"low_quality"|"collage"|"nsfw"|"logo_only")[], cropOk: boolean }
   ```
3. Final score = 0.5 × vision fit/10 + 0.3 × text rerank + 0.2 × code score. Issues `watermark`, `wrong_subject` and `nsfw` cap the fit at 3.
4. If the best fit < threshold:
   - **re-search round:** one text call turns the vision feedback (`depicts` / `issues`) into 3 new queries
   - search and rank again
   - vision-check the new top 5
   - up to `visionRetryRounds`
5. Select by final score, respecting `assignDistinct` (no reuse across scenes).
6. Store `visionCheck` on each checked candidate: `{ fit, depicts, issues, cropOk, model, checkedAt }`. Store scene `visualStatus`:
   - `REVIEW_REQUIRED` if verified ≥ threshold
   - **`NEEDS_ATTENTION`** if still below threshold, with a reason
7. **Cross-scene consistency (1 call, MAX):** send all selected images (as thumbnails in batches) with their scene descriptions. Ask for inconsistent style or era and accidental duplicates. Flag the affected scenes.
8. In **AUTO + MAX**, scenes with `NEEDS_ATTENTION` still stop at `VISUAL_REVIEW`. AUTO may skip the gate only when every scene is verified.

### 4. Review UI additions (TASK-007 surfaces)
- Per candidate: vision fit badge (e.g. "AI nhìn: 8/10"), the `depicts` text, issue chips.
- Per scene: a "Đã kiểm tra bằng AI" or "Cần bạn xem" banner, plus the re-search history (queries tried and why).
- "Kiểm tra lại bằng AI" button on any candidate (one vision call; the estimate is shown first). It works in every mode, as an explicit user action.

### 5. Custom URL / upload in MAX
User-provided images are also vision-checked (informational only, never auto-replaced).

### 6. Render verification contract (implemented in TASK-012, MAX + optional elsewhere)
After render:
- **Code checks:**
  - ffprobe: duration ≈ timeline
  - every scene has a frame at its midpoint
  - audio present, loudness in range
  - subtitle timing within voice segments ±150 ms
  - no black or frozen frames longer than 1 s
- **Vision check:**
  - extract the mid-frame of every scene with ffmpeg
  - batch vision calls: does the frame show the selected image (not black, not mis-cropped so the subject is cut off)?
  - is the burned subtitle legible and not covering the subject?
- **Result:** `renderReport` with pass/fail per scene. Any fail → the render is marked `NEEDS_ATTENTION`, AUTO cannot auto-approve, and the UI lists the scenes with a "Sửa scene này" link.

### 7. API / MCP
- Estimate endpoint includes MAX, with vision call counts per stage.
- `POST /api/projects/:id/scenes/:sceneId/visuals/:candidateId/vision-check` (explicit single check).
- MCP: `get_scene_visuals` includes `visionCheck`.

## LLM calls (per 30-scene video, MAX)
- Text: ≈ 10 (research, fact-check, script, review ×2, scene queries, alt queries, rerank, music, metadata) + ≤ 2 re-search calls per failing scene.
- Vision: 30 scenes × 1–2 calls + retries (≤ 2 rounds per failing scene) + 1–6 consistency calls. Render verification ≈ 30 / imagesPerCall calls.
- Everything is shown in the estimate before running. There is no cap, but the user can cancel at any time (`AbortSignal` honoured between scenes).

## DO NOT
- Do not enable vision outside MAX/CUSTOM except through the explicit per-candidate button.
- Do not send full-resolution images (≤ 768 px only).
- Do not send images to a provider that is not vision-capable.
- Do not let MAX hide or auto-skip a failing scene.
- Do not add npm dependencies (use the FFmpeg binary). Do not hand-write migrations. Tests must not hit the network or real CLIs. Do not commit.

## ACCEPTANCE CRITERIA
1. Checks pass (typecheck/build/test/drizzle/audit).
2. Mock vision: a scene whose top candidates score < 7 triggers a re-search round and then passes. A scene that never passes ends `NEEDS_ATTENTION` and stops AUTO at the gate.
3. A live run with `copilot-cli` as the vision route on the AlphaGo fixture (≥ 10 scenes) records vision calls in `usage.calls` and per-candidate `visionCheck`. Report the fit distribution and the number of re-searched scenes.
4. Without a vision-capable route, MAX fails fast with `VISION_PROVIDER_REQUIRED`, and the UI explains how to fix it.
5. The estimate shows the MAX numbers before running.

## REPORT BACK
`docs/tasks/TASK-004G.report.md` + empty `docs/tasks/TASK-004G.done`.
