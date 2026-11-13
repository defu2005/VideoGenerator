# TASK-047 report — Cursor operator

## What changed

One registry for the assistant, MCP, and the operator. Confirm-risk calls from MCP or the operator become pending actions. The user approves them. The operator runs Cursor's CLI in its own workspace, with a handbook, skills, a queue, standing orders, and Telegram plus web chat.

### Shared
- `packages/shared/src/schemas/operator.ts` — operator settings, standing-order input, run kinds, login hint, suggested tick `0 8 * * *`.
- `packages/shared/src/operator/guard.ts` — protected project id check.
- `packages/shared/src/operator/redact.ts` — `redactOperatorText` (emails plus common secret shapes).
- `packages/shared/src/index.ts` — exports.
- `packages/shared/src/features/featureMap.ts` — feature `cursor-operator` at `/operator`.

### Server
- `apps/server/src/db/schema.ts` — `operator_conversations`, `operator_runs`, `operator_messages`, `operator_routing_log`, `operator_tool_audit`, `standing_orders`.
- `apps/server/drizzle/0038_operator_runtime.sql` and `drizzle/meta/0038_snapshot.json` — generated. A second `npx drizzle-kit generate` printed "No schema changes".
- `apps/server/src/registry/policy.ts` — risk default confirm, hard blocks, pending rules.
- `apps/server/src/registry/audit.ts` — audit row with source `assistant` | `mcp` | `operator`.
- `apps/server/src/registry/invoke.ts` — one invoke path for MCP and the operator.
- `apps/server/src/api/registry.ts` — `GET /api/registry/tools`, `POST /api/registry/invoke`. Header `x-vg-tool-source: operator` is the only way to mark a call as operator. Any other value, including `assistant`, is stored as `mcp`.
- `apps/server/src/operator/` — CLI detection, args, stream parser, workspace, handbook, skills, routing, eval budget, cron, queue, ticks, Telegram, write guard.
- `apps/server/src/api/operator.ts` — overview, chat, stop, new session, settings, standing orders, promote skill, open folder.
- `apps/server/src/assistant/tools.ts` — `save_standing_order`, `find_skills`, `find_tools`. `runTool` hard-blocks before zod parse and writes an audit row.
- `apps/server/src/assistant/loop.ts` — same hard block and pending rule, including automation-on and public upload.
- `apps/server/src/assistant/service.ts` — caller conversations for MCP and operator pending actions, and a listener when a pending action is resolved.
- `apps/server/src/assistant/telegramBridge.ts` — `/op`, `/tl`, `/status`, `/stop`, `/new`, `/orders`. `/pause` still pauses automation.
- `apps/server/src/notifications/telegram.ts` — `sendMessage` returns `message_id`. Added `editMessageText`.
- `apps/server/src/app.ts` — builds the operator after assistant services exist, registers routes, ticks only when `WORKER_ENABLED` is true.
- Tests: `operator.test.ts`, `operatorParser.test.ts`, `operatorRouting.test.ts`, `registry.test.ts`. `assistant.test.ts` updated where the task changes the old behavior (see deviations).

### MCP
- `apps/mcp/src/apiClient.ts` — `listRegistryTools`, `invokeRegistry`. Sends `x-vg-tool-source: operator` only when `VG_TOOL_SOURCE=operator`.
- `apps/mcp/src/tools.ts` — every tool refuses the protected project. `publish_project` and `run_pipeline` go through the registry and therefore become pending. Extra registry tools are registered from the catalog.
- `apps/mcp/src/index.ts` — loads the catalog before connect. If the server is down, the existing tools still register.
- `apps/mcp/test/tools.test.ts` — catalog tool, pending publish, protected project. The old exact tool list is unchanged when no catalog is passed.

### Web
- `apps/web/src/features/operator/OperatorPage.tsx` and `OperatorChat.tsx` — status, standing orders, chat, queue, Duyệt/Từ chối, Dừng, Phiên mới, runs, audit, notes, resume command.
- `apps/web/src/features/assistant/AssistantPage.tsx` — switch **Trợ lý tích hợp** | **Cursor operator**. The operator panel mounts only after the switch.
- `apps/web/src/App.tsx`, `components/layout/nav.ts` — route and nav **Cursor operator**.
- `apps/web/src/services/operatorApi.ts`, `index.css`, tests for the page and the switch.

### Guide
- `docs/user-guide/tro-ly-va-telegram.md` — section `{#cursor-operator}`.
- `docs/user-guide/nhat-ky-thay-doi.md` — `## TASK-047`.

## Test counts

`npm run typecheck`, `npm run build`, and `npm test --workspaces` passed.

| Workspace | Tests |
| --- | --- |
| shared | 287 |
| mcp | 14 |
| server | 622 |
| web | 142 |

Counts are above the TASK-017 baseline (shared 156, mcp 11, server 295, web 70). No `package.json` or lockfile change. No NUL bytes in the changed files.

## Orchestration credits

Routing and skill shape follow ideas from [paulpas/agent-skill-router](https://github.com/paulpas/agent-skill-router) (MIT): BM25, trigger match, MMR-style diversity. Model comparison follows the successive-elimination idea from [AgentOptimizer/agentopt](https://github.com/AgentOptimizer/agentopt) (Apache-2.0). No code was copied. No new dependency.

## Deviations

- The registry is the assistant tool list, plus `find_skills`, `find_tools`, and `save_standing_order`. Older MCP-only tools (scenes, script, story, review) stay as MCP tools and still call their REST routes. `publish_project` and `run_pipeline` are confirm-risk duplicates, so those two now call `POST /api/registry/invoke` and do not publish or start a pipeline themselves.
- The installed CLI `2026.11.05-86047df` has no flag to filter MCP tools per run. `MCP_TOOL_FILTER_PER_RUN` is false. The handbook tells the operator to call `find_skills` first.
- That CLI checks `permissions.deny` before `permissions.allow`. A `Write(**)` deny would also block `notes/`. `cli.json` denies `Shell(*)` and allows `Read(**)`, `Write(notes/**)`, and `Mcp(video-agent:*)`. After each run the server restores any file outside `notes/` and logs the path.
- The web chat polls `partial_text` and tool chips. There is no SSE stream.
- Overview does not spawn `cursor-agent --list-models`. The version is the newest version folder name. `loggedIn` stays null until a run reports a login failure.
- `resume_automation_all`, turning a profile's automation on, and a public `publish_project` always create a pending action, including when assistant confirm mode is auto. `assistant.test.ts` now proves the auto-run path with `clear_llm_cooldown`, and proves resume still waits.
- With the operator enabled and `telegramEngine` unset, plain Telegram text goes to the operator. `/tl` still reaches the built-in assistant. The old paired-chat test sends `/tl Xin chào trợ lý`. `/pause` still sets the automation kill switch.

## What is not done

- Section 7 live check was not run. It needs a real `cursor-agent` session, which uses the network and the user's Cursor allowance, and step 3 creates then deletes a project. The CLI is present on disk at `%LOCALAPPDATA%/cursor-agent/versions/2026.11.05-86047df` (`index.js` and `node.exe`). It was not executed. Ticks were not enabled. Nothing was published, rendered, or gate-approved. The protected project was not opened.
- This session had no browser tool. The operator page, engine switch, queue line, pending card, and resume command were exercised in component tests only. A running dev server was not clicked through.
- TASK-046 provider research, the model scorecard, and the `research-provider` / `compare-models` skills are not in this task. Duties and seeded standing orders are arrays a later module can extend. Seeded orders stay `enabled: false`.

## Follow-up on 2026-11-09

- `apps/server/src/operator/service.ts` and `apps/server/test/operator.test.ts` cover interrupted queued and running work. Startup records the terminal status and chat notice in one transaction. Repeated startup does not duplicate the notice. Runs are left for manual review because a running job may have taken actions before the interruption.
- `apps/server/src/services/projectService.ts` selects the ID from the joined project to fix the dashboard typecheck after jobs gained nullable project IDs.
- `docs/ARCHITECTURE.md` records the separation between the operator runtime and per-task model routing. `packages/shared/src/features/featureMap.ts`, `docs/user-guide/tro-ly-va-telegram.md`, and `docs/user-guide/nhat-ky-thay-doi.md` document restart behavior.
- Typecheck and build passed. Workspace tests passed (shared 337, MCP 17, server 650 with 1 skipped, web 149). No migration or dependency change. Live browser and CLI verification remain open.
