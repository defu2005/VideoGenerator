# RESEARCH-073 — Codex research brief (what each platform tells us about change)

**Who:** Codex (desktop thread), with web search. If you have no web access, stop and write that in the report. **No code.** Research notes only.

**Why:** TASK-073 (read §1 and §9 only) detects external change through several channels. Two of them need facts we do not have:
- **D3:** what each platform API exposes about account and video status;
- **D2:** how each external API announces deprecations and errors.

**Run it** after RESEARCH-071/072 are done.

**Output (only these files):**
- `docs/research/change-signals/README.md`: the report (§4) and the method;
- `docs/research/change-signals/status-apis.md`: §1;
- `docs/research/change-signals/api-deprecation.md`: §2;
- `docs/research/change-signals/catalog-gaps.md`: §3;
- `docs/research/change-signals/knowledge.json`: `api_contract` and `account_policy` entries in the TASK-073 §2 shape;
- then an empty `docs/research/change-signals/RESEARCH-073.done`.

## 1. Account and video status, per platform

Platforms: YouTube, TikTok, Facebook, Instagram.

For each of these signals, find whether an **official API** exposes it, and if so which endpoint and field, the OAuth scope, the quota cost, and whether webhooks or polling are needed:
- strikes and warnings, suspension;
- monetization status (channel and per video), ad suitability per video;
- copyright claims;
- removals, age restrictions, region blocks, upload rejections and their reasons;
- token revocation and how it shows;
- eligibility numbers (followers, watch hours, views in a window).

**Where there is no API:** say so. Name the page in the platform's own UI where the user can see it, so the app can add a weekly manual check. Scraping logged-in pages is not an option.

## 2. How APIs announce change

For each API the app calls:
- YouTube Data and Analytics, TikTok Content Posting and Display, Meta Graph (Facebook and Instagram);
- the providers under `apps/server/src/providers/**`: list them by reading `registry.ts` files, names only.

Record for each one:
- its changelog, revision history or RSS URL;
- its versioning and deprecation policy (how much notice it gives);
- whether it sends `Deprecation`/`Sunset` headers or warning fields;
- the error codes for quota, auth and rate limits;
- **the last 3 years of breaking changes, with dates.** For example: YouTube `mostPopular` on 2025-07-21, Pexels key issuance paused, the Gemini CLI personal-account change on 2026-06-18.

## 3. Catalog gaps

- Read the catalog in `docs/cursor/TASK-073.md` §1.
- List kinds of external change it misses: real past events that fit no row, or fit a row with no detector.
- For each one, give a dated example and suggest a row.

## 4. Report (top of README, ≤ 30 lines)

```
RESEARCH-073 REPORT
status signals: <n> with API, <n> manual-only, per platform
deprecation feeds: <n> APIs with a feed, <n> with headers
catalog gaps: <n>, the 3 most important
open questions: <≤ 5 bullets>
```

**Rules:** the same as RESEARCH-072 §7:
- every fact has a URL and a check date;
- quote at most 25 exact words;
- no sign-ins, no paid sources;
- write in Vietnamese, keeping product and API names in English;
- no npm install; do not touch `.env`, `.claude/`, `data/` or `scripts/`; do not commit.
