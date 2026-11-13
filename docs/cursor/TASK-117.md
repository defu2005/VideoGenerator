# TASK-117 — Packaging: one Docker image, compose files, one-line install 📦

**Who:** Cursor, model `grok-4.7-medium`. Infrastructure files with a clear check: the image builds and runs. **Size:** M. **Order:** can run now, in parallel with TASK-110 and TASK-114. It touches only new files. **No DB change.**

Read first:
- `docs/cursor/README.md`
- `docs/architecture/multi-user-multi-node.md` (rows "Packaging", "Backup", "Network between machines")
- the root `package.json` and each workspace's `package.json` (build scripts)
- `apps/server/src/lib/config.ts` (env keys)
- `apps/web/vite.config.*` (the `/api` proxy)

## Why

Today the app runs only from a dev checkout (`npm run dev`). To run it on a VPS, or on several, we need one image that holds every runtime tool, plus a short way to start it.

## Mã nguồn mở có sẵn

- **Docker** with a multi-stage `Dockerfile`, and **Docker Compose**.
- **Caddy** (Apache-2.0): the official image, used as a reverse proxy with automatic HTTPS. It serves the built web files and proxies `/api` to the server, so no new npm package is needed for static files.
- **Litestream** (Apache-2.0): the official image, as an optional compose profile that replicates the SQLite file.
- No new npm dependency.

## What to do

All new files go under `deploy/`, plus a root `.dockerignore`.

1. **`deploy/docker/Dockerfile`** (multi-stage):
   - **build stage:**
     - `npm ci` from the lockfile inside the image, so it is Linux-native in the image; it does not touch the host `node_modules`
     - build `@vg/shared`, `apps/server`, `apps/web` and `apps/mcp` with the existing scripts
   - **runtime stage:** Node 22 slim with:
     - production deps only
     - ffmpeg (from `ffmpeg-static`, or apt; say which)
     - a Chromium that HyperFrames can drive. Find how `hyperframes` locates a browser (`@puppeteer/browsers` is in its deps), and pre-install it at build time so the container needs no download at runtime.
     - Be Vietnam Pro fonts
     - fontconfig
   - Runs as a non-root user. `DATA_DIR=/data` is a volume, with `HEALTHCHECK` on `/api/health`.
   - If the server has no production start command, start `node apps/server/dist/index.js` and check that it works. If `dist` needs a step the scripts don't cover, add it only inside the Dockerfile.
   - Native modules (`better-sqlite3`) must be built for the image's platform.
2. **`.dockerignore`:** exclude `node_modules`, `data`, `tmp`, `artifacts`, `.env*` (but keep `.env.example`), `.claude`, `.git`, test outputs and `docs/compose/samples`.
3. **`deploy/docker/compose.control.yml`:**
   - the `vg` service (`VG_ROLE=control`, `/data` volume, `env_file: .env`, no host port for the API)
   - `caddy` (ports 80/443, `Caddyfile` with a `DOMAIN` env, or `:80` for a LAN-only install; it serves the web build and proxies `/api`, with SSE working, so set `flush_interval -1` or check)
   - a `litestream` profile (off by default, config from env)
4. **`deploy/docker/compose.worker.yml`:**
   - one `vg` service with `VG_ROLE=worker`, `VG_CONTROL_URL` and `VG_JOIN_TOKEN`, a cache volume and no ports
   - Worker mode is built in TASK-118. For now, if `VG_ROLE=worker`, the server logs "worker mode chưa có (TASK-118)" and exits with code 0. This is the only server code change allowed: a few lines in `src/index.ts`.
5. **`deploy/install.sh`** (Linux VPS, bash):
   - check Docker and Compose, and print how to install them if missing (do not install them silently)
   - ask control or worker
   - create `/opt/vg` (overridable)
   - write `.env` from `.env.example` with fresh random secrets (`TOKEN_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`) and the domain
   - build or pull, then `up -d`
   - print the URL and next steps

   It must be idempotent: never overwrite an existing `.env` or `/data`.
6. **`deploy/README.md`** (Vietnamese, user-facing):
   - single machine with Docker
   - control plane on a VPS with a domain
   - LAN only
   - recommended private network (Tailscale or a self-hosted Headscale) between machines
   - backups (Litestream or copying `/data`)
   - updating
7. **What does not fit in the image.** These need a login on the machine:
   - LLM providers that use a local CLI (claude, codex, gemini, cursor-agent)
   - OmniRoute

   Find how the server calls them (grep `apps/server/src/providers/llm/`). Document the options: run the control plane natively, mount the CLI's config folder, or use API-key providers in Docker. Do not bake any login into the image.

## Rules

- No commit or push. No new npm dependency. Do not edit `package.json` files or `package-lock.json`.
- Do not touch:
  - `.env`, `.claude/`, `data/`, `scripts/`
  - `apps/server/src/**`, except the few lines in `src/index.ts` from step 4
  - `apps/web/src/**`
  - anything TASK-110 or TASK-114 is changing (compose, style, auth)
- Never `docker push`, and never log in to a registry. Do not run the install script on this machine against `/opt` or the real `data/`.
- Tests: no network in unit tests. The Docker build itself may download base images and apt packages.

## Done

- **Build and run** with the Docker installed on this machine:
  - `docker build -f deploy/docker/Dockerfile -t vg:dev .` works
  - `docker compose -f deploy/docker/compose.control.yml up` works with a temp data volume and `:80` (or another free port)
  - `/api/health` answers through Caddy
  - The image size and the build time go in the report. Then `down -v`.
- **Render inside the container:** run the existing compose sample render once to prove that Chromium and ffmpeg work:
  - command: `docker run … npx vitest run test/compose.eval.test.ts` with `VG_COMPOSE_SAMPLES=1` and `VG_COMPOSE_SAMPLE_ONLY=list_full`, or the nearest working equivalent
  - write the output into the container only
- **If TASK-114 has landed** before you finish, check that login works through Caddy (cookie over HTTP on LAN, `Secure` over HTTPS). If not, say "chưa kiểm vì 114 chưa xong".
- `npm run typecheck` at the root still passes.
- Write `docs/tasks/TASK-117.report.md` in Vietnamese, at most 40 lines, with:
  - the files
  - the image size
  - what was checked
  - the CLI-provider limitation and the recommended setup
  - the open questions
- Then create the empty `docs/tasks/TASK-117.done`.
