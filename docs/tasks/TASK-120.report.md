# TASK-120 report: worker nodes run TTS and media fetch

Worker nodes now also run VOICE (TTS) and MEDIA_FETCH, placed by capability, with short-lived secrets bound to the lease. Defaults keep RENDER-only. Nothing committed.

## Summary
- Capabilities `render`, `tts:<provider>`, `media_fetch` with versions (`capabilityInfo`). CLI TTS detected for real; key providers via `VG_NODE_TTS`; `VG_NODE_MEDIA=false` turns media off.
- Per-stage placement off|prefer|only (VOICE, MEDIA_FETCH default off). Retries and local-only keys run on the control plane.
- Sealed lease secret: X25519 + HKDF + AES-256-GCM, in the lease response only, expiry = lease TTL + 5 min, revoked on complete/fail/cancel/revoke, 410 `SECRET_GONE` after. Only `tts.<id>.apiKey` can be lent. Hash + metadata in `node_lease_secrets`; audit row per grant. Node holds key in memory and wipes it.
- Control plane checks sha256/size for TTS audio and media files; bad `result.json`/`report.json` gives 422.
- Web: Nodes page has stage placement, local-only key checkboxes, per-capability toggles with versions, and a "Khoá đã cho node mượn" audit card.

## Files
- Shared: `packages/shared/src/schemas/node.ts`, `schemas/renderBundle.ts`, `features/featureMap.ts`.
- Server: `db/schema.ts`, migrations `0073_goofy_kylun.sql`, `0074_modern_the_leader.sql` (+ meta/journal), `node/{settings,nodeService,remoteBundle,secretBox,leaseSecrets,mediaFetch,placement,leaseService,remoteRunners,agent}.ts`, `providers/tts/registry.ts`, `stages/voice/voiceExecutor.ts`, `pipeline/executorRegistry.ts`, `app.ts`, `api/nodes.ts`.
- Web: `features/nodes/{nodesApi.ts,NodesPage.tsx,NodesPage.test.tsx}`.
- Tests: `apps/server/test/remoteStages.test.ts` (new, 21 tests).
- Docs: `docs/user-guide/may-worker.md`, `docs/user-guide/nhat-ky-thay-doi.md`, `docs/architecture/multi-user-multi-node.md`.
- `services/visualService.ts` (TASK-126) was NOT touched by me.

## Test counts (npm test --workspaces)
shared 737, mcp 22, web 204 (72 files), server 1147 passed / 6 skipped / 2 failed (131 files).
Failures: `qualityRepair` "shelves the project when the budget runs out" (pre-existing, not mine). `workerAgent` "VG_EXIT_FOR_UPDATE=1 ..." timed out under full-suite load; it passes alone (10/10, run twice). Typecheck clean in all four workspaces, `npm run build` OK, I made no package.json changes (the working tree has package.json diffs from earlier tasks), no NUL bytes. Migration second run: "No schema changes".

## Deviations / not done
- MEDIA_FETCH has the node runner and placement, but nothing in the render-prepare path auto-creates media side jobs yet; call `MediaFetchService.place` to use it.
- Capability version equals the agent app version (no per-tool version probe).
- The regrant route exists but the agent does not use it yet (regrant never extends expiry).
- No agent-level unit test for VOICE/MEDIA with a fake fetch; covered at runner and service level.
- Browser check of the Nodes page not run in a live app; covered by the NodesPage component tests.
