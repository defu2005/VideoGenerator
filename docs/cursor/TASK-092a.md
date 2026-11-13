# TASK-092a — Lab core: experiments, assignment, statistics, breakers 🧪🔴

**Who:** a new Sonnet 5.5 session at high effort (or Codex when the user asks). **Size:** L. **Migration:** yes (🗄); drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-087, TASK-088 and TASK-089 done.

## ⛔ Data gate: check this before dispatch

The roadmap rule says 087 and 089 must run **for real for at least 4 weeks** before this guide is final. Before dispatching, Claude (the architect) checks:
- ≥ 4 weeks since TASK-089.done;
- ≥ 20 published videos with 7d snapshots on at least one channel;
- retention curves present for ≥ 10 of them.

If the gate fails, do not dispatch: note it in the handoff and re-check weekly. When the gate passes, Claude re-reads this guide against the real data (metric spread, how many videos per week) and adjusts `minSamplePerArm` and the windows **before** dispatching.

## Why

The agent can change params (088) and see genes and retention (089), but it cannot tell whether a change *caused* better results. The Lab runs controlled experiments with safe limits, so the playbook (093) is built on evidence.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 (`experiments`, `experiment_assignments`, `experiment_results`, `title_experiments` extension, `knowledge_entries` kind `format_signal`), §4 group `lab`, §5 (the 15 % cap, branch breakers, CUSUM auto-revert).
- `docs/cursor/TASK-073.md` part d (format signal + half-life). It is folded in here; build it here.
- The `params/` resolver hook from TASK-088.

## Build

1. **Tables** as in §3:
   - `experiments`: hypothesis, `variableKind` (`param|pattern|gene`), `variableKey`, arms, `primaryMetric`, `minSamplePerArm`, `stopRule`, status, conclusion, createdBy;
   - `experiment_assignments`: unique (experiment, project) and unique (project, variableKey);
   - `experiment_results`.
2. **Assignment.**
   - When a project is created in a profile with a running experiment, the code assigns an arm: randomized, balanced by blocks.
   - The share of a channel's videos that are in **any** experiment is capped at 15 %, a user setting; code enforces it.
   - There is one experiment per variable per channel.
   - The resolver applies the arm's param value with source `experiment`.
3. **Statistics.**
   - After each window snapshot, compute per arm: n, the mean, and a 95 % CI. Use Welch t for continuous metrics and Wilson for rates.
   - Store `metricDefinitionRev`.
   - The primary metric and sample size are **locked** once the first assignment exists. A change makes a new experiment.
   - Stop rule: n ≥ min per arm in all arms, **and** (the CI excludes 0 **or** the max duration has passed). Never stop early on a peek; use a simple alpha-spending rule, or no peeking until n is reached.
4. **Breakers.**
   - If an arm's primary metric falls below control by more than a threshold, with n ≥ 5, that arm stops and its projects go back to control values.
   - CUSUM (073c) auto-revert applies to param changes adopted after a conclusion.
5. **Conclusion.**
   - `concluded` with a winner, no difference, or stopped.
   - Write a `knowledge_entries` row of kind `format_signal` with a half-life (073d) and a link to the experiment. The playbook (093) reads these.
6. **Guideline wins.** Every arm passes the same guideline and originality gates; an arm can never relax a gate.

## Mã nguồn mở có sẵn (open source)

- **GrowthBook** (MIT): its stats engine docs (frequentist + sequential), CUPED and SRM checks. Copy formulas with credit, not code. Add an **SRM check** (sample ratio mismatch, chi-square) because GrowthBook shows it catches broken assignment.
- **Wilson score interval** and **Welch t** are textbook. Implement them in `packages/shared/src/stats/` with tests against known values.
- **PlanOut** (Facebook, BSD) is the reference for deterministic hashing assignment.

## Rules

README rules 1–11. No experiment on money, permissions or safety params (088 marks them `agentMay: none` and not experimentable). The protected project is never assigned.

## Tests

- assignment balance and the cap;
- uniqueness;
- the lock after the first assignment;
- the stats against known values;
- the stop rule (no early stop);
- the arm breaker;
- the SRM check;
- the `format_signal` write;
- a gate is never relaxed.

## Done

- [ ] data gate checked by Claude; guide numbers adjusted
- [ ] tables, assignment, stats, stop rule, breakers, conclusion
- [ ] tests; suites; migration
- [ ] architecture note (the user guide comes in 092b)
- [ ] report → `docs/tasks/TASK-092a.done`
