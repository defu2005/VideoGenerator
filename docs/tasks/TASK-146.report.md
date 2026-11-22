# TASK-146 report (beats → visual intent → motion → music → SCRIPT_REVIEW gate)

For the advisor and the user. Nothing pushed. `docs/tasks/TASK-146.done` is NOT written: the spec's Done list is partly open (see below).

**Testing status:** from the user's rule of 2026-11-22 (no tests, no typecheck, no dev server until the user permits), nothing has been run. Earlier slices ran targeted tests under Node 24 and fixed failures; those results are not restated here. Everything changed after the rule is unverified. The full suites and the root typecheck have never run on the final tree. The owed list is at the end.

## Commits

All TASK-146 commits on `dev`: `git log --oneline --grep="TASK-146"`. Latest group: `1dab54d`, `36151a0`, `6439021`, `10d3970`, `7b4b356` (gate, outline mode, HTTP approve, web panel). Earlier: `ba6b4ac` (beats onto scenes), `37512d6` (visualIntent in queries), `3c7e754` (vision check by beat), `b2dc75c` (evidence beats), `300ddc3` (beat camera move), `81e5c38` / `19497e6` / `2ada765` (motion preset, `COMPOSE_RENDER_VERSION` 2 → 3), `9a91314` (music curve by beat purpose), `c6d0212` (music segments, pure), `fcd1e49` (translated child takes beats). The docs commit is listed in the final message.

## Status against the spec Done list

| Spec item | Status | Evidence / gap |
|---|---|---|
| beat fields on scenes, hard beat boundaries | Done in code; not run since the no-test rule | `ba6b4ac`; `planScenes` copies beat fields; "no scene spans two beats" test in `packages/shared/test/planScenes.beats.test.ts` |
| visual intent in queries and vision check | Done in code; not run since the no-test rule | `37512d6`, `3c7e754`, `b2dc75c`; tests `sectionVisualBeats`, `visionCheckBeatPrompt`, `visualVerdictBeatContext`, `visualReuse`, `sceneQueryPrompt` |
| `BEAT_MOTION` + emotion speed, deterministic | **Partly done** | `BEAT_MOTION` and `applyBeatMotion` are called from `packages/shared/src/edit/plan.ts`. The table and its deviations from the spec are in `docs/ARCHITECTURE.md` §9.7. **Emotion speed multiplier is NOT implemented**: `packages/shared/src/motion/beatMotion.ts` has no emotion table. |
| director prompt gets beats (or skipped with reason) | **Not done** | `buildDirectorPrompt` (`apps/server/src/compose/director/llm.ts`) has no beat references (grep for `beat` in `apps/server/src/compose/director` returns 0). The spec's skip reason was "TASK-141 not done"; `docs/tasks/TASK-141.done` exists, so that reason no longer holds. **Decision needed.** |
| music segments and ducking | **Partly done** | Ducking curve: `musicCurveExpr` in `packages/shared/src/render/plan.ts` (lower under tension/reflection, dip before reveal, lift on payoff), wired into the music chain. Segments: `musicSegments` in `packages/shared/src/music/segments.ts` is pure and has **no production caller**, so multi-track mood queries per segment are not built. |
| SCRIPT_REVIEW gate | **Partly done** | Server path done in code, not run: setting `scriptOutlineApproval` (`off`/`outline`/`script`, default `off`) in `packages/shared/src/schemas/project.ts`; stage in `STAGE_ORDER`/`GATES` (`packages/shared/src/pipeline.ts`); auto-pass when off (`orchestrator.ts` ~1154, ~1224–1240); outline park and resume (`approveGate` → `approveOutline`, `finishApprovedOutline`, `passScriptReviewAfterOutline`, ~329–413); script mode waits; `OUTLINE_PENDING` rechecks in `scriptService.ts`; FAILED-job accounting for `OUTLINE_PENDING` (TASK-145 accounting). Web: the outline panel exists (`ScriptDraftPanel.tsx`, `ScriptTab.tsx`), but **no `SCRIPT_REVIEW` stage label exists in `apps/web/src`** (the only match is a test comment), so the script-mode approval surface on the web is not verified. |
| tests (shared, server, mcp, web), typecheck, build | **Not run since the no-test rule**; full suites, typecheck and build never run on the final tree | See the owed list. |
| ARCHITECTURE, user guide, featureMap, changelog, three skill updates | Done; text checked against code by grep, not by test | `docs/ARCHITECTURE.md` §9.6, §9.7; `docs/user-guide/du-an-va-quy-trinh.md` ("Duyệt dàn ý trước khi làm hình" and a motion/music note in "Timeline"); `packages/shared/src/features/featureMap.ts` entry `outline-approval`; `docs/user-guide/nhat-ky-thay-doi.md` TASK-146 section; skills `video-du-an-va-pipeline`, `video-stage-kich-ban`, `video-render-va-thumbnail`. |
| report and `.done` | This file written; `.done` reserved for the user | |

## What changed in the last window

- **Gate:** SCRIPT_REVIEW auto-passes when off. `outline` parks SCRIPT after the outline and resumes narration on approval. `script` waits after the full script. Draft phase `outline_ready` / `outline_approved` / `done` in `script_drafts.phase` (migration `0104_script_draft_phase.sql`, generated only, not applied to real DBs).
- **Approval path (server):** the outline is approved with `approve_gate` and `gate: "SCRIPT"`. The web panel sends the pipeline approve action for stage `SCRIPT` (`apps/web/src/features/script/ScriptTab.tsx`, `approveOutline`). `orchestrator.approveGate("SCRIPT")` always goes to `approveOutline`, which errors unless SCRIPT is `WAITING_USER` and the draft phase is `outline_ready`. In `script` mode the gate to approve is `SCRIPT_REVIEW`. While the outline waits, the quality repair and the SCRIPT quality hold are skipped (`apps/server/src/registry/tools/pipelineActions.ts`, `outlineWaiting`).
- **MCP:** whether the MCP server exposes these gate values was not checked. `apps/server/src/supervision/leases.ts` line 29 lists `approve_gate: project()`; whether that matches the routing rule was not checked.
- **Channel default:** `scriptOutlineApproval` is in `ProfileDefaultBriefSchema` and `ProfileDefaultBriefInputSchema` (`packages/shared/src/schemas/profile.ts`). It is **API only**: there is no UI on the profile page. The project form reads it as the initial value (`CreateProjectDialog.tsx` line 159). A strip bug in the output schema was found by reading and fixed.
- **Web (D2):** outline approval panel with the button "Duyệt dàn ý" in the script tab (shown also when `script` is null). The server rejects hook switches and rescore writes while the outline is pending (`scriptService.ts` ~51, ~107, ~730). The web behaviour of those buttons was not checked. The setting is on the project create and edit forms with these option labels: "Tắt: chạy tự động, không chờ duyệt", "Duyệt dàn ý trước khi viết (không duyệt kịch bản sau)", "Duyệt kịch bản sau khi viết". **Not** on `BriefFields` (`BriefSettings` does not carry the field, so it was reverted).
- **Placement:** in `CreateProjectDialog.tsx` the `settings.scriptOutlineApproval` line (257) is inside `if (customize)`, next to `autoRender`. When customize is off, no value is sent and the server default applies. Whether the channel default then applies was not checked.
- **Runtime setting:** whether changing `scriptOutlineApproval` stales a finished SCRIPT was not checked in this window.

## Known gaps (not done, honest list)

**Suspected regression (not in the numbered list, not fixed in this commit):** `orchestrator.approveGate` (`apps/server/src/pipeline/orchestrator.ts` line 330) sends every gate `SCRIPT` to `approveOutline`, which errors unless SCRIPT is `WAITING_USER` with draft phase `outline_ready`. A normal SCRIPT approval in another state now fails, including the default `off` mode. Not yet checked whether a SCRIPT `WAITING_USER` state outside outline mode can occur. The tests that approve `gate: "SCRIPT"` (`autonomyGates.test.ts` 139–172 and 469, `qualityRepair.test.ts` 185, `missionApprovalPath.test.ts` 44) mock the orchestrator, so they do not catch this.

1. Director slice 4 not done (see the table). Decision needed.
2. Emotion speed multiplier in `BEAT_MOTION` not done.
3. `BEAT_MOTION` deviates from the spec table (the spec is `docs/cursor/TASK-146.md` §3). The real table is in ARCHITECTURE §9.7. Deviations: `evidence` is `push_in` (spec: zoom or highlight, graphic call-out); `reveal` is `punch_in` with no hard-cut or no-dissolve control; `payoff` is `pull_out` with no hold; `reflection` is `pull_out` with no dissolve and no longer shots; `transition` is `null`, which keeps the cycle (spec: per preset); `tension` does not shorten shots towards the end of the beat. The frequency cap is `capSec` inside `applyBeatMotion`; its interaction with the `FREQUENCY` table was not checked.
4. `musicSegments` has no caller; the multi-track mood-query path does not exist.
5. Outline editing: the panel only approves. The spec's "edit the central question or a beat's concrete moment" is not built, so "an edit to an approved outline reopens it" does not apply yet.
6. Channel default `scriptOutlineApproval`: API only, no profile-page UI.
7. Web: no `SCRIPT_REVIEW` stage label in `apps/web/src`, so the script-mode approval surface on the web is unverified. Fix before Done.
8. `CreateProjectDialog`: when customize is off, the setting is not sent. Whether the channel default then applies was not checked.
9. The CSS class `outline-approval-panel` has no stylesheet rule.
10. The second-approve assertion in `apps/server/test/task146OutlineApi.test.ts` is still loose (`>= 400`) and should be pinned to the exact code.
11. `script_submit_outline` is not implemented. Grep for `submit_outline` in `apps/` and `packages/` found nothing.
12. MCP tool descriptions for gates and the fleet/node routing rule ("the gate is never leased to a worker") were not checked or changed. The grep for `approve_gate` in `apps/` shows `supervision/leases.ts` lists `approve_gate: project()`; whether that is the required routing rule was not checked.
13. Cache behaviour when SCRIPT is re-run while parked with LLM cache on: report only, not analysed.

## Owed: unverified, must be run once the user permits

Tests, all written, none run since the no-test rule:
- Server: `autonomyGates.test.ts`, `qualityRepair.test.ts`, `missionApprovalPath.test.ts` (approve SCRIPT; see the suspected regression), `task146OutlineApi.test.ts`, `task146OutlineOrchestrator.test.ts`, `task146OutlineExecutor.test.ts`, `scriptReviewGate.test.ts`, `sectionVisualBeats.test.ts`, `visionCheckBeatPrompt.test.ts`, `visualVerdictBeatContext.test.ts`, `visualReuse.test.ts`, `sceneQueryPrompt.test.ts`, `beatMotion.test.ts`, `translation.test.ts`.
- Shared: `scriptReviewSettings.test.ts`, `musicSegments.test.ts`, `planScenes.beats.test.ts`, `beatMotion.test.ts`, `renderPlan.test.ts`, `presetMotion.pin.test.ts`.
- Web: `ScriptDraftPanel` outline panel (never rendered in a test), `ScriptTab`, `ProjectFormFields`, `CreateProjectDialog` (the placement inside `if (customize)` is read, not tested).
- Full suites: shared, server, mcp, web. Root typecheck. Build.
- Shared dist rebuild (`npm run build` in `packages/shared`) so the new `featureMap` entry `outline-approval` reaches the server and web from dist.
- Web CSS: class `outline-approval-panel` has no stylesheet rule yet.

Environment: the better-sqlite3 binary is built for Node ABI 137 (Node 24). The default `node` is v26 (ABI 147). Tests must run with Node 24, e.g. `CI=1 npx -y node@24 ../../node_modules/vitest/vitest.mjs run <files>` from `apps/server`. Never `npm rebuild` or `npm install` (an earlier window produced 43 ABI failures before this was known).

Feature map: the new entry is `outline-approval` in `packages/shared/src/features/featureMap.ts`; the shared dist rebuild is owed (see above).

## Open-source attribution

Checked 2026-11-17, from the spec. No dependency was added.

| Project | Licence | Use in this task |
|---|---|---|
| [Vincentwei1021/video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft) | no licence | Beat-to-shot grammar ideas from its README only. Nothing copied. |
| [remotion-dev/skills](https://github.com/remotion-dev/skills) | see repo | Motion and timing ideas only. Remotion is not used. |
| [jtydhr88/screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) | MIT | Scene and beat vocabulary, kept consistent with TASK-145. |
| video-production-skills (listed in the research doc) | Apache-2.0 | Shot list and music cue checklists: ideas only; attribution needed if wording is adapted. |

No maintained library for beat → shot mapping was identified.
