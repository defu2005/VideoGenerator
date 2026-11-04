# TASK-019 — Publishing metadata and music assist (the two "later" LLM features)

Status: spec written 2026-11-04, not started. Depends on TASK-017 (guideline injection), TASK-010 (music), TASK-011 (timeline).

The budget already has the features `musicAssist` and `metadata` (off in ECO, on in BALANCED/QUALITY) and the LLM tasks `musicAssist` and `metadata` in `LLM_TASKS`, but no code uses them. `budgetEstimate` lists them under `later`. This task makes both real.

## 1. Music assist (`musicAssist`, stage MUSIC_SEARCH)

Today the music query is built by code: `musicQueryFor(settings.music, sceneMoods)` in `packages/shared/src/music/rank.ts`, called from `apps/server/src/services/musicService.ts`.

When `resolveBudget(project).musicAssist` is true, and the user has set no `query_override`:
- **One `generateRoutedStructured` call** before the music search. Input:
  - the brief (topic, tone, style, platform, audience, language, target duration);
  - the script title and hook, plus the first ~600 characters of narration;
  - the scene moods;
  - `settings.music` (mood, keywords);
  - guideline rules for target `music`, built with the TASK-017 helper.
- **Output** (zod schema in shared, `MusicAssistOutputSchema`):
  ```ts
  { mood: string; energy: "low" | "medium" | "high"; queries: string[] /* 1..3, English, short */; avoid: string[] /* e.g. "vocals", "lyrics" */; why: string }
  ```
- **Search:** run `queries` in order with the existing providers, merge and dedupe the results, then rank with the existing code ranking. Pass `energy` and `avoid` into the ranking as soft signals (a small score bonus or penalty in code; never filter everything out). If every query returns nothing, fall back to the code query.
- **Storage and display:** store the assist result in the music selection row as a JSON column `assist` (via a drizzle-kit migration). Show it in the Music panel: "AI gợi ý: <mood> · <queries>" with the `why` text.
- **Cache and usage:** cached by prompt hash like the other tasks. Usage is recorded per call.
- **Failure:** an error logs a warning and uses the code query. The stage never fails because of the assist.

## 2. Publishing metadata (`metadata`)

**Goal:** text the user copies when uploading the video:
- title options;
- a description with chapters and credits;
- tags and hashtags;
- the AI disclosure line.

### Code part (0 LLM, always on)
- **Chapters:** `00:00 <label>` lines from the timeline scene start times. Use the scene label or the script section heading. Only when the video is ≥ 60 s and has ≥ 3 sections. YouTube needs the first chapter at 00:00, ≥ 3 chapters, each ≥ 10 s; merge shorter ones.
- **Credits:** the attribution lines already built for the render credits file (TASK-012), for images and music.
- **AI disclosure:** one line, e.g. "Video có sử dụng giọng đọc tổng hợp và nội dung do AI hỗ trợ." It is added when TTS or LLM content is used, which is always in this app. The user can edit it but it is on by default (guideline packs require disclosure).

### LLM part (when `metadata` is on)
- **One call.** Input:
  - the brief;
  - the script (title, hook, section headings, plus a short narration summary cut by code to ~1500 characters);
  - the platform;
  - guideline rules for target `metadata`.
- **Output** (`VideoMetadataDraftSchema`):
  ```ts
  { titles: string[] /* 3, ≤ 100 chars, platform-aware */; description: string /* ≤ 1500 chars, no chapters/credits; code appends them */; tags: string[] /* ≤ 15 */; hashtags: string[] /* ≤ 5, with # */; thumbnailText: string[] /* 2 short overlay ideas */ }
  ```
- **Validation by code:** trim lengths, dedupe tags, strip `#` from tags and add it to hashtags, and drop empty items.
- **With `metadata` off:** code builds a plain draft (title = script title, description = hook, tags = keywords). No LLM call.

### When it runs
- **Automatically:** after the TIMELINE stage succeeds. It is not a new pipeline stage and never blocks a gate. Errors log a warning only.
- **On demand:** a "Tạo lại" button.
- **Stale marker:** stored with the timeline `inputHash`. When the timeline changes, the UI shows "Đã cũ so với timeline — Tạo lại" and does not regenerate on its own.

### Storage
New table `video_metadata`:
- project_id (pk, fk, cascade);
- input_hash;
- the draft JSON (LLM or code);
- the user-edited JSON (`edited`, nullable);
- `source` (`LLM` | `CODE`);
- created_at, updated_at.

User edits are never overwritten by a regenerate unless the user confirms.

### API
- `GET /api/projects/:id/metadata` returns `{ metadata, stale }`.
- `PUT /api/projects/:id/metadata` saves the user edits (validated).
- `POST /api/projects/:id/metadata/generate` takes `{ overwriteEdits?: boolean }`.

### Web
A "Thông tin đăng tải" panel in the Render tab, under the player:
- title options as radio buttons, plus an editable title;
- the description textarea (chapters and credits are appended and shown read-only below it, with a toggle to include them);
- tags and hashtags as chips;
- "Sao chép" buttons for each block and for everything.

### MCP
`get_video_metadata {projectId}`.

## 3. Budget estimate
- Remove `musicAssist` and `metadata` from `later`.
- Count them in the estimate:
  - MUSIC_SEARCH +1 call when `musicAssist` is on;
  - TIMELINE +1 call when `metadata` is on (it runs after the timeline). Use stage "TIMELINE" in `perStage`, or add a "FINAL" bucket if the estimate type allows it; document the choice.
- Update `packages/shared/test/budget.test.ts` on purpose and say so in the report.

## 4. Tests (no network, no real CLI)
- **Shared:** output schemas; the chapters builder (00:00 first, merging short chapters, < 60 s gives no chapters); tag/hashtag cleanup.
- **Server, with the mock provider:**
  - music assist on: one call, queries used, cache hit on rerun;
  - assist off or failing: the code query is used;
  - metadata after TIMELINE: LLM on vs off;
  - edits are kept on regenerate unless `overwriteEdits`;
  - the stale flag;
  - guideline rules for `music` and `metadata` appear in those prompts.
- **Web:** the metadata panel renders, editing saves, copy buttons work.
