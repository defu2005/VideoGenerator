# TASK-096 — Thumbnails from templates 🖼️

**Who:** Fable designs 3–4 thumbnail layouts as HyperFrames templates (a separate brief); a Sonnet 5.5 session (or Cursor `grok-4.7-medium`) wires them. **Size:** M. **Migration:** none expected. **New dependency:** none.
**Depends on:** TASK-095 (the thumbnail concept and `thumb_layout` pattern).

## Why

Thumbnails today are a frame grab or a simple overlay. The packaging step (095) now has a thumbnail concept and layout. They should render as branded, readable thumbnails, in several variants for Test & Compare.

## Read first

- The thumbnail code (`video-render-va-thumbnail` skill and its server path).
- The style system: `packages/shared/src/style/` tokens and packs (TASK-106–111), and how TASK-108 renders HyperFrames stills.
- The `thumb_layout` pattern kind (094).

## Build

1. **Layouts (Fable):** for example big face or subject + 3-word title, split before and after, number + object, question. Each is a HyperFrames still template reading `tokens-v1` (colours and fonts from the channel pack), 1280×720, with safe zones for the YouTube timestamp.
2. **Inputs:** the subject image (the best-scored visual of the project, or a frame), the title words (≤ 4, from the package, shortened by code or the LLM), and the pack.
3. **Variants:** render N variants (layout × image × wording, N from a TASK-088 param, default 3).
   - Code checks the text size at 160 px wide (mobile), the contrast via `resolveStyle`, and that faces or subjects are not cut by the safe zone.
   - Failing variants are dropped, with a reason.
4. **Choice:** the project page shows the variants. The user picks one, or the first is used in auto mode within the grant. The rest are kept for a Studio Test & Compare request (092b).
5. **Tool:** extend the thumbnail tool with `variants` and `layout`. Update the skill.

## Mã nguồn mở có sẵn (open source)

- **Satori** (MPL-2.0) and **@vercel/og** are references for HTML-to-image text fitting. We already have HyperFrames stills; use those.
- A **text-fit** algorithm (binary search on font size) as in `textFit` (MIT). Copy with credit if needed.

## Rules

README rules 1–11. No face or celebrity image that the visual licence step did not clear. No misleading text that the script does not support (the promise gate).

## Tests

- each layout renders with a fixture pack;
- the mobile text-size check;
- contrast drop;
- safe zone;
- variant count;
- auto choice only within the grant.

## Done

- [ ] layouts (Fable) + wiring + checks + variants
- [ ] project page choice; tool; skill
- [ ] tests; suites
- [ ] user guide + changelog + sample thumbnails in `docs/compose/samples/thumbs/`
- [ ] report → `docs/tasks/TASK-096.done`
