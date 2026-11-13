# TASK-123 — Hermes fleet: every instance has the same skills, brain and app access 🛰️

**Who:** Cursor, model `grok-4.7-xhigh`. **Size:** L. **Migration:** one, generated with `npx drizzle-kit generate` in `apps/server`. **New dependency:** none. `@modelcontextprotocol/sdk` (already in `apps/mcp`) has the Streamable HTTP server transport.

**Order:** after TASK-122 (identity, duty, `agent_instances`) and TASK-117 (`deploy/`). If TASK-074b (skill eval, shadow run) has landed, reuse it. If not, use the existing `operator/skillEval.ts` + `skillVersions.ts` path and leave a `// TASK-074b` note.

## Goal

Hermes can run on many servers: the user's PC (WSL), the control server, worker nodes. Every instance must have the same:
- **ability to operate the app**: the same tool list and the same permissions;
- **skills**: what one instance learns, all of them get;
- **intelligence**: the same model, the same handbook, the same shared lessons;
- **Hermes version**.

Hermes itself has no built-in sync for skills or memory, and its docs say never to point two Hermes processes at one `~/.hermes`. So **the app is the hub and the source of truth**. Each instance keeps its own `~/.hermes` and syncs with the hub through code, using no tokens.

Facts checked in the official Hermes docs (https://hermes-agent.nousresearch.com/docs):
- **MCP:** `mcp_servers.<name>` supports stdio (`command`, `args`, `env`) or remote `url` plus `headers` (Streamable HTTP by default, `transport: sse` for legacy). `${VAR}` is expanded in `url`, `headers` and `env`.
- **Skills:**
  - they live in `~/.hermes/skills/`, in Agent Skills `SKILL.md` format;
  - the agent writes its own skills with `skill_manage`;
  - `skills.external_dirs` (a list) loads extra read-only skill folders;
  - `skills.write_approval` stages writes.
- **Memory:** `~/.hermes/memories/MEMORY.md` (2,200 chars) and `USER.md`. Memory is per profile and not shared by design.
- **Docker:**
  - official image `nousresearch/hermes-agent:<X.Y.Z>`;
  - all state is in the `/opt/data` volume;
  - run `gateway run`;
  - never run two gateways on one data directory.
- **Models:** `model.provider`, `model.default`, `model.base_url`; custom endpoints under `providers.<name>` with `api` and `api_key: ${VAR}`.
- **Fleet:** `hermes profile export/import` and profile distributions (a git repo with `distribution.yaml`; memories and `.env` are excluded). There is also an optional remote config plane (`HERMES_CONFIG_BACKEND=remote`), which fails closed when unreachable.

Read the relevant doc page again before you rely on a key name. If a key differs from the list above, follow the docs and note it in the report.

## Read first

- `docs/cursor/README.md`, `docs/cursor/TASK-122.md` and its report, `docs/cursor/TASK-117.md` and its report, `deploy/README.md`, `deploy/docker/*`
- `apps/mcp/src/index.ts` (stdio only today), `apiClient.ts`, `tools.ts`
- `apps/server/src/operator/skillVersions.ts` (`saveSkillDraft`, `activateSkillVersion`, `listSkillVersions`), `skillEval.ts`, `repoSkills.ts`, `handbook.ts`, `skills.ts`
- `apps/server/src/api/operator.ts` (skills routes ~42–60, 151)
- `apps/server/src/assistant/tools.ts`: the skill tools (~1497–1701)
- `.agents/skills/` (TASK-063), `docs/tasks/HERMES-GUIDE.report.md` (the current WSL setup)

## What to do

### 1. Remote MCP over Streamable HTTP (same tools everywhere)

- Add an HTTP mode to `apps/mcp`:
  - `VG_MCP_HTTP_PORT` set → serve the same tool server on `POST/GET /mcp` with `StreamableHTTPServerTransport`;
  - unset → stdio exactly as today.
- No shared secret is stored in the MCP process. Each request's `Authorization: Bearer <key>` (or `x-api-key`) is passed through to the API for the calls made in that request, so identity and permissions come from the caller's own TASK-114/122 key.
  - Reject requests without a key (401).
  - Keep the session id from the transport per client.
- Tool list = the operator set (`VG_TOOL_SOURCE=operator` behaviour) plus the TASK-122 supervisor tools. Any server that connects sees the list the hub serves, so a new tool reaches every instance at once.
- In `deploy/docker/compose.control.yml`, add an `mcp` service (same `vg` image, command runs the MCP in HTTP mode, internal port). In the `Caddyfile`, route `/mcp` to it.
  - Keep any `/mcp` body-size and timeout settings small but long enough for streaming.
- Add an `mcp` entry to `/api/health`: up, tool count, tool-list hash.

### 2. Capability bundle (hub → instances)

Endpoint `GET /api/agents/bundle` (key with kind `hermes`). It returns `{bundleVersion, hash, files[], configPatch, hermesVersion, cron[]}`:
- `files`:
  - every **active** skill version from `skillVersions`;
  - the repo skills marked for agents (`.agents/skills/*`, including `vg-supervise` and `vg-escalation` from TASK-122);
  - a generated `vg-handbook/SKILL.md` (handbook + standing rules + hard limits);
  - a generated `vg-fleet-lessons/SKILL.md` (§4).
  - Paths are relative and safe: no `..`, no absolute paths, limited to `*.md` and small text files under 256 KB each.
- `configPatch`: only the keys the hub manages, nothing else:
  - `model.provider`, `model.default`, `model.base_url` (OmniRoute or another OpenAI-compatible endpoint, set in a new Settings → "Hermes fleet" section);
  - `providers.<name>` with `api` and `api_key: ${VG_HERMES_MODEL_KEY}`. The **name** of the env var is sent, never its value;
  - `mcp_servers.video-agent` with `url: ${VG_MCP_URL}`, `headers.Authorization: "Bearer ${VG_API_KEY}"`, and an optional `tools.include` list;
  - `skills.external_dirs` containing `/opt/data/vg-skills`;
  - `memory` settings.
- `hermesVersion`: the pinned image tag set in Settings.
- `cron`: the supervision job definitions (`vg-supervise` every 15 min; configurable).
- **Never put a secret in the bundle.** Add a test that scans the bundle for values of known secret settings and fails if it finds any.
- `bundleVersion` goes up whenever any part changes (skill activated, settings changed, lessons digest regenerated). `hash` is a sha256 of the content.

### 3. Sync agent (`vg-hermes-sync`, code only, zero tokens)

A small Node entry in `apps/mcp` (for example `dist/sync.js`, plus a bin script) that runs next to Hermes:
- In Docker, as a **sidecar** container sharing Hermes's `/opt/data` volume.
- In WSL, as a manual or cron command.

Loop every `VG_SYNC_INTERVAL_SEC` (default 300):

1. **Heartbeat:** `POST /api/agents/instances/heartbeat` with `{instance, environment, hermesVersion (read from the image or `hermes --version`), bundleVersion, skillsHash, toolHash}`.
2. **Pull:** when `bundleVersion` changed, write `files` into `/opt/data/vg-skills/`:
   - write to a temp dir and swap it in atomically;
   - delete only files under `vg-skills` that the hub no longer lists;
   - never touch `skills/` (Hermes's own), `memories/`, `sessions/`, `.env` or `auth.json`.
3. **Config:** merge `configPatch` into `/opt/data/config.yaml`:
   - parse the YAML; there is already a YAML parser in the repo (check `package.json` files, for example `yaml`); if none, report it and stop;
   - change only the managed keys and keep everything else and the comments where the parser allows;
   - write a backup `config.yaml.vg-bak` first;
   - when the config changed, write a marker file `vg-sync/reload-needed`, and tell the user in the sync log to run `/reload-mcp` or restart the gateway. Do not restart Hermes from the sidecar.
4. **Push:** scan `/opt/data/skills/**/SKILL.md` for skills Hermes created or changed since the last sync (compare against a local `vg-sync/state.json` of hashes). For each one, call `POST /api/agents/skills/drafts` with `{name, markdown, files, instance, parentVersion?, evidence}`.
5. **Cron:** for each `cron` entry missing from `/opt/data/cron/jobs.json`, list the exact `hermes cron create …` command in the heartbeat payload. The app shows it to the user on the Fleet tab.
   - Do not edit `jobs.json` directly unless the Hermes docs describe its format as stable. If they do, say so in the report.

Rules for the sync agent:
- It never reads or sends `.env`, `auth.json`, `memories/` or sessions.
- It sends its own `VG_API_KEY` only as the auth header.
- It fails soft: the hub can be down, and Hermes keeps running with the last synced files.
- Log one line per cycle, and more only on change or error.

### 4. Shared lessons ("intelligence" that grows)

Hermes's `MEMORY.md` is small and per instance, so it stays local and untouched. Shared knowledge lives in the hub.

New table `agent_lessons`:
- `id`, `scope` (`global` | `profile:<id>` | `platform:<p>`), `text` (≤ 500 chars), `evidence` (JSON: run ids, audit ids, metrics)
- `sourceKind`, `sourceInstance`, `createdAt`, `confirmedCount`, `status` (active | retired), `supersedes`

New tools for all agents, the operator included:
- `record_lesson` `{scope, text, evidence}`. It dedups by normalized text: an existing match gets `confirmedCount + 1` instead of a new row.
- `search_lessons` `{query, scope?, limit}`.
- `retire_lesson` `{id, reason}`, Hermes on duty only.

The hub regenerates `vg-fleet-lessons/SKILL.md` with the top lessons by `confirmedCount` and recency, capped at about 6 KB, so every instance loads the same digest at session start. The in-app operator gets the same digest through `handbook.ts`.

### 5. Skill drafts from any agent → one reviewed version for all

- `POST /api/agents/skills/drafts` stores the draft through `saveSkillDraft`, with provenance: `sourceKind`, `sourceInstance`, `parentVersion`.
- **Conflict:**
  - if `parentVersion` is not the current active version of that name, the draft is marked `needs_merge` and shown side by side on the Skills page;
  - there is no auto-merge in this task;
  - two drafts of the same name from two instances are both kept.
- **Gate:** run the existing skill eval (`skillEval.ts`). Use TASK-074b's behaviour eval and shadow run if present.
  - A draft that passes and only reads (no mutating tools named) may auto-activate when the setting `fleet.autoActivateReadOnlySkills` is on (default off).
  - Everything else waits for the user to activate it on the Skills page.
  - Activation bumps `bundleVersion`, so every instance pulls it on the next cycle.
- Rollback: activating an older version is the existing `activateSkillVersion`. It propagates the same way.
- Policy rule 4 also covers skill activation by an agent, except for the read-only auto-activate setting above, which only the user can turn on.

### 6. Fleet registry and drift

- Extend `agent_instances` (TASK-122) with: `environment`, `host`, `hermesVersion`, `bundleVersion`, `skillsHash`, `toolHash`, `lastSyncAt`, `lastError`, `pendingCron`.
- Drift rules (code), shown on a **Fleet** tab next to the TASK-122 Hermes tab and included in `supervision_snapshot.anomalies`:
  - `bundleVersion` behind the hub for more than 15 min;
  - `hermesVersion` different from the pinned tag;
  - `toolHash` different from the hub's (an old MCP);
  - no heartbeat for more than 15 min;
  - managed cron job missing.
- The Fleet tab lists each instance with its status, the exact fix (for example "chạy lệnh: …", or "đổi image tag thành …"), and a copy button for the install snippet.

### 7. Packaging (Docker)

- `deploy/docker/compose.hermes.yml`:
  - service `hermes`: `nousresearch/hermes-agent:${HERMES_VERSION}` (pinned, never `latest`), volume `hermes-data:/opt/data`, command `gateway run`, and `env_file` holding the user's own `VG_API_KEY`, `VG_MCP_URL` and `VG_HERMES_MODEL_KEY`;
  - service `vg-hermes-sync`: the `vg` image, command runs the sync agent, same volume;
  - not run as root where the images allow it.
- `deploy/install.sh`: add an optional `--with-hermes` step that writes that compose file and an `.env.hermes` template with empty values. The user fills in the keys themselves.
- `deploy/README.md`, section "Hermes trên nhiều máy":
  - one gateway per data volume;
  - the user creates one machine key per instance in Settings, and sets `canSupervise` on the ones allowed to take duty;
  - only one instance is on duty at a time (TASK-122);
  - Hermes must not use the app's Telegram bot token (use no Telegram, or a different bot);
  - how to add the cron job;
  - how to upgrade (change `HERMES_VERSION` in Settings and in `.env`, then pull).
- WSL (the user's current setup): document switching the MCP entry from stdio to `url` + `headers` and running `vg-hermes-sync` from WSL. Keep stdio working for anyone who wants it.

## Open source (Mã nguồn mở có sẵn)

- **Hermes Agent** (Nous Research, MIT; the docs footer says MIT, confirm the repo LICENSE and note it in the report): official Docker image, Streamable HTTP MCP client, `skills.external_dirs`, cron. We use it unchanged.
- **Hermes profile distributions** (git repo + `distribution.yaml`) and **remote config** (`HERMES_CONFIG_BACKEND=remote`): read both pages.
  - If the remote config protocol is documented well enough for the app to act as the config plane, report it as a better alternative to the YAML merge in §3. Do not build it in this task.
  - A distribution repo needs git hosting the user does not have yet. That is why we use the hub pull.
- **MCP TypeScript SDK** `StreamableHTTPServerTransport`: already a dependency.
- **Agent Skills** format (agentskills.io): shared by Hermes, Codex, Cursor and Claude, so the same skill files work for every agent.
- If you find a maintained, permissive-licence tool that syncs Agent Skills folders from an HTTP source better than §3, report it (README rule 11). Do not add it.

## Tests (no network, no real LLM, no real Hermes)

- MCP HTTP:
  - a request without a key → 401;
  - with a key, the tool list equals the stdio operator list plus the supervisor tools;
  - the caller's key is what reaches the API (mock API);
  - two clients get separate sessions.
- Bundle:
  - contains active skills only;
  - the secret scan finds nothing;
  - `bundleVersion` bumps on skill activation, on settings change and on lessons regeneration;
  - path safety rejects `..` and absolute paths.
- Sync agent, against a temp dir laid out like `/opt/data`:
  - pull writes `vg-skills/` atomically and removes stale hub files only;
  - `skills/`, `memories/`, `.env` and `auth.json` are untouched (hash before and after);
  - the config merge changes only managed keys, writes the backup, and keeps unrelated keys;
  - push sends only new or changed Hermes skills;
  - a hub that is down → no crash, and the files stay;
  - the heartbeat payload has the hashes.
- Lessons: dedup increments `confirmedCount`; the digest stays under the cap; `retire_lesson` needs duty.
- Drafts:
  - a stale `parentVersion` → `needs_merge`;
  - a passing read-only draft auto-activates only when the setting is on;
  - an agent cannot turn that setting on (policy).
- Drift: each rule fires on a fixture and shows in `supervision_snapshot`.

## Rules

- No commit or push. No new npm dependency. One generated migration.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`. The `.env.hermes` template in `deploy/` has empty values only.
- No secret ever leaves the hub in a bundle, log or heartbeat. Each instance's keys are entered by the user on that machine.
- Do not change TASK-059 hard limits or TASK-122 duty, lease and escalation rules.
- Do not modify Hermes code or its own files beyond `config.yaml` managed keys and the `vg-skills/` folder.
- Tests: no network, no real LLM or TTS, no real Hermes. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- `npm run typecheck` at the root. `npm test` in `apps/server`, `apps/mcp`, `packages/shared`.
- `docker compose -f deploy/docker/compose.control.yml -f deploy/docker/compose.hermes.yml config` validates. If Docker is available, start `mcp` and check that `/mcp` answers 401 without a key. Do not start a real Hermes gateway with real keys.
- One line in `docs/user-guide/nhat-ky-thay-doi.md`, and a user-guide section "Đồng bộ Hermes giữa các máy".
- `docs/tasks/TASK-123.report.md` in Vietnamese, at most 60 lines:
  - files and endpoints;
  - the managed config keys;
  - the Hermes doc keys you confirmed and any that differed;
  - the remote-config finding;
  - test results;
  - what the user must do by hand: keys, cron, `/reload-mcp`.
- Then create the empty `docs/tasks/TASK-123.done`.
