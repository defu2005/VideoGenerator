# TASK-124 report: shared agent skill pack and extraction loop

Nothing committed or pushed. No `npm install`. No new dependency. No migration (`npx drizzle-kit generate` prints "No schema changes, nothing to migrate").

## Skills (all in `.agents/skills/`, all load with zero rejections)

Hub `video-van-hanh-app` (area `ket-noi-agent`, risk safe) plus ten: `video-du-an-va-pipeline`, `video-hinh-anh-va-giong`, `video-render-va-thumbnail`, `video-dang-bai`, `video-binh-luan`, `video-ho-so-kenh`, `video-mo-hinh-ai` (holds the `dieu-khien-app` content), `video-tu-dong-hoa`, `video-xu-ly-su-co`, `video-trich-xuat-ky-nang`. The guide table counts 11 rows including the hub, so there are 11 new skill files in total. Each `area` is a user guide page slug.

- `.cursor/skills/dieu-khien-app/SKILL.md` is now a short pointer (frontmatter kept).
- `AGENTS.md` has the one new line.
- No skill contains the protected project id; skills say "id in `AGENTS.md`" (the DB save path rejects the literal id).
- The web dev port in the hub is 5173 (`vite.config.ts`); 5180 is allowed by CORS. The README says 5180, which differs.

## Tools no skill lists (UNCOVERED_TOOLS in `agentSkillPack.test.ts`, each with a reason)

27 tools, in groups: notification settings (2, user setting); `delete_project` (user only); `list_goals` (read via `get_goal_progress`); knowledge and change tools (7, built-in `knowledge_refresh` / `change_investigation`); computer-use tools (3, separate opt-in feature); `list_connections` (OAuth, user only); provider intel tools (5, built-in `research-provider`); OmniRoute and routing mutations plus audit (6, infrastructure changes are user-only); `get_eval_run`. The test fails if this list goes stale in either direction.

## Extraction loop

- `propose_skill` (risk safe) is appended to the registry in `apps/server/src/assistant/tools.ts`. It validates, refuses built-in names (`BUILT_IN_SKILL`) and names outside `video-`, saves via `saveSkillDraft` with `source: "agent_proposal"`, caller and reason, applies the daily cap (`SKILL_DRAFT_LIMIT`), and returns `{name, version, status: "draft"}`. It never activates.
- `SkillEvidence` widened (`agent_proposal`, `caller`, `reason`); the 10-per-24h cap now also applies to `agent_proposal`. No migration (evidence is JSON).
- MCP: the catalog is fetched from the server, so `propose_skill` appears with no change to `apps/mcp/src/tools.ts`. A test was added in `apps/mcp/test/tools.test.ts`.
- Web: `SkillVersions.tsx` shows "Agent đề xuất" plus a line with source, caller and reason.
- Export CLI: `apps/server/src/cli/exportSkills.ts`, scripts `export-skills` in `apps/server/package.json` and root `package.json`. Dry run by default; `--write` needed to write or overwrite; never deletes; symlinks are never followed.
- Deviation: the pure `planSkillExport` lives in `apps/server/src/operator/skillExport.ts` (not in the CLI file) so tests can import it without running the CLI. The CLI imports it.

## Hermes notes

In `skillExport.ts`: `// TASK-123` (Hermes sync sidecar reads the exported files; keep paths stable) and `// TASK-074b` (skill eval will gate which versions reach the planner).

## Shared files touched (append-only unless noted)

`apps/server/src/assistant/tools.ts` (one new tool def), `apps/server/src/operator/skillVersions.ts` (type and cap condition), `apps/web/src/features/operator/SkillVersions.tsx`, `apps/mcp/test/tools.test.ts` (one test), `package.json` and `apps/server/package.json` (one script each), `AGENTS.md` (one line), `docs/user-guide/tu-van-hanh.md` (new section), `docs/user-guide/nhat-ky-thay-doi.md` (TASK-124 entry).

## Tests

New: `apps/server/test/agentSkillPack.test.ts` (6), `apps/server/test/proposeSkill.test.ts` (7 propose_skill + planSkillExport cases, 10 total). MCP 22 passed; web 193 passed; root typecheck clean; server full suite result below.

Server full suite: 1052 passed, 5 skipped, 1 failed (`antigravityCli.test.ts` "denied_actions with empty response"; a timing flake under load, passes alone 45/45, file untouched by this task). An earlier full run showed more failures while TASK-116/118 were mid-edit in the same checkout; all re-ran green.

Fixes the full run forced, outside the guide's file list:
- `apps/server/src/auth/toolActions.ts`: `propose_skill` mapped to `automation.manage` (the workspace coverage test requires every registry tool to have an action).
- `apps/server/test/assistant.test.ts`: tool catalog size guard raised 26_000 → 27_000 (the test comment says it grows with tools; another session's tools also added to it).
- `docs/user-guide/may-worker.md` (new page from another task) is listed in the hub skill and as user-only in `agentSkillPack.test.ts`.

Not done: nothing skipped. Nothing committed.
