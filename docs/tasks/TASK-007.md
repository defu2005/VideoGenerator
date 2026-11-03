# TASK-007 — Visual Review: review UI, local image store, approve/replace/custom/upload, gate

## GOAL
Build the **Visuals tab**, where the user reviews the image picked for every scene and decides:
- approve, reject or replace it
- search again with an edited query
- paste a custom URL, or upload a file

Approved images are **downloaded and validated locally**, so later stages (TASK-012 render, TASK-004G vision) never depend on remote hot-links. The `VISUAL_REVIEW` gate can only be approved when every scene has a usable image (or the user explicitly marks a scene "no image").

Principle (ARCHITECTURE §6): the AI proposes, code filters and ranks, **the user decides**. Changing an image only updates the selection. Script, voice, music and other scenes are never re-run.

## CONTEXT
- **ARCHITECTURE §6:** VisualCandidate, VisualSelection, VisualStatus, scene visual status `NO_VISUAL → SEARCHING → REVIEW_REQUIRED → APPROVED → READY_FOR_RENDER`, license rules (badges only, never hard-block, never claim "no copyright" without data).
- **TASK-006 (committed):**
  - candidates + selection tables, `visualService.ts`
  - API: `GET /visuals`, `GET /scenes/:sceneId/visuals`, `POST …/search`, `…/select`, `…/:candidateId/discard`
  - `scoreBreakdown.lowRelevance`, `reusedAcrossScenes`
  - Scene Board thumbnails
- **TASK-004F:** per-scene `visualDescription` (English, editable). Budget/LLM routing exists. **This task makes 0 LLM calls.**
- **Gate hook:** `Orchestrator` accepts `canApprove(project, gate)`; it is currently always allowed.
- **Storage:** `apps/server/src/storage/paths.ts` gives `data/projects/<id>/`.
- **Web:** `ProjectDetailPage` tabs include `visuals` (empty today). Reuse `useVisuals`, `visualsApi`, the existing form/panel/button styles, and the bounded query retry.
- **Wikimedia SVG candidates:** render and store the rasterized **`previewUrl`/thumb PNG**, never the raw SVG (TASK-006 review note).

## FILES TO INSPECT
- `apps/server/src/services/visualService.ts`, `src/api/visuals.ts`, `src/providers/images/*`, `src/storage/paths.ts`, `src/pipeline/orchestrator.ts`, `src/app.ts`
- `packages/shared/src/schemas/visual.ts`, `src/enums.ts`
- `apps/web/src/features/projects/ProjectDetailPage.tsx`, `src/features/scenes/*`, `src/hooks/useVisuals.ts`, `src/services/visualsApi.ts`, `src/index.css`

## REQUIREMENTS

### 1. Local image store (server, code only)
**Downloader** `apps/server/src/services/imageStore.ts`:
- `fetch` with a 20 s timeout, 1 retry on network/5xx, `User-Agent` from `IMAGE_SEARCH_USER_AGENT`, max **25 MB**.
- Follow redirects (max 3). Accept only `http(s)`. Refuse private/loopback/link-local hosts (SSRF guard), and test it.
- **Content check by magic bytes** (not by extension or header): JPEG, PNG, WebP, GIF. Anything else, including SVG, HTML and an empty body, is an error with a clear message.
- **Real dimensions** from the file header, with no dependency: parse the PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X and GIF logical screen. Reject when the short side is < 320 px.
- Save to `data/projects/<id>/visuals/<sha256>.<ext>`. Content-addressed: the same bytes are stored once.
- Record on the candidate: `localPath`, `sha256`, `bytes`, `actualWidth`, `actualHeight`, `fileType`, `downloadedAt`, `downloadError|null`. Add columns via **drizzle-kit only**.
- **Which URL to download:** for Wikimedia/Openverse/Pexels use the largest raster URL that is ≤ 2560 px on the long side and **never an SVG**. For a Wikimedia SVG, request the `thumburl` at width 1920 (rasterized PNG).

**Previews:** the review grid shows remote `previewUrl` thumbnails (lazy) for speed. Only the **selected** image is downloaded, when it is approved or set as custom. A "Tải trước ảnh xem" button downloads the top 8 previews of one scene (optional, explicit).

**File serving:** `GET /api/projects/:id/visual-files/:file`:
- streams the local file with the correct content-type and `Cache-Control: private, max-age=86400`
- validates the file name (`^[a-f0-9]{64}\.(jpg|png|webp|gif)$`) to prevent path traversal (test it)

### 2. Selection actions (API)
All mutating endpoints:
- return 409 when a job is running
- are scoped to the project/scene (404 otherwise)
- emit pipeline events
- mark only **TIMELINE onward** STALE through the existing invalidation (never SCRIPT/VOICE/MUSIC/other scenes)

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/projects/:id/scenes/:sceneId/visuals/approve` | download + validate the selected candidate; on success status `APPROVED`, `reviewedAt`; on failure 422 `IMAGE_DOWNLOAD_FAILED` with the reason, selection unchanged |
| POST | `/api/projects/:id/scenes/:sceneId/visuals/reject` | selection → `REJECTED`; auto-select the next distinct, non-discarded candidate as `REVIEW_REQUIRED` (same distinct-assignment rule as TASK-006); none left → no selection, scene status `NO_VISUAL` |
| POST | `/api/projects/:id/scenes/:sceneId/visuals/select` (exists) | user choice → `REPLACED`, `selectedBy: USER`; not approved until approve |
| POST | `/api/projects/:id/scenes/:sceneId/visuals/custom-url` | `{ url, title?, author?, license? }` → download + validate; candidate `origin: CUSTOM_URL`, license `kind: USER_PROVIDED` if the user supplied license data, else `UNKNOWN`, `evidence: "user"`/`"none"`; selection `CUSTOM` + approved |
| POST | `/api/projects/:id/scenes/:sceneId/visuals/upload` | raw body (`Content-Type: image/jpeg/png/webp/gif`, ≤ 25 MB) via a Fastify content-type parser (**no multipart dependency**), header `X-File-Name` optional; same validation; `origin: UPLOAD`, license `USER_PROVIDED`, `evidence: "user"`; selection `CUSTOM` + approved |
| POST | `/api/projects/:id/scenes/:sceneId/visuals/remove` | the user wants no image for this scene: selection removed, scene flag `noVisual: true` (renders as a plain background later); reversible by selecting again |
| POST | `/api/projects/:id/visuals/approve-all` | approve every scene whose selection is `DISCOVERED`/`REVIEW_REQUIRED`/`REPLACED`; downloads run sequentially with progress events; returns `{ approved, failed: [{ sceneId, reason }] }`; never touches `REJECTED`, `CUSTOM`, `APPROVED` |
| PATCH | `/api/projects/:id/scenes/:sceneId/visuals/query` | edit `visualQueries` / `visualDescription` of the scene (no search yet) |

Search again uses the existing `POST …/search` with the edited query (cache first) and appends candidates.

### 3. Scene visual status (derived, shared)
`deriveSceneVisualStatus(selection, candidates, noVisual, stageState)`:

| Status | When |
|---|---|
| `NO_VISUAL` | no selection and not `noVisual` |
| `SEARCHING` | VISUAL_SEARCH running |
| `REVIEW_REQUIRED` | selection `DISCOVERED`/`REVIEW_REQUIRED`/`REPLACED` |
| `APPROVED` | `APPROVED`/`CUSTOM` without a local file |
| `READY_FOR_RENDER` | `APPROVED`/`CUSTOM` with a validated local file |
| `SKIPPED` | `noVisual` |

`GET /visuals` returns it per scene, plus summary counts per status.

**Gate rule** (`canApprove` for `VISUAL_REVIEW`): allowed only when every scene is `READY_FOR_RENDER` or `SKIPPED`. Otherwise the message lists how many scenes need attention.
- **AUTO mode:** after VISUAL_SEARCH, run approve-all automatically. If everything becomes ready, approve the gate. If not, stop at the gate.
- MAX mode keeps its own rule (TASK-004G).

### 4. Visuals tab (web)
**Top bar:**
- counts per status (chips)
- license summary (CC0/PD, attribution required, unknown, NC/all-rights)
- buttons "Duyệt tất cả" (shows how many and asks to confirm) and "Duyệt xong → tiếp tục" (gate approve; disabled with the reason when not allowed)
- filter: Tất cả / Cần xem / Ít liên quan / Ảnh dùng lại / Chưa có ảnh / Đã duyệt

**Scene list.** One row per scene, in order, virtualised or paginated past 40 scenes. Each row shows:
- **left:** scene number, timecode, label, narration excerpt, `visualDescription`, status chip, and warnings ("Ít liên quan", "Ảnh dùng lại ở scene N", "License chưa rõ", "Phi thương mại")
- **middle:** the selected image (local file if downloaded, else preview) in the project aspect frame
- **right:** actions — Duyệt, Bỏ ảnh này (reject), Không dùng ảnh (remove), Đổi ảnh (opens the candidate panel)

**Candidate panel** (drawer on desktop, full-screen sheet on mobile):
- **search box** prefilled with the scene query; edit, then "Tìm lại"; recent queries shown as chips
- **grid of the top 8 candidates** ("Xem thêm" loads the rest): thumbnail, score, provider, size, license badge, low-relevance/reused/watermark marks, "Chọn" button
- **metadata panel** for the focused candidate:
  - source site + source URL (opens in a new tab with `rel="noopener noreferrer"`), image URL
  - author, license name + link, attribution required + attribution text (copy button)
  - real size (after download) or reported size, aspect ratio, file type, watermark status
  - score breakdown (keyword, resolution, aspect, license, watermark, provider position)
- **"Dán URL ảnh"** form (URL + optional title/author/license) and **"Tải ảnh lên"** (file picker + drag-and-drop, client-side type/size check before upload)

**Behaviour:**
- **Keyboard:**
  - `J`/`K` next/previous scene
  - `A` approve
  - `R` reject
  - `1–8` pick a candidate in an open panel
  - visible focus; all actions reachable without a mouse
- Every action updates optimistically, with rollback and an error toast on failure.
- Refresh on SSE (`stage.updated`, the new `visual.updated` event).
- Responsive at 375 / 768 / 1280 px with no horizontal page scroll. Vietnamese labels, consistent with the "Mô hình AI" page style.

### 5. Scene Board
The card shows the status chip and uses the local file when present. Clicking the image opens the Visuals tab focused on that scene.

### 6. MCP
- `get_scene_visuals` adds `status` + `localFile`.
- New `approve_scene_visual(projectId, sceneId)` and `select_scene_visual(projectId, sceneId, candidateId)` (mutations allowed: the user drives them from Claude Desktop/Copilot Chat).

## LLM calls
**0 in every mode.** No vision here (TASK-004G). The only network traffic is image downloads and searches the user triggers.

## DO NOT
- Do not add dependencies (no image libraries, no multipart plugin, no virtualisation library unless already present).
- Do not download every candidate automatically.
- Do not hard-block on license. Do not claim an image is copyright-safe.
- Do not hand-write migrations (drizzle-kit only).
- Tests must not hit the network: use local fixture images in `apps/server/test/fixtures/images/` (tiny generated JPEG/PNG/WebP/GIF, a truncated file, an SVG, an HTML page) and a mocked fetch.
- Do not run real `copilot`/`claude` prompts. Do not commit.

## ACCEPTANCE CRITERIA
1. typecheck / build / test pass. drizzle-kit reports no changes after the migration. prod audit 0.
2. **Live run** on the AlphaGo fixture project (real Wikimedia/Openverse, mock LLM, YouTube 7 s), all done from the UI:
   - approve all
   - replace one image via the candidate panel
   - reject one and verify the auto-replacement
   - search again with an edited query
   - add one custom URL
   - upload one local file
   - mark one scene "Không dùng ảnh"
   - then approve the gate

   Every approved scene has a validated local file (real dimensions recorded). SVG candidates were stored as PNG. SCRIPT/VOICE/MUSIC stages are not STALE afterwards.
3. Gate approve is refused (with a reason) while any scene is `REVIEW_REQUIRED`/`NO_VISUAL`.
4. AUTO mode: Generate All passes VISUAL_REVIEW by itself when every download succeeds, and stops there when one fails.
5. Security tests: SSRF (localhost/10.x/169.254.x refused), path traversal on visual-files, oversize upload (413), wrong magic bytes (422).
6. UI works at 375 / 768 / 1280 px with no horizontal scroll, keyboard shortcuts work, and focus is visible.

## TESTS
- **Server:**
  - magic-byte sniffing + dimension parsing for each format (fixtures)
  - download limits, timeout, redirect cap, SSRF guard
  - content-addressed storage
  - every endpoint (happy path, 404/409/413/422)
  - reject auto-replacement respects distinct assignment
  - approve-all summary
  - gate rule
  - AUTO auto-approval
  - invalidation scope
- **Shared:** `deriveSceneVisualStatus` table.
- **Web:**
  - the Visuals tab renders rows/statuses/warnings
  - the candidate panel picks, searches, and validates the custom URL and upload forms
  - keyboard shortcuts
  - the approve-all confirm
  - gate button disabled reason
  - mobile layout class
- **MCP:** new tools.

## DEPENDENCIES
TASK-006 and TASK-004F (committed).

## REPORT BACK
`docs/tasks/TASK-007.report.md` with:
- files, migration
- live-run evidence for AC2 (per-scene table: status, file, real size)
- security test list, deviations

Then create empty `docs/tasks/TASK-007.done`.
