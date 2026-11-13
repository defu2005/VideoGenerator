# TASK-062 — Cursor guide (image crop tool, run on demand: crops a scene's image to the video's aspect ratio; images already at that ratio are cropped to 9/10 of their size)

**Scope: a tool only.** The pipeline does not call it. No stage crops images automatically, and search, ranking and assignment do not change. The crop runs only when the user, or an agent the user asked, starts it from the UI, the API or the registry tool. Render uses a crop only if one exists.

Read `docs/cursor/README.md` first. Tests never use the network or real LLM CLIs. Update the user guide, `featureMap` and `nhat-ky-thay-doi.md` (README rule 10).

No new npm dependencies. Image work uses `ffmpeg-static`, which is already a dependency. Schema changes go in `schema.ts`; then run `npx drizzle-kit generate` in `apps/server`.

**Order:** run after TASK-061. Both tasks touch the visual review UI. This task does not edit the search or assignment code in `visualService.ts`; it adds a separate service and edits `render/plan.ts` and the visual review UI.

## Why

Today the app never makes a cropped file. The render (`packages/shared/src/render/plan.ts`, `buildSceneClipPlan`) scales each image to cover the frame and crops it on the fly around `visual.motion.from`, or the centre. So:

- the user cannot see or change the real frame before render;
- the vision check (`cropOk`) only says yes or no and gives no crop box;
- an image that already has the video's ratio is used edge to edge, with its borders, corner logos and captions.

The user wants a crop tool to run on a scene's chosen image when they want it, not a pipeline step:

1. It crops the image to the video's aspect ratio.
2. If the image already has that ratio, it still crops it, to the **same ratio at 9/10 of its width and height**: width × 0.9, height × 0.9, so about 81% of the area. The user confirmed "each side" (mỗi chiều), not 90% of the area.

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| [smartcrop.js](https://github.com/jwagner/smartcrop.js) | MIT | Content-aware crop: scores skin, edges and saturation over candidate boxes. Its core (`smartcrop.js`, one file) works on a plain `{ width, height, data }` RGBA object, so it needs no canvas. Copy the core into `packages/shared/src/visuals/smartcrop.ts` and convert it to TypeScript. Keep the MIT notice and a link to the source commit in the file header. Do not add the npm package. |
| [FFmpeg](https://ffmpeg.org/) through `ffmpeg-static` | already used | Decode to raw RGBA at analysis size (`-vf scale=256:-1,format=rgba -f rawvideo -`) and write the final crop (`-vf crop=w:h:x:y`, lossless PNG or high-quality JPEG `-q:v 2`). |
| [react-easy-crop](https://github.com/ValentinH/react-easy-crop) | MIT | Only if `apps/web` already has it. Otherwise build the crop box editor with plain pointer events (a draggable box with a locked ratio). Do not add the dependency. |

If you find a better project, report it (README rule 11).

## Rules for this task

- Never approve gates or render on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Never overwrite the downloaded original. Crops are new files next to it, so a crop can be redone at any time.
- A crop made by hand by the user is never replaced by an automatic crop.
- Licence and attribution stay attached to the cropped file (same candidate id, same source). Cropping is a change; add "đã cắt" to the attribution text where the licence asks for changes to be marked (CC BY, CC BY-SA).

## 1. Crop rule (pure code in `@vg/shared`)

New `packages/shared/src/visuals/crop.ts`:

```ts
export type CropBox = { x: number; y: number; width: number; height: number }; // pixels of the original
export function planCrop(input: {
  width: number; height: number;          // original size
  targetAspect: number;                   // 16/9, 9/16 or 1
  focus?: { x: number; y: number };        // 0..1, centre of interest
  subjectBox?: CropBox;                    // must stay inside the crop if possible
  sameRatioScale?: number;                 // default 0.9
  ratioTolerance?: number;                 // default 0.02 (2%)
}): { box: CropBox; rule: "fit_ratio" | "same_ratio_scale"; keepsSubject: boolean };
```

- **Same ratio:** if `|width/height − targetAspect| / targetAspect ≤ ratioTolerance`, the box is `round(width × 0.9)` × `round(height × 0.9)`, then nudged to exactly the target ratio. `rule: "same_ratio_scale"`.
- **Different ratio:** the box is the largest box with the target ratio that fits inside the image (the full height for a wide target on a tall image, or the full width the other way). `rule: "fit_ratio"`. This rule applies no extra 9/10.
- **Position:** centre the box on `focus` (default: image centre), then clamp it inside the image. If a `subjectBox` is given and fits inside a box of this size, move the box the least needed to contain it. If it does not fit, keep the focus and set `keepsSubject: false`.
- Round to even numbers (video encoders need even sizes) and never leave the image.
- `sameRatioScale` and `ratioTolerance` are settings (section 4), with 0.9 and 0.02 as defaults.

Tests (`crop.test.ts`):
- 1920×1080 → 16:9 gives 1728×972, centred at (96, 54);
- 4000×3000 → 16:9 gives 4000×2250;
- 1080×1920 → 16:9 gives 1080×608;
- 1000×1000 → 1:1 gives 900×900;
- a focus near an edge is clamped;
- a subject box is kept when it fits, and `keepsSubject: false` when it does not;
- every result has the exact ratio (±1 px) and even sizes.

## 2. Where the focus comes from

First hit wins:

1. **The user's manual crop** (section 5).
2. **Vision subject box, if one is already stored:** extend the vision check result (`VisionCheckResultSchema` and the batch schema in `packages/shared/src/schemas/vision.ts`) with an optional `subject: { x, y, width, height }` in 0..1 fractions of the image: "the box around the main subject that matches the scene". Add one line to the vision prompt in `apps/server/src/stages/visuals/visionPrompts.ts`. The field is optional, so old cached results and models that skip it still parse. The tool reads a stored result only and never makes its own vision call.
3. **smartcrop:** run the ported smartcrop on a 256-px-wide RGBA decode, asking for the target ratio. Use its top box's centre as the focus. It is code only and costs nothing.
4. Image centre.

Store which source was used (`focusSource: "user" | "vision" | "smartcrop" | "center"`).

## 3. Crop service (on demand only)

- New service `apps/server/src/services/imageCrop.ts` with `cropSceneImage({ projectId, sceneId, aspect, box? })`:
  - decode the chosen image's original with ffmpeg;
  - plan with `planCrop`, or use the given `box` for a manual crop after checking its ratio and bounds;
  - write `<original>.crop-<aspect>.<ext>`, PNG for PNG sources, otherwise JPEG at `-q:v 2`;
  - return the path, the box, the rule, the focus source, the output size and `lowRes`.
- **Nothing in the pipeline calls this service.** The orchestrator, the visual stage, ranking (`rank.ts`), assignment (`assign.ts`) and the TASK-061 extra-search rounds stay exactly as they are. Add a test that runs the visual stage and checks that no crop row is created.
- Aspects: by default the tool crops for the project aspect. The caller may ask for any of 16:9, 9:16 or 1:1, or for "all aspects this project renders" (project aspect plus variants from `render/variants.ts`).
- Batch runs (many scenes) go through the job worker, at most 4 at a time, with a 20-second timeout each. Progress shows on the visuals page.
- New table `visual_crops`: id, candidate id, scene id, aspect, box (x, y, w, h), rule, focus source, `manual` flag, output path, output width and height, `lowRes`, created at. Unique on (candidate id, aspect). Generate the migration.
- **Resolution:** if the crop is smaller than the render size for that aspect, set `lowRes: true` and show a warning. The tool never searches for another image.
- **Subject cut off:** when `keepsSubject` is false, return the warning "Ảnh cắt có thể mất chủ thể — xem lại khung cắt".
- **When the chosen image changes**, the old crop no longer applies. Render ignores crops whose candidate id differs from the scene's current image, and the UI shows "Ảnh đã đổi — cắt lại?". The tool does not re-crop by itself.
- A batch run never replaces a `manual` crop unless the caller passes `overwriteManual: true`, which only the web UI can send.

## 4. Settings

Profile and project settings (project overrides profile). They change only how the tool crops, never when it runs:

- `visuals.crop.sameRatioScale`, default **0.9**, allowed 0.8–1.0 (1.0 means "do not shrink images that already fit");
- `visuals.crop.ratioTolerance`, default **0.02**.

The settings page explains the rule in one sentence and shows a small before/after diagram.

## 5. Web UI

- On the visuals page:
  - a "Cắt ảnh" button on each scene;
  - "Cắt ảnh tất cả cảnh" in the page's actions;
  - both offer an aspect choice (default: project aspect; or all render aspects).
- After a crop, the selected image (`apps/web/src/features/visuals/VisualReview.tsx`) shows the original with the crop box drawn on it, with a tab for each aspect that has a crop.
- "Chỉnh khung cắt" opens an editor:
  - a box with the ratio locked that can be dragged and resized;
  - buttons "Đặt lại tự động", "Bỏ ảnh cắt" (delete the crop and go back to the original) and "Lưu".
  - Saving calls `PUT /api/projects/:id/scenes/:sceneId/crop` with `{ aspect, box }` and sets `manual: true`.
- When a crop exists, scene thumbnails show the cropped file, so what the user sees is what renders. Scenes without a crop look as they do today.
- Show the rule as a small label: "Cắt theo tỉ lệ 16:9" or "Cắt 90% mỗi chiều (ảnh đã đúng tỉ lệ)", plus the focus source and a warning if `lowRes`.

## 6. Render

- `buildSceneClipPlan` uses the cropped file for the render target's aspect **only when a crop exists for the scene's current image**. The file already has the right ratio, so the scale-and-crop chain only scales.
- Without a crop, render is exactly as today: cover and crop around `motion.from`. Do not change that chain.
- Ken Burns motion (`zoompan`) works on the cropped image. When a crop exists, its centre is the default motion centre.
- No render check creates or requires crops.

## 7. Tools and API

- `POST /api/projects/:id/visuals/crop` with `{ sceneIds?: string[], aspects?: ("16:9"|"9:16"|"1:1")[] | "all" }` crops the chosen image of each scene (default: every scene that has one). It skips manual crops and returns a job id for batches.
- `GET /api/projects/:id/scenes/:sceneId/crop?aspect=` returns the box, rule, source, size and warnings.
- `PUT …/crop` is the manual crop, for the web UI only.
- `DELETE …/crop?aspect=` removes a crop and keeps the original.
- Registry tool `crop_scene_images` (risk `write`) for the assistant, MCP and operator:
  - it calls the same service as the POST route;
  - it cannot make or overwrite manual crops;
  - agents use it only when the user asks. Do not add it to any TASK-059 playbook or standing order.
- None of these run while the project is rendering, and none run on project `56374fb2-54cf-48ff-9441-2e6c653295d4` while it is rendering.

## 8. Tests

- `crop.test.ts` from section 1.
- `smartcrop.test.ts`: on a synthetic RGBA image with a bright block on the right, the focus is on the right half, and the output is deterministic.
- Vision schema:
  - old results without `subject` still parse;
  - a stored `subject` is used as focus;
  - the tool makes no vision call (the mocked LLM sees zero calls).
- `imageCrop` server test with a small generated image (create it in setup with ffmpeg, or skip with a clear message if there is no binary):
  - a 16:9 1920×1080 source gives 1728×972;
  - a 4:3 source gives the full-height 16:9 crop;
  - the original is untouched;
  - a manual crop survives a batch run.
- Pipeline test: a full visual stage run creates no `visual_crops` rows and no crop files.
- `render/plan` tests:
  - a crop for the current image gives a chain with no crop filter;
  - a crop made for an old image is ignored;
  - with no crop, the chain is unchanged from today.
- Web test: the editor keeps the ratio while dragging and resizing, and saving sends the box.
- Tool test: `crop_scene_images` rejects `overwriteManual`.

## 9. Live check

Use a new test project (not `56374fb2-…`) with mocked or free providers only.

1. Run the pipeline to the visual gate: no crop files exist.
2. Click "Cắt ảnh" on a scene with a 16:9 source image: the crop file is 90% of each side and centred on the subject.
3. On a 4:3 source: a full-height 16:9 crop.
4. Change one crop by hand, then run "Cắt ảnh tất cả cảnh": the manual crop stays.
5. Render a short preview: cropped scenes match their boxes, and the other scenes look as before.

Write the sizes you saw in `docs/tasks/TASK-062.report.md`.

## 10. User guide

- Visuals page:
  - the crop tool is optional and never runs by itself;
  - the rule: a different ratio gets the largest box with the target ratio; the same ratio gets 9/10 of each side;
  - where the focus comes from;
  - how to change or remove a crop;
  - the low-resolution warning.
- Settings page: the two crop settings.
- `featureMap` entries for the crop buttons, the editor and the routes; `nhat-ky-thay-doi.md` line.

## Done

- [ ] The crop tool works from the UI, the API and `crop_scene_images`. The pipeline never calls it (tested).
- [ ] Same-ratio images are cropped to 9/10 of each side; other images get the largest box with the target ratio.
- [ ] The focus comes from the user, then a stored vision box, then smartcrop, then the centre; the source is shown.
- [ ] Originals are kept; manual crops are protected; render ignores stale crops.
- [ ] Render uses a crop only when one exists for the current image; otherwise it is unchanged.
- [ ] All workspaces' tests and typecheck pass; live check in the report; user guide updated.
- [ ] No commit, no push, no edits to `.env`, `.claude/`, `data/`, `scripts/`; no new dependencies.
