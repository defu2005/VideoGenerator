# TASK-111 — Style 4: create and edit a channel's style pack (API, settings page, LLM proposal) 🎨

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** M. **Migration:** none expected; `style_packs` and `profiles.style_pack_id` exist since TASK-109. **New dependency:** none.

## Why

TASK-106 to 110 built the style system:
- tokens, presets and packs live in `packages/shared/src/style/`;
- versioned `style_packs` rows are stored;
- every render records its look.

But the user can only **read** a pack (`GET /api/profiles/:id/style-pack`). A channel gets a preset automatically and nobody can change it. This task lets the user and the agent create a pack in four ways and preview it before it is used.

## Read first

- `packages/shared/src/style/pack.ts`:
  - `STYLE_PACK_ORIGINS` (preset, choices, llm, brand, manual), `STYLE_PRESETS`;
  - `stylePackFromChoices`, `stylePackFromProposal` (it validates LLM output and returns `dropped`), `stylePackFromBrand`, `reviseStylePack`, `stylePackFingerprint`.
- `packages/shared/src/style/{tokens,resolve,palette,color,fonts}.ts`: the token contract (`tokens-v1`), `resolveStyle` with contrast issues, and the font list.
- `apps/server/src/style/service.ts` (`StyleService.savePack`, pack assignment), `apps/server/src/api/style.ts` (three GET routes).
- `docs/architecture/style-system.md` (TASK-108).
- The sample renders in `docs/compose/samples/style/`, and how TASK-108 rendered them. Reuse that path for the preview.
- `apps/web/src/features/profiles/ProfileDetailPage.tsx`: the place for a new "Phong cách" tab. Put the tab in its own file; the page is already 1 400 lines.

## Build

1. **API.** Add these routes in `api/style.ts`. Map permissions in `routePermissions.ts` (append only): reads like profile reads, writes like profile edits.
   - `POST /api/profiles/:id/style-pack/from-preset { presetId }`
   - `POST /api/profiles/:id/style-pack/from-choices { … }`, the same input as `stylePackFromChoices`.
   - `POST /api/profiles/:id/style-pack/from-brand { colors[], presetId? }`
   - `POST /api/profiles/:id/style-pack/propose { note? }`: the LLM proposal, see 2. It returns a **draft** and does not save it.
   - `PUT /api/profiles/:id/style-pack { patch, reason }`: manual token edits through `reviseStylePack`. It saves a new version.
   - `POST /api/profiles/:id/style-pack/preview { pack }`: see 3.
   - `GET /api/profiles/:id/style-pack/versions` and `POST …/revert { version }`. A revert saves the old tokens as a **new** version; never delete rows.

   Every save returns the resolved style and its `issues`, such as contrast. A pack with a blocking issue is refused with a Vietnamese message.
2. **LLM proposal.**
   - Add a new LLM task `stylePack`, routed like the other creative tasks. Its input:
     - the channel niche, market and language;
     - the brand colours, if any;
     - the fingerprints of the packs other channels in the workspace use, so the proposal differs from them;
     - the user's note.
   - The output is validated by `stylePackFromProposal`; show the `dropped` fields to the user.
   - ECO mode: no LLM call. Return the nearest preset that no other channel uses, and say so.
   - Cost goes to usage.
3. **Preview.**
   - Render 3 still frames (title card, kinetic text, list or quote) with the pack, at the profile's aspect.
   - Use the same HyperFrames still path TASK-108 used for the samples.
   - Cache by `stylePackFingerprint` + aspect under `data/cache/style-previews/`. If a render fails, return the token swatch only, with a warning; never fail the request.
4. **Web.** Add a "Phong cách" tab on the profile page, in its own component file:
   - the current pack, with swatches, fonts, rhythm and preview frames;
   - four create buttons (preset, choices, brand colours, "Gợi ý bằng AI");
   - a token editor for colours, fonts and rhythm, with live contrast warnings;
   - a version history with revert;
   - a "Giống kênh khác" warning when the fingerprint is near another channel's (reuse `styleSimilarity`).

   Saving asks for confirmation.
5. **Registry tools**, which appear in MCP, the assistant and the operator:
   - `get_style_pack(profileId)`: read;
   - `propose_style_pack(profileId, note?)`: safe, returns a draft;
   - `set_style_pack(profileId, pack|presetId, reason)`: confirm. Add a `TOOL_GRANTS` row: grant `null` (always pending), until the user decides.

   Cover the tools in a `video-*` skill, or the coverage test fails.

## Mã nguồn mở có sẵn (open source)

- **culori** (MIT) or **chroma-js** (BSD/Apache): check first whether `packages/shared/src/style/color.ts` already wraps one. If it is hand-written and correct, keep it; do not add a library.
- **Material Color Utilities** (Apache-2.0) is the reference for building a palette from one brand colour (tonal palettes). Copy the algorithm idea only if `palette.ts` lacks it, and credit it in a comment.
- **Radix Colors** and the WCAG 2.2 contrast formula are the reference for contrast checks. They are probably already in `resolve.ts`; check.
- Report a better open-source "brand kit" generator if you find one (README rule 11); do not add it.

## Rules

- README rules 1–11. Do not change the `tokens-v1` contract or the templates; the templates are TASK-110's work, and it is done.
- A pack change applies to **future** renders only. Never re-render on your own.

## Tests

- **Server:**
  - each create route saves a version;
  - manual patch and revert make new versions;
  - a contrast-blocked pack gets 400;
  - ECO `propose` makes no LLM call and picks an unused preset;
  - the LLM `propose` is validated (inject the call), and `dropped` is returned;
  - the preview cache hits on a second call;
  - the permissions.
- **Web:** the tab renders the pack, create flows call the right routes, the contrast warning shows, and revert works.

## Docs

User guide page on channel style (create it if missing, or extend the profile page doc), `featureMap`, changelog.

## Done

- [ ] routes + permissions + tools + grant row + skill coverage
- [ ] LLM proposal with ECO fallback; preview with cache
- [ ] "Phong cách" tab
- [ ] tests; typecheck, server, shared and web suites
- [ ] user guide + changelog
- [ ] report `docs/tasks/TASK-111.report.md` (with preview screenshots saved under `docs/compose/samples/style/`), then `docs/tasks/TASK-111.done`
