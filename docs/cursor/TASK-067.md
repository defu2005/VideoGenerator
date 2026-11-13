# TASK-067 — Compose engine: the plan (overview)

**Goal:** turn each scene from one still image into a short series of shots of different kinds (`still`, `footage`, `kinetic_text`, `chart`, and later `map`, `compare`, `quote_full`, `list_full`), cut on word gaps and music beats, rendered on the CPU.

**Why it matters:**
- **Retention:** a slideshow loses viewers.
- **Monetisation:** YouTube's "mass-produced / inauthentic content" rule. Varied editing is the biggest quality step left.

**How the work is split, to save Fable's budget:**
- every part that **objective tests can check** goes to Cursor;
- Fable gets only the parts that need **design or taste**;
- Claude writes every guide and reviews every report.

| Step | Guide | Who | Starts after | What |
|---|---|---|---|---|
| 1 | [TASK-067a](TASK-067a.md) | Cursor (grok-4.7-medium) | now (parallel with 069) | the foundation: schema, words, beats, pacing DP, metrics, footage provider, renderers, concat, service, a baseline director behind an interface, the eval harness |
| 2 | Claude reviews 067a | Claude | 067a done | check the tests and the EVAL table; fix the guide for 067b if facts changed |
| 3 | [TASK-067b](TASK-067b.md) part 1 | **Fable**, effort high, its own session | step 2 | the director: rules R1–R6 + the Vietnamese number parser + variety + 1 LLM call |
| 4 | TASK-067b part 2 | **Fable**, effort medium, a new session | part 1 (or in parallel: different files) | professional templates for `kinetic_text` and `chart` (safe zones, auto-fit, contrast, variants) |
| 5 | TASK-067b part 3 | **Fable**, effort medium, a new session | parts 1 and 2 | footage ranking by meaning + tuning against the eval |
| 6 | [TASK-068](TASK-068.md) | Cursor | 069 + 067a (parallel with step 3–5) | integration: the engine setting, the render loop with per-scene fallback, the freeze/black gate, UI stats, the MCP preview tool, the live check |
| 7 | [TASK-070](TASK-070.md) | Cursor | 067b + 068, after Claude rechecks the guide | 4 more kinds, shot editing with locks, the learning features from the shot mix |

**Fable budget rules** (also in the 067b guide):
- a new short session per part;
- read only the module map `docs/compose/README.md`, not the code;
- tests and stubs already exist;
- no documentation writing;
- side bugs are reported, not fixed;
- one full test run at the end.

**What is left for later:** the per-second retention curve from YouTube Analytics (a new sync). This is a possible later Fable task: learn which shot mix keeps viewers, second by second.
