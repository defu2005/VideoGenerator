# TASK-073d — ngân sách khám phá và tín hiệu phai dần 🧭

**Who:** opencode (code), Codex (review), when the user hands it over. Claude writes this guide only. **Size:** M–L (new kind, one selector module, consumers). **Migration:** likely. The per-evidence timestamps and the exploration log (arm, draw, later reward) need storage. Decide the table at start: an existing knowledge table if it fits, otherwise a new migration. Take the next free migration number then, one migration task at a time. **New dependency:** none.
**Source:** `docs/cursor/TASK-073.md` §10 (outline) and the method table at line 50; `docs/research/monetization/change-signals.md` line 40; `docs/research/change-signals/README.md`.
**Depends on:** 073a, 073b, 073c. Checked 2026-11-19: `docs/tasks/TASK-073a.done`, `TASK-073b.done`, `TASK-073c.done` all exist. RESEARCH-072 and RESEARCH-073 have `.done` markers.
**Scheduling:** `docs/cursor/README.md` row 54s says 073d is a separate guide now, and line 196 says "073d nằm trong 092a" (073d is inside 092a). Both are updated with this guide. The **data gate** of 092a applies: real numbers need 087 and 089 running for at least 4 weeks. 089 has no `.done` marker yet, so the gate is not met (checked 2026-11-19).

## Why

The operator and the autopilot choose formats, lengths, posting slots and hook styles from research priors and past results. Two things go wrong with that:
- It keeps repeating what already worked, so it never finds a change that nobody announced (a platform quietly favouring a format, a new trend).
- What worked a month ago keeps its weight after it has stopped working.

073d adds a small, controlled exploration budget and a signal that fades unless new evidence supports it.

## What the research says (and does not say)

- `docs/research/monetization/change-signals.md` line 40: half-lives for "hot" signals are **operating hypotheses**, not measured lifetimes. The time-decay column is null where there is no longitudinal evidence. Any default value in code must be labelled as a hypothesis and read from settings, never hard-coded as fact.
- The research gives no bandit or exploration numbers.
- `docs/cursor/TASK-073.md` line 50 lists CUSUM or Page-Hinkley and Thompson sampling as textbook methods, about 50 lines each, with a citation comment in code.

## Build

### 1. New knowledge kind `format_signal` (TASK-073 §10, and §2 line 149)

TASK-073 §2 gives the steps for adding a kind: a zod schema, one line in the kind registry, a row in the catalog, and a test. The kind-adding section of `docs/knowledge/README.md` is headed "## Thêm loại tri thức" (line 5). Check it against the TASK-073 steps before relying on it. Files: `packages/shared/src/knowledge/schema.ts`, `catalog.ts`, and `snapshot.ts` (only if the snapshot must list kinds; check first).

Shape per entry:
- key: `(market, platform, dimension, value)`, where dimension is `format | niche | topic | length_band | posting_slot | hook_style`;
- `score` (0–1), `evidenceCount`, `lastConfirmedAt`, `halfLifeDays`, `source` (`research_prior | trend | own_result`), `experimentId` (nullable; links to 092a's conclusion row).

### 2. Fading weights (one model, fixed here)

- **Per-evidence decay.** Each evidence item keeps its own timestamp. Its effective weight is `w = 0.5 ^ (ageDays / halfLifeDays)`. Nothing is reset by time alone.
- **Score** = discounted Beta posterior: `alpha = 1 + Σ w·success`, `beta = 1 + Σ w·failure`, score = `alpha / (alpha + beta)`.
- **Confirmation** = a new evidence item with the same key. It adds weight at full value (w = 1). It does not reset or rewrite the old items, so old evidence keeps fading on its own clock. `lastConfirmedAt` records the most recent item for display only.
- **Research priors** use the same formula with a low starting weight (a fixed setting, labelled as a hypothesis). They fade too. Their weight drops below the threshold below after a few half-lives.
- **Priority:** the channel's own results outrank research priors once the channel has enough videos. The threshold is a setting; the default proposed here is 20 videos, labelled as a hypothesis.
- `halfLifeDays` defaults come from settings, one per platform, each labelled "giả thuyết vận hành". Default values are a guess until 092a data arrives.

### 3. Exploration budget (TASK-073 §10)

- Setting `operator.explorationShare`. **Shipped default: 0.** The target after the 092a gate is 0.15 of autopilot videos. The share is of videos, not of time.
- In exploration, pick one alternative per dimension with **Thompson sampling** (Beta draw per alternative) from a **pre-allowed set** that comes from the knowledge base and guidelines. The selector never invents an alternative.
- Reward per video = 1 if the 48 h view count is at or above the channel median of the last 20 videos, else 0. This is the only reward definition in this task. A change of reward needs a new decision.
- Log every exploration choice with its arm, its draw and the reward when it comes in, so the outcome is auditable.
- Code only. No LLM in selection.

### 4. Change detection, reused

- A sudden drop in a format's reward should trigger the existing CUSUM in `apps/server/src/knowledge/driftMonitor.ts` (073c). Reuse it; do not write a second detector.

### 5. Consumers

Four readers: topic suggestion, format picking, posting times, weekly insights. **Where each lives is not verified yet.** The first step of 073d is to find the current code for each (grep for the topic suggester, the format picker, the posting-time code and the weekly insight job) and list them in the report. Do not assume the names.

- A consumer reads `format_signal` entries and uses the score as a **tie-breaker**, not as an override of the user's choice.
- A change to a setting (default format, posting slot) goes only through the **proposal flow** of 073a (diff, risk, history, restore; `docs/cursor/TASK-073.md` §2). No automatic niche switching. This rule is in TASK-073 §10 and stays.

## Tests (must exist)

- Fading: a key with one evidence item and no new evidence has weight 0.5 after one half-life and 0.25 after two.
- Confirmation: a new item adds full weight and raises the score; the old items keep their own decay.
- Own results beat research priors above the threshold, and not below.
- Exploration share over 1 000 simulated videos is within ±2 points of the configured share (seeded). Run the test at 0.15 even though the shipped default is 0.
- Shipped default is 0: with the default setting, no exploration choice is made and none is logged.
- Thompson picks only from the allowed set; an empty allowed set means no exploration, and it is logged.
- No setting changes without a proposal.
- A new `format_signal` kind passes the catalog test (one row per kind).

## Not allowed

- Do not hard-code any half-life, threshold or share as a fact. Each is a setting and labelled as a hypothesis.
- Do not switch niche automatically.
- Do not use an LLM to choose an arm.
- Do not run against the protected project `56374fb2-…` or `data/`. Use the dev data dir.
- Do not turn the live share above 0 before the 092a data gate is checked by Claude (087 and 089 at least 4 weeks). Code and tests can land first, behind the setting, with the shipped default at 0.

## Done when

- The kind, the fading, the selector and the logging exist, with the tests above.
- Consumers found and listed in the report; each one reads the score only as a tie-breaker.
- Report at `docs/tasks/TASK-073d.report.md`. `docs/tasks/TASK-073d.done` only after review. The live share stays at 0 until the 092a gate.

## Mã nguồn mở có sẵn (open source)

Checked 2026-11-19 with one WebSearch (JS/TS Beta-Bernoulli Thompson sampling). No library fits the needed model cleanly, so the method is implemented in-house. Candidates found, none adopted:

| Candidate | Licence | Finding |
|---|---|---|
| `percipio` (npm) | MIT (per its readme) | Small, about 54 downloads. Its readme mentions Thompson sampling, but Beta-Bernoulli is not confirmed. Not adopted. |
| `ts-mab` (GitHub, TypeScript) | not seen in the results | Last push May 2020, so likely unmaintained. Not adopted. |
| `simplebandit` (npm) | "other" | A contextual bandit with logistic regression and softmax, not Beta-Bernoulli Thompson sampling. Not adopted. |
| Our CUSUM (`apps/server/src/knowledge/driftMonitor.ts`, 073c) | ours | Reused for drop detection. Do not write a second detector. |
| Our knowledge kind registry and catalog (`packages/shared/src/knowledge/`) | ours | The `format_signal` kind follows its steps. |

Decision: the Beta-Bernoulli Thompson sampler and the discounted posterior are written in-house, about 50 lines, with a citation comment to the textbook method. No new dependency. If the implementer finds a maintained library with a clear licence and the exact model, report it first; do not add it from memory.

## Open questions (for the implementer to report, not to settle)

- Storage: does the signal store fit an existing knowledge table, or does it need a migration? Decide at start and report which.
- Reward definition: 48 h views against the channel median is the default here. Confirm it with the 092a metrics before the live budget starts.
