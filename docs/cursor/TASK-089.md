# TASK-089 — Video genes + retention map 🧬🔴

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M. **Migration:** yes (🗄); drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-070 (learning), TASK-087 (retention curves). TASK-090 is useful (`render_reviews.post_7d`).

## Why

- To learn what works, every video needs a compact, comparable description of its creative choices: its "genes".
- Each retention drop needs to be tied to the exact shot, word and template on screen at that moment.
- TASK-070's learning only looks at whole-video numbers.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 `video_genes` and `retention_curves`.
- `apps/server/src/learning/{features,learningService,loadRows}.ts`: today's features. Genes replace the ad-hoc ones, with the same names where possible.
- The compose plan + word timings + `video_looks` (TASK-109).

## Build

1. **`video_genes`** (project PK, render id):
   - hookKind, format (recipe or genre), paceBand, graphicsMode, musicArc, lengthBand, thumbLayout, packageKind, patternIds (empty until TASK-094), and compose stats (shots, kinds mix, average shot length, text density);
   - made in code at render time and **locked at publish**: a later re-render makes a new row, and the published row stays;
   - define the gene schema in `packages/shared` with a version.
2. **Retention map.** This is computed at read time and not stored. It joins the curve (100 points) × the plan timeline × the word timings and returns, per segment:
   - the time range, retention, and the slope versus the channel's median curve;
   - what was on screen: shot kind, template and text;
   - what was being said.

   It flags the 3 worst drops and the 3 best holds.
3. **Tools:**
   - `get_retention_map(publicationId)`: read, or `insufficient_data`;
   - `compare_retention(publicationIds[])`: read; it aligns curves by relative time and gene differences.
4. **`post_7d` review.** If TASK-090 is done, write a `render_reviews` row of kind `post_7d` with the map's top drops, so the agent's critique has evidence.
5. **Learning.** TASK-070 features read genes. A test checks that the old feature values equal the gene-derived ones for the current fixtures.
6. Update the `video-giu-chan-nguoi-xem` skill to use the map: "điểm rơi ở 0:42 = cảnh list_full, đang nói '…'".

## Mã nguồn mở có sẵn (open source)

- Nothing to adopt for genes; it is our own schema.
- For curve alignment and smoothing, a simple moving median is enough. **simple-statistics** (ISC) is only to be used if it is already in `node_modules`; do not add it.

## Rules

README rules 1–11. The map never invents seconds: it interpolates only between real points and says so.

## Tests

- genes are made at render and locked at publish;
- the map joins correctly on a fixture curve + plan;
- the worst-drop selection;
- `insufficient_data`;
- compare;
- learning equivalence.

## Done

- [ ] genes table + shared schema; map; tools; skill
- [ ] learning reads genes
- [ ] tests; suites; migration
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-089.done`
