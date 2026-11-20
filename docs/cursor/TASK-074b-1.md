# TASK-074b-1 — nguồn bằng chứng mới cho skill do operator viết và kiểm cụm từ cấm

**Who:** opencode (code), Codex (review). Claude writes this guide only. **Size:** S. **Migration:** none.
**Part of:** TASK-074b (`docs/cursor/TASK-074.md` §4; estimate `docs/cursor/TASK-074-estimate-2026-11-19.md`).
**Depends on:** 074a (done: `docs/tasks/TASK-074a.done`). Not dependent on TASK-088 (see estimate; only the one-migration rule applies, and this part has no migration).

**Ruling (advisor, 2026-11-19; the user may overturn):** the banned list is not missing. `docs/cursor/TASK-074.md` §4.1 names five forbidden rules (approve, raise budgets, turn on `paid_fallback`, skip a check, touch the protected project). The implementer writes Vietnamese and English phrasings for those five rules into a fixture (step 2).

## Why

Skills the operator drafts need to say where their evidence came from. Today the source list is `repeated_failure | user_review | user_edit | agent_proposal` (`apps/server/src/operator/skillVersions.ts`, `SkillEvidence.source`). 074b needs five more kinds, and a draft must not carry banned phrases or long quotes from the web.

## Build

1. **Evidence sources.** Extend the `SkillEvidence.source` union with `pattern | research | change_event | outcome | improvement`. Keep the four existing values. Update every switch or validator that reads the union; a grep for `repeated_failure` finds them.
2. **Banned-phrase check.** Before `saveSkillDraft` stores a draft, run a check on the draft's markdown. The rules come from `docs/cursor/TASK-074.md` §4.1: a draft may not tell the operator to (a) approve, (b) raise budgets, (c) turn on `paid_fallback`, (d) skip a check, or (e) touch the protected project. Write Vietnamese and English phrasings for each rule in `apps/server/src/operator/skillDraftChecks.ts` (`BANNED_PHRASES`; the module also holds the quote check). A draft that matches is rejected, with the rule and the matched phrase named in the error. The check runs in `saveSkillDraft` (in `skillVersions.ts`, after `checkSkill`), before a draft is stored. `checkSkill` and `activateSkillVersion` are not changed.
3. **Quote limit.** A draft may contain at most 25 words quoted from a web source. Count words in each quoted span. Over the limit → reject the draft with the span named. **Rule (advisor, 2026-11-19; the user may overturn):** the limit applies per contiguous quoted span. A span is text inside straight or curly double quotation marks, or a markdown blockquote line. Any span over 25 words is rejected, with the span named.
4. **Where it goes.** `apps/server/src/operator/skillVersions.ts` (source union, `saveSkillDraft`) and `apps/server/src/operator/skills.ts` only if it validates sources.

## Not allowed

- No migration in this part. If a column seems needed, stop and report.
- Do not change how `checkSkill` or `activateSkillVersion` decide. Activation rules belong to 074b-4.
- Do not touch `operator/runtime.ts` or the routing path. That is 074b-3a.
- Do not run the protected project `56374fb2-…` or `data/`. Use the dev data dir.

## Tests (must exist)

- Each of the five new sources is accepted; an unknown source is rejected.
- Each of the four old sources still works (existing tests stay green).
- A draft with a banned phrase is rejected, naming the phrase; a clean draft is saved.
- A 26-word quote is rejected; a 25-word quote is accepted.

## Done when

- The tests above pass, typecheck passes for `apps/server`, and the report is at `docs/tasks/TASK-074b-1.report.md`.
- `docs/tasks/TASK-074b-1.done` only after Codex review.

## Open source available

None needed. The checks are plain string and word counting in our code. No dependency is added.
