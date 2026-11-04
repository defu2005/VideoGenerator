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
| 5 | [TASK-007C](TASK-007C.md) | "Nhờ AI tìm ảnh": LLM web search for images | docs/tasks/TASK-007C.md |
| 6 | [TASK-007B](TASK-007B.md) | More image/video sources | docs/tasks/TASK-007B.md |

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
