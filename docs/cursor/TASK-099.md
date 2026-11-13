# TASK-099 — New shot kinds: `diagram` and `timeline` 📊

**Who:** Fable designs the two templates (a separate brief); a Sonnet 5.5 session (or Cursor `grok-4.7-medium`) adds the renderer and director rules. **Size:** M. **Migration:** none. **New dependency:** none.
**Depends on:** TASK-070 (shot kinds). Easier after TASK-112: a new kind is enabled per genre by data.

## Why

Explainer and history videos need "how it works" diagrams and dated timelines. Today they fall back to a list or a stock image.

## Read first

- How a shot kind is added end to end:
  - the kind enum in `packages/shared`;
  - the director (`compose/director/kinds070.ts` or the directive-based code after 112);
  - the template and its data schema;
  - `compose/render/`;
  - `labels.ts`;
  - the eval fixtures.
- The style tokens (`tokens-v1`). Templates read only tokens.

## Build

1. **Data schemas:**
   - `diagram`: nodes (≤ 7, short labels), edges (from, to, label?) and layout (flow left-right, cycle, or hub);
   - `timeline`: events (≤ 8; date text, label, an optional image), with the scale chosen by code.
2. **Extraction.** The director detects when to use each kind:
   - `timeline`: ≥ 3 dated events in a scene (code regex for years and dates, then the LLM in QUALITY);
   - `diagram`: process or cause language ("dẫn đến", "gồm", "bước"), detected by the LLM in BALANCED and QUALITY only.

   The LLM fills the schema; code validates it and falls back to `list` on failure.
3. **Templates (Fable):** animated build-up synced to word timings (each node or event appears when it is said), reading tokens, for 16:9 and 9:16.
4. **Genre packs:** enable `timeline` for history and news recap, and `diagram` for explainer and how-to. With 112 this is data only.
5. **Eval:** add fixtures with dated and process scripts.

## Mã nguồn mở có sẵn (open source)

- **Mermaid** (MIT) and **dagre** / **elkjs** (MIT/EPL) are references for graph layout. With ≤ 7 nodes, a fixed layout per mode is enough; copy the layout ideas only. Do not add a dependency unless the guide is updated.
- **TimelineJS** (MPL-2.0) is a reference for the timeline layout.

## Rules

README rules 1–11. Do not change other templates or `tokens-v1`.

## Tests

- schema validation and the fallback;
- the detection rules;
- word-synced appear times;
- both aspects render (still frames);
- genre enablement;
- the eval does not drop.

## Done

- [ ] schemas + detection + templates + renderer + genre data
- [ ] eval fixtures; tests; suites
- [ ] samples in `docs/compose/samples/`; user guide + changelog
- [ ] report → `docs/tasks/TASK-099.done`
