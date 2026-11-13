# TASK-071 — Codex guide (target market per channel)

**Scope:** each channel profile gets a **market** (a country). The market fills sensible defaults: language, audience timezone, posting times, trends region, country-specific content rules, voice locale, and seasonal events for topic ideas. The user always sees the suggested changes and confirms them; nothing they set by hand is overwritten silently.

Read `docs/cursor/README.md` first, then this file.

**Order:**
- after TASK-073a (the knowledge layer) and after Claude has reviewed RESEARCH-071 and written the market entries into `packages/shared/src/knowledge/snapshot/market.json` (kind `market`). If that file does not exist, stop and write that in the report;
- before TASK-070, which reads `project.settings.market` for its `map` kind.

**Implementer:** Codex (desktop thread), or Cursor grok-4.7-medium.

**Rules:**
- no new npm dependency, except one that Claude names in §1 after reviewing the research;
- tests have no network;
- schema changes only through `npx drizzle-kit generate`;
- never render or approve on project `56374fb2-54cf-48ff-9441-2e6c653295d4`;
- do not commit or push;
- update the user guide and `featureMap`.

---

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| the built-in `Intl` APIs (`Intl.DisplayNames`, `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.supportedValuesOf("timeZone")`) | built in | country names in Vietnamese, currency and number formats, timezone validation. Prefer these over storing the same facts in `data.ts` |
| Unicode CLDR (through `Intl`) | Unicode licence | locale fallbacks, e.g. `en` + `GB` → `en-GB` |
| the libraries checked in `docs/research/markets/README.md` | see there | **Claude decided (2026-11-11): add none.** `date-holidays` is rejected (its holiday data is CC BY-SA 4.0, share-alike). `countries-and-timezones` and `i18n-iso-countries` are not needed: the market entries already hold timezones and `Intl.DisplayNames` gives names. Seasonal-event rules are resolved by your own pure function (§1). |

---

## 0. Two different timezones (read this first)

- **The audience timezone** belongs to the market: when to post, and the "today" count for videos per day. It lives in `profile.automation.timezone` (it exists today, default `Asia/Ho_Chi_Minh`).
- **The user's own timezone** is where the user lives: quiet hours, notifications, digests, the assistant's "today". It lives in the notification settings (`timezone`, default `Asia/Ho_Chi_Minh`).
- Today `assistant/loop.ts` (lines 142, 152) and `assistant/tools.ts` (lines 133, 138, 576) hard-code `Asia/Ho_Chi_Minh`. Change them to read the user's timezone from the notification settings. Add a test.
- The market changes only the audience timezone.

## 1. The market pack (shared)

**`packages/shared/src/markets/`:**
- **There is no `data.ts`.** Market facts are knowledge entries (TASK-073), id `market.<CC>`, so they expire, can be watched and updated without code. Do not edit the facts in the snapshot; if one looks wrong, write it in the report.
- `schema.ts`: `MarketPackSchema` (zod) matching the research JSON shape (`docs/cursor/RESEARCH-071.md` §2). Register it as the `value` schema of kind `market` (073a made a placeholder).
- The functions below take the resolved pack from the knowledge resolver (server) or the snapshot (pure shared code and tests). They are pure: pass the pack in, never read a file inside them.
- `index.ts`:
  - `listMarkets(): { code, name }[]`, with the Vietnamese name from `Intl.DisplayNames("vi", { type: "region" })` when the data has none;
  - `marketPack(code): MarketPack | null`;
  - `marketDefaults(code, platforms)`: returns `{ language, timezone, publishTimes, trendSettings: { region, language }, voiceLocale, guidelinePackId }`.
    - `language` is the primary language base code (`en`), so it fits `project.settings.language`; `voiceLocale` is the full locale (`en-GB`).
    - `publishTimes` comes from `bestPostingHours` for the profile's platforms, at most `videosPerDay` times. When the data is `null`, keep the current value.
  - `upcomingEvents(code, from: Date, days = 45)`: the seasonal events in that window, with real dates (resolve rules such as "4th Thursday of November" in a pure function, with tests for 3 kinds of rule and a year change).
- Export from `@vg/shared`.

## 2. Profile and project

- **DB:** `profiles.market` (text, nullable). Run `npx drizzle-kit generate`.
- **Schemas:** add `market: string | null` to `ProfileSchema` and its create/update inputs. The code must be in `listMarkets()`; otherwise 400.
- **Projects** copy the market from the profile at creation into `project.settings.market` (optional, the same as `language`). Old projects have none; everything below treats "none" as today's behaviour.
- **Setting or changing the market** never changes other fields by itself. The API offers a preview:
  - `GET /api/profiles/:id/market-defaults?code=GB` returns `{ current, suggested, changes: [{ field, from, to }] }`;
  - `POST /api/profiles/:id/apply-market-defaults` with `{ code, fields: string[] }` applies only the fields the user ticked.
  - **Autopilot:** an apply is a user touch (`markUserTouch`).
- **A new profile** created with a market gets the defaults directly (nothing to overwrite yet).

## 3. Where the market is used

| Place | Change | Test |
|---|---|---|
| Guidelines (`guidelines/resolve.ts` `activeGuidelines`) | a third built-in layer `market:<CC>` built from `rules` of the pack, after the platform pack and before the channel packs. User packs still win by id | a GB project gets the GB rules; a project with no market gets none |
| Script prompt (`stages/script/prompt.ts`) | one short line: the audience country, and "use local units, currency, examples and date format". Only when the project has a market. Keep the cache key correct (the line is part of the prompt) | prompt contains the line for US, not for none |
| Topic ideas (`suggestTopics` path, see `api/automation.ts`) | add `upcomingEvents(market, now, 45)` to the prompt context, ≤ 8 events | events appear; none for no market |
| Trends | `trendSettings.region/language` from the market defaults (only through apply, §2) | covered by §2 tests |
| Voice (`lib/defaultVoice.ts`) | when the project has a market, call `defaultVoiceFor(voiceLocale)` instead of the bare language, so `en` + `GB` picks a British voice | GB → `en-GB` voice when one exists, else any `en` |
| Accounts | connecting an account for a platform with `available: false` in the market shows a warning (not a block) | API returns the warning |
| Compose (067b language pack) | nothing new: it already reads `project.settings.language`. TASK-070 will read `project.settings.market` for maps | none |

**Read-only info:** the market picker shows the RPM range and the monetization flags, labelled "ước tính". Never use the RPM numbers for automatic decisions in this task. Show the freshness badge of the entry (Mới / Cần kiểm tra / Cũ) next to the estimates.

## 4. Web

- **Profile settings:** a "Thị trường" select (search by name; flag emoji from the code is fine), with the info card (languages, timezone, RPM estimate, platforms, monetization).
- **On change:** a dialog lists `changes` with checkboxes (all ticked except fields the user edited by hand in the last 30 days, if that is known; otherwise all ticked) and "Áp dụng".
- **New profile wizard:** the market is the first question, then the language list is filtered to that market's languages (with "Khác" for any language).
- No new page.

## 5. Assistant, MCP, operator

- New read-only tool `get_market_pack({ code })`: returns the pack, its freshness and the defaults. Changes to the market facts go through `propose_knowledge_change` (TASK-073), not a market-specific tool. Register it once in the shared tool registry (TASK-047), so the assistant, MCP and operator all get it.
- Changing a profile's market goes through the existing profile update tool, at its current risk level (confirm).

## 6. User guide

- A page section "Thị trường mục tiêu": what it changes, the two timezones, why RPM is only an estimate, how to add a country later (import a `market.<CC>` entry on the "Tri thức" page; no code).
- One entry in `nhat-ky-thay-doi.md`, and `featureMap`.

## Done checklist

- [ ] Market pack with schema, defaults and event dates, each with tests.
- [ ] Profile market, preview and apply; projects copy it.
- [ ] Guidelines, script prompt, topic ideas, voice locale and account warning use it; no market = today's behaviour (tests prove it).
- [ ] The assistant uses the user's timezone, not a hard-coded one.
- [ ] Web picker and apply dialog. Check it in the browser (web on port 5180): set a test profile (not one linked to project `56374fb2-…`) to GB, apply, and confirm the timezone, posting times and trend region changed.
- [ ] `npm run typecheck`, build and `npm test` pass in every workspace; `npx drizzle-kit generate` says "No schema changes".
- [ ] Report `docs/tasks/TASK-071.report.md`, and an empty file `docs/tasks/TASK-071.done`.
