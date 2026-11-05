# TASK-043 — Cursor guide (format recipes, treatment card, chat editing with undo)

Read `docs/cursor/README.md`, `TASK-041.md` and `TASK-042.md` first (both are committed). This task takes three ideas from other open-source video tools. **Only the ideas: those projects are AGPL, so do not copy their code.**
- From OpenMontage:
  - **format recipes:** one playbook per video type, which every stage reads;
  - **a treatment:** a short proposal with a cost estimate, shown before the expensive stages.
- From OpenChatCut:
  - **chat editing on stable ids:** propose → preview → apply;
  - **a revision token** so edits never apply to a stale timeline;
  - **undo.** OpenChatCut's own weak spot is that external MCP edits bypass the proposal step. Here, every surface (web chat, Telegram assistant, MCP) goes through the same propose/validate/apply path.

No new npm dependencies.

## 1. Format recipes (`packages/shared/src/formats/`)
A recipe is plain data (a TS object plus a zod schema `FormatRecipeSchema`), not code. Each recipe has:
- `id`, `nameVi`, `descriptionVi`;
- `aspects` (allowed) and `durationRangeSec`;
- `script`:
  - `structure`: an ordered list of sections `{ key, nameVi, purposeVi, shareOfDuration, required }`;
  - the hook rules (`hookMaxSec`, `hookStyles`);
  - the CTA position;
  - `sentenceMaxWords`;
  - the reading level hints;
- `scenes`: `targetSceneSec` (min/max) and `visualMix` (preferred visual kinds);
- `edit`: the default TASK-041 edit preset, subtitle style, preferred TASK-042 templates plus how often per section (e.g. `list_item` at each item section, `number_counter` for stats), and the transition rhythm;
- `research`: depth (`light`/`normal`/`deep`) and whether sources must be cited on screen (`lower_third` with the source).

Starter recipes (write good Vietnamese content guidance; these steer the LLM prompts):
1. `explainer`: hook question → context → 3 key points → takeaway → CTA.
2. `listicle`: hook ("5 điều…") → items N…1 or 1…N → bonus → CTA. Each item = one section with `list_item`.
3. `story`: a cold open in the middle of the action → setup → rising tension → twist/reveal → lesson. `quote_card`/`title_card`, `story` preset.
4. `news_recap`: headline → what happened (who/what/when) → numbers → why it matters → what's next. `news` preset, `lower_third` sources, `number_counter`/`bar_chart`.
5. `myth_vs_fact`: myth → why people believe it → the fact with evidence → repeat ×3 → summary.
6. `how_to`: result first → what you need → numbered steps → common mistake → recap.
7. `short_hook`: 15–45 s, 9:16. Hook in ≤ 1.5 s → one idea → a punchline/loop back to the hook. `energetic` preset, `progress_bar`.

**Wiring:**
- The profile has a `defaultFormat` (nullable); the project has a `format` (nullable = auto).
- **Auto pick:** a new small LLM task `formatPick` (tier cheap, budget feature `formatPick`, default on in BALANCED/QUALITY, off in ECO).
  - Input: the topic, the profile niche and the aspect. Output: a recipe id plus a one-line reason.
  - Code fallback: `short_hook` for 9:16 < 60 s; `listicle` if the topic matches `/\b\d+\s+(điều|cách|lý do|sự thật|bí mật)/i`; else `explainer`.
- **The script prompt** (`stages/script/prompt.ts` and `mergedStoryPrompt.ts`) gets the recipe structure. The script output tags each paragraph/scene with its `sectionKey` (add it to the zod schema as optional, so old data stays valid). Validation: required sections present; otherwise one repair retry through the existing repair path, then accept with a warning.
- **The scene plan** uses `targetSceneSec` and `visualMix`.
- **The TASK-041 `editPlan` and the TASK-042 graphics** get the recipe's edit hints, plus each scene's `sectionKey`, so `list_item` lands on item sections and so on. The code fallbacks use the recipe too.
- **TASK-035 learning insights:** add the format to the per-video features, so insights can say which format performs best per profile. Only read the field; do not redesign TASK-035.
- **UI:** a format picker (cards with a description and an example structure) in the project brief and the profile. "Tự chọn" = auto. Show the chosen recipe plus the reason on the project page.

## 2. Treatment card (before the expensive stages)
- After the script stage, build a **treatment**, a pure code summary (no extra LLM call):
  - title, format, angle (the first hook sentence), section outline with estimated seconds, estimated scene count, estimated duration;
  - **the estimated cost of the remaining stages**, using the existing `estimateBudget` (LLM tokens plus TTS characters, and USD where provider prices are known; otherwise just tokens/characters);
  - the estimated render time (from the TASK-042 metrics average when available, else "chưa có dữ liệu").
- **MANUAL/ASSISTED:** show it at the existing script gate as a card on top ("Bản đề xuất"), with the buttons the gate already has.
- **AUTO:** no waiting. The treatment is still stored and appears in the auto report and the Telegram daily summary line.
- Store it on the project (a json column) so the dashboard can compare the estimate with the real cost after render (show "ước tính vs thực tế").

## 3. Chat editing on stable ids (extend the TASK-018 review chat)
The review chat already proposes and applies `EDIT_NARRATION`, `EDIT_DURATION`, `EDIT_VISUAL_QUERY`, `SET_MOTION`, `MUSIC_*`, `REORDER_SCENES`, `EDIT_METADATA` and `NOTE` (`packages/shared/src/schemas/review.ts`, `apps/server/src/review/`). Add:
- **New proposal types** (zod, strict, the validation in `review/validate.ts`, and apply in `review/service.ts`):
  - `SET_TRANSITION { afterSceneId, type, durationSec }`;
  - `SET_EMPHASIS { sceneId, wordIndexStart, wordIndexEnd, effects }` and `REMOVE_EMPHASIS { sceneId, wordIndexStart }`;
  - `ADD_GRAPHIC { sceneId|null, templateId, startSec?|anchor?, durationSec?, variables }`, `EDIT_GRAPHIC { graphicId, …partial }` and `REMOVE_GRAPHIC { graphicId }`;
  - `SET_SUBTITLE_STYLE { style }`;
  - `DELETE_SCENE { sceneId }`;
  - `SPLIT_SCENE { sceneId, atWordIndex }`;
  - `REGENERATE_SCENE_VOICE { sceneId }` (re-TTS one scene only).
  - Validate with the same rules TASK-041/042 use: clamps, safe areas, limits. Reuse those functions; do not copy them.
- **The context builder** gives the model the transitions, emphasis, graphics (ids, templates, times) and the template list, kept compact (the same style as the assistant `compactSchema`).
- **Revision token:**
  - The timeline gets an integer `revision` that is bumped on every write.
  - Proposals carry `baseRevision`.
  - Apply with a stale `baseRevision` → HTTP 409 `TIMELINE_CHANGED`. The UI shows "Timeline đã thay đổi, tạo lại đề xuất?" with a one-click regenerate.
  - The MCP tool and the TASK-032 assistant tools handle 409 the same way.
- **Preview before apply:** each proposal card shows a diff:
  - before/after text for narration;
  - chips for transitions/graphics;
  - the old/new scene order.
  - Graphics proposals include the TASK-042 iframe preview.
  - After applying, offer "Xem nhanh 10 giây" around the changed scene (the TASK-041 quick preview).
- **Undo history:**
  - Before each apply (and before each manual timeline edit through the existing timeline service), store a snapshot: a `timeline_snapshots` table with id, project id, revision, a json snapshot, the source (`chat`/`assistant`/`mcp`/`manual`), the summary and `created_at`.
  - Keep the last 30 per project.
  - "Hoàn tác" restores the previous snapshot; restoring is itself a new revision and is undoable again.
  - Scene voice files are referenced, not copied. If a snapshot points at a deleted voice file, mark that scene's voice stale instead of failing.
  - Marks downstream stages stale via `markStaleFrom` as usual.
  - Assistant (TASK-032) tool `undo_timeline_edit`, risk level "confirm".
- **One path for all surfaces:**
  - The MCP `apply_review_proposal` and the TASK-032 assistant tools must call the same `ReviewService.applyProposal` (validation + revision + snapshot). No direct timeline writes from MCP.
  - Add a test that the MCP tool and the assistant tool reach the same service method (mock).

## 4. Tests (no network, mock LLM)
- Recipes: all starter recipes pass the zod schema; section shares sum to 1 ±0.01; the fallback picker cases (9:16 short, the listicle regex, the default).
- Script validation: a missing required section → a repair retry → accept with a warning; old scripts without `sectionKey` still load.
- editPlan/graphics fallbacks follow the recipe (`list_item` on item sections in `listicle`).
- Treatment: an estimate built from a fixture script; stored; the auto mode does not wait; the gate card renders (web test).
- Each new proposal type: valid → applied; invalid → dropped with a Vietnamese note.
- Revision: stale → 409; fresh → applied and revision+1.
- Snapshots: created on chat/assistant/mcp/manual apply; capped at 30; undo restores and is a new revision; a missing voice file → that scene's voice is marked stale.
- MCP and assistant use the same apply path.
- Web: the format picker, the proposal diff cards, the 409 banner with regenerate, the undo button.

## 5. Live check
On the test project `eb02c679-26a3-4a42-8ea9-bb4e1a25288d` only:
1. Pick `listicle` and run to the script gate. Check that the treatment card shows the outline and the cost.
2. In the review chat ask: "thêm số đếm ở cảnh có con số, đổi chuyển cảnh sau cảnh 1 thành zoomin, xóa cảnh cuối". Apply the result, then undo once, and check that the timeline matches.
3. Do a quick 10 s preview.
Attach screenshots to the report. **Never touch project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**

## Done
Done checklist from the README. Write `docs/tasks/TASK-043.report.md` and `docs/tasks/TASK-043.done`.
