# TASK-119 report: trang Máy worker

**Done:** `/nodes` page (list, detail, drain/resume/rename/concurrency/revoke, 15 s polling paused when hidden, `nodes.manage` gate, nav + Ctrl+K + featureMap + help), "Thêm máy" dialog (`buildJoinCommands`, countdown, localhost warning, token shown once, 2 min wait), real capability probe, "Cần cập nhật" + "Cập nhật tất cả", opt-in `VG_EXIT_FOR_UPDATE=1` (exit 75), "Máy: <tên>/Máy chính" on the RENDER stage row via `nodeName` (batched, no N+1), tools `list_nodes` / `set_node_drain`, skill update, opt-in E2E (passed), docs. Typecheck, shared, web, mcp pass; server: 1 failure that is not mine (below).

## Tests
- shared 737 pass (incl. new `nodeCommands.test.ts`, 4), web 197 pass (new `NodesPage.test.tsx` 2, rewritten `WorkerNodesCard.test.tsx`), mcp 22 pass.
- server: 127 files pass, 1 fails: `test/qualityRepair.test.ts` "shelves the project when the budget runs out". That file is untracked and belongs to another session's quality-repair work (digest `shelved` empty). Not touched by me. `autonomy.test.ts` failed at first because `set_node_drain` had no `TOOL_GRANTS` entry; fixed (`set_node_drain: null`, always pending) and shared rebuilt.
- `workerAgent.test.ts` 10 pass (exit 75 test included), `workerNodes.test.ts` 24 pass, `agentSkillPack.test.ts` pass.
- `npx drizzle-kit generate` second run: "No schema changes, nothing to migrate".
- E2E `VG_E2E_NODE=1 npx vitest run test/workerNodeE2E.test.ts`: PASSED. Node joined over loopback, real probe `render.ok` in about 16 s, RENDER job ran on the node, `jobs.node_id` recorded, render DONE, `output.mp4` is a valid video (> 1 s), report ok. About 12 s for the job.

## Files
- shared: `schemas/node.ts` (probe, `NodeTargetVersionSchema`, `NodeDetailSchema`, `buildJoinCommands`, `buildUpdateCommands`, `isLoopbackControlUrl`), `schemas/job.ts` (`nodeName`), `schemas/autonomy.ts` (grant), `features/featureMap.ts`, `test/nodeCommands.test.ts`.
- server: `node/probe.ts` (new), `node/agent.ts`, `node/nodeService.ts`, `node/leaseService.ts`, `api/nodes.ts` (`GET /api/nodes/:id`), `jobs/jobRepository.ts`, `db/schema.ts` + migration `0072_clammy_queen_noir.sql` (probe column), `assistant/tools.ts|service.ts`, `auth/toolActions.ts`, `compose/hyperframes.ts` (export), `app.ts`, tests.
- web: `features/nodes/{nodesApi,JoinDialog,NodesPage}.tsx(+test)`, slim `WorkerNodesCard`, `App.tsx`, `nav.ts`, `CommandPalette.tsx`, `StageRow.tsx`, `PipelinePanel.tsx`.
- other: `deploy/docker/compose.worker.yml`, `deploy/README.md`, `.agents/skills/video-render-va-thumbnail/SKILL.md`, user guide (`may-worker.md` rewritten, changelog bullet).

## Deviations (and why)
1. Compose: spec asked `restart: unless-stopped` + `pull_policy: always`. Kept `restart: on-failure` (a revoked node exits 0 and would restart-loop; exit 75 is non-zero so updates still restart) and made `pull_policy: ${VG_PULL_POLICY:-missing}` (`vg:dev` is built locally, `always` would fail to pull).
2. Target version is only `"control"` (`nodeTargetVersion`): a render bundle is tied to the control plane's version, so a different target would produce jobs the node cannot run. The page shows it read-only. `NodeSettingsSchema` in shared is unused.
3. `setJobLease(null)` keeps `node_id` so the job history still names the machine.
4. Tools map to `settings.read` / `settings.write` in `toolActions.ts` (no `nodes.manage` mapping exists for tools).
5. E2E uses the pipeline harness plus a bare Fastify with `registerNodeRoutes`, not `buildApp`. Upload sha256 is verified server-side (mismatch is 422), then the file is moved, so the test checks the output is a playable video.
6. Migration is 0072 because 0071 is TASK-125's.
7. "Máy: …" is shown on the RENDER stage row only; `nodeName` is available in every job list DTO.

## Not done
- No "tự cập nhật" beyond exit 75 (no Watchtower, by design).
- Pending-action UI for `set_node_drain` uses the generic confirm flow.

## For TASK-120
- `GET /api/nodes` returns `targetVersion` and `nodeTargetVersion`; node rows carry `probe`. `GET /api/nodes/:id` gives running/recent jobs and `failures24h`.
- Job DTO has optional `nodeName`; null means main machine for a RENDER job.
- Agent exit code 75 = update requested; wrapper must restart on non-zero.
- `shared` is consumed from `dist`: rebuild (`npm run build -w packages/shared`) before server tests after shared edits.

## Open source
Probe-by-real-work is my own idea, no code copied. Nomad / Kubernetes node views were UX references only. Watchtower not added (new dependency, runs outside our control).
