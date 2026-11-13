# TASK-083 — Pre-publish check: from a skill to a checked step ✅

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`). **Size:** S. **Migration:** none; the result goes into the existing originality or publication record. If it truly needs a column, use drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-082 Part 2 at least started, so the checks match a real upload.

## Why

The skill `.agents/skills/video-kiem-tra-truoc-khi-dang/SKILL.md` already exists (106 lines), but the agent has to remember it, and four checks from gap #2 are only text:
- facts and claims that need a source;
- the AI-content disclosure, which YouTube calls "altered or synthetic content";
- the sponsorship / paid promotion flag;
- ad suitability (advertiser-friendly topics).

The goal is that code collects the facts, the agent judges, and the publish flow shows the result.

## Read first

- The skill above, in full, and `.agents/skills/video-dang-bai/SKILL.md`.
- `apps/server/src/originality/` (TASK-084, 107, and 113 if done): the report this check sits beside.
- The publish path: `api/publications.ts` and the publish tool. Note where "made with AI" and "paid promotion" are or are not sent to YouTube.
- `apps/server/src/guidelines/` (TASK-017): guideline packs and `llmCheck.ts`. Reuse its LLM check shape.

## Build

1. **`prepublishCheck(projectId)` (code).** It collects:
   - the originality report;
   - the claims in the script that have no source link (from the research and source manifest);
   - whether any scene uses AI-generated visuals or voice, which makes the AI label required;
   - whether the script or description mentions a brand, an affiliate link or a sponsor, which makes paid promotion likely;
   - the guideline pack ad-suitability hits;
   - platform length limits.

   It returns `{items: [{id, status: ok|warn|block, facts, fix}]}`. Code decides only the hard facts, such as length and the AI label being required. It does not judge.
2. **Agent judgment.** In BALANCED and QUALITY modes, one LLM call goes through the guidelines `llmCheck` shape to judge the soft items (claims, ad suitability, sponsorship) with the facts as input. It returns `ok|warn|block` with a reason per item. ECO mode uses code-only results, and soft items show "chưa đánh giá".
3. **Publish flow.**
   - The publish dialog shows the checklist.
   - A `block` needs the user to tick "Tôi đã xem và vẫn đăng" with a reason, which is recorded.
   - The AI label and paid promotion flags are **pre-filled** from the facts and sent with the upload, if the platform API supports them. YouTube supports `containsSyntheticMedia` and `paidProductPlacement` in status; check the current API docs first.
4. **Tool + skill.**
   - Add a `get_prepublish_check(projectId)` read tool.
   - Rewrite the skill to call it first, then do only the parts that need judgment. Keep the skill short.
   - `publish_project` refuses when a `block` item has no user override. Hermes cannot override it; only the user's tick can.

## Mã nguồn mở có sẵn (open source)

- The YouTube Data API `videos.insert` status fields (`containsSyntheticMedia`, `selfDeclaredMadeForKids`) and the `paidProductPlacementDetails` field. These are official docs, not code.
- The **Google advertiser-friendly content guidelines** and the **FTC endorsement guides** are the sources for the checklist wording. Cite their links in the skill.
- **Vale** (MIT) is a prose linter. Its rule format is a reference only if you want rule-based claim flags; do not add it.

## Rules

README rules 1–11. Never auto-tick the override. The protected project is never published.

## Tests

- each code item;
- ECO marks soft items as not judged;
- an injected LLM judgment is applied;
- a block stops `publish_project` until the user overrides it;
- the AI and paid flags are sent in the upload body (mocked);
- skill coverage.

## Done

- [ ] `prepublishCheck` + LLM judgment + tool
- [ ] publish dialog + override record + flags sent
- [ ] skill rewritten; tests; suites
- [ ] user guide (Đăng bài page) + changelog
- [ ] report `docs/tasks/TASK-083.report.md`, then `docs/tasks/TASK-083.done`
