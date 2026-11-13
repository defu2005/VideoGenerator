# TASK-126 — VISUAL_SEARCH: never skip vision, and verify web (Brave) images 🖼️

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M. **Migration:** none. **New dependency:** none.
**Depends on:** nothing new. Runs in parallel with 111 and 120 (file boundary: this task owns `apps/server/src/services/visualService.ts` and the vision helpers; it does not touch nodes, style packs or the LLM registry).
**Source:** Hermes `PROPOSALS_AND_BUGS.md` #12 (BUG-VG-VISUAL-CACHE-006) and #13 (BUG-VG-BRAVE-VISION-007). Both are confirmed in the current code.

## Why

On Berserk (`1ef6de1f-cf84-4552-8aed-8958f290bc0e`), when vision is required (MAX), two bugs together leave **0 of 31 scenes** with an image:

1. **Vision is skipped forever when nothing changed.** `unchanged = state?.search_hash === searchHash` (around line 1655). If the stored candidates never got a vision check (an earlier run crashed, or ran with a bad path), the scene stays "unchanged". The vision loop (~2027), the web search (~2142) and the rerank (~1791) all skip unchanged scenes. Then `candidatePassesGate` (~1145, ~2364) refuses every candidate, because none has `visionCheck`. Hermes worked around it by deleting `visual_search_state` rows.
2. **Web (Brave) images are never checked.** After a vision reject, Brave hits are merged into `entry.ranked` (~2160), but no `attachVisionFile` / `verifySceneVision` runs on them. The gate then refuses them too. The stock images were correctly rejected (`wrong_subject`), and the right images were never looked at.

## Read first

- `apps/server/src/services/visualService.ts`, the whole `searchVisuals` flow: building `sceneSearches` → rank → rerank → vision pass (~2020–2130) → web search after reject (~2138–2180) → consistency → selection (~2290–2400). Also `candidatePassesGate`, `attachVisionFile`, `visionChecksByCandidateKey`, `visionMetaByScene`, and `webCap`.
- `apps/server/src/services/visionVerify.ts` (`verifySceneVision`, batch schema and error handling since BUGFIX-VISION-SCHEMA).
- `packages/shared/src/visuals/rank.ts` (`copyrightMode`, `licenseVerified`).
- TASK-121 quality repair (`quality_repairs`, the repair ladder). This task must **not** loosen any gate. The TASK-121 rule stands: "gates are not loosened".
- `PROPOSALS_AND_BUGS.md` #12 and #13 for the evidence.

## Build

1. **Replace the boolean `unchanged` with a reuse plan per scene.**
   - `reuseCandidates`: the search hash matches, so the stored candidates are reused and no new provider search happens.
   - `needsVerify`: true when vision is required for this run **and** the scene has no valid selection **and** none of its top K stored candidates (K = the current vision batch size per scene) has a `visionCheck`.
   - A scene is fully skipped only when `reuseCandidates && !needsVerify`, or when it has a protected selection.
   - Rerank, vision, web search and selection treat a `needsVerify` scene like a changed one. They use the stored candidates, so provider searches are not repeated.
   - Give the helper a name, for example `planSceneReuse(...)`, and test it alone.
2. **Second vision pass for web candidates.**
   - After the Brave step, for each scene that received new web hits, run `attachVisionFile` + `verifySceneVision` on the top new web candidates. Take at most N per scene, with N = the vision batch size. Merge the results into `visionChecksByCandidateKey` and `visionMetaByScene` before the selection step.
   - It uses the same budget, limiter, signal and cost accounting as the first pass, and counts toward the stage's LLM call count.
   - If the budget or the vision model is not available, do **not** let unchecked images pass. Mark the scene `needsAttention` with the reason `vision_unavailable`, keep the web candidates in the pool, and show them in Visual Review so the user (or the TASK-121 repair ladder) can pick.
   - Hermes's option 2 ("let Brave images pass without vision") is rejected: it would loosen the gate.
3. **Clear reasons in the summary and meta.**
   - Per scene `needsAttention` reasons must say which case happened: `vision_reject`, `vision_unavailable`, `no_candidates`, `web_failed`.
   - The stage summary adds `vision checked X (web Y)`.
   - A run that reuses everything still says how many scenes were verified, so "8 s, 0 LLM calls, 0 relevant" can no longer happen silently while vision is required. If that state is reached, the summary says why.
4. **Self-heal old data.** No manual DB step is needed. Projects whose candidates have `vision_check = NULL` (like Berserk) get verified on the next run through point 1. Do not delete `visual_search_state` rows in code.
5. **Docs.**
   - `docs/user-guide` troubleshooting: "Không có ảnh nào được chọn" explains the reasons.
   - Changelog line.
   - Append a "Trạng thái: đã sửa trong TASK-126" line under #12 and #13 in `PROPOSALS_AND_BUGS.md`. Append only; do not rewrite Hermes's text.

## Mã nguồn mở có sẵn (open source)

- Nothing to adopt: this is our own pipeline logic. Keep using the existing vision path. No new library.

## Rules

- README rules 1–11. Tests use the mock vision and HTTP fixtures, never real Brave or real LLMs.
- Never loosen `candidatePassesGate` or the render gate.
- Never run the pipeline or approve gates on project `56374fb2-54cf-48ff-9441-2e6c653295d4`.
- Do not touch `node/*`, style pack files, or `providers/llm/registry.ts` (TASK-120, TASK-111 and TASK-127 may run beside you).
- After any `packages/shared` edit, run `npm run build -w @vg/shared`.

## Tests

- `planSceneReuse`: hash match + vision required + no vision on the top K → `needsVerify`; hash match + valid selection → skip; vision not required → skip; protected selection → skip.
- Integration, with a fixture project where all stored candidates have `vision_check = NULL`, hash unchanged, and MAX mode:
  - vision runs on the stored candidates;
  - no provider search is repeated (assert the provider mock call count is 0);
  - a selection is made when the mock vision passes.
- Brave path: the stock images get a mock vision reject, the mock Brave returns hits, and the mock vision passes one hit. That hit is selected, and its `visionCheck` is stored.
- Vision unavailable after web hits: the scene gets `needsAttention` with `vision_unavailable` and no selection, and the gate is not loosened.
- The summary string includes the vision counts.
- The existing visual tests still pass.

## Done

- [ ] reuse plan + second vision pass + reasons + summary
- [ ] tests; full server suite; typecheck; build
- [ ] user guide + changelog + status lines in `PROPOSALS_AND_BUGS.md`
- [ ] report `docs/tasks/TASK-126.report.md` → `docs/tasks/TASK-126.done`. The report tells the user to rerun VISUAL_SEARCH on Berserk.
