# TASK-120 — Remote nodes run more than RENDER: TTS, media fetch, short-lived secrets 🛰️

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** M. **Migration:** probably one, for a lease secret record; drizzle-kit only (🗄 lane: no other migration task at the same time). **New dependency:** none.
**Depends on:** TASK-119 done and reviewed. Do not start before `docs/tasks/TASK-119.done` exists.

## Why

TASK-118 built nodes: a node registers, takes leases, sends heartbeats, gets a cancel list and uploads artifacts. But `apps/server/src/node/placement.ts` only lets a node take `RENDER`, while two other stages are heavy and could run elsewhere:
- **local TTS.** Piper and VieNeu need CPU or GPU and models on disk; a GPU box at home is a better place than the laptop that runs the app;
- **media fetch.** Downloading and transcoding stock clips is network- and disk-heavy.

Those stages need provider keys (TTS keys, Pexels/Pixabay keys). Today secrets never leave the main server. This task sends a node **only the secret a lease needs, only while the lease lives**.

## Read first

- `apps/server/src/node/{placement,leaseService,nodeService,agent,remoteBundle,artifactService,tokens,settings}.ts` and the TASK-118 and TASK-119 reports.
- The TTS providers (TASK-040): `apps/server/src/tts/` (Piper, VieNeu and the others), and how `TokenVault` gives a key to a provider.
- The media fetch path inside VISUAL_FETCH / visuals: find where clips are downloaded and transcoded. Do not refactor `visualService.ts`; TASK-085 does that.
- TASK-125 (overdue checks): remote jobs never get a clock kill. Keep that true for the new stages.

## Build

1. **Placement by capability.**
   - A node declares capabilities on register: `render`, `tts:piper`, `tts:vienneu`, `media_fetch`, with versions and free disk.
   - `localMayTake` and the lease query become per stage: a stage list in settings (`remoteStages`, default `["RENDER"]`) with `off|prefer|only` per stage.
   - A job goes to a node only if the node has the capability. Keep today's RENDER behaviour exactly when the settings are defaults; add a test for that.
2. **Remote bundle per stage.** Extend `remoteBundle.ts` with a TTS bundle (scene texts, voice settings, word-timing mode) and a media bundle (asset URLs, licence records, crop and transcode targets). The node returns artifacts through the existing `artifactService` upload path, and the main server verifies hashes and sizes the same way as for renders.
3. **Short-lived scoped secrets.**
   - When a lease that needs a key is granted, the server makes a **lease secret**: the one key the stage needs, encrypted for that node with the node token key, with an expiry of lease TTL + 5 min.
   - The secret is given only in the lease response, never in heartbeats or logs. It is revoked when the lease ends, fails or is cancelled. A node that asks again after expiry gets 410.
   - Store only a hash and metadata (which key, which lease, expiry, revoked). Never store the plain key twice.
   - A key marked "không gửi ra node" in TokenVault is never sent: that stage then stays local.
   - Every secret grant writes an audit row the user can see on the nodes page ("Node X nhận khoá Google TTS cho job Y, hết hạn lúc …").
4. **Node agent.** `node/agent.ts` (or the separate node package, if 119 made one) runs the new stages with the same sandbox rules as render: its own work dir, cleanup, and no secret written to disk. Keep the key in memory and wipe it after use.
5. **UI.** The nodes page shows capabilities, per-stage placement settings, and the secret audit list.

## Mã nguồn mở có sẵn (open source)

- **HashiCorp Vault** "response wrapping" and dynamic secrets (MPL-2.0) are the model for short-lived scoped secrets. Copy the idea, not the code; we already have TokenVault.
- **BullMQ** / **Temporal** worker capabilities ("task queues per capability") are the model for placement by capability. Do not add them.
- **Piper** (MIT) and VieNeu, already integrated; reuse our provider code on the node.
- Use libsodium-style sealed boxes only if `tokens.ts` already has a crypto helper; otherwise use Node `crypto` (X25519 + AES-GCM). No new package.

## Rules

- README rules 1–11. Never send `.env` contents, OAuth refresh tokens or publishing tokens to a node. Only TTS and media API keys may ever go out.
- Do not change TASK-125's overdue logic. Remote stages use it as-is.

## Tests

- defaults keep the RENDER-only behaviour;
- placement by capability, so a node without `tts:piper` never gets a Piper job;
- the secret is in the lease response only, expires, is revoked on cancel, and a request after expiry gets 410;
- a "không gửi ra node" key keeps the stage local;
- the audit row is written;
- artifact hash checks for TTS audio and media files;
- the remote TTS output gives the same word timings as local for the mock provider.

## Docs

`docs/user-guide` page on nodes: new stages, how secrets are handled, and how to keep a key local. `featureMap`, changelog, architecture note.

## Done

- [ ] capability placement + per-stage settings; RENDER default unchanged
- [ ] TTS and media bundles + artifacts
- [ ] lease secrets: scoped, expiring, revoked, audited
- [ ] nodes page
- [ ] tests; typecheck, all suites
- [ ] user guide + changelog
- [ ] report `docs/tasks/TASK-120.report.md`, then `docs/tasks/TASK-120.done`
