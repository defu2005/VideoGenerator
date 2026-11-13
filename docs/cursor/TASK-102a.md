# TASK-102a — Affiliate and sponsorship ledger 🤝

**Who:** a new Sonnet 5.5 session (or Codex when the user asks). **Size:** M. **Migration:** yes (`affiliate_products`, `campaigns`, `campaign_links`, plus `revenue_entries.campaignId?`); drizzle-kit only (🗄). **New dependency:** none.
**Depends on:** TASK-091.

## Why

Gap #5: affiliate and sponsor income is often bigger than ad revenue for small channels, but we do not track:
- which product went into which video;
- the links and UTMs;
- the disclosure;
- the income after refunds.

## Read first

- `docs/research/monetization/{streams,automation-risk}.md`, which covers the disclosure rules and the risks.
- `docs/ARCHITECTURE-TARGET.md` §3 (tables), §4 group `money`. **No tool writes payouts, prices or contracts.**
- `apps/server/src/finance/`, and TASK-083 (the paid promotion flag).

## Build

1. **Tables:**
   - `affiliate_products`: profile, name, network, landing URL, commission note, status, and a source for any commission number;
   - `campaigns`: profile, kind (affiliate, sponsor or own product), brand, dates, deliverables text, and a disclosure requirement;
   - `campaign_links`: campaign or product, publication, the short link or UTM URL, and placement (description, pinned comment or in-video).
2. **Links.**
   - Build UTM links in code (`utm_source=youtube&utm_medium=video&utm_campaign=<id>&utm_content=<publicationId>`). The user's own link shortener is optional; there is no external call by default.
   - Description templates insert links + the disclosure line.
3. **Disclosure.** A video with any campaign link sets the paid promotion flag (083) and adds the disclosure text in the channel's language. The pre-publish check blocks if it is missing.
4. **Income.**
   - Entered by the user (CSV import from the network, or by hand) per campaign and month, with refunds and reversals as negative rows.
   - Shown "sau hoàn" (after refunds). Nothing is estimated.
5. **Tools:** `list_products`, `get_conversion_stats`: read (clicks only if the shortener reports them, else "không có dữ liệu"). There are no write tools for money; the user uses the web forms.
6. **Web.** A "Liên kết & tài trợ" tab in Tài chính.

## Mã nguồn mở có sẵn (open source)

- **Dub** (AGPL — reference only) and **Shlink** (MIT, self-hostable) are link shorteners with click stats. Note in the report whether the user should self-host Shlink; do not add it.
- The UTM spec is Google's; there is no library needed.

## Rules

README rules 1–11. No tool writes money values. No auto-contact with brands (the §5 "never" list).

## Tests

- UTM build;
- description insertion;
- disclosure sets the flag and blocks when missing;
- CSV import with refunds;
- no money-write tool exists (a registry test);
- `get_conversion_stats` no-data.

## Done

- [ ] tables + links + disclosure + income import
- [ ] tab; read tools; skill
- [ ] tests; suites; migration
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-102a.done`
