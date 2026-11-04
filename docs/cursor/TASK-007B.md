# TASK-007B — Cursor guide

Read `docs/cursor/README.md` first. Spec: `docs/tasks/TASK-007B.md` (Vietnamese, short; read it fully). The spec is only notes, so this guide defines the scope.

## Scope (this task)
Add these image providers. Each one is **off when its key is missing** and shows "thiếu key" in settings.

| Provider | Key env | Notes |
|---|---|---|
| Pixabay (images) | `PIXABAY_API_KEY` | Download to local (no hotlink). License `PIXABAY` (add to `LicenseSchema` if missing) |
| Unsplash | `UNSPLASH_ACCESS_KEY` | **When the user or pipeline selects** an Unsplash image, call its `download_location` once (track it). Attribution "Photo by X on Unsplash" with links |
| NASA Image and Video Library | none | `images-api.nasa.gov/search?media_type=image`. Mostly public domain; keep `photographer` / `center` in the attribution |
| The Met Open Access | none | Only `isPublicDomain: true` → CC0. The search returns ids only, so fetch the objects with a cap (e.g. 10 per query) |
| Library of Congress | none | Only items whose rights text says "No known restrictions" |
| Smithsonian Open Access | `SMITHSONIAN_API_KEY` (api.data.gov) | Only `usage.access = CC0` |
| Europeana | `EUROPEANA_API_KEY` | `reusability=open` |
| Flickr | `FLICKR_API_KEY` | Only CC/PD license ids. Map each id to `LicenseSchema` |

**Out of scope:** Pexels/Pixabay **video** clips (B-roll needs timeline and render changes; that is a later task) and advanced watermark detection.

## File map
- **Providers:** `apps/server/src/providers/images/`. Copy the pattern of `pexels.ts` / `openverse.ts` / `wikimedia.ts`: `types.ts` (`ImageSearchInput`), `http.ts` (rate limiter, timeout, cache), and `registry.ts` (registration, enabled state).
- **Config:** `apps/server/src/lib/config.ts` and `.env.example`. Add the keys plus `IMAGE_SEARCH_PER_MINUTE_<NAME>` like the existing ones. **Do not touch `.env`.**
- **License:** `packages/shared/src/schemas/` (find `LicenseSchema`). Licenses are metadata, never a hard block. Unknown means `UNKNOWN` with the source link.
- **Topic routing (0 LLM):** a pure function in shared, e.g. `packages/shared/src/visuals/sourcePriority.ts`, `preferredSources(project, scene)`, using keyword rules on topic, style and scene text:
  - space/science → NASA first;
  - history/art → Met, LoC, Smithsonian, Europeana;
  - everyday life → Pexels, Unsplash, Pixabay;
  - otherwise the current order.

  It only changes the provider **order and per-provider limit**, never removes providers. Use it where the visual search picks providers (`visualService.ts` / `stages/visuals/`).
- **Unsplash download ping:** hook it into `VisualService.selectCandidate` (and the AUTO preselect path) for `provider === "unsplash"`. Store "pinged" on the candidate so it fires once. Failure only logs a warning.
- **Settings UI:** a "Nguồn ảnh" section (find the settings page): one row per source with an on/off switch, key status (configured / thiếu key, **never show the key**) and requests per minute. Store on/off in app settings.
- **Tests:** one HTTP fixture file per provider in `apps/server/test/fixtures/`, plus tests for:
  - mapping to candidates and licenses;
  - license filtering (Met non-PD dropped, Flickr non-CC dropped, LoC restricted dropped);
  - the Unsplash ping on select (once);
  - the priority function;
  - a disabled provider being skipped.

  No real network.

## Steps
1. Shared: license values, the priority function, tests.
2. Server: one provider at a time (provider + fixture + test), then registry/config/env example, the Unsplash ping, and the settings API for on/off.
3. Web: the "Nguồn ảnh" settings section + test.
4. **Optional live check:** only for providers that need no key (NASA, Met, LoC), on a throwaway project. **Never use project `56374fb2-54cf-48ff-9441-2e6c653295d4`.**
5. Run the README done checklist, then write the report (list which providers were live-checked) and the `.done` file.
