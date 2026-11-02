# TASK-004B Implementation Report

## Files changed

- MCP workspace: `apps/mcp/package.json`, `apps/mcp/tsconfig.json`, `apps/mcp/src/index.ts`, `apps/mcp/src/apiClient.ts`, `apps/mcp/src/tools.ts`, and `apps/mcp/test/tools.test.ts`.
- Server REST and prompt support: `apps/server/src/api/script.ts`, `apps/server/src/app.ts`, and `apps/server/src/services/scriptService.ts`.
- Claude CLI provider/configuration: `apps/server/src/providers/llm/claudeCli.ts`, `apps/server/src/providers/llm/registry.ts`, and `apps/server/src/lib/config.ts`.
- Shared provider schema: `packages/shared/src/schemas/llm.ts`.
- Server tests: `apps/server/test/claudeCli.test.ts`, `apps/server/test/scriptApi.test.ts`, and `apps/server/test/llmProviders.test.ts`.
- Web guidance: `apps/web/src/features/script/ScriptTab.tsx`, `apps/web/src/features/script/ScriptTab.test.tsx`, and `apps/web/src/index.css`.
- Workspace/config/docs: `package.json`, `package-lock.json`, `.env.example`, `README.md`, and `docs/CLAUDE_DESKTOP.md`.

No database migration was needed.

## Claude Code CLI flags

Invoked without a shell; the task prompt is sent over stdin. The flags are centralized in `claudeCli.ts`:

```text
-p
--output-format json
--system-prompt <system prompt>
--max-turns 1
--tools ""
--disallowedTools "mcp__*"
--model <resolved model>          (only when resolved)
```

The official CLI reference documents print mode, JSON output, system-prompt replacement, max turns, model selection, disabling built-in tools with `--tools ""`, and blocking MCP tools with `--disallowedTools "mcp__*"`:
[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference).
The official [headless usage guide](https://code.claude.com/docs/en/headless) documents non-interactive `claude -p` use. No `--bare` flag is used because the official guide states bare mode does not read OAuth credentials.

## Verification

| Command/check | Result |
|---|---|
| `npm install` | Passed; workspace dependencies installed. npm reported 4 moderate audit advisories in the dependency tree. |
| `npm run typecheck` | Passed for shared, MCP, server, and web workspaces. |
| `npm run build` | Passed for all workspaces. Vite emitted the existing non-fatal Zod/Rollup annotation warnings. |
| `npm test` | Passed: **109 tests** - MCP 5/5, server 80/80, web 24/24. |
| `npm run mcp` | Started the built stdio server successfully; exited cleanly when the runner closed stdin. |
| MCP runtime smoke test | Passed against an isolated running API: MCP advertised 10 tools and 3 prompts; `list_projects` returned `{"total":0,"projects":[]}`. Temporary database was removed. |

Claude CLI behavior is tested with mocked child processes, including stdin over 40 KB, output/usage parsing, auth/rate-limit/invalid-output mappings, abort/timeout termination, and serialized concurrency. A real Claude Code CLI was not available on this machine, as anticipated.

## Deviations and remaining issues

- The task’s explicit tool table lists 10 tools, while its acceptance criterion says 9. Implemented all 10 explicitly named tools.
- The task text asks to register two prompts, while its acceptance criteria require three including `write_story`. Implemented all three prompts.
- No migration changes or commits were made.
- `npm install` reported 4 moderate dependency-tree advisories; no unrelated dependency upgrades or audit remediation were performed.

## Architect verification
- 109/109 tests (MCP 5, server 80, web 24); `npm audit --omit=dev` = 0 (4 moderate are dev-only).
- Real MCP smoke test via SDK stdio client against the running API: 10 tools, 3 prompts, `list_projects` returned live projects. No approve/delete/archive tools; MCP writes nothing to stdout.
- Spec inconsistency (9 vs 10 tools, 2 vs 3 prompts) was the architect's; implementation follows the detailed list. Accepted.
