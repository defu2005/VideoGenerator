# TASK-141 — Director continuity pass: one look and pace for the whole video 🎬🧭

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M. **Migration:** none (the plan is stored as a stage artifact or JSON on the existing scene-plan row). **New dependency:** none.
**Depends on:** 070 (genre director, `compose/director/*`), 077 (relevance gate), 109/111 (style profile, `style/*`), 139 (preview facts, optional input). It may run beside 140. It does not edit `operator/quality*`, `operator/autonomy.ts`, `node/*` or `providers/llm/*`.
**Source:** RESEARCH-076 P1 "director pass for continuity" and [SCALE-PLAN.md](SCALE-PLAN.md) row 7.

## Why

- Every scene picks its visual alone. The relevance gate (077) checks that a scene matches its text. Nothing checks that scene 4 looks like the same video as scene 3.
- The result at volume:
  - mixed colour temperatures;
  - a different "main character" face in each shot;
  - random cut rhythm;
  - recurring motifs dropped.
- Viewers and platforms read that as low-effort, mass-produced content.
- A short plan written once, before visual search, and checked once after selection, fixes most of it cheaply.

## Read first

- `compose/director/*` (`llm.ts`, `kinds070.ts`, genre rules), `services/visualService.ts` (search queries, 077 gate, selection), `agents/visualToolkit.ts`.
- `style/*` (style profile, palette extraction, `frames.ts`), the scene plan schema in `packages/shared`.
- `stages/*` order: SCRIPT → SCENE_PLAN → VISUAL_SEARCH → VISUAL_REVIEW.

## Build

### 1. Continuity plan (one LLM call, after SCENE_PLAN)

- `buildContinuityPlan(projectId)` → `ContinuityPlan` (zod schema in `packages/shared`):
  - `characters[]`: `{ id, description, appearsInScenes[], referenceQuery }` (who must look the same);
  - `palette`: `{ temperature: warm|neutral|cool, saturation: low|mid|high, dominantHues[] }`, seeded from the channel style profile when one exists;
  - `pacing`: target shot length per section (hook, body, outro) in seconds;
  - `motifs[]`: `{ id, description, scenes[] }` (recurring visual ideas, max 3);
  - `avoid[]`: things that break the look (e.g. "no cartoon in a documentary").
- One LLM call through the normal provider path (OmniRoute, TASK-136 rules). Input: script, scene plan, channel style, genre. Output validated with zod; one repair retry on invalid JSON, then fall back to an empty plan and say so (the pipeline never blocks on it).
- Store it with the scene plan (JSON field or stage artifact). It is part of `inputVersion` for VISUAL_SEARCH, so editing it invalidates search the normal way (134).

### 2. Use it in search and selection (code)

- Visual search adds the character `referenceQuery` and palette words to the scene query where the scene lists that character or motif. Keep the original query as the first query; the plan only adds candidates.
- Selection scoring adds a continuity term, computed in code:
  - colour distance of the candidate's average Lab colour to the plan palette and to the previous selected scene;
  - shot length versus the pacing target.
  - The weight is a setting (default small). It never overrides the 077 relevance gate or licensing.

### 3. Continuity check (after selection, before VISUAL_REVIEW)

- `checkContinuity(projectId)` (code first):
  - colour jumps between neighbour scenes over a threshold;
  - pacing outside ±40 % of the target;
  - a motif scene without its motif tag.
- Character consistency only when a vision model is configured: one batched vision call with the selected frames of the scenes that list a character. Otherwise skipped and said so, never guessed.
- Output: `findings[]` with scene ids and a suggested fix (re-search with the reference query, swap with the next candidate). Shown on the visual review page, given to 121 repair as input, and to 140 as a `continuity` dimension when 140 exists (if 140 is not merged yet, expose a function 140 can read).

### 4. UI and tools

- Scene plan page: a "Định hướng hình ảnh" card that shows and edits the plan (characters, palette, pacing, motifs).
- Visual review page: continuity findings with "Tìm lại cảnh này" per finding.
- Tools `get_continuity_plan`, `check_continuity` (read-only); edits go through the existing scene-plan edit tool so the audit and gates apply.

## Mã nguồn mở có sẵn (open source)

- **OpenReels** (RESEARCH-076): a "director" step before asset search. Idea only.
- **colorthief / node-vibrant** ideas: average and dominant colour. Write the small Lab average in code with `sharp` (already a dependency); do not add a package.
- **ShotDeck-style pacing tables**: shot length by genre. Idea only; numbers live in the genre rules of 070.

## Rules

- README rules 1–11. No migration.
- The plan only adds signals: it never removes the relevance gate, licence checks or user selections. A user's manual pick is never changed by continuity.
- Tests: mock LLM and vision, fixture images, no network.

## Tests

- Plan: valid JSON stored; invalid JSON → one retry → empty plan with a note; the pipeline continues.
- Editing the plan changes VISUAL_SEARCH `inputVersion`.
- Search adds reference queries only for the listed scenes; the original query stays first.
- Selection: between two equally relevant candidates the one closer to the palette wins; a less relevant one never beats the 077 gate.
- Check: a fixture with a warm → cool jump and a too-long shot gives both findings; no vision model → character check skipped with a reason.
- Manual picks unchanged.

## Done

- [ ] plan schema + builder + storage + `inputVersion`
- [ ] search and selection integration; continuity check
- [ ] UI (plan card, findings); tools
- [ ] tests; shared + server + web suites; typecheck; build
- [ ] `docs/ARCHITECTURE.md` (pipeline), user guide, changelog
- [ ] report → `docs/tasks/TASK-141.done`
