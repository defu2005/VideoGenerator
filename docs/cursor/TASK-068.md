# TASK-068 — Cursor guide (compose engine, part 3: integration into rendering, the gate, UI and MCP)

**Scope:** plug the compose engine built in TASK-067a (and later improved in 067b) into the real pipeline.
- **The engine choice:** `legacy` (one still per scene, as today) or `compose`, per profile or project. The default stays `legacy` until the live check passes.
- **The render gate** also checks for freeze and black segments.
- **UI:** the engine toggle, a shot list per scene, and the plan stats.
- **A read-only assistant/MCP tool.**

Read `docs/cursor/README.md` first. Also read `docs/compose/README.md`, the module map from 067a. Do not read the compose code in full.

**Order:**
- after TASK-069 (both edit `assistant/tools.ts` and the gates) and after TASK-067a;
- it **can run while Fable does 067b**, because the director is behind an interface. **Do not edit** `packages/shared/src/compose/**`, `apps/server/src/compose/**` or `apps/server/assets/compose/**`: Fable works there. Call their exported functions only.

**Cursor model:** grok-4.7-medium.

**Rules:**
- No new npm dependency.
- Tests have no network and no real LLM, TTS or HyperFrames (inject `run`).
- No schema change is expected (see §2). If you need one, use `npx drizzle-kit generate` in `apps/server`.
- Never render or approve on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Do not commit or push.
- Update the user guide and `featureMap` (README rule 10).

**Out of scope:** new shot kinds and the learning loop (TASK-070).

---

## Mã nguồn mở có sẵn

Nothing new. Everything uses what 067a built on: HyperFrames (Apache-2.0), GSAP, FFmpeg, and the Pexels and Pixabay APIs. Footage licences follow the TASK-060 rules (credits and `licenseSummary`).

---

## Facts (verified 2026-11-10)

- **Edit settings:** `EditSettingsSchema` (`packages/shared/src/edit/plan.ts:64`) is a strict zod object: `preset`, `subtitleStyle`, `fontSize`, `highlightColor`, `sfx`, `emphasisEverySec`.
  - It is stored inside the profile and project settings JSON (`schemas/project.ts:41` and `:86`), so a new field needs **no migration**.
  - The web form is `apps/web/src/features/projects/EditStyleFields.tsx`.
- **Scene clip loop:** `apps/server/src/services/renderService.ts` lines 676–700. The clip hash is used for `clipsDir/<clipHash>.mp4`, and the file is reused when it exists.
- **Credits:** `buildCreditsText({ ..., licenseSummary: timeline.licenseSummary })` (`renderService.ts:1220`).
- **The render gate:**
  - `renderGateOk({exists, durationSec, targetSec, silent, subtitlesInSync})` is in `packages/shared/src/schemas/autonomy.ts:172`;
  - its inputs come from `renderGateInputs` (`apps/server/src/operator/qualityGates.ts:115`), which reads `renders.report` JSON (`maxVolumeDb`, `subtitlesInSync`);
  - `approve_gate` RENDER uses it at `assistant/tools.ts:929`. TASK-069 changed that branch to check `ctx.gated`, so read the current code.
- **The compose API from 067a** (check exact names in `docs/compose/README.md`):
  - `planProject(...) → ComposePlan`;
  - `renderSceneClip(plan, sceneId, target, ctx, outPath)`;
  - `beatGridForMusic(dataDir, musicPath)`;
  - `searchFootage(config, ...)`;
  - `baselineDirector`, and later `ruleDirector` / `llmDirector` from 067b.

---

## 1. Engine setting

- Add `engine: z.enum(["legacy","compose"]).optional()` to `EditSettingsSchema`. A missing value means `legacy`.
- Add `directorMode: z.enum(["eco","quality"]).optional()`. `quality` allows the director's single LLM call. Like everything else, it follows the project's ECO mode: in ECO mode it is always `eco`.
- **Which director is used:**
  - if 067b has landed (`ruleDirector` is exported), use `ruleDirector` in `eco` and `llmDirector` in `quality`;
  - otherwise use `baselineDirector`.

  Put this choice in **one** function, `pickDirector(mode, llm)`, in `apps/server/src/services/composeBridge.ts`.
- The LLM function for `llmDirector` goes through the normal routed LLM path, so usage and cost are counted. Use the stage name `COMPOSE`, or the closest existing usage label; grep how `scriptExecutor` calls `generateRoutedStructured`.

## 2. Render integration (`services/composeBridge.ts` + a small change in `renderService`)

- **Before the scene loop**, when the engine is `compose`:
  1. build the plan once per render with `planProject` (passing words from the voice tracks, footage search, the beat grid for `timeline.music`, the recipe id and the preset);
  2. save it as JSON at `<project render dir>/compose-plan.json`;
  3. add `plan.stats` and a list of footage licences to `renders.report.compose`.

  **Storage choice:** a JSON file + the report, with no new table. Keep this unless you find a strong reason; if you change it, say why in the report.
- **In the scene loop** (lines 676–700): when the engine is `compose`, call `renderSceneClip` for that scene instead of the ffmpeg still plan.
  - Add `sha256(JSON(scenePlan))` to the clip hash, so legacy and compose clips never collide.
  - Everything after the loop stays the same: transitions, overlays, audio and loudnorm.
- **When composing a scene fails** (a missing footage file, a HyperFrames error), fall back to the legacy clip for that scene. Add a warning to the render report and continue. **A compose problem must never fail the whole render.**
- **Licences:** every footage clip used must be in `licenseSummary` and in the credits text: author, provider, licence name and page URL. Write a test.
- **Footage search cost:** at most 6 hits per scene. Search only when the engine is `compose`.
- **The format version:** bump `RENDER_FORMAT_VERSION` only if the final plan input changes; say which you did.

## 3. Render gate: freeze and black

- After a compose render, run `freezedetect=n=0.003:d=1.5` and `blackdetect` on the final video, using the 067a eval probes (import them).
- Write `freezeSegments` and `blackSegments` (counts) into `renders.report`.
- Extend `renderGateInputs` and `renderGateOk`: the gate fails when `freezeSegments > 0` or `blackSegments > 0`. A missing value (an old render) counts as 0.
- The failure reason in Vietnamese: `"video có đoạn đứng hình"` / `"video có đoạn đen"`.
- **Tests:** a report with a freeze → the gate holds; an old report → passes.

## 4. UI (`apps/web`)

- **`EditStyleFields.tsx`:**
  - "Kiểu dựng": `Cổ điển (ảnh tĩnh)` / `Nhiều cảnh quay (thử nghiệm)`;
  - when compose is chosen, "Đạo diễn": `Tiết kiệm (luật)` / `Chất lượng (+1 lần gọi AI)`.
- **The render or edit page of a project:**
  - a "Cảnh quay" panel per scene, listing the shots with kind, time, `reason` and a thumbnail when available;
  - the plan stats at the top: shots/min, kind shares, still share, beat-cut %.
  - Read the stats from a new read-only endpoint, `GET /api/projects/:id/compose-plan` (404 when there is none).
  - Editing shots (swap kind, re-roll footage) is **out of scope** here; it goes into TASK-070.
- Use the existing shared UI components from TASK-049 (`/dev/ui`). Vietnamese text.

## 5. Assistant / MCP tool

- `compose_plan_preview({ projectId })` is read-only. It returns the stats and, for each scene, the shot kinds and reasons. Truncate it to 12 scenes.
- Register it in the shared tool registry like the other read tools, so it works for the assistant, MCP and the operator.
- **Test:** returns the plan; 404 → a clear message.

## 6. Tests

- The engine setting parses; a missing value = legacy.
- With compose and a fake `renderSceneClip`: the clip hash differs from legacy, and the plan JSON and `report.compose` are written.
- A scene compose error → the legacy clip for that scene, a warning, and the render still DONE.
- Footage licences appear in the credits.
- The freeze/black gate (§3).
- The endpoint and the tool.
- Web: the toggle saves `engine`, and the panel renders the stats (mock the API).

## 7. Live check

Use a **new test project**, never `56374fb2-…`. Use real Pexels/Pixabay keys if `.env` has them; you may check whether they are set through `AppConfig`, but **never print the values**.

1. Render the same project as `legacy` and as `compose` (`eco`).
2. Report, for both:
   - render seconds;
   - the number of shots;
   - shots/min, still share, beat-cut %;
   - freeze and black;
   - output size.
3. Look at 3 frames from the compose video (start, middle, end) and say whether text overlaps the subtitles.
4. Add a "live" row to `docs/compose/EVAL.md`.

## 8. User guide

- Add a short page or section, "Kiểu dựng nhiều cảnh quay": what it does, how to turn it on, ECO vs quality, the footage licences shown in the credits, and that it is experimental.
- Add one entry to `nhat-ky-thay-doi.md`.
- Update `featureMap` for the new panel and endpoint, if the coverage test requires it.

## Done checklist

- [ ] No file changed in the 067 compose folders.
- [ ] `npm run typecheck` and `npm test` pass in every workspace.
- [ ] `legacy` stays the default; a compose failure never fails a render.
- [ ] The live check is done, or its reason is explained.
- [ ] Report `docs/tasks/TASK-068.report.md`:
  - the storage choice;
  - the director used (baseline or 067b);
  - test counts;
  - live numbers;
  - deviations.
- [ ] An empty file `docs/tasks/TASK-068.done`.
