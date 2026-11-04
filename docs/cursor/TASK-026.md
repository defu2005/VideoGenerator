# TASK-026 — Cursor guide (OmniRoute as the LLM gateway)

Read `docs/cursor/README.md` first, and `docs/ARCHITECTURE.md` §4. There is no spec in `docs/tasks/`: this guide is the spec.

## Goal
OmniRoute is a local OpenAI-compatible gateway (default `http://127.0.0.1:20128/v1`) that fronts many providers and accounts. The app already has a basic `omniroute` provider (`apps/server/src/providers/llm/registry.ts`, `openaiCompatible.ts`). Make it a first-class **gateway**: the user can route all LLM work through it, see its model catalog and health, and fall back to direct providers when it is down.

The user has not installed OmniRoute yet. Everything must work, and stay off, when it is not running.

## What to build
- **Model catalog:** `GET <base>/models` (OpenAI format). Cache it for 10 minutes. Map each model to `{ id, ownedBy, contextWindow?, vision?, pricing? }` from whatever fields the response has (keep unknown fields out). The model list in the LLM settings shows these models for `omniroute` instead of the empty list.
- **Health:** `GET /api/llm/providers/omniroute/health` → reachable, latency, model count, last error. A short timeout (3 s). The providers page shows a green/red dot and the setup hint when it is down.
- **Gateway mode** (app setting `llmGateway`, in app_settings): `off` (default) | `prefer` | `only`.
  - `prefer`: when a task's route points at a model that OmniRoute also lists (match by model id, or by a mapping table `provider:model → omniroute model id` the user can edit), send the call through OmniRoute. If OmniRoute fails with a connection error or 5xx, fall back to the original direct route. Log the fallback once per run.
  - `only`: every call goes to OmniRoute; there is no fallback. Tasks whose model OmniRoute does not list fail at preflight with a clear message.
  - CLI providers (claude-cli, copilot-cli, antigravity-cli) are only replaced when the mapping table says so.
- **Vision:** `OMNIROUTE_VISION` stays as the global flag, and a per-model `vision` from the catalog wins when present.
- **Usage/pricing:** record usage under provider `omniroute` with the real model id. Use catalog pricing when present, else the existing pricing table.
- **UI:** in "Cài đặt LLM", a section "Gateway OmniRoute": status, base URL (read-only, from env), the mode select, the mapping table editor, a "Tải lại danh sách model" button, and the setup steps (install OmniRoute, connect providers in its dashboard, create an endpoint key, set `OMNIROUTE_API_KEY` in `.env`).

## Tests (no network: fake fetch)
- Catalog parse and cache; health up/down.
- `prefer`: routed through OmniRoute; falls back on a connection error; no fallback on a 4xx.
- `only`: preflight error for an unmapped task.
- Usage recorded with the right provider/model.
- Web: the gateway section renders the status and saves the mode.

## Steps
1. Shared: gateway setting schema.
2. Server: catalog, health, routing in `generateRoutedStructured`/the router, preflight, tests.
3. Web section + tests.
4. Done checklist. Write `docs/tasks/TASK-026.report.md` and `docs/tasks/TASK-026.done`.
