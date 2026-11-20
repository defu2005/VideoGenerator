# TASK-140 — Measured quality scorecard and calibrated auto-approval 📏✅

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M–L. **Migration:** one (drizzle-kit only). **New dependency:** none.
**Depends on:** 090 (`render_reviews`), 139 (preview facts), 121 (`quality_repairs`, repair loop), 066/069 (script quality gate), 077 (scene relevance gate), 113 (originality similarity). Run it alone among migration tasks. Do not run it beside a task that edits `operator/qualityRepair.ts`, `operator/qualityGates.ts` or `operator/autonomy.ts`.
**Source:** RESEARCH-076 P0 (quality loop) and [SCALE-PLAN.md](SCALE-PLAN.md) row 6.

## Why

- Throughput is capped by human gates (VISUAL_REVIEW, MUSIC_REVIEW, FINAL_APPROVAL). AUTO mode passes gates when no `autoBlock` reason exists.
- "No block reason" is not the same as "good": the signals are scattered.
  - script score (066);
  - scene relevance (077);
  - originality similarity (113);
  - render facts (090, 121 freeze/black);
  - preview facts (139).
- Nobody has measured whether those signals agree with the user's own decisions. So either the user approves everything by hand (slow), or AUTO approves blindly (risky at volume).
- 121 already repairs within a budget. What is missing:
  - one scorecard per project;
  - a gate policy that reads it;
  - proof, from the user's past decisions, that the scorecard is trustworthy for that channel.

## Read first

- `operator/qualityGates.ts`, `operator/qualityRepair.ts`, `operator/autonomy.ts`, `operator/autopilot.ts`, `packages/shared/src/repair/quality.ts`, `schemas/autonomy.ts`.
- `pipeline/orchestrator.ts` (`autoBlock`, gate handling in AUTO), the `quality_repairs` table.
- `render_reviews` (090), `preview/` facts (139), `originality/`, the 077 relevance gate in `services/visualService.ts`.
- Gate decisions: where approve/reject is recorded for each gate (review service, audit log).

## Build

### 1. Scorecard (code; LLM only where a stage already used it)

- `buildScorecard(projectId)` → `{ version, dimensions[], overall, blockers[], evidence[] }`.
- Each dimension holds `{ id, score 0–100, weight, source, detail, evidenceRef }`:
  - `script` (066 score);
  - `relevance` (077, share of scenes passing, worst scene);
  - `visualQuality` (vision verdicts where present, otherwise skipped, never guessed);
  - `pacing` (cuts per minute and text density from 139/090);
  - `audio` (LUFS, true peak, jumps from 090);
  - `captions` (sync p95 from 090);
  - `technical` (black, freeze, safe-area overflow);
  - `originality` (113 similarity inside and across channels);
  - `policy` (open MUST guideline findings).
- **Blockers are hard:**
  - any MUST finding;
  - black or freeze over the 090 threshold;
  - an originality block from 113;
  - a missing or unlicensed visual.
  - A blocker makes the gate stay with the user, whatever the score.
- Persist each scorecard in a new table `quality_scorecards`:
  - `project_id`, `stage` (the gate it was built for), `input_version` (134);
  - `overall`, `dimensions` JSON, `blockers` JSON, `created_at`.
- It is rebuilt when the input version changes.

### 2. Calibration from the user's own decisions

- For every gate the user decided by hand, store the scorecard at decision time with `decision` (`approved` | `rejected` | `edited`) in `quality_gate_decisions` (same migration).
- `calibration(channelId, gate)`: over the last N decisions (default 30), the agreement rate if the gate had been decided by `overall ≥ threshold`, the false-approve count, and the best threshold with zero false approves.
- The UI shows this per channel: "Nếu tự duyệt ở ngưỡng X: đúng Y/Z lần, duyệt nhầm W lần".

### 3. Gate policy

- New autonomy option per channel and gate: `auto_if_score`, with a threshold. It can only be enabled when calibration has ≥ 20 decisions and 0 false approves at that threshold. Otherwise the toggle is disabled with the reason.
- In AUTO mode with `auto_if_score`:
  - score ≥ threshold and no blocker → approve, with the scorecard id in the audit;
  - score below → run the 121 repair loop (bounded rounds, same budget), rebuild the scorecard, then approve or hold;
  - still below → hold with the top 3 weakest dimensions as the reason.
- FINAL_APPROVAL with `autoRender` follows the same rule. Publishing keeps its own gates (083 checks, private upload on MUST findings).
- **Drift guard:** every 10th auto-approved project per channel is held for the user anyway (sample audit).
  - A user rejection of a sampled project switches the channel back to manual, and notifies.
- The repair loop (121) receives the weakest dimensions with their evidence (preview frames, 090 findings) as input, instead of only the gate's message.

### 4. UI and tools

- Project page: the scorecard with dimension bars, blockers, evidence links (preview, contact sheet, render review).
- Autonomy settings: the `auto_if_score` toggle per gate with the calibration numbers.
- Tool `get_scorecard` (read-only). Agents cannot change thresholds (policy).

## Mã nguồn mở có sẵn (open source)

- **OpenReels / AutoShorts critic loops** (RESEARCH-076): critic → repair with bounded rounds. Idea only.
- **promptfoo / DeepEval** (MIT/Apache): scoring rubrics and regression sets. Idea only; no dependency.
- **Thompson sampling** stays in 092b. Not here.

## Rules

- README rules 1–11. Migration only through drizzle-kit.
- The scorecard never invents a value: a missing source is "không có dữ liệu" with weight 0, never a default score.
- No auto-approval for the protected project `56374fb2-…`, ever.
- Tests: mock LLM, fixture render reviews, no network.

## Tests

- **Scorecard:** each dimension reads its source; a missing source → weight 0; blockers override a high score; rebuilt only when `input_version` changes.
- **Calibration:** a fixture of 30 decisions gives the expected agreement, false-approve count and best threshold; fewer than 20 → toggle disabled.
- **Policy:**
  - above threshold → approved with an audit row;
  - below → repair, then approve or hold;
  - blocker → hold;
  - every 10th → sampled hold;
  - sampled rejection → channel back to manual with a notification.
- **Protected project** never auto-approved.

## Done

- [ ] scorecard + table; decisions table + calibration
- [ ] `auto_if_score` policy, repair integration, drift guard
- [ ] UI (scorecard, calibration), `get_scorecard` tool
- [ ] tests; shared + server + web suites; typecheck; build
- [ ] `docs/ARCHITECTURE.md` §3 (mode AUTO), user guide, changelog
- [ ] report → `docs/tasks/TASK-140.done`
