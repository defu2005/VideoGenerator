# TASK-126 report: VISUAL_SEARCH never skips vision, and verifies web (Brave) images

Not committed, not pushed (AGENTS.md rule). No migration, no new dependency.

## What changed

- `apps/server/src/services/visualReuse.ts` (new): `planSceneReuse(...)` returns `{reuseCandidates, needsVerify, skip}`; `VISION_BATCH_SIZE = 5`.
- `apps/server/src/services/visualService.ts`:
  - The boolean `unchanged = hash matches` is replaced by the reuse plan. A scene with a matching hash, vision required, no protected selection, no valid selection, and no vision result in its top 5 stored candidates is `needsVerify`. It reuses the stored candidates (no provider search, no alt-query search), seeds its stored checks, and goes through rerank, vision, web and selection like a changed scene.
  - Second vision pass: Brave hits added after a vision reject are attached and checked (at most 5 per scene, same budget, limiter, signal, LLM call and cost accounting, no re-search rounds). If the budget gate or the vision call is unavailable, the scene is `needsAttention`, the unchecked web candidates stay in the pool, and nothing unchecked passes.
  - Per-scene `cause`: `vision_reject`, `vision_unavailable`, `no_candidates`, `web_failed`. For the existing Review UI, `vision_unavailable` also sets `reason: "vision_missing"` and `no_candidates` sets `reason: "no_candidate"`.
  - Summary adds `vision checked X (web Y)`, `re-verified N scene(s) from stored candidates`, and, when vision is required and 0 relevant images were selected, `0 selected: <causes>` (or "every scene was skipped as unchanged or kept by the user").
- `packages/shared/src/schemas/vision.ts`: `VisionAttentionCauseSchema` and an optional `cause` on `SceneVisionMetaSchema`. `@vg/shared` rebuilt.
- `apps/server/test/visualReuse.test.ts` (new, 10 tests).
- Docs: `docs/user-guide/xu-ly-su-co.md` (section "Không có ảnh nào được chọn"), `docs/user-guide/nhat-ky-thay-doi.md` (TASK-126 entry), `PROPOSALS_AND_BUGS.md` (one appended "Trạng thái: đã sửa trong TASK-126" line under #12 and under #13; Hermes's text untouched).
- No `visual_search_state` rows are deleted in code; old data heals on the next run.

## Tests

| Workspace | Result |
|---|---|
| packages/shared | 737 passed (91 files) |
| apps/mcp | 22 passed |
| apps/web | 203 passed (72 files) |
| apps/server | 1103 passed, 6 skipped, 25 failed (see below); 10 of the passed are the new tests |

`npm run typecheck` (all workspaces) and `npm run build` pass.

Server failures, none in files this task owns or touches (all existing visual tests pass):
- `workerNodes.test.ts` (20) and `workerAgent.test.ts` (1): `table nodes has no column named capability_info`. TASK-120's migration is in flight.
- `qualityRepair.test.ts` "shelves the project when the budget runs out" (1): `digest.shelved[0]` is undefined, in the shelved-project digest. It also fails when run alone. Unrelated to visual search; not investigated further.
- `composeScene.test.ts`, `imageHash.test.ts` (30 s timeouts) and `render.test.ts` (90 s timeout): ffmpeg / environment timeouts.

## Deviations and limits

- `cause` is a separate field instead of extending `VISUAL_ATTENTION_REASONS` (avoids changing the shared enum the web UI switches on).
- `featureMap` not changed: the existing "Ảnh" entry already says an image without a vision result is not ready to render.
- Brave hits added after a vision reject are still not run through `enrichBraveCandidates` (that crawls pages; out of scope). Real Brave hits keep `licenseVerified: false`, which `candidatePassesGate` refuses by design, so such a hit is now vision-checked and shown in Visual Review but is not auto-selected unless its license is verified. The gate was not loosened. The Brave-path test uses a hit with `licenseVerified: true`. If you want those hits auto-selectable, a follow-up should enrich the post-reject hits.
- Tests clear `llm_cache` before the second run, otherwise the identical vision prompt is answered from cache and the provider call count would be 0 for the wrong reason.

## What you should do

Rerun VISUAL_SEARCH on Berserk (`1ef6de1f-cf84-4552-8aed-8958f290bc0e`) in MAX. Its stored candidates with `vision_check = NULL` will now be verified, no manual DB step needed. Do not run anything on `56374fb2-54cf-48ff-9441-2e6c653295d4`.
