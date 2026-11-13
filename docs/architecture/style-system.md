# Style system

Per-channel look for compose graphics (TASK-106, wired in TASK-108). Templates read resolved tokens. They do not hold their own colours, type sizes, or timings. Adding a genre is data. Adding a template is a folder plus a manifest.

Code lives in `packages/shared/src/style/`. The server wiring is `apps/server/src/compose/render/graphicStyle.ts`. Schemas are the source of truth; this file does not copy them.

## Data model

| Piece | Schema | File |
|---|---|---|
| Tokens and a partial patch | `StyleTokensSchema`, `StyleTokensPatchSchema` | `tokens.ts` |
| Palette seed and roles | `PaletteSeedSchema` | `palette.ts` |
| Font spec | `FontSpecSchema` | `fonts.ts` |
| Versioned channel pack | `StylePackSchema` | `pack.ts` |
| Genre (recipe, director hints, style patch) | `GenrePackSchema` | `genre.ts` |
| Template manifest and one axis | `TemplateManifestSchema`, `TemplateAxisSchema` | `axes.ts` |
| One rendered video's look | `VideoLookSchema` | `sameness.ts` |

A pack is a named patch over `BASE_STYLE_TOKENS`, plus `id`, `version`, `origin`, and an optional `seed`. `reviseStylePack` bumps `version` only when the fingerprint changes. `stylePackFingerprint` hashes the merged tokens, not the name.

Three ways to build a pack, all in `pack.ts`:

- `stylePackFromChoices` — a preset plus a few user choices.
- `stylePackFromProposal` — an LLM object. A group that fails validation is dropped.
- `stylePackFromBrand` — one or more colours the channel already uses.

`STYLE_PRESETS` (`classic`, `newsroom`, `paper`, `neon`, `studio`) are starting data, not stored rows.

A genre points at a format recipe (`recipe.ref` into `formats/recipes.ts`) or carries an inline recipe of the same shape. It does not copy the script structure. `genreDirectives` is what a director should read: opening, disabled and forced kinds, template folders, pacing, LLM notes.

## Resolution order

`resolveStyle` in `resolve.ts` merges layers, later wins, field by field inside each group:

**base → genre → channel pack → per-video override → shot edit**

`video` and `shot` are null until a later task stores them. The result is concrete for one frame: pixels, seconds, hex colours, GSAP ease names. `templateStyle` drops `tokens` and `issues` and adds the shot's `axes`. That object is `variables.style`.

`styleAspect` maps the frame to `16:9`, `9:16`, or `1:1`. Safe zones and the type ramp follow that aspect.

## What the render does

Once per video, `prepareGraphicStyle`:

1. Genre patch: `genrePack(recipeId).style`. The recipe id is `settings.format`, then `settings.treatment.formatId`, then `explainer`.
2. Pack: the profile pack from `packForProfile` when the project has a profile, otherwise `stylePackFromBrand({ id, name: "brand", colors: [brand, accent] })` when the brand colour is hex, otherwise null. The schema rejects `:`, so a project brand id is `project-` plus the project id, not `project:`. A profile pack id is the profile id.
3. `resolveStyle(layers, { width, height })`.
4. `pickVariants` with seed `` `${profileId ?? "none"}|${projectId}` ``, every graphic shot, the merged tokens, the aspect, and `pack.seed ?? pack.id` (or `"base"`). History is `lookHistory(profileId, DEFAULT_VARIANT_WINDOW)`. A value already on the shot (`sourceField` on the axis, today `highlight` and `marker` on `list_full`) is passed as `pinned` and kept.

`renderService` stores that on the compose context as `videoStyle` and copies `fingerprint` plus each shot's `axes` into the clip hash. `renderComposedScene` does the same for the scene cache. The HyperFrames file cache hashes the whole `variables` object, so the per-shot file also changes when the style or the axes change. An unchanged style reuses the cache.

`graphicVariables` sets `variables.style` to `templateStyle(resolved, pick.axes)`. It still sets `brandColor`, `accentColor`, and `colors` from `graphicColors`. `common.js` paints the ground from `style.color` when the object is present, and picks the background treatment from the `background` axis. Kinetic and compare keep their string style on `shotStyle`.

If a caller has no video plan, `graphicVariables` resolves that one shot the same way. `list_full` has `fallbackListStyle`, and `common.js` has `fallbackStyle`, so a direct open with no `variables.style` does not throw. Real renders take the server path.

## Module map

| Module | Role |
|---|---|
| `color.ts` | Hex, mix, WCAG contrast |
| `palette.ts` | Seed colours to roles, contrast repair |
| `fonts.ts` | Registry. Unknown or non-Vietnamese families fall back to Be Vietnam Pro |
| `tokens.ts` | Base tokens, merge, diff |
| `pack.ts` | Packs, presets, fingerprint |
| `resolve.ts` | Layers to a frame, `templateStyle`, `styleRhythm` |
| `axes.ts` | Manifests, `axisChoices`, import checks, token lint |
| `picker.ts` | Seeded picks, rotation, `variantOptions` for a later LLM choice |
| `genre.ts` | Genre packs over the format recipes |
| `sameness.ts` | Visual sameness between videos and between channels |
| `graphicStyle.ts` | The server call that runs the steps above |

`apps/server/assets/compose/common.js` is the template runtime: `VG.S`, `VG.axis`, `VG.enter`, `VG.alpha`, `VG.fallbackStyle`.

## tokens-v1

A manifest sets `contract: "tokens-v1"` or `"legacy"`. Every template in `TEMPLATE_MANIFESTS` (`axes.ts`) is tokens-v1.

The template reads `VG.S` for colour, type, space, and shape, and `VG.axis(name, allowed, given)` for a variant. A value already on the shot source wins, then the pick, then the first allowed value. Motion goes through `VG.enter` and `S.motion`. Numbers left in the file are layout ratios of that design. When `variables.style` is missing, `list_full` uses its own `fallbackListStyle` and the other templates use `VG.fallbackStyle`.

`entrance` and `background` are the shared axes on every manifest. Own axes:

| Template | Own axes |
|---|---|
| `list_full` | `layout` (rows, cards, rail), `title` (bar, underline, tag). `highlight` and `marker` are content axes with `sourceField`, so the director's choice is pinned. |
| `compare` | `layout` (split on 16:9 and 1:1, stack on every aspect), `join` (badge, divider). The shot style string stays on `shotStyle`. |
| `quote_full` | `layout` (center, mark). The reveal stays on the shot. |
| `kinetic_text` | `chrome` (plain, bar, rule). bold, typewriter and stack stay on `shotStyle`. |
| `chart` | `frame` (bleed, card). bar, line and pie stay on the shot. |
| `map` | `label` (plate, float). zoom and highlight stay on the shot. |

`templateTokenLint` rejects a tokens-v1 file that still contains a hex colour, a GSAP ease, a numeric tween duration, a numeric font weight, a px font size, or a fixed font family.

## Add a genre

A genre is data. Add one object to `BUILTIN` in `genre.ts` (or parse a `GenrePack` from JSON) and the director reads it. Nothing under `apps/server/src/compose` compares a recipe id. A test greps the folder for `recipeId ===` and `recipeId !==` to keep it that way.

What to set, and only where the genre should differ from the defaults:

- `recipe`: `{ ref }` to an existing recipe, or an inline recipe.
- `director.opening`: `list` makes the first scene a list card.
- `director.kinds.<kind>`: `enabled: false` turns a graphic kind off, `force: true` keeps it on, `templates` names the template to use.
- `director.compareFallback`: `true` gives a compare card to a claim scene with no compare cue (`myth_vs_fact` does this).
- `director.llmNotes`: lines added to the QUALITY director prompt.
- `pacing`: `preset` and `paceScale`.
- `style`: a patch over the resolved style tokens.

The director builds the directives once per project with `directivesForRecipe(recipeId, genres)`. An id that is not a pack falls back to `explainer`. The example `top_facts` is a pack with no recipe of its own: it changes the plan only through `listOpening` and `llmNotes`, with no code edit.

In QUALITY mode the director's single LLM call may also choose among picker options (`variantOptions`, at most 4 per graphic shot, rule pick first) through an optional `variants` field in the answer. A valid letter is applied with `applyVariantChoices`; an invalid one keeps the rule pick. The compose plan records the shots that used an LLM choice in `llmVariantChoices`. ECO and BALANCED keep `pickVariants` alone and the prompt has no extra field.

## Add a template

1. Add `apps/server/assets/compose/<id>/index.html`. It loads `common.js` and reads `VG.S`.
2. Add a manifest under `TEMPLATE_MANIFESTS`: `contract: "tokens-v1"`, at least one own axis with two values (layout or composition), and the shared `background` axis.
3. `templateTokenLint` returns no lines.
4. The shot kind is either an existing graphic kind or a new one wired through the director. The renderer uses `shot.source.kind` as the folder name.

## Third-party HyperFrames blocks

`templateImportProblems` is the gate. An empty list means the block may be added. It must:

- parse as a manifest with `contract: "tokens-v1"`;
- declare at least one own layout or composition axis with two values;
- include the shared `background` axis;
- for `origin: "third_party"`, carry `name`, `author`, `sourceUrl`, `commit`, and a licence in `PERMISSIVE_LICENSES` (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0).

Keep the licence header and the source URL in the file. Run `templateTokenLint` on the HTML. Do not copy GPL, AGPL, or unlicensed blocks. No block is imported by this system yet; HyperFrames itself is already a dependency (Apache-2.0).

## Database

Built in TASK-109. The migration is `apps/server/drizzle/0064_style_packs.sql`. Restart the app so it runs.

- **`style_packs`**. One row per version: `id`, `version`, `name`, `origin` (json), `seed`, `tokens` (json patch), `created_at`. Primary key `(id, version)`. Rows are inserted, not updated. `savePack` calls `reviseStylePack` and skips the insert when the fingerprint is unchanged. `getPack(id)` is the latest version.
- **Profile link.** `profiles.style_pack_id` stores the pack id, not a version. The first compose render of a profile with no pack calls `packForProfile`. A colour other than the default swatch `#3B82F6` becomes `stylePackFromBrand`. Otherwise the profile gets the first `STYLE_PRESETS` entry no other profile pack is using, then the least used one. The version used for a video is stored on `video_looks` and on `renders.report.compose.style`, so an old render can be repeated.
- **`video_looks`**. One row per finished render that was not a cache hit: `id`, `project_id`, `render_id`, `profile_id` (nullable), `pack_id`, `pack_version`, `fingerprint`, `look` (json, `VideoLookSchema`, including combos and frame hashes), `created_at`. Index `(profile_id, created_at)`. `lookHistory(profileId, window)` reads the newest rows as `LookHistory` (`window` defaults to 5). A failure while recording is logged and does not fail the render.

Frame hashes are the dHash of JPEG files the render already wrote in that version's `thumbs` folder (`hashImage` → `dHashFromGray`). A thumb that is not a JPEG is skipped. If hashing fails, the row is still stored with an empty `frameHashes` list.

`video` and `shot` token patches can be columns on the project and on the shot once an editor exists. They are already arguments of `resolveStyle`.

## Director and originality

**Director.** `genreDirectives(pack)` and `directivesForRecipe(recipeId)` are the extension point. `styleRhythm` returns the edit preset and pace scale the pacing code should use. `variantOptions` plus `applyVariantChoices` is the QUALITY path: the model may pick only among keys the rules already allow. ECO stays on `pickVariants` alone. None of that is called from the director yet.

**Originality.** `visualSameness` scores two `VideoLook` values. Inside one channel the style term is left out (a channel is supposed to match itself). Between channels it carries weight. `buildVideoLook` is the row stored in `video_looks` after a finished render (TASK-109). The sameness score is not wired into the publish gate yet, and `apps/server/src/originality/` is unchanged.
