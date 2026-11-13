# TASK-088 — Param registry: every tunable number has one home 🎛️

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M. **Migration:** yes (🗄; only one migration task at a time); drizzle-kit only. **New dependency:** none.
**Depends on:** TASK-085 (file split) committed.

## Why

Thresholds and weights are scattered as constants and per-feature settings: variety, pacing, relevance, script scoring, visual sameness (TASK-113) and overdue checks (TASK-125).
- The agent cannot tune them safely.
- The user cannot see what was changed or undo it.
- The Lab (TASK-092a) needs to vary them per experiment arm.

ARCHITECTURE-TARGET §3 defines `param_values`; §5 defines the guardrails.

## Read first

- `docs/ARCHITECTURE-TARGET.md` §3 (`param_values`, `param_user_bounds`), §4 (the settings tool group, risk and grant) and §5.
- The TASK-121 pattern: code owns limits, the agent picks inside them, and every change is recorded with a reason.
- The current constants: grep `apps/server/src/compose/director/`, `visuals/relevance*`, `script/score*`, `style/` and the `*Settings` readers.

## Build

1. **`packages/shared/src/params/defs.ts` (code, the single source; ARCHITECTURE-TARGET §3).** Each param has:
   - `key`, `group`, a Vietnamese `label` and help;
   - `type` (number, int, enum, bool) and `default`;
   - `hardMin` / `hardMax`, which code never lets anyone pass;
   - `scope` (global, profile or project);
   - `agentMay` (none, suggest or set), and `maxStepPerChange` for agents;
   - `affects`, which stages read it.

   Start with ~20–30 params from the four groups the roadmap names, plus the TASK-113 sameness thresholds and the TASK-125 check spacing.
2. **Tables (drizzle).**
   - `param_values`: key, scope, scope id, value, version, actor (user, agent, hermes or experiment), reason, created_at. Values are append-only; the latest version wins.
   - `param_user_bounds`: per-key user min and max, which must lie inside the hard limits. The agent must stay inside these.
3. **Resolver.**
   - `resolveParam(key, {projectId, profileId})` walks project → profile → global → default. Experiment arm overrides come later, in TASK-092a; leave a hook.
   - Cache it per job.
   - Move the four groups' constants to read through the resolver. Defaults must equal today's constants: a snapshot test proves no behaviour change.
4. **Tools.**
   - `list_params`, `get_param`: read.
   - `suggest_param_change(key, value, reason)`: safe; it makes a suggestion the user sees.
   - `set_param(key, scope, value, reason)`: confirm, with a grant row. Agents are clamped to the user bounds and `maxStepPerChange`, and refused if `agentMay` is not `set`.
   - `revert_param(key, scope, toVersion)`: confirm.

   Add these to a skill.
5. **Web.** A "Tham số" page grouped by `group`. It shows each value, its source (default, global, profile or project), its history with the actor and reason, an undo, user bounds editing, and suggestions waiting for approval.

## Mã nguồn mở có sẵn (open source)

- **Unleash** (Apache-2.0) and **GrowthBook** (MIT) are the reference for a layered-override resolver and its audit trail. Copy the model, not the code.
- **convict** (Apache-2.0) is the reference for a schema with defaults, ranges and docs per key. Our `defs.ts` mirrors it. Do not add the package; zod is already there.

## Rules

README rules 1–11. Hard limits live in code only, never in the DB. No param may change a safety rule (the protected project, publish confirm, budgets).

## Tests

- resolver order;
- defaults equal the old constants (snapshot);
- an agent outside its bounds or step is refused;
- `agentMay: none` is refused;
- revert makes a new version;
- every param in `defs.ts` is read somewhere (a grep test);
- the web page lists, edits and undoes.

## Done

- [ ] defs + tables + resolver; four groups moved; no behaviour change
- [ ] tools + grants + skill
- [ ] "Tham số" page
- [ ] tests; suites; drizzle-kit migration
- [ ] user guide + featureMap + changelog
- [ ] report `docs/tasks/TASK-088.report.md`, then `docs/tasks/TASK-088.done`
