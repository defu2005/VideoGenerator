# TASK-144 — Script quick wins: send the recipe guidance, add a style lint and fix the narration rules ✍️

**Who:** a new Sonnet 5.5 session (or Cursor `composer-2.5`). **Size:** S–M. **Migration:** none. **New dependency:** none.
**Depends on:** nothing. It can run beside any task that does not edit `apps/server/src/stages/script/*`, `packages/shared/src/formats/*` or `packages/shared/src/scenes/*`. TASK-145 builds on this task, so finish this one first.
**Source:**
- the user's complaint on 2026-11-17: the product scripts are "vô vị, nhàm chán, đơn thuần là đọc nội dung";
- `AI_VIDEO_AGENT_SKILLS_RESEARCH.md` sections 3.3–3.5 (already copied to `docs/research/AI_VIDEO_AGENT_SKILLS_RESEARCH.md`).

## Why

Three real product scripts were read on 2026-11-17: BlackPink, Berserk and Vạn Lý Trường Thành.

- **Wikipedia-style narration.** The text walks through dates in order ("Năm 1989…", "Năm 221 TCN…", "Năm 1987 UNESCO…"). Facts are listed, not told: there is no scene, no person and no turning point.
- **The format guidance never reaches the LLM.** `FORMAT_RECIPES` in `packages/shared/src/formats/recipes.ts` defines, per section:
  - `purposeVi` (for `story`: "Mỗi cảnh thêm một trở ngại", "Một sự thật đổi cách nhìn");
  - `hookStyles`;
  - `readingLevelVi`.

  `formatLine()` in `stages/script/prompt.ts` sends only the section keys, `hookMaxSec` and `sentenceMaxWords`.
- **The reviewer only fixes length.** Every review note saved is a word-count fix ("Điều chỉnh từ ~350 lên ~465 từ…"). The review prompt (`reviewPrompt.ts`) has no storytelling criteria.
- **Clichés and template outros.** Examples:
  - "Cảm ơn bạn đã đồng hành… Hẹn gặp lại trong video tới";
  - "like, subscribe and ring the bell";
  - "bi tráng", "tượng đài", "hành trình", "nghẹt thở".

  The outro never answers the question the hook asked.
- TASK-130 already dedupes the hook/section seams in code. Leave that alone and reuse its matcher.

## Read first

- `apps/server/src/stages/script/prompt.ts`, `mergedStoryPrompt.ts`, `reviewPrompt.ts`, `scriptExecutor.ts` (the review loop at ~lines 278–380 and the guideline pass at ~533) and `scriptUtils.ts`.
- `packages/shared/src/formats/recipes.ts`: `FormatRecipe`, `resolveFormat`, `fallbackFormat`.
- `packages/shared/src/scenes/` from TASK-130: `dedupeSeams` and the sentence matcher.
- `packages/shared/src/schemas/script.ts`: `ScriptSchema`.
- `apps/server/src/operator/qualityGates.ts`: how `quality_score`, `blocking_facts` and `revise_round` are read.
- `docs/research/AI_VIDEO_AGENT_SKILLS_RESEARCH.md` §3.2–3.4.

## Build

### 1. Send the full recipe guidance to the prompts

- Extend `formatLine()`, or add `formatGuidance(project)`, so the writer prompt and the merged-story prompt get each section as `key — nameVi: purposeVi (≈share of duration)`.
- The same prompts also get `hookStyles` (the allowed hook tactics), `readingLevelVi` and the recipe `descriptionVi`.
- Keep it compact: one line per section.
- Write the guidance once, in English instructions with the Vietnamese purpose text quoted. Do not translate the recipes.
- The review prompt gets the same block, so the reviewer can check that each section does its job.

### 2. Narration rules (writer and reviewer)

Replace the one-line system prompt with a short rule block shared by `prompt.ts`, `mergedStoryPrompt.ts` and `reviewPrompt.ts`, in a new module `stages/script/narrationRules.ts`. Rules, from research §3.3–3.4:

- **Hook.** Open with a tension, a contradiction, a cold-open moment or a real question. Never open with "Hôm nay chúng ta tìm hiểu…" or a list of achievements. The hook makes a promise that the script keeps.
- **Central question.** One question runs through the whole video. The outro answers it, or names what is still unknown. The outro is a payoff, not a thank-you.
- **Show, don't list.** Each section is built around at least one concrete moment: a person, a place, an object or a decision. Dates are context inside the scene, not the subject of the sentence. Do not open two consecutive sentences with a year.
- **Rhythm.** Mix short and long sentences. Use a rhetorical question at most once per section. End each section with a line that pulls into the next one (an open loop), except the last.
- **Accuracy.** No invented quotes, numbers or events beyond the research notes. Separate fact, interpretation and dramatisation ("có lẽ", "theo [nguồn]").
- **CTA.** Only when the recipe has a `cta` section, and one sentence at most. It never replaces the payoff.
- **TTS.** Write numbers, years and abbreviations the way they are spoken. Put no stage directions in the narration text.

### 3. Style lint in code (no LLM)

Add `lintNarration(script, recipe, language)` in `packages/shared/src/script/lint.ts`, exported from the package index. It returns findings `{ code, sectionId | "hook" | "outro", message, severity: "warn" | "fix" }`. Checks:

| code | Rule |
|---|---|
| `HOOK_REPEATED` | Hook sentence repeated in section 1. Reuse the TASK-130 matcher. |
| `DATE_LIST` | More than 40 % of a section's sentences start with a year or date pattern (`Năm \d{3,4}`, `Vào năm`, `Thế kỷ`, `In \d{4}`), or two in a row. |
| `CLICHE` | Hits from a cliché list per language: `packages/shared/src/script/cliches.vi.ts` and `.en.ts`. Seed it with: "hành trình", "bi tráng", "tượng đài", "nghẹt thở", "không thể phủ nhận", "hãy cùng", "chính thức", "đầy cảm xúc", "in the ever-evolving", "delve", "testament to", "tapestry". |
| `TEMPLATE_OUTRO` | The outro is only thanks, subscribe or "hẹn gặp lại" with no content sentence. |
| `FLAT_RHYTHM` | The coefficient of variation of sentence length in a section is under 0.25 with 4+ sentences. |
| `NO_QUESTION_PAYOFF` | The hook contains a question, and no word overlap of ≥ 2 content words between the hook question and the outro. This is a cheap heuristic: `warn` only. |
| `LONG_SENTENCE` | A sentence over the recipe's `sentenceMaxWords`. |

Thresholds live in one exported constant object, so tests and later tasks can tune them.

### 4. Feed the lint into the review pass

- In `scriptExecutor.ts`, run `lintNarration` after the first draft. Pass the `fix`-severity findings to the review prompt as "Problems found by the checker; fix each one" with section ids.
- After the last review pass, run the lint again. Store the remaining findings in the existing `review_notes`: keep the 8-note cap, and prefix lint notes with `[lint]`.
- When review is off (budget), the lint still runs and its notes are saved. No extra LLM call is added in this task.

### 5. Reviewer criteria

Rewrite `reviewPrompt.ts` so the reviewer scores against these criteria, not only length:

- hook strength;
- whether each section fulfils its recipe purpose;
- concrete scenes vs listing;
- open loops closed;
- outro pays off the hook;
- TTS naturalness;
- length.

Notes must name the section id. Length fixes come last and must not remove a section's concrete moment. The JSON output shape is unchanged.

### 6. Docs

- `docs/ARCHITECTURE.md`: the script stage now has a style lint, and the recipe guidance reaches the prompts.
- User guide: add a short section on what the script checker flags and how to read the `[lint]` notes. Put it on the page where the script editor and review notes are described (find it via `featureMap`), and add the `featureMap` entry if the section is new.
- Changelog line in `docs/user-guide/nhat-ky-thay-doi.md`.
- Update the operating skill `.agents/skills/video-du-an-va-pipeline/SKILL.md`: what the `[lint]` notes mean and that rerunning SCRIPT applies the new rules.

## Mã nguồn mở có sẵn (open source)

| Project | Licence | Use |
|---|---|---|
| [jtydhr88/screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) | MIT | Hook and scene principles. Borrow the ideas; if you copy wording, add an attribution comment in `narrationRules.ts`. |
| [danjdewhurst/story-skills](https://github.com/danjdewhurst/story-skills) | MIT | Editorial-review checklist (open loops, setup/payoff). Ideas only. |
| [Vincentwei1021/video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft) | no licence (NOASSERTION) | Do not copy anything. Ideas from its README only. |
| Cliché lists | — | Nothing permissive for Vietnamese. Write our own list. |

No dependency is added.

## Rules

- README rules 1–12. No migration.
- Never run SCRIPT, review or render on the protected project `56374fb2-…`.
- Tests use the mock LLM and fixtures only. No network, no real LLM CLI.
- Do not change `ScriptSchema` in this task. Beat metadata is TASK-145.

## Tests

- `formatGuidance` includes each section's `purposeVi`, the `hookStyles` and the `readingLevelVi` for `story` and `explainer`.
- `lintNarration` on fixtures cut from the three real cases. Put the text in `packages/shared/src/script/__fixtures__/`, with no project ids.
  - The date-list section → `DATE_LIST`.
  - The "Cảm ơn bạn đã đồng hành… Hẹn gặp lại" outro → `TEMPLATE_OUTRO`.
  - "bi tráng" → `CLICHE`.
  - The repeated hook → `HOOK_REPEATED`.
  - A clean hand-written fixture → no findings.
- Executor with the mock LLM:
  - lint findings reach the review prompt;
  - leftover findings are saved as `[lint]` notes;
  - with review off, the lint still runs and no LLM call is added.
- Existing script, scene and TASK-130 tests stay green.

## Done

- [ ] recipe guidance in the writer, merged and review prompts
- [ ] `narrationRules.ts` shared by all three prompts
- [ ] `lintNarration` + cliché lists + thresholds; wired before and after review
- [ ] reviewer criteria rewritten
- [ ] tests; shared and server suites; typecheck
- [ ] ARCHITECTURE, user guide, featureMap if needed, changelog, skill update
- [ ] report → `docs/tasks/TASK-144.report.md` and `docs/tasks/TASK-144.done`
