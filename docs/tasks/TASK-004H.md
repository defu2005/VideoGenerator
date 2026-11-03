# TASK-004H — Antigravity CLI provider (`antigravity-cli`), text + vision

> History: this task first targeted `gemini-cli`. Google stopped serving Gemini CLI for personal accounts on 2026-06-18 (verified 2026-11-03: `IneligibleTierError … UNSUPPORTED_CLIENT`). Its successor, **Antigravity CLI (`agy`)**, works with the user's Google account. This spec replaces the old one.

## GOAL
Add **`antigravity-cli`** as an LLM provider. It runs Google's Antigravity CLI headless and gives the app the models of the user's Google account. It must work:
- for every LLM task through TASK-004F routing, including as a **fallback** route
- for **vision** (TASK-004G)

## CONTEXT — verified facts (architect, 2026-11-03, `agy` 1.4.12)
- **Binary:** `%LOCALAPPDATA%\agy\bin\agy.exe`. Native, signed by Google LLC, and it self-updates in the background, so the exe can briefly disappear during an update: retry resolution for up to 60 s. On macOS/Linux it is `~/.local/bin/agy`. Auth is the user's Google sign-in (shared with the Antigravity desktop app). **The app never handles credentials.**
- **`agy models`** prints `id<TAB>label` lines, e.g. `gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-low`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`.
- **Headless:**
  - `agy --print=<prompt> --output-format json --mode plan --model <id> --print-timeout <n>s`
  - `--print` **requires its value attached** (`--print=<text>`). With a separate value and a flag after it, agy takes the next flag as the prompt.
  - Prompts are read only from `--print` / `-i` / stdin-with-`--input-format stream-json`.
  - **On Windows the app must pass arguments without a shell** (spawn with an args array). Then no manual quote escaping is needed. Add a test with quotes, backslashes and newlines in the prompt.
- **JSON result** (`--output-format json`), one object:
  ```
  {"conversation_id":"…","status":"SUCCESS","response":"<text>","duration_seconds":6.9,"num_turns":1,
   "usage":{"input_tokens":7641,"output_tokens":452,"thinking_tokens":447,"cache_read_tokens":0,"total_tokens":8093},
   "denied_actions":[{"action":"command","display_name":"RunCommand"}]}
  ```
  `denied_actions` appears when the model tried a tool and it was auto-denied. In that case `response` can be empty.
- **Modes:**
  - `--mode auto` is **not available** for the user's account ("warning: --mode auto is not available for this account; continuing in the default mode", printed on stderr).
  - `--mode plan` is read-only. Shell commands are auto-denied there, which is what an LLM provider wants.
- **`--json-schema <string|path>`** enforces structured output (for stream-json, only the final result). **Use it:** pass the zod schema converted to JSON Schema (zod 4 `z.toJSONSchema`) as a temp file path.
- `--add-dir <dir>` adds a directory to the workspace (repeatable). Use it for vision images.
- `--effort low|medium|high|xhigh|max`.
- Other stderr warnings must not be treated as failures. Only the exit code + JSON `status` decide.

## DEPENDENCIES
TASK-004F (routing, fallback, `usage.calls`, model suggestions). The vision part is consumed by TASK-004G.

## REQUIREMENTS

### 1. Provider (`apps/server/src/providers/llm/antigravityCli.ts`, on top of `CliProviderBase`)
- **Config:**
  - `ANTIGRAVITY_CLI_ENABLED=false`
  - `ANTIGRAVITY_CLI_PATH=` (empty = auto-resolve as above)
  - `ANTIGRAVITY_CLI_MODEL=` (empty = agy default)
  - `ANTIGRAVITY_CLI_EFFORT=medium`
  - `ANTIGRAVITY_CLI_MAX_INPUT_TOKENS` / `…_MAX_OUTPUT_TOKENS` (optional, for preflight)
  - Add them to `.env.example`, `config.ts`, `LlmProviderIdSchema`, labels/hints ("Antigravity CLI (tài khoản Google)", hint "Cài agy và chạy `agy` một lần để đăng nhập Google").
- **Invocation** (args array, no shell):
  ```
  agy --print=<prompt> --output-format json --mode plan --print-timeout <timeoutSec>s
      [--model <id>] [--effort <e>] [--json-schema <tmp/schema.json>] [--add-dir <tmpImageDir>]
  ```
  - cwd = per-call temp dir, deleted afterwards. The agent never sees the repo.
  - The prompt = system + messages, formatted like the other CLI providers.
  - When `json: true`, also pass `--json-schema` built from the request schema (extend `LlmRequest` with an optional `jsonSchema` object, which `generateStructured` fills from the zod schema).
- **Parse:**
  - `response` → text; strip code fences.
  - usage → `inputTokens = input_tokens + cache_read_tokens`, `outputTokens = output_tokens + thinking_tokens`.
  - `status !== "SUCCESS"` or an empty `response` → error (see below).
  - Keep `conversation_id` in the debug log only.
- **Failure classification:**

  | Signal | Code | Retryable |
  |---|---|---|
  | exe not found | `LLM_NOT_CONFIGURED` | no, with the install hint |
  | not signed in / ineligible account (`not eligible`, `sign in`, `login`, `IneligibleTier`) | `LLM_NOT_CONFIGURED` | no, hint "Chạy `agy` một lần để đăng nhập Google" |
  | quota / rate (`quota`, `RESOURCE_EXHAUSTED`, `rate limit`, 429) | `LLM_RATE_LIMITED` | yes (routing fallback applies) |
  | unknown model | `LLM_NOT_CONFIGURED` | no, "Model không có trong `agy models`" |
  | timeout | `LLM_UNAVAILABLE` | yes |
  | `denied_actions` non-empty **and** empty `response` | `LLM_INVALID_OUTPUT` | no, "Model cố dùng công cụ thay vì trả lời" (the repair path may retry with a stricter "Answer directly, do not use tools" prefix) |
  | malformed JSON in `response` | — | the normal repair path |

- **Monthly counter + `usage.calls`** as for the other providers.
- **Model suggestions:** run `agy models` (5 s timeout, cache 10 min) → ids. On failure use the static list above. Also include models that previously succeeded (TASK-004F).
- **Capabilities:** `vision: true`, `maxImagesPerCall: 8`.

### 2. Vision transport (for TASK-004G)
- Copy the already-resized images into `<tmp>/images/`, pass `--add-dir <tmp>/images`, and reference each image by absolute path in the prompt (`Image 1: <path>` …).
- Verified behaviour to record as a fixture: the model reads the image through its read tool, which plan mode allows.
- If a real run shows images are not read in plan mode, document it and set `vision: false` until fixed.

### 3. Fixtures (recorded by the architect from real runs)
`apps/server/test/fixtures/agy-1.4.12-*.json`:
- a success text call
- a `--json-schema` structured call
- a `denied_actions` empty-response case
- the `--mode auto` stderr warning
- the `agy models` output

The implementer must not run `agy`. If a fixture is missing, write against the documented shape above and mark the test `todo`.

### 4. UI
- The provider appears in `Cài đặt → Mô hình AI`, with the "Nhanh" preset suggesting `gemini-3.8-flash-low` and the "Mạnh" preset suggesting `claude-sonnet-4-6`.
- Status: Đã cài / Chưa cài, Đăng nhập (from the last call's classification), monthly calls.

## DO NOT
- Do not spawn through a shell. Do not use `--dangerously-skip-permissions` or any mode other than `plan` in the provider (that flag is only for the developer dispatch script `scripts/agy-task.ps1`, never for the app).
- Do not read, store or forward Google credentials. Do not run the CLI in the repo directory.
- Do not add dependencies. Tests must not hit the network or real CLIs. Do not commit.

## ACCEPTANCE CRITERIA
1. Checks pass (typecheck, build, test, drizzle-kit no changes, audit 0).
2. Unit tests cover:
   - resolution with retry
   - args (quotes/backslashes/newlines, model, effort, schema, add-dir)
   - JSON parsing and usage mapping
   - every failure class
   - model listing parse + fallback list
   - the vision prompt
3. **Live (architect):**
   - research + script routed to `antigravity-cli / claude-sonnet-4-6`
   - scene queries routed to `antigravity-cli / gemini-3.8-flash-low`
   - fallback `claude-cli` → `antigravity-cli`: a forced primary failure falls back once

## REPORT BACK
`docs/tasks/TASK-004H.report.md` + empty `docs/tasks/TASK-004H.done`.
