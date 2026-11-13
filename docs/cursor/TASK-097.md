# TASK-097 — Pattern interrupts + music that follows the story arc 🎵

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). Fable writes the director rules (a separate brief). **Size:** M. **Migration:** none expected. **New dependency:** none.
**Depends on:** TASK-088 (params), TASK-094 (`music_arc` pattern kind). TASK-112 is useful (genre directives).

## Why

- Retention drops when nothing changes on screen for too long.
- Music today is one track at one level for the whole video.
- Good channels add a "pattern interrupt" (a visual or sound change) every few seconds, and shape the music to the story: intro, build, reveal and outro.

## Read first

- The director (`compose/director/`), the pacing code, and `directives.pacing` (TASK-112).
- The music selection and mix code (find where the background track and ducking are set).
- `music_arc` in `creative_patterns` (094).
- The TASK-089 retention map, to check the effect later.

## Build

1. **Interrupt params** (registered in 088):
   - `interruptMinGapSec` and `interruptMaxGapSec`;
   - the allowed interrupt kinds: zoom punch, cut to B-roll, text pop, SFX hit, colour flash, and so on.

   Use genre defaults from directives.
2. **Director rule.** After the shots are planned, scan the timeline. Wherever there is no change for longer than `maxGap`, insert the cheapest allowed interrupt that fits the shot, and never within 300 ms of a word's middle. Record the inserted interrupts in the plan.
3. **Music arc.**
   - A `music_arc` pattern defines sections by script role (hook, body, reveal, CTA) with relative level, energy and transition (cut, swell or drop).
   - The mixer applies the gain automation per section, under voice ducking. With a single track, use energy by gain and filter. If the music library has stems or alternate cuts, pick by section; check what we have.
4. **Eval.** Extend `runEval.ts` with an "max still gap" metric; it must improve, and the old scores must not drop.

## Mã nguồn mở có sẵn (open source)

- **ffmpeg** `volume` with expressions, `afade`, `sidechaincompress` (already used for ducking?): use the filters, do not reimplement.
- **auto-editor** (Unlicense) is a reference for timeline gap detection.

## Rules

README rules 1–11. Interrupts never cover captions or required text. SFX come only from licensed packs we already have.

## Tests

- gap detection and insertion;
- the word-middle rule;
- params respected;
- the music gain automation per section (a filter-graph snapshot);
- the eval metric improves;
- genre defaults.

## Done

- [ ] params + interrupt rule + music arc mix
- [ ] eval metric; tests; suites
- [ ] samples in `docs/compose/samples/`; user guide + changelog
- [ ] report → `docs/tasks/TASK-097.done`
