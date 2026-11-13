# TASK-101 — Market ladder: transcreate winners into other markets 🌏🔴

**Who:** a new Sonnet 5.5 session (or Codex when the user asks). **Size:** M. **Migration:** yes (`projects.sourceProjectId`, `derivedKind`, `profiles.sourceProfileId`); drizzle-kit only (🗄). **New dependency:** none.
**Depends on:** TASK-084 (originality), TASK-091 (unit economics). **The user creates the target channel** (Claude cannot create accounts).

## Why

A video that works in one market can be **transcreated**, not just translated, for a higher-RPM or larger market: local examples, units, references, voice and a new local research pass. Done badly, it is reused content; the originality gate must check the local part.

## Read first

- `docs/research/markets/*.md` and `markets.json` (market facts and RPM context).
- `docs/ARCHITECTURE-TARGET.md` §3 (`projects`/`profiles` extensions), §4 `list_transcreation_candidates` (read) and `transcreate_project` (confirm, grant `null`).
- The originality service and source manifests (084).

## Build

1. **Candidates.** `list_transcreation_candidates(sourceProfileId, targetProfileId)` lists source videos with good same-window metrics (087) that are not yet transcreated to the target. Each has a reason (metric vs channel median) and the target market's context from the research, marked as reference.
2. **`transcreate_project(sourceProjectId, targetProfileId)`** creates a new project with `sourceProjectId` and `derivedKind: "transcreation"`. It runs:
   - a local research pass for the target market;
   - a script rewrite with a "localize" brief: examples, units, references, idioms, and local sources;
   - the target profile's voice, style pack and identity.

   It never copies the source's visuals blindly. Visual search runs again, and local visuals are preferred.
3. **Originality check.** The manifest records what is new: local facts with sources, changed examples, a new voice, new visuals.
   - The gate requires a minimum "đóng góp riêng" ratio for transcreations. Below it, the project goes to manual review.
   - Cross-channel sameness (113) must be below the threshold against the source.
4. **Web.** The candidates list on the target profile, and the source link on the project page.

## Mã nguồn mở có sẵn (open source)

- Nothing to adopt. Translation-memory ideas (**OmegaT**, GPL — reference only) are not needed, since we rewrite rather than translate.

## Rules

README rules 1–11. Never publish a transcreation without passing the originality gate. Never on the protected project.

## Tests

- candidates by window metrics;
- the project link fields;
- the localize brief in the prompt;
- visuals re-searched;
- the originality ratio rule;
- cross-channel sameness check;
- tool risk.

## Done

- [ ] migration + candidates + transcreate flow + originality rule
- [ ] UI; tools; skill (`video-chien-luoc-kenh`)
- [ ] tests; suites
- [ ] user guide + changelog
- [ ] report → `docs/tasks/TASK-101.done`
