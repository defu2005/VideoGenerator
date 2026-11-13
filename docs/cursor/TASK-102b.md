# TASK-102b — Scripts that sell well + media kit 🛍️🔴

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). Fable writes the product placement prompt (a separate brief). **Size:** M. **Migration:** none expected. **New dependency:** none.
**Depends on:** TASK-102a.

## Why

A product mentioned at the wrong place, or with no fit, hurts retention and trust. A good fit, placed after a value moment, converts. Sponsors also ask for a media kit with real numbers.

## Read first

- The TASK-102a tables, the script prompt and director, and the TASK-089 retention map (where viewers drop).
- `docs/ARCHITECTURE-TARGET.md` §4 group `money` (`score_product_fit`, `build_media_kit`: read or safe).

## Build

1. **`score_product_fit(projectId, productId)`** (safe): in BALANCED and QUALITY, the LLM rubric scores relevance to the topic, audience fit and claim risk. ECO uses a keyword overlap only. It returns a score + reasons + risky claims to avoid.
2. **Placement in script.**
   - With a campaign attached and the fit above the threshold (a TASK-088 param), the script prompt gets a placement brief: after the first value delivery, never in the hook, at most 1 mention + the CTA, honest wording, and no claims the product page does not support.
   - Code checks the position (not in the first 15 % of the video), the count, and the disclosure.
3. **Sponsor slot.** For sponsor campaigns, a reserved segment of 30–60 s with the brand's talking points; the director gives it a distinct look (the style pack's accent) and a caption label "Tài trợ".
4. **`build_media_kit(profileId)`** (safe): a one-page PDF or HTML with real metrics only (subs, 28-day views, median views per video, audience geography and age if the API gives them), the best videos and the contact placeholder. Every missing number is left out, not estimated. A date is stamped.
5. **Web.** The product fit and placement preview on the project page, and a media kit button on the profile page.

## Mã nguồn mở có sẵn (open source)

- PDF: reuse our existing HTML→PDF path, if any (check for Playwright/Chromium print). Otherwise HTML only.

## Rules

README rules 1–11. Never invent product claims. A sponsor segment is always labelled and disclosed (083).

## Tests

- fit scoring (ECO and injected LLM);
- the placement position and count checks;
- the sponsor segment label;
- media kit omits missing numbers;
- the disclosure is enforced.

## Done

- [ ] fit + placement + sponsor slot + media kit
- [ ] UI; tools; skill
- [ ] tests; suites
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-102b.done`
