# TASK-121 — Quality failures are repaired by the agent, not handed to the user 🔁

**Who:** Cursor, model `grok-4.7-xhigh`. Hard task: agent loop, budgets and several stages. **Size:** L. **Order:** after BUGFIX-VISION-SCHEMA (done). It does not overlap TASK-114 (auth), TASK-117 (`deploy/`) or the 115–120 workspace/node tasks. **One DB migration (generated). No new dependency.**

Read first:
- `docs/cursor/README.md`
- `docs/cursor/TASK-059.md` and `docs/cursor/TASK-066.md` (autonomy levels, grants, quality gates, hard limits)
- `packages/shared/src/schemas/autonomy.ts`: `AUTONOMY_PRESETS`, `scriptGateDecision` (max 2 revise rounds), `renderGateOk`
- `apps/server/src/operator/qualityGates.ts`: `scriptGateInputs`, `scriptRevisionFeedback`, `renderGateInputs`, `recordHeld`
- `apps/server/src/assistant/tools.ts`: `approve_gate` (~line 893), which today ends every failed gate with `recordHeld` + `createUserRequest`; `research_scene_visuals`, `crop_scene_images`, `dedupe_scene_visuals`
- `apps/server/src/services/visualService.ts`: `attentionReasonFor` (~975), the auto-approve filter (~650), `researchOffTopic`, `selectCandidate`
- `apps/server/src/services/visionVerify.ts`: the vision retry loop, `needsAttention`
- `packages/shared/src/visuals/sceneQuery.ts`: `VISUAL_ATTENTION_REASONS`
- `apps/server/src/operator/supervisor.ts`, `loopGuard.ts`, `circuitBreaker.ts`, `autonomyBudget.ts`, `undo.ts`, `digestLine.ts`
- TASK-067/070 compose shot types (text card, map, quote_full, list_full, footage) in `apps/server/src/compose/`

## Why

The user's rule: in self-running mode, a quality failure is the agent's job. Today three cases stop and wait for a human:

1. **Script gate.** After 2 revise rounds the script is held and a "Giữ cổng kịch bản" request is created.
2. **Render gate.** Any failure (silent audio, subtitles out of sync, freeze/black segments, duration off by more than 15%, missing file) is held right away. There is no retry at all.
3. **Scene images.** A scene with `vision_reject`, `vision_missing`, low relevance or an unverified web source is skipped by auto-approve and waits in "Cần bạn xử lý".

Each of these has known, mechanical fixes. The agent should pick and run them inside a budget, check the result with the same gate, and only stop when the budget runs out. When it stops, the project is **shelved**, not left waiting: the agent moves on to the next topic and the user sees it in the daily digest.

What does **not** change: the gates themselves. A failing video is never published, a failing scene image is never accepted, and the hard limits (keys, sign-in, money, licence/watermark, protected project, own permissions) stay exactly as they are.

## Scope and switches

- Active only when the effective autonomy has the `retries` grant (presets: `supervised` and `autonomous`). With `off`/`assist` nothing changes: gates hold and ask the user, as today.
- New per-profile setting in the autonomy settings (shared schema, UI in the existing autonomy page, one Vietnamese line each):
  ```ts
  repair: {
    maxAttemptsPerProject: number;   // default 6, 0..12, all repair actions of one project together
    maxRendersPerProject: number;    // default 2 extra renders, 0..4 (renders are the expensive part)
    maxUsdPerProject: number | null; // default null = only the daily/monthly autonomy budget applies
    onExhausted: "shelve" | "ask";   // default: "shelve" for autonomous, "ask" for supervised
  }
  ```
  These are autonomy keys: the existing policy rule 4 must block tools from changing them, the same way it blocks `budget*`.

## 1. One repair loop in code, decisions by the agent

Add `apps/server/src/operator/qualityRepair.ts`.

**Code owns the facts and the limits; the agent owns the choice.**

1. `diagnose(projectId, gate)` (pure code, no LLM). Returns a list of `RepairIssue`:
   ```ts
   type RepairIssue = {
     gate: "SCRIPT" | "VISUALS" | "RENDER";
     kind: string;              // e.g. "script_score", "script_facts", "audio_silent", "subtitle_sync",
                                // "freeze", "black", "duration_long", "duration_short", "file_missing",
                                // "scene_vision_reject", "scene_vision_missing", "scene_low_relevance", "scene_source_risk"
     sceneIds?: string[];       // for scene issues and for freeze/black mapped to scenes
     detail: string;            // short Vietnamese text for the log and digest
     actions: RepairActionKind[]; // the allowed actions for this issue, cheapest first
   };
   ```
2. `chooseRepair(...)`: the operator agent gets the issues, the allowed actions, what was already tried for this project (from the repair log), and the remaining attempts/renders/USD. It returns one action per issue as structured output (zod, `generateRoutedStructured`, task `operatorRepair`). It may only pick from `actions`; the code rejects anything else.
   - If no operator model is configured, the call fails, or `ECO` mode is on, use the **default ladder**: the first action in `actions` not yet tried for that issue. So the loop also works with zero LLM tokens.
3. `runRepair(...)` executes the action through the existing tool registry (so audit, hard blocks, loop guard and circuit breaker all apply), with `origin: "supervisor"`, a `reason`, and `undo` where possible.
4. Re-run the same gate. Pass → continue the pipeline as normal (`approve_gate` path). Fail → back to step 1 with the attempt counters updated.
5. Stop when attempts, renders or USD for this project run out, when the loop guard sees the same action+issue twice without change in the gate inputs, or when an issue has no untried action left. Then apply `onExhausted` (section 5).

`approve_gate` in `tools.ts` calls this loop instead of `recordHeld` + `createUserRequest` when the `retries` grant is on. Keep the old path unchanged for the other levels.

## 2. Allowed actions per issue (cheapest first)

Only these. Each maps to existing services; add a thin tool only where none exists.

**Script** (`script_score`, `script_facts`, guideline MUST findings):
1. `revise_script`: the existing revise round with `scriptRevisionFeedback`. Raise the cap from 2 to the repair budget when `retries` is on (keep 2 otherwise).
2. `revise_script_stronger_model`: same, but on the profile's stronger script route for this one call (TASK-059 provider choice; no app-scope change).
3. `rerun_research_then_script`: re-run RESEARCH with the failing facts as extra queries, then SCRIPT. Only for `script_facts`.
4. `new_angle`: rewrite from the same research with a different hook/angle (prompt flag). Counts as a revise round.

**Scene images** (per scene; never touches a scene the user owns, `userOwnsVisualSelection`):
1. `vision_recheck`: only for `scene_vision_missing`; run the vision check again for that scene, on the fallback vision route if the first one failed.
2. `pick_next_candidate`: select the next existing candidate that **passes the gate** (vision fit ≥ threshold, no `source_risk`, no watermark, valid source). Never lower the threshold.
3. `research_scene`: `research_scene_visuals` with new queries from the vision research prompt (uses `depicts`/`issues` of the rejected image).
4. `web_search_scene`: Brave/web search, only if the profile's source policy already allows web sources. Unverified web finds still never auto-approve.
5. `rephrase_scene_visual`: rewrite that scene's `visualDescription` into something findable (generic, period-correct, no named character if the named one cannot be found), then `research_scene`. Narration is not changed.
6. `switch_shot_type`: change the scene to a shot type that needs no matching photo: text card / quote_full / list_full / map (TASK-070), or licensed stock footage on the mood keywords (TASK-067). Mark it in the scene meta as `repair: "shot_type"` so the learning loop sees it.

`scene_source_risk` only allows 2, 3, 5, 6. Licence and watermark rules are never relaxed.

**Render** (map each failure to its stage; re-render only after the fix):
- `audio_silent` → re-run VOICE (TTS provider fallback chain from TASK-040/065) and MUSIC_SEARCH if the music track is missing; then render.
- `subtitle_sync` → re-run SUBTITLE with word timings re-aligned; then render.
- `freeze` / `black` → map the segment timestamps to scenes via the timeline, treat those scenes as `scene_vision_reject` (image ladder above, starting at `pick_next_candidate`), rebuild TIMELINE, then render.
- `duration_long` / `duration_short` → first rebuild TIMELINE with pacing inside ±5% speed; if the gap is still above 15%, `revise_script` with an explicit target word count, then VOICE→SUBTITLE→TIMELINE→render.
- `file_missing` → render again once.
Every render counts against `maxRendersPerProject` and the existing `maxRendersPerDay`.

## 3. Budget, safety, audit

- All repair calls go through the tool registry. Hard blocks win in every case (test it).
- Cost counts toward `autonomyBudget` (daily/monthly USD) and the per-project limit. `budget_stop` ends the loop at once.
- Circuit breaker: 3 shelved projects in a row on the same profile with the same issue kind → open the breaker for that kind, send the existing breaker alert. This catches a broken provider instead of burning budget on every topic.
- Never on project `56374fb2-54cf-48ff-9441-2e6c653295d4`: the loop must refuse it even if the gate call reaches it.
- Repair log table `quality_repairs` (migration via `npx drizzle-kit generate`): `id, project_id, profile_id, gate, issue_kind, scene_id null, action, chosen_by ("agent"|"ladder"), attempt, cost_usd, render_used, outcome ("passed"|"failed"|"error"), gate_before json, gate_after json, created_at`.
- Each row is also an audit row with `reason` and `undo` (e.g. previous selection id, previous script version).

## 4. Learning hook (light)

Expose a read function `repairStats(profileId, days)`: per issue kind, which action passed most often and its average cost. Feed it into `chooseRepair`'s prompt as "what worked before on this channel", and into the ladder order (an action that passed ≥ 60% over ≥ 5 tries moves to the front for that issue). No new learning model.

## 5. When the budget runs out

- `onExhausted: "shelve"`: set project status to a new `SHELVED` (add to `PROJECT_STATUSES`, reversible, nothing deleted). Free its schedule slot. Put the topic back at the end of the queue once with a `repairNote`, or drop it if it was already shelved once. Write one digest line: "Đã gác video «…»: kịch bản 5/10 sau 4 lần sửa." No user request, no immediate alert (unless the breaker opens).
- `onExhausted: "ask"`: today's behaviour (`recordHeld` + `createUserRequest`), but the request text lists what was tried.
- A shelved project can be reopened by the user from the project page ("Mở lại"), which resets its repair counters.

## 6. UI (small)

- Autonomy page: the `repair` fields.
- Project page: a "Tự sửa chất lượng" block listing the repair log rows (issue, action, by agent/ladder, result, cost). Read-only.
- Dashboard "Cần bạn xử lý": a project being repaired shows "Đang tự sửa (lần 2/6)" instead of a request.
- Stage summary: append "· Tự sửa: N lần, M cảnh đổi ảnh" when repairs ran.

## Open-source

Nothing to add. The loop is the "evaluate → diagnose → fix → re-evaluate" pattern of self-refine/reflexion agents, with retry limits like LangGraph's `RetryPolicy` or Temporal retry policies; our gates are already the evaluators. ffmpeg `freezedetect`/`blackdetect` are already in the render report. Do not add a dependency.

## Tests (no network, no real LLM, mock providers)

- `diagnose` table test: each gate input → the expected issues and action lists; `scene_source_risk` never lists `pick_next_candidate` with a risky candidate.
- Script: score 5 → revise → 6 → stronger model → 8 → gate passes, pipeline continues; no user request created.
- Script exhausted with `shelve` → project `SHELVED`, topic re-queued once, digest line, no request. With `ask` → request created listing the tried actions.
- Scene: `vision_reject` → `pick_next_candidate` picks only a gate-passing candidate; when none, `research_scene`; then `switch_shot_type` produces a text card scene; user-owned scenes untouched.
- Render: `subtitle_sync` → SUBTITLE re-run then 1 render; `freeze` at 12 s → the scene at 12 s gets a new image; render cap 2 respected; `maxRendersPerDay` respected.
- Agent picks an action not in `actions` → rejected, ladder used, logged.
- No operator model / ECO → ladder only, zero LLM calls.
- Loop guard: same action twice with unchanged gate inputs → stop.
- Breaker: 3 shelves in a row with the same issue kind → breaker open + alert.
- `off`/`assist`: behaviour identical to today (snapshot of `approve_gate` results).
- Protected project refused. Hard-block table test still passes. Policy blocks tool args touching `repair`.

## Rules

- No commit or push. No new npm dependency. Migration only via `npx drizzle-kit generate` in `apps/server`.
- Do not touch `.env`, `.claude/`, `data/`, `scripts/`, `deploy/`, auth/user code (TASK-114), `packages/shared/src/style/**`.
- Do not loosen any gate threshold, the relevance gate rules in `sceneQuery.ts`, licence/watermark rules or hard limits. Repairs change the input of a gate, never the gate.
- Never render or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.

## Done

- `npm run typecheck` at the root; `npm test` in `packages/shared`, `apps/server`, `apps/web`. List any failure outside your area, with its file.
- User guide: the autonomy page section and the project page section in `docs/user-guide/`, the `featureMap` entry, one line in `nhat-ky-thay-doi.md`.
- `docs/tasks/TASK-121.report.md` in Vietnamese: files changed, the action table as implemented, the default ladder, deviations, test counts, what is not done.
- Then the empty `docs/tasks/TASK-121.done`.
