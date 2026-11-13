# TASK-073 — Codex guide (adapting to change: knowledge, change detection, reactions)

**The problem:** almost everything outside our code can change without warning:
- platform rules and monetization programs;
- APIs and quotas;
- providers and their terms;
- laws, markets and audiences;
- what content works;
- the state of the channel itself.

Today these facts are spread through the code (`guidelines/packs.ts` with one `REVIEWED_AT`, pack `params`, publisher limits, provider registries, format recipes). Each source of change has its own ad-hoc handling (the circuit breaker, LLM quota, provider intel, the YouTube upload rejection) or none at all. Nothing tells the user "this fact is old" or "something outside changed".

**The goal is not to handle a list of known examples.** The goal is one framework that every kind of external change goes through:
1. **Know:** every external assumption is a **knowledge entry**, with a source, a check date and an expiry. Code reads entries through one resolver and never hard-codes them.
2. **Notice:** **detectors** turn every way of noticing change (documents, runtime errors, account status, metric drift, staleness, people) into one record, the **change event**.
3. **React:** a **reaction policy** decides, per category and severity, what happens: log, inform, propose, adapt within limits, hold the affected part only, or open an investigation. A risky fact never changes silently.
4. **Learn:** the system keeps a small exploration budget, so it finds out that "what works" changed even when nobody announces it.
5. **Extend:** a new platform, provider, market, law or kind of fact means **data plus an adapter**, not a change to the core.

Read `docs/cursor/README.md` first, then this file. **§1 is the contract.** Every later task that touches an external fact must follow it.

**Parts and order:**

| Part | Content | Implementer | When |
|---|---|---|---|
| 073a | §2–§5: the knowledge store, the resolver, proposals, history, import, the assumption audit, tools, the web page | Codex | before TASK-071 |
| 073b | §6–§8: change events, the reaction policy, detectors D1 (documents), D2 (runtime signals), D6 (staleness), D7 (people), the incident skill | Codex or Cursor grok-4.7-medium | after 073a |
| 073c | §9: detectors D3 (account and video status) and D4 (metric drift) | Codex | after 073b and RESEARCH-073 |
| 073d | §10: the exploration budget and "what works" signals that fade | outline. Claude writes it after RESEARCH-072/073 | last |

**Rules:**
- no new npm dependency (the JSON diff and the drift statistics are small functions you write);
- tests have no network and no real LLM;
- schema changes only through `npx drizzle-kit generate`;
- never render or approve on project `56374fb2-54cf-48ff-9441-2e6c653295d4`;
- do not commit or push;
- update the user guide and `featureMap`.

---

## Mã nguồn mở có sẵn

| Project | Licence | Use |
|---|---|---|
| our provider intel (`apps/server/src/providerIntel/service.ts` `fetchPage`; `packages/shared/src/providerIntel/evidence.ts` `knownEvidence`, `quoteInPage`, `acceptExtractedFields`) | ours | the document pattern already works: official pages only, robots.txt, a 6 h limit, a content hash, quotes checked against the page. **Move the page fetcher into a shared helper** used by provider intel and D1; do not copy it. Provider intel changes become change events (§6), so there is one inbox |
| our circuit breaker (`operator/circuitBreaker.ts`), autopilot pause, quality gates, LLM quota store | ours | the "hold" reaction (R4) uses these; do not build a second pause mechanism |
| `zod` (installed) | MIT | one schema per knowledge kind |
| RFC 6902 JSON Patch; RFC 8594 `Sunset` and RFC 9745 `Deprecation` HTTP headers | standards | the stored diff shape; D2 reads these headers from every external HTTP response |
| changedetection.io | Apache-2.0 | do not add it. Use its idea of text filters for noise (dates, counters) in the D1 hash. Report it if you think it beats our fetcher |
| CUSUM / Page-Hinkley change-point tests; Thompson sampling | textbook methods | D4 drift and the 073d exploration. ~50 lines each; cite the method in a comment |

---

## 1. The change catalog (the contract)

`packages/shared/src/knowledge/catalog.ts` exports `CHANGE_CATEGORIES`. Each category lists:
- the knowledge kinds that hold its facts;
- the detectors that can notice it;
- the default reactions by severity.

**Test:** every category has at least one detector that is implemented, or `manual` with a reason. Every knowledge kind belongs to at least one category. This test is what keeps "all cases" true as the app grows. A new kind of change is a new row here, plus its kind, detector and policy.

`docs/knowledge/change-catalog.md` is the human version, kept in sync by a test (the same way the user-guide coverage test works).

**Starting catalog** (add rows when you find more; list them in the report):

| # | Category | Examples (not the full list) | Knowledge kinds | Detectors |
|---|---|---|---|---|
| A1 | Content and community policy | new banned topics, stricter rules for violence, misinformation or elections | `guideline_pack`, `law` | D1, D3 (strikes, removals), D7 |
| A2 | Monetization programs | eligibility, revenue share, programs that merge, close or open, country lists | `monetization_program` | D1, D3 (monetization status), D7 |
| A3 | Originality, AI and automation policy | reused/inauthentic content, AI labels, mass-produced content | `guideline_pack`, `creator_tactic` (`originality.*`) | D1, D3 (demonetisation, limited ads), D4 |
| A4 | Ad suitability and brand safety | advertiser-friendly rules, limited-ads triggers | `guideline_pack` | D1, D3 (per-video ad status) |
| A5 | Rights and licensing | Content ID, music rules, stock licence terms, attribution | `provider_terms`, `guideline_pack` | D1, D2 (claims on upload), D3 (claims) |
| A6 | Audience-specific rules | made-for-kids, age limits, minors in videos | `law`, `guideline_pack` | D1, D7 |
| B1 | Format and metadata specs | max length, aspect ratio, file size, title/description/tag/hashtag limits, caption formats | `platform_capability` | D1, D2 (validation errors on upload) |
| B2 | Platform APIs | deprecated endpoints, new scopes, quota costs, rate limits, app audits, token lifetime | `platform_capability`, `api_contract` | D1 (API changelogs), D2 (errors, `Deprecation`/`Sunset` headers, schema mismatches) |
| B3 | Platform features | features added or removed (A/B tests, multi-language audio, Shorts linking, chapters); API vs UI-only | `platform_capability` | D1, D2 |
| B4 | Ranking and recommendation | what the algorithm rewards shifts; rarely announced | `creator_tactic`, `format_signal` | D4, D5, 073d exploration |
| B5 | Platform availability and rise/decline | country bans, a platform shrinking, a new platform worth adding | `market`, `platform_capability` | D1, D5, D7 |
| C1 | Audience behaviour | best posting hours, preferred length, language mix | `market`, `format_signal` | D4, 073d |
| C2 | Topics, formats, niches | trends rise and fade, saturation, competition | `format_signal` | D5 (trend service), D4, 073d |
| C3 | Calendar and news | seasonal events, breaking news, election periods | `market` (`seasonalEvents`) | D5, D1 |
| C4 | Ad market and money | RPM/CPM, currency, sponsor rates | `market` (`rpmUsd`), `monetization_program` | D3 (own revenue), D1, D6 |
| C5 | Local law | AI labelling laws, ad-disclosure law, privacy and data law, age-verification law | `law`, `market` | D1, D6, D7 |
| D1 | LLM providers | model retired, price, quota, quality drift, terms | provider intel records (map to `provider_terms`) | provider intel (as a detector), D2 |
| D2 | TTS, footage, image and music sources | voices removed, keys paused (as Pexels did), licence or caching terms | `provider_terms` | D1, D2 (auth/quota errors), D6 |
| D3 | Tools and dependencies | CLI discontinued (as Gemini CLI was), renderer or ffmpeg changes, npm deprecations and advisories | `dependency` | D2 (exit codes, version checks), D6 (`npm outdated`/`npm audit`, read-only), D7 |
| E1 | Account health | strikes, warnings, suspension, revoked tokens, lost verification | `account_policy` | D3, D2 (`invalid_grant`, 401/403) |
| E2 | Video health | removed, age-restricted, limited ads, claimed, blocked in some countries | — (state, not knowledge) | D3 |
| E3 | Channel milestones | crossing a threshold makes a program possible | `monetization_program` | D3 + A2 entries (a rule compares them) |
| E4 | Unexplained performance change | a sudden drop or rise with no known cause | — | D4 → an incident (R5) |
| F1 | Our cost and budget | price changes that change the profit per video | `provider_terms`, provider intel | D2 (usage cost), provider intel |
| F2 | The user's goals | new market, new niche, budget changes | profile settings | D7 (the user), existing settings |
| G1 | Knowledge quality | sources disagree, a source page 404s, a fact proven wrong by our own data | any | D1 (404, redirect), D4 (contradiction), D6 |

**Rows added from RESEARCH-073** (`docs/research/change-signals/catalog-gaps.md`, verified 2026-11-11). Each one covers a change that returns HTTP 200 and no error, so D2 alone never sees it:

| # | Category | Real example | Knowledge kinds | Detectors | Default reaction |
|---|---|---|---|---|---|
| B6 | Data meaning changes, schema stays | YouTube `mostPopular` became Music/Movies/Gaming on 2025-07-21; Shorts views counted differently from 2025-03-31 | `api_contract` (+ a `metricDefinitionRev`) | D1 (effective dates), D2 (semantic fingerprint: the dimension mix of results) | R1 + split analytics into before/after segments; baseline changes need approval |
| B7 | Alias or upstream changes while requests still work | DeepSeek routed old `deepseek-v4-flash` IDs to V4.1 Flash on 2026-09-10 | `api_contract`, `provider_terms` | D1 (model lifecycle), provider intel (compare the model ID the response returns), D4 | R2: mark the baseline changed, propose a review of the replacement |
| B8 | Quota units or buckets change | YouTube gave `videos.insert` and `search.list` their own buckets on 2026-06-01 | `api_contract` (`quota: { bucket, unit, window, reset }`) | D1, D2 (classify quota errors by bucket) | throttle only the affected method; never pause other methods because one bucket ran out |
| D4 | New sign-ups or one account group lose access | Pexels paused new API keys (2026-11); Gemini CLI dropped personal Google login on 2026-06-18 | `api_contract`, `provider_terms`, `dependency` (`onboarding`, `accountTypes`) | D1 (help/lifecycle pages), D7 | R1: label "affects new sign-ups / account type X", keep working connections |
| E5 | Consent or scope migration | TikTok User Info scope migration deadline 2024-02-29 | `account_policy`, `api_contract` | D1, D2 (granted scopes vs needed fields per account), D7 | R2: ask the user to reconnect with the right scopes. Never call it a ban or a revoke |
| G2 | A source changes how it is reached, data still exists | Wikimedia API Portal closed 2026-06 while the wiki endpoints stayed | `api_contract`, any | D1 (content type, canonical URL, a body that is only a shell), D6 | stop raising confidence from that watch; R2 to change the source |

**Interpretation rule (RESEARCH-073):** 401/403, 404, an empty list and zero revenue never prove a strike, a ban, a removal or a lost monetization. They make an `unknown` state that asks for a check (D3, §9).

## 2. Knowledge entries (073a)

**`packages/shared/src/knowledge/`:**

```ts
type KnowledgeEntry = {
  id: string;                 // stable, dotted: "youtube.ypp.ads", "market.GB", "guideline.youtube", "limit.youtube.shorts_max_sec"
  kind: KnowledgeKind;        // each kind has its own zod schema for `value`
  scope: { platforms: Platform[] | ["*"]; markets: string[] | ["*"] };
  value: unknown;
  evidence: Array<{
    url: string;
    checkedAt: string;        // YYYY-MM-DD
    sourceUpdatedAt?: string; // the date the page shows, when it shows one
    quote?: string;           // ≤ 25 words, found in the page (quoteInPage)
    type: "official" | "industry" | "measured" | "anecdote" | "inference";
  }>;
  confidence: "high" | "medium" | "low";
  volatility: "stable" | "yearly" | "quarterly" | "monthly" | "weekly";
  watch: Array<{ url: string; kind: "policy_page" | "changelog" | "rss" | "api_revision" }>;
  status: "active" | "deprecated";
  supersedes?: string;        // a renamed or replaced fact
  validFrom?: string;         // a change announced for a future date
  validUntil?: string;        // a program or rule with an announced end
  notes?: string;             // Vietnamese, for the user
};
```

**Kinds in 073a:**
- `guideline_pack`;
- `market` (placeholder schema; TASK-071 fills it);
- `monetization_program`;
- `platform_capability` (limits and features per platform: `{ platform, name, value, unit?, api: boolean }`);
- `api_contract` (endpoint, scopes, quota cost);
- `provider_terms` (a source or provider: availability, licence, attribution, caching, price);
- `law` (country, scope, what it requires);
- `account_policy`;
- `dependency`;
- `creator_tactic`.

`format_signal` comes in 073d. **Adding a kind** is: a zod schema, one line in the kind registry, a row in the catalog, and a test. Write these steps in `docs/knowledge/README.md`.

**Time** (all computed, never stored):
- the time to live by volatility: stable 730 d, yearly 365 d, quarterly 90 d, monthly 30 d, weekly 7 d;
- the freshness state: `fresh`, `due` (past `reviewAfter`), or `stale` (past 2× the time to live);
- `validFrom` and `validUntil` make the resolver return the right version for a date. A program that ends on a date stops applying that day, and a rule announced for next month starts on its date. **Test:** both edges.

## 3. Layers, the resolver and the assumption audit (073a)

**Layers.** A higher layer wins by `id`:
1. **Snapshot:** reviewed JSON files committed in `packages/shared/src/knowledge/snapshot/<kind>.json`. **Claude writes these** from reviewed research. They are also the fallback when the DB is empty. A test parses every entry.
2. **Accepted:** DB revisions approved by the user, or auto-applied by policy.
3. **Measured:** facts computed from our own data (073c/d). They are only ever proposals for `high` kinds.
4. **User:** the user's own guideline packs and settings keep winning, as today.

**The resolver** (`apps/server/src/knowledge/service.ts`):
- `get(id, at?)`, `list({ kind, platform, market, freshness })`, `value<T>(id, fallback)`;
- each result carries `{ entry, layer, freshness, revision }`;
- a missing id logs once and returns the fallback.

**Consumers declare what they read.** `packages/shared/src/knowledge/consumers.ts` maps every consumer (a guideline check, a prompt line, a publisher limit, a provider registry, a skill, a `featureMap` feature) to the ids or id patterns it reads. This gives the impact of any change and decides what a hold (R4) pauses. **Test:** every id passed to `get`/`value` in the code exists in the snapshot (grep the call sites).

**Assumption audit.** grep the code for external assumptions:
- platform numbers and limits (Shorts length, `hookWithinSec`, title/description/tag limits in `publishing/trimMetadata.ts`, quota costs in `publishing/youtubeQuota.ts`);
- provider facts (free tiers, licences, caching terms in `providers/**`);
- API scopes (`analytics/scopes.ts`).

**Known stale or at-risk assumptions** (found while reviewing RESEARCH-073, 2026-11-11). List them in `assumptions.md` first:
- `YOUTUBE_UPLOAD_QUOTA_COST = 100` in `packages/shared/src/publishing/youtubeHelp.ts` is correct today, but it is an outside fact: move it to `api_contract` `youtube.data.videos_insert`.
- `YoutubeQuotaTracker` counts every call against one `YOUTUBE_DAILY_QUOTA`. Since 2026-06-01 `videos.insert` and `search.list` have their own buckets (catalog row B8). The tracker must count by bucket, read from the entry. The single counter is safe but stops too early.
- The warning in `youtubePublisher.ts` (around line 442) says unverified API projects keep videos private. YouTube reversed that on 2026-11-02. Keep the mismatch check, and take the explanation text from the entry.
- The publisher always sends `privacyStatus`. Keep it that way: since 2026-11-02 an upload without it defaults to `public`. Add a test that `privacyStatus` is always present.

Then:
- move each one that an outside party decides into an entry;
- keep our own design choices as code;
- write `docs/knowledge/assumptions.md` listing every one: moved, or kept and why.

From then on, a reviewer can reject any new hard-coded external fact by pointing to this file.

**Videos remember the facts they used:** `project.settings.knowledgeRev`, a short hash of the revisions the project read, so learning can compare before and after a change.

## 4. Proposals, history, import (073a)

**DB** (via drizzle-kit):
- `knowledge_entries`: id, kind, json, revision, updatedAt;
- `knowledge_revisions`: id, entryId, revision, before, after, patch, origin, actor, reason, changeEventId?, createdAt;
- `knowledge_proposals`: id, entryId, kind, proposed, patch, origin, evidence, risk, status, changeEventId?, createdAt, decidedAt, decidedBy.

**Rules:**
- a change is always a proposal first;
- accepting writes the entry and a revision in one transaction;
- rollback is a new revision; nothing is deleted;
- a newer proposal for the same entry supersedes the older one;
- `diffJson(before, after)` returns RFC 6902 operations. Test it with nested objects, arrays and a type change.

**Import** (how research gets in, now and later):
- `POST /api/knowledge/import` `{ entries, label }`, and the `import_knowledge` tool;
- each entry is validated by its kind schema; invalid entries are listed, not saved;
- a valid entry becomes a proposal;
- an identical entry only refreshes `checkedAt` (an auto revision with the reason "đã kiểm tra lại, không đổi");
- every research brief from now on outputs a `knowledge.json` of entries;
- **legacy kind:** `platform_limit` (used by `docs/research/monetization/knowledge.json`) is accepted on import and converted to `platform_capability`. Its `value` maps to `{ platform, name, value, unit?, api }`, and `api` defaults to `false` unless the evidence names an endpoint. Test it with one real entry from that file.

**Research already done** (Claude reviews it and writes the snapshot from it; Codex only builds the importer):
- `docs/research/monetization/knowledge.json`: 125 entries, using the old shape;
- `docs/research/markets/markets.json`: the market data;
- `docs/research/change-signals/knowledge.json`: 111 entries (`api_contract`, `account_policy`), in the §2 shape.

**Risk** (computed from the patch and the kind; the full table is in code, with tests):
- **`high`**, always needs the user:
  - `MUST` rules, laws and account policies;
  - monetization eligibility or revenue share;
  - availability of a platform or provider;
  - `platform_capability` limits and `api_contract`;
  - anything coming from the measured layer;
- **`medium`**, the user approves: `SHOULD` rules, market defaults, tactics, provider prices. The setting `knowledge.autoApplyMedium` is off by default;
- **`low`**, auto-applied when the confidence is `high` and every `official` evidence has a checked quote: TIP rules, notes, and patches that touch only `evidence` or `notes`.

## 5. Tools and web (073a)

**Tools** (shared registry from TASK-047: assistant, MCP and operator):
- read: `list_knowledge`, `get_knowledge` (with history and consumers), `list_stale_knowledge`, `list_change_catalog`;
- confirm: `propose_knowledge_change`, `import_knowledge`;
- user-only: accept, reject and rollback, from the web or as a confirmed pending action. **The operator can never accept its own proposal.**

**Web**, one page "Tri thức" under Cài đặt:
- tabs by kind, a freshness badge (Mới / Cần kiểm tra / Cũ), and the sources with dates;
- "Chờ duyệt": the diff per field, the evidence and quotes, the risk, the consumers affected, and Duyệt / Bỏ qua;
- "Lịch sử" per entry, with "Khôi phục".

**Move the guideline packs:**
- `BUILT_IN_GUIDELINE_PACKS` → `snapshot/guideline_pack.json`, with ids `guideline.<packId>`; platform packs are `quarterly`, channel packs `yearly`;
- `builtInGuidelinePack` reads through the resolver;
- **test:** the existing guideline tests pass unchanged, and an accepted update changes the active rules.

**Done for 073a:**
- [ ] Catalog with its tests, entries, kinds, time rules, resolver, layers, consumers, assumption audit file, `knowledgeRev`.
- [ ] Proposals, revisions, rollback, `diffJson`, import, risk.
- [ ] Guideline packs moved, and the moved assumptions; the old tests pass.
- [ ] Tools, the web page, the user guide page "Tri thức và thay đổi bên ngoài", `nhat-ky-thay-doi.md`, `featureMap`.
- [ ] typecheck, build and test pass in every workspace; drizzle-kit says "No schema changes".
- [ ] Browser check (port 5180): import 2 test entries (one low, one high), see one auto-applied and one pending, approve it, then roll it back.
- [ ] Report `docs/tasks/TASK-073a.report.md`, and an empty `docs/tasks/TASK-073a.done`.

---

## 6. Change events: one inbox for every change (073b)

**Table** `change_events`:
- id, category (from the catalog), detector, subject (`{ type: "knowledge" | "platform" | "provider" | "account" | "video" | "metric" | "dependency", id }`);
- summary (Vietnamese), evidence, severity (`info | warn | high | critical`), fingerprint (to merge repeats);
- impacted consumers (from `consumers.ts`), reaction taken, status (`open | acknowledged | resolved | ignored`), createdAt, resolvedAt.

**Rules:**
- **Repeats merge by fingerprint:** a count and a last-seen time, not new rows.
- **Provider intel changes** (`provider_intel_changes`) also write a change event, so there is one inbox. Keep their own table.
- **Web:** a "Thay đổi" tab on the same "Tri thức" page, filtered by status and severity, with links to the proposals.
- **Dashboard:** `high`/`critical` open events appear in "Cần bạn xử lý".
- **Tools:** read `list_change_events`; confirm `resolve_change_event`.

## 7. Reaction policy (073b)

A table in code, keyed by category × severity, with tests. The reactions:

| Level | Reaction | Notes |
|---|---|---|
| R0 | log | |
| R1 | inform | in the daily digest |
| R2 | propose | a knowledge proposal |
| R3 | adapt within limits | only to an option that is already configured and allowed: the next provider in a fallback chain, another footage source, a shorter length within the current limit. It never changes a `MUST`, never spends beyond the budget, and never enables `paid_fallback`. It is always undone when the cause clears |
| R4 | hold the affected part only | pause the consumers that read the changed fact (through `consumers.ts`), using the circuit breaker or the autopilot pause. Example: a strike on a YouTube account holds publishing to **that account**, not rendering for TikTok. Every hold has a reason and a "Tiếp tục" button, and is lifted when the event resolves |
| R5 | investigate | open an incident: run the `change_investigation` skill (§8) |

**Defaults:**
- `critical` (account suspended, video removed, revoked token, a platform API endpoint gone) → R4 + R1 + a notification;
- `high` → R2 + R1 + a notification;
- `warn` → R2 or R3;
- `info` → R0/R1.

The user can change the policy per category. They can never lower a `critical` account event below R4.

## 8. Detectors D1, D2, D6, D7 and the investigation skill (073b)

**D1, documents:**
- watch every `watch` URL of the active entries, plus a platform list of API changelogs and revision histories (in the snapshot as `api_contract` watch URLs);
- the schedule follows volatility: weekly → daily, monthly → twice a week, slower → weekly;
- use the shared fetcher, and hash the text after removing noise;
- a 404 or a redirect to another path is a G1 event;
- a changed page → one cheap routed LLM call (usage label `KNOWLEDGE`) that returns "không ảnh hưởng" or a proposed value with quotes checked by `quoteInPage`. No valid quote means `confidence: low`, and it can never be auto-applied;
- `rss` and `api_revision` watches read new items only;
- **D1 is the main early-warning channel, not D2.** RESEARCH-073 found that only Unsplash sends a deprecation `Warning` header, and no API we call promises `Deprecation`/`Sunset`. Most changes appear only on changelog pages, about 12 of which have RSS/Atom (`docs/research/change-signals/api-deprecation.md`). Prefer the feed when one exists, and fall back to hashing the page;
- a 200 response whose body is only a shell (no main text), or a changed canonical URL, is a G2 event, not "không đổi";
- respect `robots.txt` for automatic fetches. A watch the research marked as robots-blocked or 403 (`docs/research/monetization/change-signals.md`, `markets/change-signals.md`) becomes a manual D7 check;
- **budget:** N LLM calls per day (setting, default 20); ECO mode runs only the hash.

**D2, runtime signals:**
- one small wrapper on every external HTTP client (publishers, analytics fetchers, footage, images, music, TTS, LLM HTTP providers) and on CLI providers;
- it records, per (provider or platform, endpoint): `Deprecation`/`Sunset`/`Warning` headers (rare, but cheap to read); new status codes or error reasons not seen before; 401/403 and `invalid_grant`; quota and rate-limit errors; and responses that fail our zod schema (the API shape changed);
- each kind of signal gets a fingerprint and becomes a change event after a threshold (setting; e.g. 3 in 1 h, or 1 for auth and `Sunset`);
- this replaces nothing: existing retries, quota handling and the YouTube rejection handling stay. They also emit events;
- CLI providers: a changed `--version`, or an exit message seen for the first time, is an event.

**D6, staleness and dependencies:**
- a weekly sweep lists `due`/`stale` entries; `stale` `high`-risk entries become `high` events;
- once a week, read-only `npm outdated --json` and `npm audit --json` in the repo root, run by the operator. Deprecations and high advisories become D3-category events. It never installs or upgrades.

**D7, people:**
- the user, assistant or operator can file a change ("nghe nói TikTok đổi điều kiện Creator Rewards") with `report_change({ category, summary, url? })`, a confirm tool;
- it becomes an event, and an investigation if it names a knowledge entry.

**Operator skills** (in `operator/skills.ts`; they never accept knowledge and never lift a `critical` hold):
- `knowledge_refresh`: takes ≤ 5 stale or due entries, reads their evidence and watch pages, and proposes updates with evidence;
- `change_investigation`: for an open event, writes hypotheses ("platform change", "our content changed", "seasonal", "a data or sync bug"), the checks for each (other channels, other platforms, the same week last year, `knowledgeRev` before and after, sync errors), runs the read-only ones, and writes a short finding plus proposed next steps to the event;
- `research_brief`: for a large refresh, writes a Codex research brief from the stale list in the same shape as RESEARCH-071/072. The user hands it to Codex, and the output comes back through `import_knowledge`.

**Tests:** for each detector, a fake that triggers it and one that does not (noise-only page change, a single 500 error); merge by fingerprint; each reaction level, including that a hold pauses only the consumers that read the fact; the budget limits.

## 9. 073c: D3 account and video status, D4 drift

**Do first: two 073b gaps** (found in Claude's review, 2026-11-11). §8 asks for schedules, but nothing outside the tests calls the 073b detectors.
- **Schedule them** through the existing operator cron (`apps/server/src/operator/cron.ts`) or the app's scheduler, with the cadence from §8:
  - D1 `runDocumentWatch` per watch: weekly volatility → daily, monthly → twice a week, slower → weekly;
  - D6 `ChangeInbox.sweepStale(...)` weekly, fed from the knowledge resolver's `due`/`stale` entries;
  - D6 `runDependencySweep` weekly, running only the read-only `dependencyCommands()` (`npm outdated --json`, `npm audit --json`) through `assertReadOnlyNpm`.
  - Each run respects ECO and the LLM budget already in `ChangeInbox`, skips when the app is offline, and writes one audit line. Tests use fake clocks and fake runners (no network, no real npm).
- **Prune `change_signal_hits`:** delete rows older than 7 days (the threshold only looks back 1 hour), on the same daily schedule or on insert every N rows. Add a test.

**D3, account and video status:**
- poll what each platform API exposes for account health and per-video status: upload rejections, removals, age restrictions, region blocks, claims, ad status, monetization status, strikes;
- **What each platform exposes is in `docs/research/change-signals/status-apis.md`** (the `account.*` entries in its knowledge.json). Read the coverage from the entries, not from code. Most signals (strikes, monetization status, ad suitability, copyright claims) are **manual-only** on all four platforms. What has an API:
  - YouTube: `videos.list` `status`/`processingDetails` (rejections), `contentDetails.regionRestriction`, `ytAgeRestricted`; `invalid_grant` on refresh;
  - TikTok: the `authorization.removed` webhook with its `reason`, the `post.publish.*` webhooks, `publish/status/fetch`;
  - Facebook: the video `status`, `debug_token`, Graph code 190;
  - Instagram: the container `status_code`.

  The webhooks need a public HTTPS URL. Without one, poll, and say so in the settings page.
- **The manual check:** a weekly checklist page lists, per connected account, the platform UI path from each manual-only entry (`value.verification`). The user ticks "không có gì" or records what they saw (time, asset, policy name). That record is a D7 report. Never scrape logged-in pages;
- a missing video, an error or zero revenue gives the state `unknown` and a check item. It is never treated as a strike or a removal;
- E3 milestones: compare the channel's numbers with the `monetization_program` eligibility entries, and raise an `info` event "kênh đã đủ điều kiện …".

**D4, drift:**
- per channel and platform, track daily series (views per video at 48 h, CTR, average view %, impressions by traffic source, RPM);
- run a change-point test (CUSUM or Page-Hinkley) against the channel's baseline;
- a confirmed shift is an E4 event with R5;
- **cross-checks** decide the likely category:
  - every channel on one platform shifts the same day → B4;
  - one format only → C2;
  - after a `knowledgeRev` change → our change;
- a fact in the measured layer that contradicts an `industry` entry → a G1 proposal.

## 10. 073d: exploration and fading signals (outline; Claude details it after RESEARCH-072/073)

- New kind `format_signal`: a score per (market, platform, format or niche or topic, length band, posting slot), with a half-life.
- **Inputs:** research priors (low weight), trend velocity, and the channel's own results. Weights halve every half-life unless confirmed, and the channel's own data wins with enough videos.
- **Exploration budget** (setting, default 15 % of autopilot videos): Thompson sampling over allowed alternatives (format, length, posting slot, hook style). This catches changes that nobody announces.
- **Consumers:** topic suggestion, format picking, posting times, weekly insights. Settings change only through the existing proposal flow. No automatic niche switching.
