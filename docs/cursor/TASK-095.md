# TASK-095 — Package first, write second: the PACKAGING step 📦

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). Fable writes the scoring prompt and rubric (a separate brief). **Size:** M. **Migration:** yes (🗄); drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-094 (title, hook and package patterns).

## Why

Top channels decide the title, thumbnail concept and hook **before** writing; the script then has to deliver that promise. Today the script is written first and the title is an afterthought.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 `topic_packages`, §4 group `packaging`.
- The pipeline stage list and how a stage is added: `packages/shared` stage enum, `jobs/worker.ts`, the review gates. Also how TASK-018 review chat and the gates interact.
- The script prompt and score code.

## Build

1. **Stage `PACKAGING`**, between the topic and SCRIPT stages.
   - `generate_packages` makes 3–5 candidates: title, thumbnail concept (a text description + layout pattern id), hook line, the promise (one sentence: what the viewer will get) and the pattern ids. The count is a TASK-088 param.
   - Each is scored by code (title length, keyword, clash with recent titles) plus an LLM rubric in BALANCED and QUALITY.
2. **Choice.**
   - `choose_package`: confirm, grant `topics`. In auto modes within the grant, the top-scored package is chosen; otherwise a review gate shows the candidates.
   - The chosen package is stored in `topic_packages` with `chosenBy`.
3. **SCRIPT constraint.** The script prompt gets the chosen package as a hard brief.
4. **"Trả đủ lời hứa" gate.**
   - After SCRIPT, one LLM check (or code-only in ECO: keyword coverage) asks whether the script delivers the promise and the hook.
   - A fail goes back to SCRIPT once with the reason, then to manual review. There is no endless loop.
5. **Published videos.** `update_packaging(publicationId, title|thumb)`: confirm, grant `null`. It keeps the old values and opens a measurement window (087) for a before and after comparison.
6. **Web.** A packaging card on the project page: the candidates, scores, the chosen one, and the promise check result.

## Mã nguồn mở có sẵn (open source)

- Nothing to adopt. YouTube's own "Test & Compare" covers live title tests (manual, see 092b).
- For the title clash check, reuse the n-gram or embedding similarity we already have in `knowledge/` or originality.

## Rules

README rules 1–11. Adding a stage must not break resumable jobs: existing projects already past SCRIPT skip PACKAGING (test this). Never on the protected project.

## Tests

- the stage order and the skip for old projects;
- candidate count and scoring;
- auto choice only within the grant;
- the script prompt contains the package;
- the promise gate's single retry then review;
- `update_packaging` keeps the old values;
- ECO code-only.

## Done

- [ ] stage + table + generate/score/choose
- [ ] script constraint + promise gate
- [ ] update_packaging + card
- [ ] tests; suites; migration
- [ ] user guide (pipeline page) + featureMap + changelog
- [ ] report → `docs/tasks/TASK-095.done`
