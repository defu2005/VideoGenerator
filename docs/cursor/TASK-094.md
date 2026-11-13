# TASK-094 — Pattern library: hooks, titles, recipes, music arcs as data 🧩

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). Fable writes the starter hook and title pattern set as a data file (a separate brief). **Size:** M. **Migration:** yes (🗄); drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-088. Genre packs (TASK-106/112) already show the data-driven style.

## Why

- Format recipes, edit presets, hook styles and title formulas are scattered in code and prompts.
- The Lab (092) needs a named, versioned "pattern" to test.
- The playbook (093) needs a pattern id to point at.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 `creative_patterns`, §4 group `patterns`.
- The existing format recipes, edit presets and genre packs (`packages/shared/src/style/genre.ts`): genre packs **stay**. A `format_recipe` pattern references a genre pack id; it does not copy it.
- `video_genes.patternIds` (TASK-089).

## Build

1. **Table** as in §3:
   - kind (`hook|title|format_recipe|music_arc|thumb_layout|package`), name, version, `profileId?` (null = global);
   - spec, validated by a Zod schema **per kind** in `packages/shared/src/patterns/`;
   - origin (builtin, fable, agent or user), sourceRef, and status (`draft|trial|active|retired`).
2. **Builtins.**
   - Move the existing recipes and presets into builtin patterns via a seed (not a hand-written migration: a code seed that runs on startup if missing).
   - Behaviour must not change; a snapshot test proves it.
3. **Use.**
   - The script and packaging stages pick hook and title patterns: in QUALITY by the LLM from the active list, otherwise by rule.
   - The ids used go into `video_genes.patternIds`.
4. **Stats.** `get_pattern_stats(id)` is computed at read time from genes × metrics (same window): n, the median metric, and the CI. It is not stored.
5. **Tools:**
   - `list_patterns`, `get_pattern_stats`: read;
   - `propose_pattern`: safe, creates a `draft`;
   - `trial_pattern`: confirm, through `create_experiment` (092b).
6. **Web.** A "Mẫu" page: browse by kind, see the spec and stats, and approve drafts.

## Mã nguồn mở có sẵn (open source)

- Fable's set is ours. For hook and title formula **ideas**, public lists such as Copyhackers' headline formulas can be cited as sources. Never copy a list verbatim; restate it.

## Rules

README rules 1–11. The agent cannot activate a pattern, only propose it and trial it inside the Lab cap.

## Tests

- spec validation per kind;
- the builtin seed is idempotent;
- the behaviour snapshot;
- QUALITY pick from the active list only;
- gene ids are recorded;
- stats with `insufficient_data`.

## Done

- [ ] table + schemas + builtin seed (no behaviour change)
- [ ] use in script and packaging; genes link; stats; tools; page
- [ ] tests; suites; migration
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-094.done`
