# TASK-034 report — Revenue, profit, monthly report, payout reminder

## What changed

### Shared (`packages/shared`)
- `src/schemas/finance.ts` — revenue/cost/payout/rates/CSV/monthly report/summary zod schemas + `PLATFORM_REVENUE_HELP_VI`
- `src/schemas/llm.ts` — `financeInsight` task
- `src/budget/modes.ts` — `financeInsight` feature (ECO off; BALANCED/QUALITY/MAX on)
- `src/schemas/notifications.ts` — `monthly_report` kind (toggle = dailySummary)
- `src/publishing/youtubeHelp.ts` — monetary scope + Vietnamese help
- `src/index.ts` — export finance schemas
- Tests: `test/budget.test.ts`, `test/llm.test.ts`

### Server DB
- `src/db/schema.ts` — `revenue_entries`, `cost_entries`, `payout_thresholds`, `currency_rates`, `monthly_reports`; YouTube revenue columns on `platform_accounts`
- Migration `drizzle/0029_bright_colleen_wing.sql` (+ snapshot); second `drizzle-kit generate` → "No schema changes"

### Server finance
- `src/finance/profit.ts` — pure profit/allocation/FX math
- `src/finance/csvImport.ts` — CSV preview; reject whole file on bad rows
- `src/finance/currencySettings.ts` — app currency + manual rates
- `src/finance/youtubeRevenue.ts` — YouTube Analytics monetary fetch + idempotent upsert
- `src/finance/financeService.ts` — CRUD, CSV commit, summary, monthly report, payout reminder, YouTube sync, tick
- `src/api/finance.ts` — HTTP routes under `/api/finance/*`

### Wiring
- `src/app.ts` — FinanceService + routes
- `src/publishing/ticker.ts` — finance tick
- `src/publishing/youtubePublisher.ts` — opt-in monetary scope when `revenueSyncEnabled`
- `src/notifications/notificationService.ts` — format `monthly_report`
- `src/assistant/tools.ts` + `service.ts` — `finance_summary`, `monthly_report`, `add_revenue_entry` (confirm)
- `src/providers/llm/mock.ts` — FinanceInsight answer

### Web
- `src/features/finance/FinancePage.tsx` + test
- `src/services/financeApi.ts`
- `src/features/analytics/charts.tsx` — `StackedBarChart`
- `App.tsx` route `/finance`, nav "Doanh thu"
- `BriefFields.tsx` — CUSTOM toggle for `financeInsight`
- `ProjectDetailPage.test.tsx` — budget fixture update

### Tests
- `apps/server/test/profit.test.ts`
- `apps/server/test/finance.test.ts` (CSV, YouTube upsert/not-monetized, monthly report, payout 7d dedup, summary)

## Test counts

| Workspace | Tests |
|---|---|
| shared | 208 |
| mcp | 12 |
| server | 531 |
| web | 103 |

`npm run typecheck`, `npm run build`, `npm test --workspaces` all pass.

## Deviations from the guide

1. **Payout reminder** uses existing `account_error` event (attention toggle) with Vietnamese payout copy, plus `payout_thresholds.last_notified_at` for 7-day dedup — no new notification kind.
2. **Monthly `financeInsight`** uses BALANCED budget feature defaults (no per-project context); ECO would skip if that preset were used.
3. **YouTube sync** stores per-video day rows when present and only keeps channel-day rows for dates without video breakdown (avoids double-counting).
4. **UI live check** in a real browser on a throwaway project was not run in this agent session; web unit test covers summary render + form validation.

## Not done

- Auto-withdraw (explicitly out of scope).
- Official revenue APIs for TikTok / Facebook / Instagram (manual + CSV only, as specified).
- PDF export (CSV client-side only, as specified).
- Browser live smoke on throwaway project (see deviation 4).
