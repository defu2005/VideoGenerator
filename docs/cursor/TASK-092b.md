# TASK-092b — Lab: tools, "Thử nghiệm" page, bandit suggestions 🧪

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-medium`). **Size:** M. **Migration:** only if `title_experiments.experimentId` was not added in 092a; drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-092a.

## Why

092a built the engine. Now the user and the agent need to create, watch and conclude experiments. The title experiments that exist today, and the experiment notebook from gap #3, merge into one place.

## Read first

- The TASK-092a report and its tables.
- `docs/ARCHITECTURE-TARGET.md` §4 group `lab` (risk and grants).
- `docs/research/api-capabilities/youtube.md`: **Test & Compare** (thumbnail and title A/B) can only be started and read in YouTube Studio. There is no API, so results are entered by hand, with a source.
- The existing `title_experiments` code.

## Build

1. **Tools:**
   - `list_experiments`, `get_experiment_result`: read;
   - `create_experiment(hypothesis, variable, arms, primaryMetric, …)`: confirm, grant `strategy`, inside the cap. Outside the cap it is refused, not left pending;
   - `conclude_experiment`, `stop_experiment`: confirm.

   Each tool takes a `reason`. Add a `video-thu-nghiem` skill, or extend `video-bao-cao-thu-nghiem`.
2. **Title experiments** become `variableKind: "title"` rows linked by `experimentId`. Keep their logic.
   - For Studio Test & Compare: a "Cần bạn" request tells the user to start it in Studio.
   - The result is entered by the user (the winner and the watch time share) with a screenshot or note as the source.
3. **"Thử nghiệm" page:**
   - a list with status, arms, n per arm against the minimum, a CI chart, the stop-rule status and breaker events;
   - create and conclude forms that call the same services;
   - a notebook view: hypothesis → result → playbook entry (once 093 exists).
4. **Bandit suggestions (suggest only).**
   - Thompson sampling over **concluded and running** results suggests the next arm values to test, as a suggestion card.
   - It never assigns traffic by itself; assignment stays 092a's randomized rule.

## Mã nguồn mở có sẵn (open source)

- **GrowthBook** (MIT) and **Unleash** (Apache-2.0) experiment UIs are the layout reference: results table, CI bars, SRM warning.
- Thompson sampling with a Beta-Bernoulli model is textbook; write it in `packages/shared/src/stats/` with tests.

## Rules

README rules 1–11. The bandit only suggests. Manual results must have a source.

## Tests

- tool risks, grants and cap refusal;
- title rows migrated;
- manual result requires a source;
- Thompson sampling deterministic with a seed;
- the page renders and calls the routes.

## Done

- [ ] tools + skill; title merge; manual Studio results
- [ ] page; bandit suggestions
- [ ] tests; suites
- [ ] user guide (Thử nghiệm page) + featureMap + changelog
- [ ] report → `docs/tasks/TASK-092b.done`
