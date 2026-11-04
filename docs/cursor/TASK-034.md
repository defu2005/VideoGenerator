# TASK-034 — Cursor guide (revenue, profit, monthly report, payout reminder)

Read `docs/cursor/README.md` and `docs/cursor/TASK-033.md` first (TASK-033 is committed). This task tracks money per video, per channel and per profile:
- revenue in, from APIs where official ones exist and by manual entry otherwise;
- cost out, from LLM/TTS usage and manual costs.

It shows profit, writes a monthly report and reminds the user when a payout balance is due.

No new npm dependencies. **Auto-withdraw is out of scope** (user decision: no platform offers a payout API, and the app never logs into platforms with passwords).

## 1. Currency
- One app currency setting, default `VND`, plus a display list (`VND`, `USD`).
- Revenue rows store `amount` + `currency`.
- Exchange rates are a manual table (`currency_rates`: currency, rate_to_app_currency, updated_at) editable in the UI. No FX API call.
- LLM costs are in USD today (`usageService`); convert them with the same table.

## 2. Data model (drizzle-kit generate)
- `revenue_entries`:
  - columns: id, account_id (nullable FK), publication_id (nullable FK), profile_id (nullable FK);
  - source `youtube_api` | `manual` | `import_csv`;
  - kind `ads` | `creator_fund` | `sponsorship` | `affiliate` | `gift` | `other`;
  - period_start, period_end (dates), amount (real), currency, note, external_key (for idempotent API sync), created_at;
  - unique (source, external_key).
- `cost_entries`:
  - columns: id, profile_id nullable, project_id nullable;
  - kind `llm` | `tts` | `stock_media` | `tool_subscription` | `ads_spend` | `other`;
  - date, amount, currency;
  - source `usage_auto` | `manual`; note.
  - LLM costs are not copied row by row. They are read live from `usageService` per project/day and shown as `usage_auto`. Manual costs are stored.
- `payout_thresholds`: account_id, threshold_amount, currency, current_balance (manual), last_notified_at.

## 3. YouTube revenue (official API)
- YouTube Analytics `reports.query` with metrics `estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue` and `dimensions=day` (channel), plus `dimensions=video` for per-video revenue over a range.
- This needs the scope `https://www.googleapis.com/auth/yt-analytics-monetary.readonly`.
  - Make it **opt-in** per account ("Bật thống kê doanh thu YouTube"), because it asks for money-level access. When enabled, add the scope and trigger the reconnect flow (same `needs_reconnect` mechanism as TASK-033).
  - A channel not in the Partner Program returns errors or zeros. Show "Kênh chưa bật kiếm tiền" and stop syncing revenue for that account until re-enabled.
- Sync daily (the last 30 days rolling, because YouTube revises recent days) into `revenue_entries` with `external_key = channelId:date` or `videoId:date`. Upsert, never duplicate.

## 4. TikTok / Facebook / Instagram revenue: manual
No general-purpose official revenue API is available to this app for these platforms. Provide:
- A manual entry form: account, period, kind, amount, currency, note, optional publication.
- CSV import with column mapping and a preview before saving. Support the user pasting exported monthly totals. Validate dates and amounts, reject the whole file on any bad row and show the row numbers.
- In the UI, explain in Vietnamese where to find the numbers in each platform's creator dashboard.

## 5. Profit and allocation
- Profit per video = revenue linked to the publication + allocated channel revenue − project costs (LLM/TTS usage plus manual costs for that project).
- Channel-level revenue without a video link is allocated to that account's videos in the same period, proportionally to views (from TASK-033 snapshots). With no views data, allocate equally. Show allocated amounts as "ước tính".
- Profit per profile and per month = sum over its accounts and projects, minus profile-level manual costs (`tool_subscription`, `ads_spend`).
- Keep all calculations in one pure module `apps/server/src/finance/profit.ts` with unit tests.

## 6. Monthly report
- On the 1st of each month at the daily-summary time (TASK-031 settings, profile timezone), build the report for the previous month:
  - revenue by platform/profile/kind;
  - costs by kind;
  - profit and margin;
  - top 5 videos by profit and by views;
  - videos published, failures;
  - the month-over-month change.
- Store it as `monthly_reports` (month YYYY-MM, json, created_at). Generate it once and regenerate on demand.
- Send a short Telegram summary (`monthly_report` notification kind, toggled with the daily summary toggle) with a link to the web page.
- The web page offers "Tải CSV", a client-side CSV export of the same tables. No PDF library.
- Optional LLM commentary (`financeInsight` LLM task, tier fast, budget-aware): 3–5 Vietnamese bullet points on what went well or badly. When the budget mode forbids it, skip it silently.

## 7. Payout reminder
- Per account, the user sets a payout threshold and updates the current balance by hand, or it is derived from manual revenue entries since the last payout entry (kind `payout` marks a withdrawal).
- When the balance ≥ threshold, send one `attention` notification "Số dư … đã đủ để rút, hãy rút trong app …" (dedup: once per 7 days per account).
- Never automate the withdrawal itself.

## 8. API and UI
- **API** `apps/server/src/api/finance.ts`:
  - CRUD for revenue/cost entries;
  - CSV import (preview + commit);
  - rates;
  - thresholds;
  - `GET /api/finance/summary?from&to&profileId`;
  - `GET /api/finance/reports`, `GET /api/finance/reports/:month`, `POST /api/finance/reports/:month/regenerate`.
  - Shared schemas in `packages/shared/src/schemas/finance.ts`.
- **Web:** a new page "Doanh thu" (`/finance`):
  - KPI tiles (revenue, cost, profit, margin);
  - a stacked bar per month (revenue vs cost);
  - tables by profile, platform and video;
  - entry forms, CSV import, payout thresholds, the reports list and detail.
  - Use the plain SVG chart components from TASK-033.
- **Assistant (TASK-032):**
  - read tools `finance_summary` and `monthly_report`;
  - a confirm tool `add_revenue_entry`.

## 9. Tests
- Profit math: direct links, view-proportional allocation, equal fallback, currency conversion, manual costs.
- YouTube revenue sync upserts idempotently over overlapping 30-day windows. A non-partner channel gets the state "chưa bật kiếm tiền" and no retry spam.
- CSV import: a valid file previews and commits; one bad row rejects the whole file with row numbers.
- The monthly report is generated once on the 1st in the timezone, and regenerate replaces it.
- The payout reminder fires at the threshold with a 7-day dedup.
- Web: the entry form validates, and the summary renders.

## Done
Done checklist from the README. Write `docs/tasks/TASK-034.report.md` and `docs/tasks/TASK-034.done`.
