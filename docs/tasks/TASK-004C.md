# TASK-004C — Video Brief Parameters + Rule-based Recommendations (0 LLM calls)

## GOAL
Users (Web UI, REST API, MCP/Claude Desktop) can pass any subset of video parameters — only `topic` is required. The app recommends a value for every parameter the user did not set, shows the reason, and fills it automatically. Recommendations are **pure code (rules + presets), zero LLM calls**.

## CONTEXT
- Read `docs/ARCHITECTURE.md` §4 "Quy tắc LLM" (hard rule: deterministic work = code).
- Current state: `CreateProjectInput` requires `title` + `topic`; `settings` has `language`, `targetDurationSec`, `aspectRatio`, `researchMode`, `stageExecutors`, `llm`, `autoRender`. The merged story prompt (TASK-004) uses topic, description, language, duration.
- TASK-004B (MCP + claude-cli) may be in progress or finished; inspect the current code first and do not change MCP tool contracts except adding the optional parameters described below.

## FILES TO INSPECT
- `packages/shared/src/schemas/project.ts`, `src/index.ts`
- `apps/server/src/services/projectService.ts`, `src/api/projects.ts`
- `apps/server/src/stages/script/mergedStoryPrompt.ts`, `prompt.ts`, `src/stages/research/prompt.ts`, `scriptUtils.ts`
- `apps/web/src/features/projects/CreateProjectDialog.tsx`, `EditProjectDialog.tsx`, `ProjectFormFields.tsx`, `ProjectDetailPage.tsx`
- `apps/mcp/src/tools.ts` (if present)

## FILES TO CREATE/MODIFY (guide)
```
packages/shared/src/brief/presets.ts          # platform presets, style keyword maps, WPM per language
packages/shared/src/brief/recommend.ts        # recommendBrief(input) -> resolved values + reasons
packages/shared/src/brief/detectLanguage.ts
packages/shared/src/schemas/project.ts        # VideoBrief fields in settings, title optional on create, userSet list
packages/shared/test/recommend.test.ts        # add vitest to shared if not present
apps/server/src/services/projectService.ts    # apply recommendations on create/update
apps/server/src/api/recommendations.ts        # POST /api/recommendations (preview, no DB write)
apps/server/src/stages/script/*prompt*.ts     # use style/tone/audience/platform in prompts (compact)
apps/web/src/features/projects/CreateProjectDialog.tsx   # quick create + customize
apps/web/src/features/projects/BriefFields.tsx           # fields with "Gợi ý" badges and reasons
apps/web/src/features/projects/EditProjectDialog.tsx
apps/mcp/src/tools.ts                         # optional create_project tool (see below)
tests for each
```

## REQUIREMENTS

### 1. Brief parameters (all optional except topic)
Add to `settings` (backward compatible defaults):
| Field | Values |
|---|---|
| `platform` | `youtube` \| `youtube_shorts` \| `tiktok` \| `facebook_reels` \| `custom` |
| `style` | `storytelling` \| `documentary` \| `explainer` \| `news` \| `listicle` |
| `tone` | `neutral` \| `dramatic` \| `inspiring` \| `humorous` \| `serious` |
| `audience` | `general` \| `kids` \| `students` \| `professionals` |
| `language` | ISO code (existing) |
| `targetDurationSec` | existing (30–1800) |
| `aspectRatio` | existing |
| `wordsPerMinute` | 100–220 |
| `sceneDurationSec` | average seconds per scene, 2–20 (used by TASK-005 scene split) |
| `visualStyle` | `photo` \| `illustration` \| `mixed` |
| `subtitles` | `{ enabled: boolean, maxCharsPerLine: number }` |
| `music` | `{ enabled: boolean, volume: 0–1 }` |
| `userSet` | `string[]` — dotted paths of fields the user explicitly set (e.g. `"targetDurationSec"`, `"subtitles.enabled"`) |

Plus top-level: `title` becomes **optional** on create (derived when missing).

### 2. `recommendBrief(input)` (shared, pure, deterministic, unit-tested)
Input: partial brief (+ topic, description, title). Output:
```ts
{ values: ResolvedBrief; recommendations: Record<string, { value: unknown; reason: string; source: "user" | "recommended" }> }
```
Rules (keep them in `presets.ts` tables, easy to tune):
- **language**: if not set, detect from `topic`+`description` text: Vietnamese diacritics (`/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i`) → `vi`; otherwise `en`. Reason: "Detected Vietnamese characters in the topic".
- **platform**: default `youtube`; if aspectRatio `9:16` set by user → `youtube_shorts`.
- **platform presets** (when not user-set):
  | platform | aspect | duration default (min–max) | sceneDurationSec | subtitles |
  |---|---|---|---|---|
  | youtube | 16:9 | 180 (60–1800) | 7 | on |
  | youtube_shorts | 9:16 | 50 (15–60) | 3 | on, 18 chars/line |
  | tiktok | 9:16 | 45 (15–180) | 3 | on, 18 chars/line |
  | facebook_reels | 9:16 | 45 (15–90) | 3 | on |
  | custom | 16:9 | 120 | 6 | on |
  If the user sets a duration outside the platform range, keep the user's value and add a warning (`warnings[]`), never override.
- **style** from topic keywords (vi + en, case/diacritics-insensitive): history/year patterns (`lịch sử`, `history`, `\b(1[0-9]{3}|20[0-9]{2})\b`, `chiến tranh`, `war`) → `documentary`; `cách`, `làm sao`, `là gì`, `how to`, `what is`, `why` → `explainer`; `top \d+`, `\d+ (điều|cách|sự thật)`, `\d+ things` → `listicle`; `tin`, `news`, `mới nhất` → `news`; else `storytelling`. Reason names the matched keyword.
- **tone** from style: documentary → `serious`, explainer → `neutral`, storytelling → `dramatic`, listicle → `inspiring`, news → `neutral`.
- **audience**: `general` unless keywords (`trẻ em`, `kids` → kids; `sinh viên`, `học sinh`, `students` → students).
- **wordsPerMinute**: by language table (`vi: 160`, `en: 150`, default 150), minus 15 for `kids`.
- **visualStyle**: documentary/news → `photo`; kids → `illustration`; else `mixed`.
- **music**: enabled, volume 0.15 (news 0.08).
- **title**: if missing → topic trimmed, first letter uppercase, max 80 chars at a word boundary. (The merged LLM call may later suggest a better title inside its existing output — no extra call.)
- **mode**: `ASSISTED` default (existing).
- Fields listed in `userSet` are never changed by recommendations.

### 3. Server
- `POST /api/projects`: accepts the partial brief; runs `recommendBrief`; stores resolved values; `userSet` = the fields present in the request body. Response includes the project plus `recommendations` (reasons) for the UI.
- `PATCH /api/projects/:id`: fields in the body are added to `userSet`; when `topic`, `platform` or `language` changes, re-run recommendations only for fields **not** in `userSet`. A body field `resetToRecommended: string[]` removes fields from `userSet` and recomputes them.
- `POST /api/recommendations`: body = partial brief (+topic) → `{ values, recommendations, warnings }`, no DB write (used by the UI live preview and by MCP).
- Prompts: pass `style`, `tone`, `audience`, `platform`, `wordsPerMinute` into the merged story / script prompts as **one compact line** (e.g. `Style: documentary; tone: serious; audience: general; platform: youtube_shorts (vertical, fast pacing)`). Do not add examples or long text. Changing these fields changes the LLM cache key (already true because the prompt changes).
- `sceneDurationSec`, `subtitles`, `music` are stored now and consumed by later tasks (TASK-005/009/010).

### 4. Web UI
- **Create dialog = quick create**: only "Chủ đề / Topic" (required) is visible, with a primary button "Tạo" and a summary line under it, e.g. `YouTube · 16:9 · 3 phút · Tiếng Việt · Documentary — gợi ý tự động`. Typing in the topic updates the summary live (debounced 300 ms, calling the shared `recommendBrief` locally — no request needed).
- "Tùy chỉnh / Customize" expands `BriefFields`: every field shows its current value; recommended values have a "Gợi ý" badge with the reason as tooltip/subtext; editing a field marks it user-set (badge disappears); a small "↺" resets it to recommended.
- Edit dialog uses the same `BriefFields` with the project's `userSet`.
- Overview tab shows the brief summary and warnings.

### 5. MCP (only if `apps/mcp` exists)
Add tool `create_project` with input `{ topic (required), title?, platform?, targetDurationSec?, language?, style?, tone?, audience?, aspectRatio? }` → calls `POST /api/projects`, returns id + resolved brief + reasons. Add `recommend_brief` tool calling `POST /api/recommendations`. Both zero-LLM.

## LLM calls
None added. Recommendations are deterministic code. The only effect on LLM usage is a short extra line in the existing merged prompt.

## DO NOT
- Do not call any LLM for recommendations, title, language or style detection.
- Do not break existing projects: missing new fields must resolve to defaults when read.
- Do not add dependencies (language detection by regex only).
- Do not edit committed migrations; settings are JSON so no migration should be needed (if one is, generate it).
- Do not commit.

## ACCEPTANCE CRITERIA
1. Root typecheck/build/test pass; all previous tests pass.
2. `POST /api/projects {"topic":"Lịch sử trận đấu AlphaGo và Lee Sedol năm 2016"}` → title derived, language `vi`, style `documentary` (reason mentions the matched keyword), platform `youtube`, aspect 16:9, duration 180, all in `recommendations` with source `recommended`.
3. `{"topic":"5 sự thật về mèo","platform":"tiktok"}` → listicle, 9:16, 45 s, sceneDuration 3, platform user-set.
4. User-set fields are never overwritten by recommendation re-runs; `resetToRecommended` works.
5. Create dialog: entering only a topic creates a project; summary updates while typing; Customize shows badges and reasons.
6. Generate All with mock provider still costs exactly 1 LLM call; changing style changes the cache key.

## TESTS
- `recommendBrief`: table-driven tests for language detection, each style keyword group (vi/en), platform presets, out-of-range user duration warning, userSet protection, kids WPM adjustment, title derivation (long topic cut at word boundary).
- Server: create with topic only; create with partial brief; patch re-recommendation for non-user-set fields; `resetToRecommended`; `/api/recommendations` no DB write; prompt contains the compact brief line; merged path still 1 call.
- Web: quick create submits topic only; live summary; badges and reset; edit marks userSet.
- MCP (if present): `create_project`, `recommend_brief`.

## EXPECTED RESULT
"Nhập topic → Tạo" just works with sensible, explained defaults; power users and API/MCP clients can set any parameter; nothing costs tokens.

## DEPENDENCIES
TASK-004 (done). Run after TASK-004B is committed.

## REPORT BACK
Write `docs/tasks/TASK-004C.report.md` (files, command results with test counts, deviations, remaining issues). Then create empty `docs/tasks/TASK-004C.done`.
