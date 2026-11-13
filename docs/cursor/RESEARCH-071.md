# RESEARCH-071 — Codex research brief (target markets)

**Who:** Codex (desktop thread, web search on). **No code.** You write data and notes only.

**Why:** the app makes videos for channels in any country the user picks. Today it leans on Vietnam: `vi` language, `Asia/Ho_Chi_Minh`, trends region `VN`, guideline packs written for Vietnam. TASK-071 adds a "market" (country) to each channel profile, and fills sensible defaults from a **market pack**. You collect the facts for those packs. Claude reviews your data before TASK-071 uses it.

**Output (only these files):**
- `docs/research/markets/markets.json`: one object per country, in the shape below;
- `docs/research/markets/<CC>.md`: one short note per country (≤ 60 lines), with the sources;
- `docs/research/markets/change-signals.md`: §2b;
- `docs/research/markets/README.md`: the method, the date checked, the open-source libraries you checked (§3), and the open questions;
- then an empty `docs/research/markets/RESEARCH-071.done`.

Do not touch anything else in the repo. No npm install.

---

## 1. Countries (wave 1)

`VN, US, GB, CA, AU, IN, PH, ID, TH, MY, JP, KR, DE, FR, ES, MX, BR`

If one country takes far longer than the others, finish the rest first, and list it under open questions.

## 2. Data per country

Every fact has a source URL and a check date. **When you cannot find a reliable source, write `null`, and say why in the note. Never guess.** Estimates (RPM, best posting hours) are ranges, and they are marked `"estimate": true`.

```jsonc
{
  "code": "US",                       // ISO 3166-1 alpha-2
  "name": { "en": "United States", "vi": "Hoa Kỳ" },
  "languages": [                      // main languages for video content, most-used first
    { "code": "en-US", "share": "primary" },
    { "code": "es-US", "share": "large minority" }
  ],
  "timezones": ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
  "defaultTimezone": "America/New_York", // the zone most of the audience lives in
  "currency": "USD",
  "platforms": {                      // is the platform legally available to the public there today?
    "youtube":   { "available": true },
    "tiktok":    { "available": true, "note": "…" },
    "facebook":  { "available": true },
    "instagram": { "available": true }
  },
  "monetization": {                   // per platform: can a channel run from this country earn money?
    "youtubePartnerProgram": true,
    "tiktokCreatorRewards": true,
    "facebookContentMonetization": "…"
  },
  "rpmUsd": { "youtubeLong": [3, 8], "youtubeShorts": [0.03, 0.1], "estimate": true },
  "bestPostingHours": {               // local time, for each platform the app posts to
    "youtube": ["17:00", "20:00"], "tiktok": ["12:00", "19:00", "21:00"], "estimate": true
  },
  "trends": {
    "youtubeRegionCode": "US",        // valid for YouTube Data API videos.list chart=mostPopular
    "wikipediaProject": "en.wikipedia", // the Wikipedia for the "top pages" trend source
    "rssSuggestions": ["https://…"]   // 2-5 major national news RSS feeds with a working feed URL
  },
  "tts": {                            // voices for the main language, by provider the app supports
    "edge": ["en-US-JennyNeural", "…"], "google": "…", "elevenlabs": "supported", "openai": "supported",
    "piper": ["…"]                    // only voices with a permissive licence
  },
  "rules": [                          // country-specific content rules that differ from the global platform rules
    {
      "id": "us_ftc_disclosure",
      "text": "Disclose paid or affiliate links clearly in the video and description.",
      "severity": "MUST",             // MUST = law or platform ban, SHOULD = strong advice, TIP
      "appliesTo": ["script", "metadata"],
      "source": "https://…"
    }
  ],
  "sensitiveTopics": ["…"],           // topics that are illegal or get channels removed there (e.g. lèse-majesté in TH)
  "seasonalEvents": [                 // 8-15 dates that drive views (holidays, shopping days, school year)
    { "name": "Thanksgiving", "date": "4th Thursday of November", "type": "holiday" }
  ],
  "formats": { "decimal": ".", "thousands": ",", "date": "MM/DD/YYYY", "measurement": "imperial" },
  "sources": ["https://…"],
  "checkedAt": "2026-11-10"
}
```

**Notes on the fields:**
- `rules`: only rules that **add** to the global YouTube/TikTok/Facebook/Instagram rules the app already has (misleading info, violence, profanity, licences, synthetic-content labels). Look for: advertising and affiliate disclosure, children's content (COPPA-like), gambling, alcohol, finance and health claims, political content, elections, privacy of people shown, AI-content labels required by law (e.g. the EU AI Act, China, India, Korea), and data laws that touch comments or analytics. 2–8 rules per country.
- `rules[].text` in **Vietnamese**, because the app UI is Vietnamese; keep the source in English if it is English.
- `rpmUsd` and `bestPostingHours`: these vary a lot and there is no official source. Use 2–3 recent creator-industry sources, give a range, and mark them as estimates. Write which sources disagree.
- `tts.edge`: check that the voice names exist in the current Edge TTS voice list.
- `platforms.tiktok` for India, and anything similar: write the legal status and the date.

## 2b. These facts change: say how fast and where

The app keeps these facts as knowledge entries with an expiry and watches their sources (`docs/cursor/TASK-073.md` §2, read only §2). So in each country object add:
- `"volatility"`: one value per field group, e.g. `{ "platforms": "monthly", "monetization": "quarterly", "rpmUsd": "quarterly", "bestPostingHours": "quarterly", "rules": "yearly", "seasonalEvents": "yearly", "tts": "quarterly" }`;
- `"watch"`: 1–5 pages or feeds where a change for that country would appear first (a regulator's news page, a platform's country newsroom, a law tracker), each `{ "url", "kind": "policy_page" | "changelog" | "rss" }`.

In `change-signals.md`: for platform availability bans (e.g. TikTok in India, any country-level blocks) and for country AI-labelling or ad-disclosure laws, list the changes of the last 3 years with dates, and the places they were first announced.

## 3. Open-source and free data to check (open source first)

For each one, write the licence, the last release date, the size, and what it would replace in the JSON above. **Do not install anything.** Claude decides what TASK-071 may add.

- the built-in `Intl` APIs (timezones, currency, number/date formats, `Intl.DisplayNames` for country names): no dependency; say which JSON fields they make unnecessary;
- `countries-and-timezones`, `i18n-iso-countries`, `country-data` (or better ones you find);
- `date-holidays` (check the licence of the code **and** of the holiday data separately);
- Unicode CLDR (likely subtags, territory info: the language population per country);
- the YouTube Data API `i18nRegions` and `i18nLanguages` lists;
- Natural Earth (already planned for the `map` shot kind in TASK-070).

## 4. Rules

- Read nothing in the repo beyond this file, `AGENTS.md`, `packages/shared/src/guidelines/packs.ts` (to see which global rules exist; do not repeat them), and `packages/shared/src/schemas/automation.ts` and `trends.ts` (the current fields).
- No secrets, no sign-ins, no paid sources, no scraping behind logins.
- Quote at most one short sentence from any source; summarise in your own words.
- Validate `markets.json` with `node -e "JSON.parse(require('fs').readFileSync('docs/research/markets/markets.json','utf8'))"` before you finish.

## 5. Report

In `docs/research/markets/README.md`, at the top (≤ 30 lines):
```
RESEARCH-071 REPORT
countries: <done>/<17>, missing: <list>
nulls: <count of null fields and the 3 most common reasons>
libraries: <one line each: name, licence, recommend yes/no>
surprises: <facts that change the TASK-071 plan, ≤ 6 bullets>
```
