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

Set `LLM_DEFAULT_PROVIDER` to `anthropic`, `gemini`, `openai`, `ollama`, `openrouter`, `deepseek`, `groq`, `custom`, or `mock`, and set the matching API key or base URL in `.env`. Models can be selected globally with `LLM_DEFAULT_MODEL`, for each stage with `LLM_RESEARCH_MODEL` / `LLM_SCRIPT_MODEL`, or per project in its Advanced settings. Providers other than Anthropic require an explicit model ID. The mock provider is enabled by default outside production; set `LLM_ENABLE_MOCK=false` to disable it in development or tests.

LLM requests time out after `LLM_TIMEOUT_MS` (120 seconds by default) and are cached by provider, model, stage prompt, and input. Optional token prices can be supplied as `LLM_PRICES_JSON`, for example `{"openai:gpt-model":{"inputPerMTok":1,"outputPerMTok":2}}`; unknown prices are reported as zero. Adjust `SPEECH_WORDS_PER_MINUTE` to change script duration estimates. API keys stay in the server environment and are never exposed by the providers API.

`LLM_RESEARCH_MODE` defaults to `merged`, which creates research notes and the script in one provider call per Generate All run. Use `separate` for one research call and one script call, or `off` to skip research and generate a script from the topic. A project can override this in its Advanced settings.

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
