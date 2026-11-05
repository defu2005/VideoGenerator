# TASK-045 — Cursor guide (live provider quota from OmniRoute)

Read `docs/cursor/README.md` and `TASK-044.md` first (044 is committed). No new npm dependencies. Tests never use the network: mock `fetch`.

## Why
TASK-044 has two gaps.

**The Quota tab only knows estimates.**
- It shows preset or user rules with guessed limits.
- It counts only the calls this app made after TASK-044 shipped, so every bar starts at 0.
- The real allowance is account-wide: the user also uses Antigravity, Copilot and Claude outside this app, and through OmniRoute.

**The tab ignores OmniRoute.**
- None of the models the user connects in OmniRoute appear.

The local OmniRoute (v3.8.x, `http://127.0.0.1:20128`) already reads the **real** provider quota for each connection: GitHub Copilot, Antigravity, Claude, Codex, Cursor, Kiro, OpenRouter, Gemini daily quota, free model quotas and more. Use it as the source of truth whenever it is available.

## OmniRoute API (read only; check the shapes against `dist/docs/openapi.yaml` in the global `omniroute` package)
- `GET /api/providers` returns `{ connections: ProviderConnection[] }`, with `id`, `provider`, a name or label, an active flag, and maybe an email.
- `GET /api/usage/{connectionId}` returns the usage for one connection. Quotas are keyed by name; each value follows OmniRoute's `UsageQuota`:
  - `{ used, total, remaining?, remainingPercentage?, resetAt: string|null, unlimited, fractionReported? }`;
  - possibly with `plan` or `message` fields.
  - Parse defensively with zod `.passthrough()`. Treat a connection that returns only a message as "no quota data".
- `GET /api/rate-limits`: the rate-limit status per account. Optional; show it when present.
- `GET /v1/models`: already used by the app catalog.

**Auth.** Management routes return 401 without credentials. They accept:
- `Authorization: Bearer <token>` where the token is an OmniRoute Access Token (`oma_live_…`, created by the user in OmniRoute → Settings → Access Tokens);
- or an API key with `manage`/`admin` scope.

## 1. Credentials (the user enters them; never create tokens)
- Add an optional vault secret `omniroute.managementToken`. Use the same vault the Telegram bot token uses: encrypted, never returned by the API, never logged.
- Order of use: the management token if set; otherwise try the existing `OMNIROUTE_API_KEY`.
- On 401/403, the sync status becomes `needs_token`. The UI explains in Vietnamese, with steps: open `http://127.0.0.1:20128` → Settings → Access Tokens → create a read-only token → paste it here.
  - Use a password input with Save and Remove buttons.
  - Show only "đã lưu" plus the last 4 characters.

## 2. Sync service (`apps/server/src/services/omnirouteQuotaSync.ts`)
- **When:**
  - every 5 minutes while the gateway is reachable;
  - plus a manual "Làm mới" button (`POST /api/llm/quota/omniroute/refresh`);
  - plus a refresh before a job whose route uses a provider OmniRoute covers, if the last snapshot is older than 15 minutes.
- **Limits:** one request at a time per connection, a 10 s timeout, and at most one refresh per minute (OmniRoute itself throttles provider usage endpoints; do not hammer it).
- **Storage:** a new table `llm_provider_quota_snapshots`:
  - `connection_id`, `omniroute_provider`, `label`, `quota_key`;
  - `used`, `total`, `remaining_pct`, `reset_at`, `unlimited`, `fraction_reported`;
  - `fetched_at`, `error`.
  - Run `npx drizzle-kit generate`; never hand-write the migration.
  - Replace each connection's rows on every successful fetch. Keep the last error per connection.
- **Privacy:** mask emails (`a***@gmail.com`) before storing or displaying them. Never store or log tokens, account ids or raw response bodies.

## 3. Mapping OmniRoute data to the app's routes
- **Provider map**, editable in code as one table:

  | OmniRoute provider | App provider |
  |---|---|
  | `antigravity` / `agy` | `antigravity-cli` |
  | `github` | `copilot-cli` |
  | `claude` | `claude-cli` |
  | `gemini` | `gemini` |
  | `openrouter` | `openrouter` |
  | `groq` | `groq` |
  | `codex` | `codex` (if present) |

  A call that goes through the app provider `omniroute` with model `<prefix>/<model>` maps to the connection of that prefix.
- **Matching a quota to a model**, best first:
  1. the quota key equals the model id or its family (Antigravity reports per model family, e.g. a quota key that contains `gemini-3` or `claude`; normalise to lower case and strip `-low`/`-high`/date suffixes);
  2. a provider-wide quota (e.g. Copilot `premium_interactions`);
  3. none.
  - Write the matcher as pure, tested code.
- **Live data wins.** A snapshot younger than 20 minutes overrides the TASK-044 estimate:
  - **exhausted:** `fractionReported !== false` and (`remainingPercentage <= 0` or `used >= total` with `total > 0`), not `unlimited`. Set an `llm_cooldowns` row until `resetAt` (or +1 h when `resetAt` is null), with the reason `"OmniRoute: hết quota <quota_key>"`.
  - **near:** remaining ≤ (1 − `nearLimitRatio`).
  - `fractionReported === false` with 0 is **not** exhausted (OmniRoute documents it as a sentinel).
- **Falling back:** if the snapshot is stale or missing, use the TASK-044 local counting.
- `isUnavailable`, the fallback chain, ECO ordering, `LLM_QUOTA_WAIT`/`retryAt` (use the live `resetAt`), the model advisor and the assistant/MCP `get_llm_quota_status` all use this merged view.

## 3b. Credit and trial allowances (not only request counts)
Many free accounts give credit instead of requests. Examples:
- signup credit in USD (OpenRouter, DeepSeek, xAI, Together, Fireworks, Mistral and similar);
- a token allowance (e.g. N million tokens per day or month);
- a trial balance that expires on a date.

Handle each of these explicitly:
- **Quota unit.** Every live snapshot row and every TASK-044 rule limit gets a `unit`: `requests` | `tokens` | `credits_usd` | `credits` (provider points). Store it in the new `unit` column, and add `expires_at` for trial balances.
  - Extend the TASK-044 rule limits with the optional `creditsUsd` and `expiresAt` fields. Keep the old rules valid.
- **Reading balances.** OmniRoute reports balances for some providers. Map these to `credits_usd`, with `total` = granted and `used` = spent when given, otherwise only `remaining`:
  - the OpenRouter `/key` usage and limit;
  - the DeepSeek balance;
  - any `UsageQuota` whose name or plan says credit or balance.
  - Show "còn $X.XX" when only the remaining amount is known.
- **Manual credit rules.** For providers that are not in OmniRoute or do not report balances, the user can add a rule with:
  - `kind: "free_tier"`, `unit: credits_usd`;
  - the granted amount;
  - an optional expiry date.
  - The app then spends from it using its own cost estimate: `estimateLlmCost` with the provider's paid prices, even when the call was free to us.
- **Spending local credit.** Each recorded call with a known price adds its estimated USD to the `credits_usd` counter of the matching rule. The window is `lifetime` (a new window value: never resets, or resets only at `expiresAt`).
- **Status:**
  - exhausted when the remaining credit is ≤ 0, or `expiresAt` has passed;
  - near when it is ≤ 10% or under $0.50, or when it expires within 3 days. Show "hết hạn ngày dd/MM".
  - Exhausted credit uses the same cooldown/fallback path, with no reset time ("hết credit, cần nạp hoặc tạo quy tắc mới"). `LLM_QUOTA_WAIT` must not wait for a reset that never comes, so it goes to the next chain entry or fails with a clear Vietnamese message.
- **Free credit is not free money.** `paid_fallback` and `paidFallbackDailyUsd` keep counting only real paid spend. Credit-funded calls are shown separately as "dùng credit miễn phí".
- **Presets.** Add notes-only examples with the value 0 and `enabled: false`, so the user fills in their own granted amount. Never invent balances.

## 4. Fix the local counters
- **Backfill once** (a guarded settings flag), so the bars do not start at 0. Rebuild the current day, month and last 5 h windows of `llm_quota_usage` from existing `jobs.usage.calls[]` (provider, model, tokens), using each job's `finishedAt`, or else `startedAt`, as the time.
- **Label the local numbers** "app đã dùng" so they are never mistaken for the provider's own count.
- **Reset column:** show the reset of the window that limits the most (the highest ratio; when all are 0, the day window if present). Today it always shows the minute window.

## 5. Quota tab UI (`QuotaPanel.tsx`)
- **A new top section "Từ OmniRoute (số thật)":**
  - **Status line:** connected / `needs_token` (with the token form) / OmniRoute unreachable. Also the "cập nhật lúc HH:mm" time and the "Làm mới" button.
  - **One card per connection:**
    - the provider icon text, the label and the masked account;
    - each quota: name, `used / total` in its unit (lượt, tokens, $ credit) or "còn $X.XX" or "không giới hạn", the expiry date for trial credit, a remaining % bar, the reset time in local time with a relative "còn 3 giờ", and a status chip (Còn / Sắp hết / Hết);
    - which app routes and tasks currently use it, e.g. "đang dùng cho: script, research";
    - the error text if that connection failed.
  - **Connections without quota data** say "Nhà cung cấp này không báo quota qua OmniRoute". Also add a button to create a manual rule for them (prefill the TASK-044 rule editor).
- **A section "Model đang dùng chưa có quota":** every model in the current app routes and profile overrides that has neither live data nor a rule. This is where the user's own OmniRoute models show up. Each row has a "Thêm quy tắc" button.
- **The existing rules table** stays, renamed "Quy tắc ước tính / tự đặt", with a chip `ước tính` or `tự đặt`. When live data covers a rule, grey the rule out with "đang dùng số thật từ OmniRoute".

## 6. Tests (mocked fetch, no network)
- Parsing fixtures for:
  - a GitHub-style provider-wide quota;
  - Antigravity-style per-family quotas;
  - Claude 5 h and weekly quotas;
  - a message-only response;
  - `unlimited`;
  - `fractionReported: false` with 0;
  - an OpenRouter-style credit balance (only `remaining`);
  - a DeepSeek-style USD balance.
- Credit rules:
  - a manual `credits_usd` rule is spent by estimated cost;
  - balance ≤ 0 → fallback, with no `LLM_QUOTA_WAIT` loop;
  - `expiresAt` passed → exhausted;
  - expiring within 3 days → near;
  - credit spend is not counted in `paidFallbackDailyUsd`.
- 401 → `needs_token`; the token is never in logs (spy on the logger) and never in API responses.
- The matcher: family match, provider-wide, none.
- Live exhausted → cooldown until `resetAt`; the chain skips that model without calling it; `LLM_QUOTA_WAIT` uses the live `resetAt`.
- A stale snapshot → the local counting is used.
- Backfill from `jobs.usage` is idempotent.
- The reset column picks the most limiting window.
- Web:
  - live cards render;
  - the `needs_token` form saves and masks the token;
  - the "chưa có quota" list shows the routed models without data.

## 7. Live check
- With OmniRoute running and **no token**: the tab shows `needs_token` with the steps. Do not create a token and do not log in to the OmniRoute dashboard.
- Run the backfill on the real DB through the app (allowed: app code writing its own tables). Check that today's bars are no longer all 0 when jobs ran today.
- Screenshot the tab. **Never touch project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**

## Done
Done checklist from the README. Write `docs/tasks/TASK-045.report.md` and `docs/tasks/TASK-045.done`.
