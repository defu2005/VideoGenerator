# TASK-044 — Cursor guide (free model quotas: track, route, cool down)

Read `docs/cursor/README.md` first. No new npm dependencies. Tests never use the network or real LLM CLIs.

## Why
Many routes use free models that come with a built-in allowance. Examples:
- the Gemini API free tier (requests per minute/day);
- OpenRouter `:free` models (requests per day);
- Groq/Cerebras free tiers;
- GitHub Copilot premium requests per month;
- Antigravity/Claude CLI subscription windows;
- free providers behind OmniRoute.

Today the app does not know about these allowances:
- `estimateLlmCost` returns 0 for them, so they look unlimited.
- When a quota runs out, every following call still tries the exhausted model first, waits for the error, and only then uses the single `fallback` (if the user set one). Antigravity maps quota errors to the retryable `LLM_RATE_LIMIT`, so jobs even retry against an exhausted quota.
- Nothing shows how much free allowance is left, and the model advisor (`modelAdvisor.ts`) cannot see it.

## 1. Quota profiles (`packages/shared/src/schemas/llmQuota.ts`)
- `LlmQuotaRuleSchema`, strict:
  - `{ provider, model }`: `model` may be `"*"` for the whole provider;
  - `kind`: `free_tier` | `subscription` | `paid`;
  - `limits`: an array of `{ window: "minute" | "day" | "month" | "rolling_5h", requests?, inputTokens?, outputTokens? }`;
  - `resetTz`: an IANA zone, used for day/month windows;
  - `note`, `source`: `preset` | `user`.
- **Presets** live in `packages/shared/src/llmQuota/presets.ts`. Cover:
  - Gemini API free tier (flash / flash-lite / pro), reset `America/Los_Angeles`;
  - OpenRouter `*:free`;
  - Groq;
  - Copilot CLI (monthly premium requests);
  - Antigravity CLI;
  - Claude CLI (`rolling_5h`).
- Every preset carries `note: "ước tính, kiểm tra trang nhà cung cấp"`. **Numbers change often**, so presets are only starting values. The user can edit, disable or add rules in the UI. User rules win over presets.
- Stored in app settings (the same key/value storage `settings.ts` uses), not in `.env`.

## 2. Counting usage (`apps/server/src/providers/llm/quota.ts`)
- **Table:** a new table `llm_quota_usage` (provider, model, window_start, window, requests, input_tokens, output_tokens). Generate it with `npx drizzle-kit generate`; never hand-write it.
- **Recording:** record every real provider call, including retries and fallbacks, at the single place where calls finish in `structured.ts`, plus the plain-text generate path if there is one.
  - Cache hits and preflight failures do not count.
- **Window math is pure and tested.** `currentWindowStart(window, now, tz)` and `nextReset(window, now, tz)` handle:
  - minute, day and month in the rule's timezone;
  - `rolling_5h` (sum of calls in the last 5 h).
- **Cleanup:** prune rows older than 40 days.

## 3. Cool-downs from real errors
- When a call fails with `LLM_QUOTA_EXHAUSTED` or `LLM_RATE_LIMIT` (HTTP 429 or a CLI quota message), store a cool-down for that provider+model:
  - use `Retry-After` / `x-ratelimit-reset*` headers when present (expose them on `LlmError` as an optional `retryAfterMs`);
  - for daily-quota messages ("per day", "RPD", "daily", "quota exceeded for metric … per day"), use the rule's next day reset;
  - otherwise use exponential backoff: 1 min, 5 min, 30 min, capped at 6 h.
- Store it in a table `llm_cooldowns` (provider, model, until, reason, set_at).
- Fix Antigravity: a quota message ("quota", "resource_exhausted", "exhausted") maps to `LLM_QUOTA_EXHAUSTED` (not retryable). A plain 429 stays `LLM_RATE_LIMIT`.
- A model is **unavailable** when it has an active cool-down, or when the recorded usage has reached any limit of its rule (≥ 100%).
- A model is **near limit** at ≥ 90% (configurable).

## 4. Routing: skip what is exhausted
- Extend the route `fallback` to an ordered chain:
  - `fallbacks: Array<{ provider, model? }>`, max 4;
  - keep reading the old single `fallback` and treat it as a chain of one, so old settings stay valid with no migration of the JSON.
- **In `generateRoutedStructured`, before the call:**
  - if the primary model is unavailable, go straight to the first available chain entry, without trying the exhausted model;
  - if every entry is unavailable, follow the policy below.
- **After a quota/rate error**, set the cool-down and continue down the chain within the same request. Mark the usage call `fallback: true` with `fallbackReason: "quota"`.
- **Policy when free allowance runs out.** This is an app setting, overridable per profile: `quotaPolicy`.
  - `wait` (**the default**): the job fails with a new retryable code `LLM_QUOTA_WAIT` carrying `retryAt`. The job runner reschedules it for `retryAt` instead of using up its attempts (one reschedule does not count as an attempt). AUTO mode shows "Chờ quota reset lúc HH:mm".
  - `paid_fallback`: allowed to use the next chain entry with `kind: "paid"`, but only while today's LLM spend is under `paidFallbackDailyUsd` (default 1.00 USD, read from the existing usage/cost data). Over the cap → behave like `wait`.
  - Never switch to a paid model silently: the first paid fallback each day sends one Telegram notification (the existing notification service, kind `attention`) with the task, the model and today's spend.
- **Budget modes:** in ECO the chain prefers `free_tier`/`subscription` entries first; BALANCED/QUALITY keep the user's order.
- **The OmniRoute gateway path:** count usage under `omniroute/<model>` and honour cool-downs the same way. Do not try to read OmniRoute's internal quotas (out of scope).

## 5. UI and tools
- **Settings → AI models:** a new "Quota" tab with a table:
  - provider/model, kind;
  - usage per window as `used / limit`, with a bar;
  - next reset (local time);
  - status chip: `Còn`, `Sắp hết` or `Hết – chờ đến HH:mm`;
  - cool-down reason;
  - buttons: edit rule, disable rule, "Xoá chờ" (clear cool-down).
- **Route editor:** the fallback chain becomes a small ordered list (add / remove / move up/down). Each entry shows its status chip.
- **`quotaPolicy`** and `paidFallbackDailyUsd` are set in the same page and in the profile LLM settings.
- **Project usage view:** calls that fell back for quota show a chip "dự phòng (hết quota)".
- **The model advisor** gets each model's `kind`, remaining allowance today and status in its catalog input. Its prompt says to prefer free models with allowance left for cheap tasks. It still only proposes (never applies by itself).
- **TASK-032 assistant:** a read tool `get_llm_quota_status` (risk "read") and `clear_llm_cooldown` (risk "confirm").
- **MCP:** a read tool `get_llm_quota_status`.
- **The Telegram daily summary** adds one line: models that hit their limit today, plus paid fallback spend.

## 6. Tests (no network, mock providers)
- Window math: day reset in `America/Los_Angeles` across the DST change; month end; `rolling_5h`.
- Counting: real calls counted; cache hits and preflight errors not counted; retries counted.
- Cool-down:
  - `Retry-After` honoured;
  - a daily-quota message waits until the next day reset;
  - backoff grows and is capped;
  - Antigravity quota text → `LLM_QUOTA_EXHAUSTED`.
- Routing:
  - an exhausted primary is skipped without a provider call (assert the mock was not called);
  - the chain order is respected;
  - the old single `fallback` still works;
  - all exhausted + `wait` → `LLM_QUOTA_WAIT` with `retryAt`, and the job is rescheduled without using up its attempts;
  - `paid_fallback` under the cap → uses paid and sends one notification per day;
  - over the cap → wait.
- ECO prefers free entries.
- Presets pass the schema; a user rule overrides a preset.
- Web: the quota table renders the statuses; the chain editor reorders; the policy setting saves.

## 7. Live check
- Use the mock provider only, or the user's already configured providers, with **no forced quota exhaustion against real APIs**.
- Seed usage rows for a free model up to its limit and check:
  - the Quota tab shows "Hết";
  - a test-project task (`eb02c679-26a3-4a42-8ea9-bb4e1a25288d` only) routes to the next chain entry.
- Attach a screenshot of the Quota tab. **Never touch project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**

## Done
Done checklist from the README. Write `docs/tasks/TASK-044.report.md` and `docs/tasks/TASK-044.done`.
