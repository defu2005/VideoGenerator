# RESEARCH-072 — Codex research brief (every way to earn money from video)

**Who:** Codex (desktop thread). You need web search. If you have no web access, stop at once and write that in the report. **No code.** You write research notes only.

**Why:** the product goal is an app that makes good, cheap videos by itself and earns money on YouTube, TikTok, Facebook and Instagram. Before Claude changes features, designs operator skills or adds MCP tools, we need a complete, sourced map of:
1. every way video earns money, on each platform and off them;
2. the creator skills that drive that money (what top channels actually do);
3. the rules that can **stop** an automated channel from earning (reused content, AI content, mass-produced content);
4. how the app covers each of these today, and the gaps.

Claude turns your output into task guides. **Do not write guides, code, skills or MCP tools yourself.**

**These facts will change.** The app does not hard-code them: it keeps them as knowledge entries with a source, a check date and an expiry, and it watches the source pages for changes (see `docs/cursor/TASK-073.md` §2, read only §2). So for every fact, also say **how fast it changes** and **where a change would be announced**. This research is the first import, not a one-time answer.

**Output (only these files):**
- `docs/research/monetization/README.md`: the report (§6) and the method;
- `docs/research/monetization/streams.md`: §1, one table per platform;
- `docs/research/monetization/automation-risk.md`: §2;
- `docs/research/monetization/skills.md`: §3;
- `docs/research/monetization/gap-analysis.md`: §4 and §5;
- `docs/research/monetization/change-signals.md`: §2b;
- `docs/research/monetization/knowledge.json`: §8, the machine-readable facts;
- then an empty `docs/research/monetization/RESEARCH-072.done`.

Do not touch anything else in the repo. No npm install.

---

## 1. Revenue streams

**Platforms:** YouTube (long and Shorts), TikTok, Facebook, Instagram. Then briefly: Snapchat, X, Pinterest, Zalo Video (Vietnam), and Kuaishou/Douyin (only whether a foreign channel can join).

**For each stream, one table row:**
- name, platform;
- what pays (ads, gifts, subscriptions, affiliate, brand deals, fund…);
- eligibility (followers, watch hours or views, video length, age, account type, and the window, e.g. "4 000 h in 12 months");
- revenue share or typical payout, marked as an estimate when it is;
- countries where it is available, and whether **Vietnam** is one of them;
- the content rules that matter for it (length, originality, "no AI voice only"…);
- **can an automated, faceless channel use it?** yes / partly / no, with the reason;
- the source URL and the check date;
- `volatility`: `stable | yearly | quarterly | monthly | weekly`, with the reason (e.g. "the threshold has changed twice since 2023");
- the page or feed where a change would show first (`watch`).

**At least these streams:**
- **YouTube:** YPP ads (long), Shorts revenue share, channel memberships, Super Thanks/Chat/Stickers, YouTube Shopping (own store and affiliate), Premium revenue, brand deals (BrandConnect).
- **TikTok:** Creator Rewards Program (≥ 1 min videos), Subscriptions, LIVE gifts, TikTok Shop affiliate, Creator Marketplace/TikTok One, Series (paid collections), Effect creator rewards.
- **Facebook:** Content Monetization (the merged program for in-stream ads, Reels and photos), Stars, subscriptions, brand collabs manager, the creator bonus programs.
- **Instagram:** gifts, subscriptions, badges, bonuses (if still live in any country), affiliate and brand collabs.
- **Off-platform:** affiliate links in descriptions (Amazon, Shopee and Lazada for VN/SEA, Impact…), sponsorships, digital products and courses, licensing clips (stock footage sites), newsletter and lead capture, multi-language dubbing of the same video (YouTube multi-language audio tracks).

## 2. What stops an automated channel from earning

This is the most important part: the app produces videos automatically.
- **YouTube:** the "inauthentic content" (formerly "repetitious content") and "reused content" policies; the July 2025 rename and what changed since; how reviewers judge AI voice, stock footage, slideshows and text-to-speech; the altered/synthetic content disclosure; what reviewers say gets channels rejected or demonetised. Include real examples of rejection reasons from creator forums, marked as anecdotes.
- **TikTok:** the originality rules of Creator Rewards; unoriginal or low-quality content; the AI-generated content labels (AIGC).
- **Facebook/Instagram:** the "unoriginal content" rules (2025 crackdown); what counts as meaningful enhancement.
- For each platform: a checklist of **what makes an automated video count as original**, in concrete, checkable terms (e.g. "own script and commentary", "at least N % of the runtime is not stock", "a human voice or a cloned own voice", "varied visuals"). Mark each item with its source, or as an inference.

## 2b. How changes are announced, and how fast things go out of date

For `change-signals.md`:
- **Per platform:** the official places where policy and monetization changes appear first (changelog pages, policy update pages, official blogs, newsroom RSS, creator channels such as Creator Insider). For each one: the URL, an RSS/Atom feed if there is one, whether robots.txt allows fetching it, and how much noise the page has (dates, counters).
- **History:** the main monetization and originality changes of the last 3 years per platform, with dates (e.g. YPP thresholds, the Creator Fund → Creativity Program → Creator Rewards changes, the July 2025 YouTube rename, the Meta 2025 unoriginal content changes). From this, suggest a `volatility` per kind of fact.
- **Content that stops working:** evidence of how long formats and niches stay profitable (e.g. faceless compilation channels, "Reddit story" TTS videos, AI slideshow channels after the 2025 crackdowns). How fast did they drop, and what signal showed it first (views, RPM, demonetisation waves)? Use this to suggest a half-life in days for "what is hot" signals per platform. Mark anecdotes as anecdotes.

## 3. Creator skills that drive revenue

These are the skills a good channel operator has. For each one:
- what it is, in 2–3 lines;
- the evidence that it matters (sources, numbers);
- how an automated system could do it (data needed, rules, or an LLM step);
- what can be measured to know it works (the KPI);
- whether it is stable advice or depends on the current algorithm (`volatility`).

**At least:**
- niche and topic choice by RPM and demand (high-RPM niches: finance, tech, education…; for Vietnam and the other markets in RESEARCH-071);
- hooks and the first 30 seconds, retention editing (pattern interrupts, open loops);
- titles and thumbnails (CTR), A/B testing ("Test & Compare" on YouTube);
- video length and mid-roll ad placement (≥ 8 min on YouTube);
- SEO: tags, descriptions, chapters, captions, multi-language titles and audio;
- posting cadence and timing; series and playlists; end screens and cards;
- the Shorts → long-video funnel; repurposing one video into many formats;
- community: comment replies, pinned comments, community posts, polls;
- analytics loops: what to change after 48 h, 7 days, 28 days;
- brand safety: keeping ad suitability ("yellow icon") high;
- trend jacking and seasonal planning;
- sponsor-ready packaging (media kit, audience data).

## 4. How the app covers each stream and skill

Read the app's own feature list, not the code:
- `packages/shared/src/features/featureMap.ts`;
- `docs/user-guide/README.md`, and only the user-guide pages you need (each ≤ 300 lines; use grep).
- For skills that exist already: `apps/server/src/operator/skills.ts` (the list of operator skills, names and triggers only) and `apps/server/src/operator/playbooks.ts` (names only).

For each stream in §1 and each skill in §3, a row: `covered | partly | missing`, with the app feature or file that covers it, and what is missing.

## 5. Proposals (Claude decides; you only propose)

From §4, list the gaps, ranked by **expected revenue impact ÷ effort**. For each gap:
- the problem, in one line;
- the proposal, in one of these forms:
  - **feature** (a change to the app);
  - **operator skill** (a playbook the operator/assistant runs: name, triggers, steps, tools used);
  - **MCP tool** (name, input, output, risk level: read / confirm / blocked);
  - **guideline rule** (for the content checks);
- expected impact (with the evidence from §1–§3), effort S/M/L, and risks (policy, cost, account bans);
- dependencies (e.g. "needs RESEARCH-071 market data");
- **what is data and what is code:** which part is a knowledge entry that can change later (thresholds, rules, best hours, tactics) and which part is code that stays stable. A proposal must not hard-code a fact that §2b says changes.

At most 25 proposals. Then pick the **top 5** and say why.

**Open source first:** for each proposal, name open-source projects that already do it (licence, last release, stars), e.g. thumbnail A/B tools, YouTube SEO tools, comment-reply bots, affiliate-link managers. Do not install anything.

## 6. Report (top of `README.md`, ≤ 40 lines)

```
RESEARCH-072 REPORT
streams: <n> rows, <n> available in VN, <n> usable by an automated channel
biggest risk: <one line>
originality checklist: <the 5 most important checkable items>
top 5 proposals: <one line each, with impact and effort>
open-source finds: <≤ 5 lines>
knowledge.json: <n> entries by kind, <n> high-volatility
open questions for Claude/user: <≤ 6 bullets>
```

## 7. Rules

- Every fact has a source URL and a check date (today's date). Prefer official help centres and policy pages; then creator-industry data; forums only as anecdotes, marked so.
- Programs change often: write the date the source was updated when the page shows one, and flag anything older than 12 months.
- When sources disagree, say so; do not pick one silently.
- No secrets, no sign-ins, no paid sources, no scraping behind logins.
- Quote at most one short sentence from any source; summarise in your own words.
- Write the files in **Vietnamese** (the user reads them); keep product and policy names in English.

## 8. `knowledge.json`

An array of entries in the `KnowledgeEntry` shape of `docs/cursor/TASK-073.md` §2. Kinds:
- `monetization_program`: one per stream row in §1. `value` has: platform, name, pays, eligibility (structured: `{ followers?, watchHours?, views?, windowDays?, minLengthSec?, minAge? }` plus a Vietnamese text), share, countries (`["*"]` or codes, with `VN` explicit), contentRules (Vietnamese), automatedUse (`yes | partly | no`) and reason.
- `platform_capability`: each number or feature a platform fixes (e.g. Shorts max length, Creator Rewards min length, mid-roll min length, whether A/B title tests exist in the API). `value` = `{ platform, name, value, unit?, api }`. (Older name `platform_limit` is fine; Claude renames it on import.)
- `creator_tactic`: one per skill in §3. `value` = `{ name, summary (Vietnamese), kpi, howToAutomate }`.
- The originality checklist items from §2: kind `creator_tactic` with id prefix `originality.`.

Rules:
- every entry has at least one `evidence` item; `type: "inference"` when it is your conclusion;
- `quote` only when you copy ≤ 25 words exactly from the page;
- ids are stable and dotted: `youtube.ypp.ads`, `tiktok.creator_rewards`, `limit.youtube.shorts_max_sec`, `tactic.hook_first_30s`.

Validate the file with `node -e "JSON.parse(require('fs').readFileSync('docs/research/monetization/knowledge.json','utf8'))"`. There is no zod schema yet; Claude checks the shape when importing.
