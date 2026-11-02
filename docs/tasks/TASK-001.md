# TASK-001 — Foundation: Monorepo, Shared Domain, SQLite, Project API

## GOAL
Create the project foundation: an npm-workspaces TypeScript monorepo with a shared domain package, a Fastify server backed by SQLite, and a fully tested Project Management API (CRUD, duplicate, archive, search/filter/sort, dashboard stats). No UI, no LLM, no pipeline yet.

## CONTEXT
- Read `docs/ARCHITECTURE.md` first. It is the source of truth (sections 2, 3, 5, 6, 9).
- The repository is empty (only `docs/`). It is not a git repo yet.
- Environment: Windows 11, Node 24.19, npm 11. FFmpeg is NOT installed (not needed for this task).
- Later tasks will add: web UI (TASK-002), job runner/pipeline (TASK-003), stages. Design so they can plug in without rewriting this task's code.

## FILES TO INSPECT
- `docs/ARCHITECTURE.md`

## FILES TO CREATE/MODIFY
```
.gitignore
.editorconfig
.env.example
package.json                      # root, workspaces: ["packages/*", "apps/*"]
tsconfig.base.json
packages/shared/package.json      # name: "@vg/shared"
packages/shared/tsconfig.json
packages/shared/src/index.ts
packages/shared/src/enums.ts
packages/shared/src/schemas/project.ts
packages/shared/src/schemas/errors.ts
packages/shared/src/schemas/dashboard.ts
apps/server/package.json          # name: "@vg/server"
apps/server/tsconfig.json
apps/server/vitest.config.ts
apps/server/drizzle.config.ts
apps/server/src/index.ts          # starts server
apps/server/src/app.ts            # buildApp(config) factory (used by tests)
apps/server/src/lib/config.ts
apps/server/src/lib/errors.ts
apps/server/src/lib/logger.ts     # optional if pino via Fastify is enough
apps/server/src/db/client.ts
apps/server/src/db/schema.ts
apps/server/src/db/migrate.ts
apps/server/drizzle/              # generated SQL migrations (committed)
apps/server/src/storage/paths.ts
apps/server/src/services/projectService.ts
apps/server/src/api/health.ts
apps/server/src/api/projects.ts
apps/server/src/api/dashboard.ts
apps/server/test/projects.test.ts
apps/server/test/dashboard.test.ts
apps/server/test/paths.test.ts
README.md                          # how to install, run, test
```

## REQUIREMENTS

### 1. Workspace
- Root scripts: `dev` (server watch), `build`, `test`, `typecheck` — each runs across workspaces.
- TypeScript `strict: true`, ESM (`"type": "module"`), target ES2023.
- `.gitignore`: `node_modules`, `dist`, `data/`, `.env`, `*.db`, coverage.
- Run `git init` and make the first commit only if the user approves; otherwise leave files uncommitted.

### 2. `@vg/shared`
`enums.ts` (string unions + zod enums, values exactly as below):
- `ProjectStatus`: `DRAFT | GENERATING | REVIEW | RENDERING | COMPLETED | FAILED`
- `PipelineStage`: `TOPIC | RESEARCH | SCRIPT | SCENE_PLAN | VISUAL_SEARCH | VISUAL_REVIEW | VOICE | SUBTITLE | MUSIC_SEARCH | MUSIC_REVIEW | TIMELINE | FINAL_APPROVAL | RENDER | DONE`
- `AutonomyMode`: `AUTO | ASSISTED | MANUAL`
- `StageExecutor`: `AGENT | USER`
- `VisualStatus`: `DISCOVERED | REVIEW_REQUIRED | APPROVED | REJECTED | REPLACED | CUSTOM | AI_GENERATED`
- `CandidateOrigin`: `SEARCH | CUSTOM_URL | UPLOAD | AI_GENERATED`
- `WatermarkStatus`: `NONE | SUSPECTED | UNKNOWN`
- `LicenseKind`: `CC0 | PUBLIC_DOMAIN | CC_BY | CC_BY_SA | CC_BY_NC | ROYALTY_FREE | ALL_RIGHTS_RESERVED | UNKNOWN | USER_PROVIDED | AI_GENERATED`
- `JobStatus`: `QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED`
- `AspectRatio`: `16:9 | 9:16 | 1:1`

`schemas/project.ts` (zod; export inferred types):
- `ProjectSettings`: `{ language: string (default "vi"), targetDurationSec: int 30..1800 (default 120), aspectRatio (default "16:9"), stageExecutors: Partial<Record<"visuals"|"voice"|"music", StageExecutor>> (default {}), autoRender: boolean (default false) }`
- `Project`: `id, title, description, topic, mode, settings, status, stage, thumbnailPath|null, durationSec|null, version, createdAt (ISO string), updatedAt, archivedAt|null`
- `CreateProjectInput`: `title (1..200, trimmed), topic (1..2000, trimmed), description? (≤2000), mode? (default ASSISTED), settings? (partial)`
- `UpdateProjectInput`: all optional of `title, description, topic, mode, settings (partial, merged)`; reject empty body.
- `ProjectListQuery`: `q?` (matches title/topic/description, case-insensitive), `status?` (one or comma-separated list), `includeArchived?` (default false), `archivedOnly?` (default false), `sort?` (`updatedAt|createdAt|title`, default `updatedAt`), `order?` (`asc|desc`, default `desc`), `page?` (≥1, default 1), `pageSize?` (1..100, default 20)
- `ProjectListResponse`: `{ items: Project[], total, page, pageSize }`

`schemas/errors.ts`: `ApiError = { error: { code: string, message: string, details?: unknown } }`.

`schemas/dashboard.ts`: `DashboardStats = { total, byStatus: Record<ProjectStatus, number>, archived, recent: Project[] (5 most recently updated, non-archived) }`. Leave a `recentErrors: []` field typed as `unknown[]` placeholder for TASK-003.

### 3. Server
- Fastify 5 + `fastify-type-provider-zod`, request/response validated with the shared schemas.
- `lib/config.ts`: read env with zod, fail fast with a clear message. Vars: `PORT` (default 3001), `HOST` (default 127.0.0.1), `DATA_DIR` (default `./data`), `DATABASE_PATH` (default `${DATA_DIR}/app.db`), `LOG_LEVEL` (default `info`). Add all to `.env.example`. Load `.env` via `dotenv` or Node `--env-file`.
- `buildApp({ config })` returns the Fastify instance without listening, so tests use `app.inject`. Tests use a temp directory DB (`os.tmpdir()`), never `./data`.
- DB: Drizzle ORM + `better-sqlite3`. Table `projects` with columns matching `Project`; `settings` stored as JSON text. Index on `status`, `updated_at`, `archived_at`. Enable `PRAGMA journal_mode=WAL` and `foreign_keys=ON`. Migrations generated by drizzle-kit, committed, applied automatically at startup.
- `storage/paths.ts`: `projectDir(id)` → `${DATA_DIR}/projects/<id>`; validate id format (UUID) and ensure resolved path stays inside DATA_DIR (reject traversal).
- `services/projectService.ts` holds all logic; routes stay thin.

### 4. Endpoints
| Method | Path | Behavior |
|---|---|---|
| GET | `/api/health` | `{ status: "ok", version, db: "ok" }` (runs a trivial query) |
| GET | `/api/projects` | list using `ProjectListQuery` |
| POST | `/api/projects` | create; `status=DRAFT`, `stage=TOPIC`, `version=1`, id = `crypto.randomUUID()`; creates project dir; 201 |
| GET | `/api/projects/:id` | 404 `PROJECT_NOT_FOUND` if missing |
| PATCH | `/api/projects/:id` | partial update; settings deep-merged; bumps `updatedAt`; does NOT bump `version` (versioning is TASK-013) |
| POST | `/api/projects/:id/duplicate` | new id, title `"<title> (copy)"`, same topic/description/mode/settings, `status=DRAFT`, `stage=TOPIC`, `version=1`, not archived; 201 |
| POST | `/api/projects/:id/archive` | set `archivedAt`; idempotent |
| POST | `/api/projects/:id/unarchive` | clear `archivedAt`; idempotent |
| DELETE | `/api/projects/:id` | delete row + project dir; 204; 409 `PROJECT_BUSY` if status is `GENERATING` or `RENDERING` |
| GET | `/api/dashboard/stats` | `DashboardStats` |

- Validation failures → 400 `VALIDATION_ERROR` with zod issues in `details`. Unknown errors → 500 `INTERNAL_ERROR` without stack trace in body (log it instead).
- CORS: allow `http://localhost:5173` (Vite dev) via env `CORS_ORIGIN`.

## IMPLEMENTATION NOTES
- Keep the service layer framework-agnostic (no Fastify types in services) so the TASK-003 worker can call it.
- Timestamps: store ISO strings (UTC).
- Search `q`: SQL `LIKE` with escaped `%`/`_`, case-insensitive. No full-text search yet.
- Status filter must use the enum; invalid values → 400.
- Keep dependencies minimal: fastify, @fastify/cors, fastify-type-provider-zod, zod, drizzle-orm, better-sqlite3, dotenv; dev: typescript, tsx, vitest, drizzle-kit, @types/*.

## DO NOT
- Do not create the web app, job runner, LLM/TTS/image providers, or tables for scenes/visuals/jobs.
- Do not add auth, Docker, Redis, queues, microservices, or another ORM.
- Do not hard-code paths, ports or secrets; use config/env.
- Do not change enum values or names defined above without flagging it in the report.
- Do not write tests that touch `./data`.

## ACCEPTANCE CRITERIA
1. `npm install`, `npm run typecheck`, `npm run build`, `npm test` all succeed from the repo root on Windows.
2. `npm run dev` starts the server; `GET http://127.0.0.1:3001/api/health` returns `status: "ok"`.
3. DB file and migrations are created automatically on first start in `DATA_DIR`.
4. All endpoints behave as specified, including 400/404/409 error shapes.
5. `@vg/shared` is importable from the server, and types are inferred from zod (no duplicate hand-written interfaces).
6. Archived projects are excluded from list and stats counts by default.

## TESTS (Vitest, `app.inject`, temp DB per test file)
- create → get → returns same data with defaults (`mode=ASSISTED`, `settings.language="vi"`, `status=DRAFT`, `stage=TOPIC`, `version=1`)
- create with invalid input (empty title, title 201 chars, invalid mode) → 400 `VALIDATION_ERROR`
- PATCH title and partial settings → other settings preserved, `updatedAt` changes
- PATCH with empty body → 400
- list: `q` search, `status` filter (single + comma list), sort by title asc, pagination `total`
- archive/unarchive idempotent; archived excluded by default; `includeArchived` and `archivedOnly` work
- duplicate: new id, "(copy)" suffix, reset status/stage/version
- delete: 204, project dir removed, then GET → 404; delete while `GENERATING` → 409 (set status directly through the service/DB in the test)
- unknown id → 404 `PROJECT_NOT_FOUND`; malformed id → 400 or 404 (document which)
- dashboard stats counts per status and `recent` length ≤ 5
- `paths.ts`: rejects `../` and non-UUID ids

## EXPECTED RESULT
A running API server with persistent project management, shared types ready for the web app, and a passing test suite.

## DEPENDENCIES
None (first task).

## REPORT BACK (required)
1. Files created/changed (list)
2. Output of `npm run typecheck`, `npm run build`, `npm test` (summary + counts)
3. Any deviation from this spec and why
4. Remaining issues / TODOs
