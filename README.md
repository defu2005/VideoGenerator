# AI Video Agent

The AI Video Agent MVP monorepo. It contains the shared TypeScript domain package, a Fastify project-management API backed by SQLite, and the React control panel.

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

The server applies committed Drizzle migrations automatically at startup. The control panel is available at `http://localhost:5173`, and the API health check is at `http://127.0.0.1:3001/api/health`.

The web development server proxies `/api` requests to `http://127.0.0.1:3001` by default. Set `VITE_API_PROXY_TARGET` to override the proxy target.

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
