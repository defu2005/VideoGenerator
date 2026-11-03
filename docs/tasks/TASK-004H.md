# TASK-004H — Gemini CLI provider (`gemini-cli`), text + vision

## GOAL
Add **Google Gemini CLI** as an LLM provider (`gemini-cli`), alongside `claude-cli` and `copilot-cli`. The user can then use their Google account quota, or a Gemini Pro / Google AI Pro plan they may buy later. The provider must be usable for **every LLM task** through TASK-004F routing, and for **vision** (TASK-004G).

## CONTEXT
- **Installed** on the dev machine: `@google/gemini-cli` **0.66.0** (global npm). Bin entry: `bundle/gemini.js`. Windows shims: `%APPDATA%\npm\gemini.cmd`, `gemini.ps1`, plus an extension-less `gemini`. `engines.node >= 20`.
- **Relevant flags (0.66.0 `--help`):**

  | Flag | Meaning |
  |---|---|
  | `-p, --prompt` | headless mode; "Appended to input on stdin (if any)" |
  | `-m, --model` | model |
  | `-o, --output-format` | `text` / `json` / `stream-json` |
  | `--approval-mode` | `default` / `auto_edit` / `yolo` / `plan` (read-only) |
  | `--include-directories` | extra workspace directories |
  | `--skip-trust` | trust the workspace for this session |
  | `-e, --extensions` | extensions to load |
  | `--allowed-mcp-server-names` | MCP servers to allow |
  | `-s, --sandbox` | sandbox |
  | `--policy` | policy files (tool permissions; `--allowed-tools` is deprecated in favour of the Policy Engine) |

- **Auth** is done once by the user, outside the app: run `gemini` interactively and sign in with Google, or set `GEMINI_API_KEY` / Vertex env vars. The app never handles credentials.
- **Pattern to follow:** `apps/server/src/providers/llm/copilotCli.ts` + `cliProvider.ts`. Reuse the shared base: Windows launch via `process.execPath` + the package JS entry (never the extension-less shim; `.EXE` only in PATHEXT), timeout, temp cwd, `classifyFailure`, usage accounting.
- Existing `gemini` (API key) provider stays as is. `gemini-cli` is a separate provider id.

## DEPENDENCIES
TASK-004F (provider list + routing UI). The vision part is consumed by TASK-004G.

## REQUIREMENTS

### 1. Provider
- **Config:**
  - `GEMINI_CLI_ENABLED=false`
  - `GEMINI_CLI_PATH=gemini`
  - `GEMINI_CLI_MODEL=` (empty = CLI default)
  - `GEMINI_CLI_MAX_INPUT_TOKENS` / `MAX_OUTPUT_TOKENS` (optional, for preflight)

  Add them to `.env.example`, `config.ts` and the env-prefix map.
- **Windows launch:** resolve `gemini.cmd` → `node_modules/@google/gemini-cli/bundle/gemini.js` (read the `bin` field of the package's `package.json`, do not hard-code the path) and run it with `process.execPath`. Test the resolver with a fake directory tree.
- **Invocation, locked down** (headless, no tools, no MCP, no extensions, no file edits):
  ```
  <node> gemini.js -p "" -o json --approval-mode plan --skip-trust -e none --allowed-mcp-server-names __none__ [-m <model>] [--include-directories <tmpImageDir>]
  ```
  - The prompt goes on **stdin**: `-p ""` switches to headless mode and the stdin content is used. **Verify this exact behaviour** (and that `-e none` / an unknown MCP name disables extensions and MCP) against the real CLI with a recorded fixture. If any flag behaves differently, choose the documented equivalent (e.g. a deny-all `--policy` file written to the temp dir) and document it in the report.
  - cwd = per-call temp dir (deleted afterwards), so the CLI never sees the repo.
  - Environment: pass through the user env (auth), and set the env to disable telemetry if the CLI documents one.
- **Output parsing (`-o json`):** take the final model text from the JSON result (field names must come from the recorded fixture, not guessed). Take usage from the stats block (per-model input/output/cached tokens, request count) when present → `usage.calls[].inputTokens` / `outputTokens`. Strip code fences before handing the text to `generateStructured`.
- **Failure classification:**

  | Case | Code | Retryable |
  |---|---|---|
  | not installed | `LLM_NOT_CONFIGURED` | no |
  | not authenticated (message asks to sign in / set an API key) | `LLM_NOT_CONFIGURED` | no; hint "Chạy `gemini` một lần để đăng nhập Google" |
  | quota / rate limit (429, "quota", "RESOURCE_EXHAUSTED") | `LLM_RATE_LIMITED` | yes, with backoff; routing fallback (TASK-004F) applies |
  | invalid model | `LLM_NOT_CONFIGURED` | no |
  | timeout | — | yes |
  | malformed JSON | — | repair path as today |

- **Monthly counter:** counted like the other providers. No cap.
- **Model suggestions (TASK-004F `/models`):** static list `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, plus the configured default, plus free text. Mark the list as "may be outdated — type any model name your plan supports".
- **Capabilities:** `vision: true`, `maxImagesPerCall: 10`.

### 2. Vision transport (for TASK-004G)
- Copy the (already resized) images into the per-call temp dir and pass `--include-directories <dir>`.
- Reference each image in the prompt with Gemini CLI's file-reference syntax `@<absolute or relative path>`. Verify with a recorded real run that the image content reaches the model (e.g. a test image with a known word; the model must read it).
- Keep `--approval-mode plan` so the CLI can only read files.

### 3. Recorded fixtures (real CLI, recorded once by the architect)
- `apps/server/test/fixtures/gemini-cli-0.66.0.json`: a structured-output text call.
- `apps/server/test/fixtures/gemini-cli-0.66.0-vision.json`: an image read.
- `apps/server/test/fixtures/gemini-cli-0.66.0-unauth.txt`: the not-signed-in output.

**The implementer must not run the real CLI.** If a fixture is missing, write the parser against the documented shape, mark the related tests `todo`, and list it in the report. The architect records the fixtures after the user signs in, and the tests are then enabled in a follow-up.

### 4. UI
- Provider appears in `Cài đặt → Mô hình AI` (TASK-004F) as "Gemini CLI (tài khoản Google)".
- Status line: Đã cài / Chưa cài; Đã đăng nhập / Chưa đăng nhập (from the last call's classification, not a live probe); monthly call count.
- Hint when disabled: set `GEMINI_CLI_ENABLED=true` and sign in once.

## DO NOT
- Do not store, read or forward Google credentials.
- Do not allow tools other than read-only file access for vision.
- Do not run the CLI against the repo directory.
- Do not run real `gemini` / `copilot` / `claude` prompts in tests.
- Do not add npm dependencies to the project (the CLI is a user-installed global binary).
- Do not commit.

## ACCEPTANCE CRITERIA
1. Checks pass (typecheck, build, test, drizzle-kit no changes, audit 0).
2. Unit tests cover:
   - the Windows launcher resolver
   - args (with and without model and images)
   - JSON parsing from the fixtures
   - usage extraction
   - every failure class
   - the vision prompt with `@path` references
3. With `GEMINI_CLI_ENABLED=true` and the user signed in: the architect runs research + script on a mock-free project routed to `gemini-cli` (live, done by the architect), and one vision check.

## REPORT BACK
`docs/tasks/TASK-004H.report.md` (including any flag deviations) + empty `docs/tasks/TASK-004H.done`.
