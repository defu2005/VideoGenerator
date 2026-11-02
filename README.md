# AI Video Agent

The initial repository foundation for the AI Video Agent MVP. It contains the shared TypeScript domain package and the Fastify project-management API backed by SQLite.

## Requirements

- Node.js 24+
- npm 11+

## Install

```sh
npm install
```

Copy `.env.example` to `.env` to override the defaults. The server defaults to `127.0.0.1:3001`, stores its database and project files under `./data`, and allows the Vite development origin `http://localhost:5173`.

## Run

```sh
npm run dev
```

The server applies committed Drizzle migrations automatically at startup. Check it at `http://127.0.0.1:3001/api/health`.

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
