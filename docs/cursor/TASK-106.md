# TASK-106 — Architecture: per-channel style system, genre packs and variant engine

**Who:** Fable (architecture + core). Cursor builds the rest from your design later. **Order:** now. TASK-081 (Cursor) is editing `apps/server/src/compose/hyperframes.ts` and `apps/server/src/compose/render/graphic.ts` at the same time: do not edit those two files.

## The problem (read this twice)

The app makes videos for **many faceless channels in many genres**: news, explainer, listicle, history, finance, travel, how-to, myth vs fact, story, and so on. Today the look is mostly hard-coded:

- The compose templates (`apps/server/assets/compose/{map,compare,quote_full,list_full,…}`) take a brand colour and a variant number. Font sizes, layouts, motion and backgrounds are fixed.
- Format recipes (`packages/shared/src/formats/recipes.ts`, 7 ids) fix the script structure and graphic hints.
- `packages/shared/src/compose/variety.ts` only prevents repeated shot kinds inside one video.

Result: every channel's videos look alike, and adding a genre means editing code. That is bad for two reasons:
1. **Scale:** the user wants to run many channels in many genres without hand-tuning each one.
2. **Income:** YouTube ("inauthentic / reused content") and Facebook (originality update 03/2026) demonetize channels that look mass-produced. TASK-084 already checks scripts, images and titles against the channel's own past videos. It does **not** see visual sameness across videos or across channels.

## Your job

Design the architecture, and build its **core** with tests, so that:

1. **Channel style (style pack).** Each channel/profile has a style pack: palette (with contrast-checked roles), type scale and fonts (Vietnamese diacritics must work), motion personality (easing, speed, entrance types), cut rhythm, layout family, background treatment, subtitle style and safe zones per aspect ratio, and graphic density. Templates read **only** resolved style tokens and no longer hold fixed values. Define how a pack is created (from a few user choices, from an LLM proposal based on the channel niche, or from an existing channel's thumbnails/brand colour) and how it is versioned.
2. **Genre pack.** A declarative unit: which shot kinds and templates it uses, script sections (absorb or wrap `formats/recipes.ts`, do not duplicate it), pacing, graphic hints, and default style hints. Adding a new genre must mean adding data plus optional templates, never editing the director or the renderer core. Say how the director (`apps/server/src/compose/director/`) consumes it.
3. **Variant engine.** Each template exposes declared variation axes (layout, composition, motion, background). A deterministic, seeded picker chooses a variant per shot. It respects the channel style, rotates across the channel's recent videos (no repeat of the same combination within N videos), and stays inside a "brand consistency" band so a channel still looks like itself. QUALITY mode may let the LLM pick among valid variants. ECO uses rules only.
4. **Sameness metric.** A cheap, testable measure of visual sameness: between videos of one channel, and between channels run by the same user. Reuse the existing pHash code (`packages/shared/src/visuals/phash.ts`) on frames you already render, plus the variant combination history. Design how it plugs into the TASK-084 originality report as a new signal. Report the hook point; wire it only if it is small.
5. **Open-source templates.** HyperFrames (Apache-2.0, already installed) has a block/component catalog (`npx hyperframes catalog`, `add`, `docs compositions`). Check offline, from the installed package, what the catalog is and what licence its blocks carry. Design an import path: a third-party block becomes a template only if it declares style tokens and variation axes and carries attribution. Do not import any block in this task.

## What to deliver

- `docs/architecture/style-system.md`: the design. Data model (zod types), the resolution order (genre default → channel pack → per-video override → user shot edit), the module map, extension points, how templates consume tokens, the migration path for the existing templates, and the DB needs. **Do not create a migration:** describe the table or column, and Cursor generates it later.
- Core code with unit tests, in new folders only:
  - `packages/shared/src/style/`: schemas, token resolver, contrast checks, variant axes, seeded picker with rotation, sameness math.
  - `apps/server/src/style/` only if a server piece is needed for the core (for example loading the history).
- **One reference template** converted to tokens and axes: pick `compare` or `list_full`. Show that two style packs give clearly different frames: render one sample of each with the existing sample path (`VG_COMPOSE_SAMPLES=1`) and say where the PNGs are.
- **A split plan for Cursor:** the remaining work cut into tasks, each with its files, tests and difficulty. Examples: convert the other templates, API, settings UI, LLM style proposal, director integration, migration, originality hook. Claude turns it into guides.

## Rules

- No commit or push. No new npm dependency. No migration.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `apps/server/src/compose/hyperframes.ts`, `apps/server/src/compose/render/graphic.ts`, `apps/server/src/pipeline/**`, `apps/server/src/jobs/**`, `apps/server/src/originality/**`, `apps/server/src/publishing/**`.
- Do no pixel polish and no hard-coded fixes. If you see a bug, list it in the report.
- Tests: no network, no real LLM. Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Read files in parts, and grep before you open anything over 300 lines.
- Stop and report if the design needs something this task forbids (a migration, an edit to a fenced file). Do not work around it.

## Report

Write `docs/tasks/TASK-106.report.md`, in Vietnamese and at most about 80 lines:
1. The design in 10 lines.
2. Files.
3. Test results (`npm run typecheck`, the shared tests, the new tests).
4. Where the reference samples are.
5. The Cursor split plan.
6. Open questions for the user.

Then create the empty `docs/tasks/TASK-106.done`.
