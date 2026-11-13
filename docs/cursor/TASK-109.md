# TASK-109 — Style system, part 2: store style packs and video looks 🗄

**Who:** Cursor, model `grok-4.7-medium` (a migration plus repositories, with clear tests). **Size:** M. **Order:** now, after TASK-108. **DB change:** yes. Generate it with `npx drizzle-kit generate` in `apps/server`; never write it by hand.

Read first:
- `docs/cursor/README.md`
- `docs/architecture/style-system.md` (the "Database" section is the spec)
- `docs/tasks/TASK-108.report.md`
- `apps/server/src/compose/render/graphicStyle.ts`
- `packages/shared/src/style/pack.ts`, `picker.ts` (`LookHistory`, `lookHistoryEntry`) and `sameness.ts` (`buildVideoLook`, `VideoLookSchema`)

## Why

TASK-108 resolves a style for every video, but nothing is stored:

- a channel has no style pack of its own (it falls back to a brand pack built per project);
- the variant picker gets an empty history, so it cannot rotate looks across a channel's videos;
- there is no record that a later sameness check (TASK-113) can compare.

## What to do

1. **Tables** in `apps/server/src/db/schema.ts`, following the spec in the design doc:
   - `style_packs`:
     - one row per version: `id`, `version`, `name`, `origin` (json), `seed`, `tokens` (json patch), `created_at`
     - primary key `(id, version)`
     - insert only, never update
   - `profiles.style_pack_id` (nullable text): the pack id, not a version.
   - `video_looks`:
     - columns: `id`, `project_id`, `render_id`, `profile_id` (nullable), `pack_id`, `pack_version`, `fingerprint`, `look` (json, `VideoLookSchema`), `created_at`
     - an index on `(profile_id, created_at)`
2. **Repository and service** in `apps/server/src/style/` (new folder):
   - Packs: `getPack(id, version?)` returns the latest when no version is given; `savePack(pack)` inserts a new version through `reviseStylePack` and does nothing when the fingerprint is unchanged; `listPacks()`.
   - Profile link: `packForProfile(profileId)`. The first time a profile with no pack renders, create and link a pack:
     - from the profile's brand colour, if it has one (`stylePackFromBrand`);
     - otherwise from a preset in `STYLE_PRESETS`, chosen so that this user's profiles use different presets while unused ones exist.

     That way two new channels never start with the same look.
   - Looks: `recordLook(...)` builds the row with `buildVideoLook` and inserts it. `lookHistory(profileId, window)` returns the newest rows as `LookHistory` for the picker.
3. **Use them in the render:**
   - In `prepareGraphicStyle`, the pack comes from the profile (`packForProfile`), then the project brand pack, then none.
   - The picker gets `lookHistory(profileId, DEFAULT_VARIANT_WINDOW)`.
   - Record the pack id and version used for the render in its report (`renders.report.compose.style` or a similar existing place), so an old render can be rebuilt with the same look.
   - After a render finishes (`renderService`, next to the originality recheck), call `recordLook`:
     - Frame hashes come from frames the render already writes (the `thumbs` folder) using the existing dHash/pHash code in `packages/shared/src/visuals/phash.ts`. If computing them is not cheap or not possible there, store an empty list and say so in the report.
     - Recording must never fail the render. Catch, log one warning, continue (same pattern as `recheckOriginalitySafely`).
   - A reused render (the cache hit path) does not record a second look.
4. **Read-only API** (the full editor comes in TASK-111): `GET /api/style/presets`, `GET /api/profiles/:id/style-pack` (pack plus resolved tokens) and `GET /api/profiles/:id/looks?limit=`. Follow the existing route style in `apps/server/src/api/`, and register the routes in the shared tool registry only if the other profile routes are registered there.

## Rules

- No commit or push. No new npm dependency. Migration only through `npx drizzle-kit generate`.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `apps/server/src/pipeline/**`, `apps/server/src/jobs/**`, `apps/server/src/originality/**`, `apps/server/src/publishing/**`, `apps/server/assets/compose/**`.
- Change `packages/shared/src/style/` only to fix a bug; list each change in the report.
- Tests: no network, no real LLM, no real browser. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- Tests:
  - pack versioning (a new version only when the look changes)
  - profile pack auto-create, including distinct presets for two new profiles
  - the history fed to the picker making the second video of a channel pick a different combination from the first when another one exists
  - `recordLook` failure not failing the render
  - no look recorded on a cache hit
  - the three GET routes
- `npm run typecheck` at the root; `npm test` in `packages/shared` and `apps/server`. Failures outside your area: list them with the file.
- One line in `docs/user-guide/nhat-ky-thay-doi.md`. Update the "Database" section of `docs/architecture/style-system.md` from "later" to what was built.
- Write `docs/tasks/TASK-109.report.md` in Vietnamese, at most 40 lines:
  - the migration file name
  - what is stored and when
  - the frame hash source
  - test results
  - the reminder that the user must restart the app so the migration runs
- Then create the empty `docs/tasks/TASK-109.done`.
