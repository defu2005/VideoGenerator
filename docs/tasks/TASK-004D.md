# TASK-004D — GitHub providers: GitHub Models + GitHub Copilot (Free) + provider limits & usage counter

> **AMENDMENT (architect, 2026-11-03): GitHub Models was fully retired by GitHub on 2026-07-30** (playground, catalog, inference API and BYOK no longer available — see https://docs.github.com/en/github-models). **Do not ship a `github-models` provider.** Keep: §2 provider limits, §3 pre-flight (generic, configurable per provider via `<PROVIDER>_MAX_INPUT_TOKENS` / `_MAX_OUTPUT_TOKENS`), §4 `copilot-cli`, §5 usage counter, §6 Copilot Chat + MCP docs. Pre-flight tests should use the `mock` provider configured with small limits instead of github-models. If code for github-models was already written in this round, remove it in the fix round.

## GOAL
Add two GitHub-based LLM options:
1. **GitHub Models** (official API, free tier with a GitHub account).
2. **GitHub Copilot** (works with the Copilot Free plan): automatic via the **Copilot CLI** in headless mode (provider `copilot-cli`), and human-driven via **Copilot Chat in VS Code using the TASK-004B MCP server** (docs only).

And make the LLM layer respect per-provider token limits **before** calling, so small free tiers never waste requests, and show how many calls each provider used this month. **No call cap** (product decision by the user): calls are never blocked by a monthly count.

## CONTEXT
- Read `docs/ARCHITECTURE.md` §4 "Quy tắc LLM" and §7, `docs/tasks/TASK-004.md` + `TASK-004.review.md` (merged/separate/off research modes, `LLM_OUTPUT_TRUNCATED`, usage accounting).
- GitHub Models exposes an OpenAI-compatible chat completions API authenticated with a GitHub token (fine-grained PAT with the Models permission). Verify the current base URL, auth header and model id format (e.g. `<publisher>/<model>`) in GitHub's official docs ("GitHub Models" → REST API / quickstart) and record them in the report. Expected: base `https://models.github.ai/inference`, `Authorization: Bearer <token>`.
- Free-tier limits are per user **per model** and vary by model tier; they change over time — make them configurable, do not hard-code beyond defaults.
- GitHub Models uses its own allowance (not the Copilot chat quota). `copilot-cli` DOES use the Copilot plan quota — the app only shows usage (§5), it does not cap it.
- TASK-004B (claude-cli + MCP) must be committed first; this task refactors its CLI code into a shared base.

## FILES TO INSPECT
- `apps/server/src/providers/llm/registry.ts`, `openaiCompatible.ts`, `types.ts`, `structured.ts`
- `apps/server/src/stages/script/*`, `src/stages/research/*` (merged/separate logic, maxOutputTokens computation)
- `apps/server/src/lib/config.ts`, `.env.example`, `README.md`

## FILES TO CREATE/MODIFY (guide)
```
apps/server/src/providers/llm/registry.ts        # register "github-models"
apps/server/src/providers/llm/types.ts           # provider limits metadata
apps/server/src/providers/llm/tokenEstimate.ts   # cheap heuristic token estimator (no tokenizer dependency)
apps/server/src/providers/llm/preflight.ts       # decide merged vs separate / fail early
apps/server/src/stages/**                        # use preflight
apps/server/src/lib/config.ts, .env.example, README.md
apps/server/test/githubModels.test.ts, preflight.test.ts
apps/web: provider select shows limits hint (small text)
```

## REQUIREMENTS

### 1. Provider
- Id `github-models`, label "GitHub Models", implemented with the existing OpenAI-compatible adapter (no new adapter class unless headers differ; if GitHub requires extra headers, add them via adapter options).
- Env: `GITHUB_MODELS_TOKEN`, `GITHUB_MODELS_BASE_URL` (default from docs), `GITHUB_MODELS_MODEL` (no default — user must choose), `GITHUB_MODELS_MAX_INPUT_TOKENS=8000`, `GITHUB_MODELS_MAX_OUTPUT_TOKENS=4000`, `GITHUB_MODELS_JSON_MODE=true`.
- Configured only when token **and** model are set (same rule as Ollama after TASK-004 B5).
- 429 → `LLM_RATE_LIMIT`. If the response says the **daily** quota is exhausted (inspect body/headers, e.g. "UserByModelByDay"), map to a new code `LLM_QUOTA_EXHAUSTED`, **non-retryable**, message: "GitHub Models daily limit reached for <model>. Try another model or provider, or wait until the quota resets." (Do not burn retries on a daily cap.)

### 2. Provider limits (generic, all providers)
- Extend `LlmProvider` with optional `limits?: { maxInputTokens?: number; maxOutputTokens?: number }` (from env for github-models; optional env overrides for other providers: `<PROVIDER>_MAX_INPUT_TOKENS`, `<PROVIDER>_MAX_OUTPUT_TOKENS`).
- `tokenEstimate.ts`: conservative heuristic, no dependency: `ceil(chars / 3)` for text containing Vietnamese diacritics or other non-ASCII, `ceil(chars / 4)` otherwise; JSON overhead factor 1.15. Unit-tested; document that it is an estimate.
- Clamp `maxOutputTokens` sent to the provider to `limits.maxOutputTokens`.

### 3. Pre-flight decision (before any LLM call)
`preflight({ provider, mode, project })` returns one of:
- `proceed` with `{ mode, maxOutputTokens }`;
- `switch-to-separate` when `merged` estimated output (research + script for the target duration) exceeds the provider output limit but each separate call fits — the RESEARCH executor then runs research-only and SCRIPT does its own call (2 calls). Record the reason in the job message: "Merged output (~N tokens) exceeds GitHub Models limit (4000); using 2 calls";
- `reject` with non-retryable `LLM_LIMIT_TOO_SMALL` when even the script alone cannot fit (estimate from target duration × words per minute × tokens per word), **before** calling; message suggests a shorter duration or another provider.
- Also reject/trim when the estimated input exceeds `maxInputTokens`: drop research `keyFacts` beyond 8 and `timeline` beyond 6 from the script input first; if still too big → `LLM_LIMIT_TOO_SMALL`.
- Estimation for expected script output: `words = targetDurationSec / 60 × wordsPerMinute`; tokens per word: 2.5 for `vi`, 1.4 for `en`, 2.0 otherwise; + JSON/fields overhead 400 tokens; research estimate 900 tokens. Keep constants in one place.
- Pre-flight applies to every provider that declares limits; providers without limits always `proceed`.

### 4. GitHub Copilot via Copilot CLI (`copilot-cli`)
- Reuse the CLI-provider machinery from TASK-004B (`claudeCli.ts`): extract a shared `cliProvider.ts` base (spawn without shell, prompt via stdin, empty temp cwd under `DATA_DIR/tmp/<provider>`, minimal env, kill process tree on abort/timeout, single-concurrency queue, error mapping) and make both `claude-cli` and `copilot-cli` thin configurations of it. Existing `claude-cli` tests must still pass unchanged.
- Binary `COPILOT_CLI_PATH` (default `copilot`), enabled with `COPILOT_CLI_ENABLED=true`, optional `COPILOT_CLI_MODEL`. Not installed → listed `configured: false` with hint "Install GitHub Copilot CLI and sign in once".
- Invocation: non-interactive prompt mode, **no tools allowed** (text only), no file access (empty cwd), optional model flag. Verify exact flags against GitHub's official Copilot CLI docs, keep them in one constant, and record flags + doc URL in the report. If the CLI prints plain text instead of JSON, the existing structured helper extracts the JSON object.
- Facts verified by the architect on this machine (GitHub Copilot CLI **1.0.105**, installed globally via `npm i -g @github/copilot`, binary `copilot` on PATH): `-p/--prompt <text>` non-interactive; piped stdin is accepted as the prompt; `-s/--silent` prints only the agent response; `--output-format json` emits JSONL (one object per line); `--model <id|auto>`; `--disable-client-telemetry`; tool auto-approval only happens with `--allow-all-tools` (never pass it); `--log-dir`, `--log-level none`. Auth: `copilot login` (browser OAuth; token in the OS credential store). Prefer stdin + `-s` + `--output-format json` if the JSONL contains the final message and usage; otherwise `-s` text. Confirm with `copilot --help` and record the final argv in the report.
- Usage: CLI may not report tokens → record `llmCalls: 1`, tokens 0 with `usage.tokensUnknown = true`; `costUsd = 0`.
- Error mapping additions: not signed in / "not licensed to use Copilot" / 401/403 → `LLM_AUTH` (non-retryable) with message "Copilot CLI is not signed in or this account has no Copilot access"; quota/limit reached → `LLM_QUOTA_EXHAUSTED` (non-retryable).

### 5. Monthly usage counter (display only, NO cap)
- Add `provider` and `model` to `JobUsage` (backward compatible). Count successful + failed provider calls in the current calendar month per provider from job usage.
- `GET /api/llm/providers` returns `usage: { monthCalls }` per provider; the UI shows it next to the provider (e.g. "12 calls this month").
- Never block or refuse a call based on this count; do not add any cap setting.
- README note: Copilot Free has a small monthly chat/agent allowance (≈50; GitHub is moving to usage-based "AI credits" in 2026) shared with the developer's own coding; when it runs out the provider returns `LLM_QUOTA_EXHAUSTED`. Copilot is a developer tool — intended for personal use.

### 6. Copilot Chat + MCP (docs only)
- In `docs/CLAUDE_DESKTOP.md` (or a new `docs/MCP_CLIENTS.md`), add a "VS Code Copilot Chat" section: an example `.vscode/mcp.json` entry pointing to `apps/mcp/dist/index.js` with `VG_API_URL`, and example prompts ("Liệt kê project", "Viết story cho project X"). Do **not** create `.vscode/mcp.json` in the repo (it would expose the tools to the implementer agent working in this workspace).

### 7. UI
- In the provider select, show a one-line hint for providers with limits, e.g. "GitHub Models free: ~4k output tokens/request → best for videos ≤ 3 min; longer videos use 2 calls automatically", and for copilot-cli: "Uses your Copilot plan quota (shared with coding) · 12 calls this month".

### 8. Docs
- README: how to create the token, which permission, example `.env`, note that limits are per model per day and change over time, link to GitHub's official rate-limit docs.

## LLM calls
No new calls. Pre-flight may switch merged (1 call) → separate (2 calls) only when the provider cannot return everything in one response; it prevents wasted truncated calls.

## DO NOT
- Do not add a tokenizer or any new dependency.
- Do not call Copilot internal/undocumented HTTP endpoints or extract Copilot tokens; Copilot is used only through the official Copilot CLI (and MCP in Copilot Chat).
- Do not hard-code a model id.
- Do not commit.

## ACCEPTANCE CRITERIA
1. Root typecheck/build/test pass; all previous tests pass.
2. With token + model set, `/api/llm/providers` lists `github-models` configured; without model → not configured with hint.
3. Mocked tests: 120 s vi project on github-models → merged, 1 call; 600 s vi project → switch-to-separate, 2 calls, job message explains; 1800 s → `LLM_LIMIT_TOO_SMALL` with 0 calls.
4. Daily-quota 429 → `LLM_QUOTA_EXHAUSTED`, no retries; ordinary 429 → retried.
5. `maxOutputTokens` sent never exceeds the provider limit.
6. Providers without limits behave exactly as before (existing tests unchanged).
7. copilot-cli with a fake binary: success, "not licensed" → LLM_AUTH, quota message → LLM_QUOTA_EXHAUSTED, abort kills process; claude-cli tests still pass after the shared-base refactor.
8. Usage counter: after 2 calls this month `/api/llm/providers` shows `monthCalls: 2` for that provider, and a third run still proceeds (no cap).

## TESTS
Adapter request shape (URL, auth header, model, JSON mode) with mocked fetch; error mapping incl. daily quota; token estimator tables (vi/en); preflight decisions for the three durations; input trimming; clamp of maxOutputTokens; registry configured rules.

## DEPENDENCIES
TASK-004 (done), TASK-004B (must be committed). Run before TASK-004C.

## REPORT BACK
Write `docs/tasks/TASK-004D.report.md` (files, the verified base URL / auth / model id format with the doc URL, command results with test counts, deviations, remaining issues). Then create empty `docs/tasks/TASK-004D.done`.
