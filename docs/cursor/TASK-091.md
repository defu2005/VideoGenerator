# TASK-091 — Unit economics by market and format + monetization readiness 💰🔴

**Who:** a new Sonnet 5.5 session (or Codex when the user asks). **Size:** M. **Migration:** yes (🗄); drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-082 (real revenue data from at least one channel).

## Why

- Gap #4: we do not know the real profit per video, per market or per format.
- Gap #2 of RESEARCH-072: we do not track how close each account is to monetization: YPP thresholds, TikTok Creator Rewards, Facebook in-stream.
- Strategy tools (101, 104, 105) need these numbers, and must never get guesses.

## Read first

- `docs/research/monetization/{gap-analysis,streams,automation-risk}.md` and `docs/research/markets/*.md` (RPM ranges are **context only**, never stored as our numbers).
- `apps/server/src/finance/{financeService,youtubeRevenue}.ts`, the usage and cost tables (LLM, TTS, media).
- `docs/ARCHITECTURE-TARGET.md` §3: `revenue_entries` gets `campaignId?`, `market?`, `format?`.

## Build

1. **Cost per video.** Sum the LLM, TTS, media, render node time and paid assets from the usage tables for each project. Unknown costs show "chưa rõ", not zero.
2. **Revenue per video.** Use the real revenue entries (YouTube Analytics revenue per video, manual entries for the others). Tag `market` (from the profile) and `format` (from the genes, if TASK-089 is done, else the recipe).
3. **Unit economics view.** Show per group (market × format × length band): n, the median and IQR of RPM, revenue, cost and profit.
   - A group with n < 5 shows "chưa đủ dữ liệu" and no numbers.
   - Never fill a gap with research RPMs. Those show only as a separate "tham khảo thị trường" column, with their source.
4. **Monetization readiness per account.**
   - The thresholds are code constants with a source link and a `checkedAt` date (from the research), for example YPP 1 000 subs + 4 000 h or 10 M Shorts views in 90 days.
   - Progress comes from real metrics, plus an ETA only when the trend has ≥ 4 weekly points; otherwise no ETA.
   - When the source date is older than 90 days, show "cần kiểm tra lại điều kiện" (this ties into the TASK-073 change signals).
5. **Tools:**
   - `get_unit_economics(groupBy, filters)`: read;
   - `get_monetization_readiness(profileId)`: read.

   Both return `insufficient_data` with the missing threshold.
6. **Web.** A "Kinh tế" tab on the Tài chính page.

## Mã nguồn mở có sẵn (open source)

- **Lago** (AGPL — read only) and **Kill Bill** (Apache-2.0) are the reference for usage-cost aggregation models. Copy the ideas only.
- The quantiles are easy to hand-write; they are probably already in `learning/` — reuse them.

## Rules

README rules 1–11. No tool writes payouts or prices. Never estimate revenue.

## Tests

- cost sums with unknown parts;
- the n < 5 rule;
- research RPMs are never mixed into our numbers;
- readiness progress, ETA only with enough points;
- stale threshold warning;
- the tools.

## Done

- [ ] cost + revenue tagging (migration); economics view; readiness
- [ ] tools + "Kinh tế" tab + skill (`video-doc-so-lieu` or a new money skill)
- [ ] tests; suites
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-091.done`
