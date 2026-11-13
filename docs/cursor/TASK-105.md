# TASK-105 — Niche scoring + opportunity radar 📡

**Who:** a new Sonnet 5.5 session (or Codex when the user asks). **Size:** M. **Migration:** probably none (cache in existing knowledge or research tables); if needed, drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-074a (self-research), TASK-091 (economics).

## Why

Before opening a channel or a topic cluster, the user needs to know three things:
- demand vs supply;
- the RPM context;
- whether small channels can break through: **outliers**, videos that beat their channel's median many times over.

Seasonal windows (Tết, back to school, World Cup) matter too.

## Read first

- `docs/research/markets/`, `docs/research/monetization/`, and the TASK-074a research tools and budget.
- `docs/ARCHITECTURE-TARGET.md` §4 group `strategy` (`score_niche`, `find_outliers`, `get_seasonal_windows`: read).
- The YouTube search quota (100 units per search). Every call is budgeted and cached.

## Build

1. **`find_outliers(query, market)`** (read):
   - search recent videos (YouTube Data API, cached 7 days);
   - for each, get the channel's median views of its last 20 videos;
   - the outlier ratio is views ÷ the channel median;
   - return the top outliers from small channels (< 50 k subs) with their titles, which feed the pattern library (094) as `propose_pattern` drafts only.
2. **`score_niche(niche, market)`** (read) combines:
   - demand: search volume proxies, total recent views;
   - supply: the number of active channels, and upload frequency;
   - breakthrough: the share of outliers from small channels;
   - money: our own economics (091) if we have the market, otherwise research RPM context, labelled as reference;
   - production fit: can our pipeline make it (stock visual availability, genre support).

   The score shows each part and its source; there is no single magic number without the parts.
3. **`get_seasonal_windows(market, months)`** (read): from the research market files + a code calendar (holidays per market), each with a lead time ("bắt đầu sản xuất trước 3 tuần").
4. **Budget.** All external calls go through `autonomyBudget` (`selfImprovement` or research bucket) and the quota log. When there is no budget, return the cached data with its age.
5. **Web.** A "Radar" page: niche score cards, the outlier list, and the season calendar.

## Mã nguồn mở có sẵn (open source)

- The outlier method is the public **"outlier score"** idea (views ÷ channel average) used by tools like 1of10 and vidIQ, which are closed. We implement it ourselves.
- **Nager.Date** (MIT, public holiday API and dataset). Prefer copying the static holiday rules for our markets into code with credit, rather than calling the network in tests.

## Rules

README rules 1–11. Tests use fixtures only. Research numbers are always labelled "tham khảo", never mixed with ours.

## Tests

- outlier ratio on fixtures;
- small channel filter;
- score parts and sources;
- season windows with lead time;
- budget refusal returns the cache;
- quota logged.

## Done

- [ ] outliers + niche score + seasons + budget
- [ ] page; tools; skill (`video-chon-chu-de`)
- [ ] tests; suites
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-105.done`
