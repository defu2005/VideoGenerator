# AI Video Agent

The AI Video Agent MVP monorepo. It contains the shared TypeScript domain package, a Fastify project-management API backed by SQLite, and the React control panel.

## Requirements

- Node.js 24+
- npm 11+

## Install

```sh
npm install
```

Copy `.env.example` to `.env` in the repository root to override the defaults. The server defaults to `127.0.0.1:3001`, stores its database and project files under `<repository-root>/data`, and allows the Vite development origin `http://localhost:5173`. Relative `DATA_DIR` and `DATABASE_PATH` values resolve from the repository root, even when the server runs from `apps/server`.

## Run

```sh
npm run dev
```

The server applies committed Drizzle migrations automatically at startup. The control panel is available at `http://localhost:5173`, and the API health check is at `http://127.0.0.1:3001/api/health`.

The web development server proxies `/api` requests to `http://127.0.0.1:3001` by default. Set `VITE_API_PROXY_TARGET` to override the proxy target.

## LLM providers

Set `LLM_DEFAULT_PROVIDER` to `anthropic`, `gemini`, `openai`, `ollama`, `openrouter`, `deepseek`, `groq`, `custom`, `mock`, `claude-cli`, or `copilot-cli`, and set the matching API key or base URL in `.env`. Models can be selected globally with `LLM_DEFAULT_MODEL`, for each stage with `LLM_RESEARCH_MODEL` / `LLM_SCRIPT_MODEL`, or per project in its Advanced settings. Providers other than Anthropic and the CLI providers require an explicit model ID. The mock provider is enabled by default outside production; set `LLM_ENABLE_MOCK=false` to disable it in development or tests.

LLM requests time out after `LLM_TIMEOUT_MS` (120 seconds by default) and are cached by provider, model, stage prompt, and input. Optional token prices can be supplied as `LLM_PRICES_JSON`, for example `{"openai:gpt-model":{"inputPerMTok":1,"outputPerMTok":2}}`; unknown prices are reported as zero. Adjust `SPEECH_WORDS_PER_MINUTE` to change script duration estimates. API keys stay in the server environment and are never exposed by the providers API.

Providers can declare optional `*_MAX_INPUT_TOKENS` and `*_MAX_OUTPUT_TOKENS` environment limits. Requests are preflighted before provider calls, input research is trimmed only when needed, and output-token requests are clamped to the configured provider limit. The provider selector shows a current-month call counter. It is informational only: there is no monthly call cap and calls are never blocked based on the counter.

`LLM_RESEARCH_MODE` defaults to `merged`, which creates research notes and the script in one provider call per Generate All run. Use `separate` for one research call and one script call, or `off` to skip research and generate a script from the topic. A project can override this in its Advanced settings.

## Claude Desktop and Claude Code

Build the MCP server with `npm run build`, then configure Claude Desktop as described in [docs/CLAUDE_DESKTOP.md](./docs/CLAUDE_DESKTOP.md). It connects through the Video Agent REST API and can read projects or save research/scripts; it has no direct database, file, shell, or approval-gate access.

To use your Claude subscription for automatic text stages on this personal local installation, install Claude Code CLI, log in once, set `CLAUDE_CLI_ENABLED=true`, and select `claude-cli` with `LLM_DEFAULT_PROVIDER`. Set `CLAUDE_CLI_PATH` if the executable is not on `PATH`; `CLAUDE_CLI_MODEL` is optional. This provider runs in a temporary empty directory and costs zero API-key usage, but uses your Claude subscription. Check Anthropic's terms before offering this feature to other users.

To use GitHub Copilot for automatic text stages on your personal installation, install the official [GitHub Copilot CLI](https://docs.github.com/en/copilot/get-started/cli-quickstart), sign in once, set `COPILOT_CLI_ENABLED=true`, and select `copilot-cli` with `LLM_DEFAULT_PROVIDER`. `COPILOT_CLI_PATH` defaults to `copilot`; `COPILOT_CLI_MODEL` is optional. The CLI runs with an empty temporary working directory and no available tools. Copilot Free has historically included about 50 monthly chat/agent requests; GitHub is transitioning to usage-based AI credits in 2026. Usage is shared with coding. The app displays calls this month but does not impose a cap; confirm the current allowance in [Copilot plans](https://docs.github.com/en/copilot/about-github-copilot/plans-for-github-copilot).

**GitHub Models is not available:** GitHub's official documentation says the playground, model catalog, and inference API were fully retired on July 30, 2026 ([GitHub Models notice](https://docs.github.com/en/github-models)). This project therefore does not configure or call the retired service.

## Development

Create migrations only with `drizzle-kit generate`. Never hand-edit a migration, and never edit a migration after it has been applied to a database. If a local development database was migrated by an older version of a migration file and startup reports a migration error, delete `data/app.db` and restart; do not change the migration to accommodate that database.

## Build, type-check, and test

```sh
npm run typecheck
npm run build
npm test
```

Tests use isolated databases and temporary directories under the operating system's temporary folder; they do not use `./data`.

## API

- `GET /api/health`
- `GET|POST /api/projects`
- `GET|PATCH|DELETE /api/projects/:id`
- `POST /api/projects/:id/duplicate`
- `POST /api/projects/:id/archive`
- `POST /api/projects/:id/unarchive`
- `GET /api/dashboard/stats`

Request and response schemas are shared from `@vg/shared`.
