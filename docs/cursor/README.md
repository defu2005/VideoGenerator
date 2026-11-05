# Cursor guide: upcoming tasks

## Cách dùng (cho bạn)
1. Mở repo trong Cursor, bật Agent mode.
2. Làm **lần lượt từng task** theo bảng bên dưới. Mỗi lần dán vào Cursor đúng một dòng:
   > Read docs/cursor/README.md and docs/cursor/TASK-019.md, then implement that task.
3. Cursor làm xong khi có file `docs/tasks/TASK-XXX.report.md` và `docs/tasks/TASK-XXX.done`.
4. Đừng cho Cursor commit. Gọi Claude review rồi commit (hoặc tự kiểm tra theo "Done checklist" bên dưới).
5. Chỉ chuyển task kế tiếp khi task trước đã review và commit xong.

## Order

| # | Guide | What | Spec |
|---|---|---|---|
| ✅ | [TASK-017](TASK-017.md) | Content guideline packs (**done**, commit 3739833) | docs/tasks/TASK-017.md |
| 1 | [TASK-019](TASK-019.md) | Video metadata (title/description/tags) + music assist LLM | docs/tasks/TASK-019.md |
| 2 | [TASK-018](TASK-018.md) | Optional pre-render review chat with the LLM | docs/tasks/TASK-018.md |
| 3 | [TASK-013](TASK-013.md) | Render versions, history, export/download | docs/tasks/TASK-013.md |
| 4 | [TASK-004G](TASK-004G.md) | MAX mode: vision-checked images + vision check of rendered frames | docs/tasks/TASK-004G.md |
| 5 | [TASK-007C](TASK-007C.md) | Web image search: Brave API + Gemini grounding (free) + code crawl (guide replaces the LLM-agent spec) | docs/tasks/TASK-007C.md |
| 6 | [TASK-020](TASK-020.md) | AUTO never pauses (auto decisions + AUTO report) + realistic token estimate | (guide only) |
| 7 | [TASK-007B](TASK-007B.md) | More image/video sources | docs/tasks/TASK-007B.md |
| 8 | [TASK-021](TASK-021.md) | Fixes from the first live AUTO run (download fallback, blocked-source circuit breaker) | (guide only) |
| 8b | [TASK-021B](TASK-021B.md) | Fixes from live run 2: sturdier edge-tts retry, NASA image URLs from the listed sizes | (guide only) |
| 9 | [TASK-022](TASK-022.md) | Profiles (Hồ sơ) with their own direction + platform accounts | (guide only) |
| 10 | [TASK-023](TASK-023.md) | Render variants 16:9 / 9:16 from one project | (guide only) |
| 11 | [TASK-024](TASK-024.md) | Publishing framework: encrypted token vault, OAuth, publish jobs + schedule, mock publisher | (guide only) |
| 12 | [TASK-025](TASK-025.md) | YouTube publisher (long videos + Shorts) | (guide only) |
| 13 | [TASK-026](TASK-026.md) | OmniRoute as the LLM gateway (catalog, health, prefer/only mode) | (guide only) |
| 14 | [TASK-027](TASK-027.md) | LLM model advisor (picks a model per task) | (guide only) |
| 15 | [TASK-028](TASK-028.md) | Topic queue + automation scheduler per profile | (guide only) |
| 16 | [TASK-029](TASK-029.md) | TikTok publisher | (guide only) |
| 17 | [TASK-030](TASK-030.md) | Facebook Reels + Instagram Reels publishers | (guide only) |
| 18 | [TASK-031](TASK-031.md) | Notifications + Telegram bot (pairing, events, daily summary) | (guide only) |
| 19 | [TASK-032](TASK-032.md) | LLM assistant that controls the app (web chat + Telegram, confirm rules) | (guide only) |
| 20 | [TASK-033](TASK-033.md) | Platform analytics sync (YouTube Analytics, TikTok video stats, Meta insights) + analytics dashboard | (guide only) |
| 21 | [TASK-034](TASK-034.md) | Revenue + profit per video/channel (minus LLM/TTS cost), manual revenue entry, payout reminder, monthly report | (guide only) |
| 22 | [TASK-035](TASK-035.md) | Learn from results: LLM performance insights → direction, topics, best posting time | (guide only) |
| 23 | [TASK-036](TASK-036.md) | Auto thumbnails (frames + title text, AI pick, upload) | (guide only) |
| 24 | [TASK-037](TASK-037.md) | Long video → Shorts/Reels clips added to the schedule | (guide only) |
| 25 | [TASK-038](TASK-038.md) | Comment inbox across platforms, LLM reply suggestions, spam filter | (guide only) |
| 26 | [TASK-039](TASK-039.md) | Trending topics via official APIs + multi-language dubbing/subtitles | (guide only) |
| 27 | [TASK-040](TASK-040.md) | More TTS sources: Google Gemini/Cloud, ElevenLabs, OpenAI, FPT.AI/Viettel AI, local Piper/VieNeu; word timings | (guide only) |
| 28 | [TASK-041](TASK-041.md) | Editing skills: real transitions (xfade), emphasis (punch-in, keyword callouts, SFX), animated styled subtitles (word highlight), LLM edit plan, per-profile edit presets, subtitle gap fix | (guide only) |
| 29 | [TASK-042](TASK-042.md) | Motion graphics layer: HyperFrames HTML/GSAP templates (titles, kinetic words, counters, lower thirds, lists, charts, end card) rendered to alpha clips and overlaid; LLM picks templates + fills text | (guide only) |
| 30 | [TASK-043](TASK-043.md) | Format recipes (explainer, listicle, story, news…), treatment card with cost estimate, chat editing with revision token + undo across web/Telegram/MCP | (guide only) |
| 31 | [TASK-044](TASK-044.md) | Free/quota-limited model manager: quota profiles, usage counters, cool-down on 429/quota, ordered free-first fallback chain, wait-or-paid policy with daily cap, Quota UI, Telegram alert, advisor awareness | (guide only) |

The spec in `docs/tasks/` is the requirement. The guide in `docs/cursor/` gives the current code state, the file map and the steps. When they disagree, the guide wins (it is newer). Each task depends on the ones above it; don't skip ahead.

---

## For the agent: project facts

- **Monorepo** (npm workspaces):
  - `packages/shared`: zod schemas and pure logic. Exported from `src/index.ts` with `.js` import suffixes. Built to `dist/` before the apps use it.
  - `apps/server`: Fastify, better-sqlite3, Drizzle. Routes in `src/api/*.ts`, registered in `src/app.ts`. Stage executors in `src/stages/<stage>/`. Services in `src/services/`. Tests in `apps/server/test/`.
  - `apps/web`: React + Vite + react-query. Features in `src/features/<area>/`. UI text is **Vietnamese**.
  - `apps/mcp`: MCP server for Claude Desktop / Copilot Chat (`src/tools.ts`, `src/apiClient.ts`).
- **Source of truth:** `docs/ARCHITECTURE.md`. Read §4 (budget modes, LLM rules, routing) before touching LLM code.
- **Pipeline:** stages with states, gates (`WAITING_USER`), modes AUTO/ASSISTED/MANUAL. `src/pipeline/orchestrator.ts`. Changing upstream data marks later stages stale (`markStaleFrom`).
- **LLM layer:** `apps/server/src/providers/llm/`. Use `generateRoutedStructured` (per-task route, fallback, cache by prompt hash, usage per call). Every new LLM task needs:
  - an `LlmTaskId` plus an `LLM_TASKS` entry in `packages/shared/src/schemas/llm.ts`;
  - a budget feature in `packages/shared/src/budget/modes.ts` (presets ECO/BALANCED/QUALITY, the CUSTOM toggle in `apps/web/src/features/projects/BriefFields.tsx`, the estimate);
  - an answer in the mock provider for tests.
- **Quality-first rule:** an LLM call is allowed wherever it makes the video better. Budget modes stay selectable. Mechanical work (splitting, timing, ranking math, FFmpeg) stays in code.
- **Licenses** are metadata for the user. Never a hard block.

## Rules (must follow)

1. Never run real `claude`, `copilot`, `agy`, `edge-tts` or any real LLM in tests. Tests must not use the network. Use the mock provider and HTTP fixtures.
2. No new npm dependencies unless the guide says so. FFmpeg/ffprobe binaries are already available (`ffmpeg-static`, `ffprobe-static`).
3. **Migrations:** change `apps/server/src/db/schema.ts`, then run `npx drizzle-kit generate` inside `apps/server`. Never hand-write or edit migration SQL or snapshots.
4. Do not touch `.env`, `.claude/`, `data/`, `scripts/`. Do not commit or push.
5. Do not change existing behaviour beyond the task. Keep all existing tests passing. Update an old test only when the task intentionally changes what it checks, and say so in the report.
6. The app never handles Google credentials. Never read `~/.gemini/oauth_creds.json`.
7. Don't put the user's email or other personal data into user agents, URLs or any external service.
8. **Live checks:** never approve gates or press Render on project `56374fb2-54cf-48ff-9441-2e6c653295d4` (the user's real project). Create a throwaway project for live tests.
9. Windows + PowerShell 5.1: `&&` does not work in PowerShell. Use `;` or Git Bash.

## Commands

```bash
npm run typecheck
npm run build
npm test --workspaces
cd apps/server && npx drizzle-kit generate
```

- Run `drizzle-kit generate` a second time. It must print "No schema changes".
- Dev servers: `npm run dev` (API on 3001, web on 5180).

Test counts after TASK-017: shared 156, mcp 11, server 295, web 70. The counts must not go down.

## Done checklist (every task)

- [ ] `npm run typecheck`, `npm run build`, `npm test --workspaces` all pass.
- [ ] Each new table has a generated migration plus snapshot, and a second `drizzle-kit generate` says "No schema changes".
- [ ] No `package.json` / `package-lock.json` change unless the guide allows it.
- [ ] No NUL bytes or broken encodings in changed files (Vietnamese text stays UTF-8).
- [ ] The web UI works in a browser on a throwaway project: the new panel renders and its main action works.
- [ ] `docs/tasks/TASK-XXX.report.md` covers:
  - what changed, as a file list;
  - test counts per workspace;
  - deviations from the spec;
  - what is not done.
- [ ] An empty file `docs/tasks/TASK-XXX.done`.
