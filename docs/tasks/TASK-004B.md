# TASK-004B — Use Claude without an API key: MCP server for Claude Desktop + `claude-cli` LLM provider

## GOAL
Let the user power the text stages with their Claude subscription instead of paid API keys, in two ways:
1. **MCP server** (`apps/mcp`): Claude Desktop connects to the Video Agent and can read projects and save research/script directly (human-driven, zero API cost).
2. **`claude-cli` LLM provider**: the server runs Claude Code in headless mode (`claude -p`) as one more provider in the TASK-004 LLM layer, so Generate All stays fully automatic.

## CONTEXT
- Depends on TASK-004 (multi-provider LLM layer, RESEARCH/SCRIPT executors, `completeByUser`, `PUT /script`, `settings.stageExecutors.script = "USER"`) **including its review fix round**: merged 1-call "story" generation (`LLM_RESEARCH_MODE`) and the extended `ScriptSection` (visualQueries, visualNotes, musicMood, energy). Read `docs/tasks/TASK-004.md`, `TASK-004.review.md` and the report first, then inspect the actual code.
- Token rule (`docs/ARCHITECTURE.md` §4 "Quy tắc LLM"): this task adds **no** automatic LLM calls. `GET /prompts/:stage` and `get_writing_brief` must also support stage `STORY` (the merged research+script prompt) so Claude Desktop can produce research and script in one reply and save them with one tool call `save_story` (saves research + script together).
- The MCP server must be a thin client of the existing REST API (single source of truth, no direct DB access).
- Claude Code CLI is **not installed** on this machine yet. All tests must mock the process; real-CLI testing is done later by the architect.

## FILES TO INSPECT
- `apps/server/src/providers/llm/*` (interface, registry, structured helper)
- `apps/server/src/stages/research/*`, `src/stages/script/*` (prompts, schemas)
- `apps/server/src/api/script.ts`, `src/services/scriptService.ts`, `src/pipeline/orchestrator.ts`
- `packages/shared/src/schemas/script.ts`, `llm.ts`
- `apps/web/src/features/script/*`

## FILES TO CREATE/MODIFY (guide)
```
apps/server/src/providers/llm/claudeCli.ts
apps/server/src/providers/llm/registry.ts          # register claude-cli when enabled
apps/server/src/api/script.ts                      # + PUT research, GET prompts
apps/server/src/services/scriptService.ts
apps/server/test/claudeCli.test.ts, researchApi.test.ts, promptsApi.test.ts
apps/mcp/package.json                              # name "@vg/mcp", bin "video-agent-mcp"
apps/mcp/tsconfig.json
apps/mcp/src/index.ts                              # stdio MCP server
apps/mcp/src/apiClient.ts
apps/mcp/src/tools.ts
apps/mcp/test/tools.test.ts
apps/web/src/features/script/ScriptTab.tsx         # "Use Claude Desktop" hint
docs/CLAUDE_DESKTOP.md                             # setup guide (Vietnamese)
.env.example, README.md
```

## REQUIREMENTS

### Part A — REST additions (server)
- `PUT /api/projects/:id/research` body `ResearchNotes` → validates, stores with `provider: "user"`, then `completeByUser(RESEARCH)`; marks later stages STALE when content changed; 409 when a job is active.
- `GET /api/projects/:id/prompts/:stage` for `RESEARCH` and `SCRIPT` → `{ stage, system, user, jsonSchema, language, targetDurationSec }`: the exact prompt the agent executors would send, plus the output JSON Schema generated from the shared zod schema (`z.toJSONSchema`). Executors and this endpoint must use the same prompt functions (no duplicated prompt text).
- Both added to existing tests style; no change to existing endpoints.

### Part B — MCP server (`apps/mcp`)
- Use the official `@modelcontextprotocol/sdk` with stdio transport. Env: `VG_API_URL` (default `http://127.0.0.1:3001`). Logs go to **stderr only** (stdout is the protocol).
- Tools (clear descriptions; inputs validated with zod; return concise JSON text):
  | Tool | Purpose |
  |---|---|
  | `list_projects` | `q?`, `status?` → id, title, status, stage, updatedAt (max 20) |
  | `get_project` | project + pipeline summary (stage states) |
  | `get_writing_brief` | `projectId`, `stage: "RESEARCH" \| "SCRIPT"` → system + user prompt + JSON schema from `GET /prompts/:stage`, plus current research (for SCRIPT) |
  | `get_research` / `save_research` | read / save `ResearchNotes` (via PUT) |
  | `get_script` / `save_script` | read / save `Script` (via PUT) |
  | `save_story` | save research + script from one STORY reply (two PUTs, research first) |
  | `run_pipeline` | `projectId`, `stage?` → start Generate All or one stage |
  | `get_pipeline` | current pipeline state |
- `save_*` must return the server's validation errors verbatim so Claude can fix and retry.
- Do NOT expose approve-gate, delete, or archive tools (review stays a human action in the Web UI).
- Also register two MCP **prompts**: `write_research` and `write_script` (argument `projectId`) whose text tells Claude to call `get_writing_brief`, write in the project language, and save with the matching tool.
- Root scripts: `build` includes `apps/mcp`; add `npm run mcp` to run it locally.
- If the API is not running, tools return a clear error: "Video Agent server is not running at <url>. Start it with `npm run dev`."

### Part C — Web hint
In the Script tab, when the script executor is `USER` or the stage is `WAITING_USER`, show a small card: "Write with Claude Desktop", the sentence to paste into Claude Desktop (e.g. `Viết script cho project "<title>" (id <id>) bằng Video Agent`), a Copy button, and a link to `docs/CLAUDE_DESKTOP.md` instructions. The page refreshes when the script is saved (already handled by SSE/refetch; verify).

### Part D — `claude-cli` provider
- Implements the TASK-004 `LlmProvider` interface, id `claude-cli`, label "Claude (subscription via Claude Code)".
- Enabled only when `CLAUDE_CLI_ENABLED=true`. Binary from `CLAUDE_CLI_PATH` (default `claude`); at startup resolve it once; if missing, the provider is listed with `configured: false` and a hint "Install Claude Code CLI and run `claude` once to log in".
- Invocation: `child_process.spawn` **without a shell**, prompt passed via **stdin** (avoid Windows command-line length limits), print mode with JSON output (`-p --output-format json`), optional `--model` from the resolved model, the system prompt via the CLI's system-prompt flag, max one turn, and **no tools** (text only). Verify exact flag names against the official Claude Code CLI documentation and keep them in one constant so they are easy to adjust; document the chosen flags in the report.
- Run with `cwd` = an empty temp directory under `DATA_DIR/tmp/claude-cli` so the CLI cannot read project files; minimal env (PATH, HOME/USERPROFILE, APPDATA, LOCALAPPDATA and the vars the CLI needs to find its login).
- Parse the JSON result: text → `LlmResponse.text`; token usage if present → usage; set `costUsd = 0` (subscription) and keep any reported "equivalent cost" only in debug logs.
- Abort/timeout: kill the process tree on `signal` abort or `LLM_TIMEOUT_MS`.
- Error mapping: ENOENT → `LLM_NOT_CONFIGURED` (non-retryable); not logged in / auth messages → `LLM_AUTH` (non-retryable); usage/rate limit messages → `LLM_RATE_LIMIT` (retryable); non-zero exit otherwise → `LLM_UNAVAILABLE` (retryable); unparsable output → `LLM_INVALID_OUTPUT`.
- Concurrency: at most 1 concurrent CLI process (simple in-module queue).
- README note: intended for the user's personal local use with their own subscription; check Anthropic's terms before offering it to other users.

### Config (`.env.example`)
```
CLAUDE_CLI_ENABLED=false
CLAUDE_CLI_PATH=claude
CLAUDE_CLI_MODEL=
VG_API_URL=http://127.0.0.1:3001      # used by apps/mcp
```

### Docs (`docs/CLAUDE_DESKTOP.md`, Vietnamese)
- Build: `npm run build`.
- Claude Desktop config snippet for Windows (`%APPDATA%\Claude\claude_desktop_config.json`) with `"command": "node"` and the absolute path to `apps/mcp/dist/index.js`, env `VG_API_URL`; restart Claude Desktop.
- Example chats: "Liệt kê project của tôi", "Viết research rồi script cho project X", "Chạy tiếp pipeline".
- How to enable `claude-cli`: install Claude Code CLI, log in once, set `CLAUDE_CLI_ENABLED=true` and `LLM_DEFAULT_PROVIDER=claude-cli`.

## DO NOT
- Do not access SQLite from `apps/mcp`.
- Do not expose gate approval, delete, archive, or arbitrary file/shell tools via MCP.
- Do not run the CLI through a shell or put the prompt in argv.
- Do not add other new dependencies besides `@modelcontextprotocol/sdk` (and its peer `zod` already present).
- Do not modify `claude_desktop_config.json` on this machine; only document it.
- Do not commit.

## ACCEPTANCE CRITERIA
1. Root typecheck/build/test pass; all previous tests still pass.
2. `npm run mcp` starts; an MCP client (test harness) can list the 9 tools and 3 prompts (`write_research`, `write_script`, `write_story`) and call `list_projects` against a running server.
3. `save_script` through MCP on a project waiting at SCRIPT completes the stage (RESEARCH SKIPPED or DONE) and, if Generate All was running, the pipeline continues; Web UI updates live.
4. Invalid script via `save_script` returns the zod issues text.
5. `GET /prompts/SCRIPT` returns the same system prompt the SCRIPT executor uses (test asserts equality).
6. With `CLAUDE_CLI_ENABLED=true` and a mocked binary, the provider returns text/usage, maps errors, kills on abort, and never spawns more than one process at a time.
7. `/api/llm/providers` lists `claude-cli` with `configured` reflecting binary presence.

## TESTS
- Server: research PUT (validation, completeByUser, STALE, 409); prompts endpoint equality with executor prompts and valid JSON Schema; claudeCli with a fake executable script (Node script that echoes JSON / exits non-zero / prints "not logged in" / hangs) covering success, each error mapping, abort kill, stdin delivery of a >40 KB prompt, single-concurrency queue.
- MCP: tools with a mocked `fetch` API client (list, get, save success, save validation error, server down message); prompts registered.

## EXPECTED RESULT
The user can write research/scripts by chatting with Claude Desktop (no API key), or let the pipeline call Claude Code headless automatically — both through the same storage and pipeline as the API providers.

## DEPENDENCIES
TASK-004 (must be reviewed and committed first).

## REPORT BACK
Write `docs/tasks/TASK-004B.report.md` (files, command results with test counts, the exact CLI flags chosen and the doc they came from, deviations, remaining issues). Then create empty `docs/tasks/TASK-004B.done`.
