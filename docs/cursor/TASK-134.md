# TASK-134 — Stage data contract: input versions, no stale DONE, safe remote finalize 🧱🗄

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`; touches the orchestrator core, rate it hard). **Size:** M–L. **Migration:** one (drizzle-kit only). **New dependency:** none.
**Depends on:** 128b (migration slot). Run it alone among migration tasks. Do not run it beside a task that edits `pipeline/orchestrator.ts`, `pipeline/invalidation.ts` or `node/leaseService.ts`.
**Priority:** first task of the "node runs the whole pipeline" branch (TASK-135a/b/c). 135 builds directly on the table registry and the input versions made here.
**Source:** the 2026-11-16 review of data handoff between stages and between control and worker nodes.

## Why

Files are checked well (sha256, temp file then rename, lease fencing). State is not. Nothing records which version of the inputs a stage output was made from.

1. **A running stage is never marked stale.**
   - `markStaleFrom` (`pipeline/invalidation.ts`) only flips `DONE → STALE`.
   - `orchestrator.completeJob` (~line 486) writes `DONE` without any check.
   - So: a RENDER runs 20 minutes on a node, the user edits the script meanwhile, and the render still lands as `DONE`. An old video is treated as current and can be published.
   - VOICE from a node is already safe (it matches `scene.hash`). RENDER, VISUAL_SEARCH and the LLM stages are not.
2. **No input version per stage.** Only `voice_tracks`, `subtitle_tracks`, `research_notes` and the timeout plan keep an `input_hash`. Staleness depends on about 20 hand-placed `markStaleFrom` calls in `api/`, `review/` and `services/`. A new writer that forgets the call corrupts the pipeline silently.
3. **Remote render finalize writes before it checks the lease.**
   - `node/leaseService.ts` `complete()` runs `renameSync` into the render version dir, then `renders.finalize`, then `after()`, and only then calls `holding()` again.
   - A lease lost in between leaves a registered render while the job is handed to another node: two renders, and side effects that are never undone.
4. **Uploaded outputs are tracked only in memory.** `private readonly uploads = new Map` (~line 100). A control restart between the upload and `complete` gives `OUTPUTS_INCOMPLETE`, a full re-render, and orphan files in `uploadsDir`.
5. **Uploads cannot resume.** A broken connection restarts a multi-GB `final.mp4` upload from zero.

## Read first

- `packages/shared/src/pipeline.ts` (`STAGE_ORDER`, `STAGE_DEPENDS`, `GATES`, `dependentStages`).
- `apps/server/src/pipeline/orchestrator.ts`: `enqueue`, `startJob`, `completeJob`, `failJob`, the `markStaleFrom` calls at ~176/194/275, variant renders (~212), and `continueAll`.
- `pipeline/invalidation.ts` and every caller (`grep -rn "markStaleFrom(" apps/server/src`).
- `node/leaseService.ts` (`receiveOutput`, `complete`, `completeVoice`, `completeMedia`, `holding`, `discard`), `node/agent.ts` (`upload`, `download`), `node/artifactService.ts`.
- `db/schema.ts`: every table with a `project_id` (about 40). `jobs` payload shape.
- `stages/render/*` and `services/renderService.ts` (or wherever `renders.finalize` lives).

## Build

### 1. Project table registry (shared, code only)

- Add `apps/server/src/pipeline/dataContract.ts` with one entry per project-scoped table:
  - `table`: the drizzle table;
  - `owner`: the stage that writes it (`SCRIPT`, `VISUAL_SEARCH`, …), or `"project"` for project rows and settings, or `"control"` for rows that never leave the control machine (publications, OAuth-linked rows, operator audit, notification log, costs ledger aggregates);
  - `scope`: how a row belongs to the project (`project_id` column, or through `scene_id`, etc.).
- **A test fails** when a table with a `project_id` (or `scene_id`) column is missing from the registry. New tables must be classified on purpose.
- This registry is the base for 135a (project snapshot) as well; keep it free of node logic.

### 2. Input versions

- `inputVersion(projectId, stage)`: a sha256 over a stable serialization of
  - the rows of every table whose `owner` is a stage in the transitive upstream of `stage` (`STAGE_DEPENDS`), plus `"project"` settings that the stage reads;
  - the sha256 of every file those rows point to (use `ArtifactService.register`; paths are never hashed, content is).
- Keep the serialization deterministic: sorted keys, sorted rows by primary key, timestamps such as `updated_at`/`created_at` excluded.
- Cost: it runs at enqueue and at completion only. Measure it on the largest local fixture and state the time in the report. If it is over 200 ms, cache per table by a cheap change counter (`MAX(rowid)`, row count, `updated_at`) and say so.
- **Migration:** add `project_stages.input_version` (text, null) and `jobs.input_version` (text, null).

### 3. Completion guard

- `enqueue`/`startJob` store the current `inputVersion` on the job.
- `completeJob` recomputes it inside the same atomic block:
  - equal → `DONE` and the stage row stores `input_version`, as today;
  - different → the job is `SUCCEEDED` (its work is kept for reuse and caches), but the stage becomes `STALE` with message "Đầu vào đã đổi trong lúc chạy", and `continueAll` does not advance past it. In run-all mode, re-enqueue that stage once.
- `markStaleFrom` also handles `RUNNING` and `QUEUED` downstream stages: it leaves the job running (no kill), and sets a flag on the job (`jobs.invalidated_at`, part of the same migration) so the UI shows "sẽ chạy lại" right away. The guard above does the rest.
- The existing `markStaleFrom` calls stay. They are now an early signal, no longer the only protection. Add a debug check in tests: after any API write, every `DONE` stage's stored `input_version` equals the recomputed one, or the stage is `STALE`.
- Variant renders (~line 212) keep their current rule: they never invalidate earlier stages.

### 4. Remote finalize: lease first, then side effects

- In `leaseService.complete` (render, voice, media):
  1. `holding()`;
  2. validate the outputs (already done);
  3. **claim the completion**: one guarded UPDATE on `jobs` (`lease_id = ? AND status = 'RUNNING'` → a `finalizing` marker, e.g. `lease_until` pushed out and `node_id` kept). If 0 rows change → `LEASE_STALE`, discard, no side effect;
  4. only then move files, `finalize`, `after()`, `completeJob`.
- Once a job is finalizing, lease expiry must not hand it to another node. A finalize that crashes leaves the job for the normal stuck-job recovery, which retries finalize from the persisted outputs (step 5), not the whole render.

### 5. Persisted, resumable uploads

- Replace the in-memory `uploads` map with a table `node_uploads` (`job_id`, `lease_id`, `name`, `sha256`, `size`, `path`, `received_bytes`, `status`, `created_at`) in the same migration.
- **Resume:**
  - `HEAD /api/nodes/agent/jobs/:id/outputs/*` returns `Upload-Offset`;
  - `PATCH` with `Upload-Offset` appends;
  - the final sha256 check stays.
  - Follow the core of the tus 1.0 protocol (offset and append only; no extensions). Do not add a tus package.
- **Skip what control has:** before uploading, the agent sends `POST /api/nodes/agent/jobs/:id/have` with the sha256 list; files the `ArtifactService` already holds are linked, not uploaded.
- `node/agent.ts` uses resume on retry (3 tries, backoff) and the `have` check.
- **Cleanup:** uploads for jobs that are finished or failed for more than 24 h are deleted by the existing cleanup sweep; never delete an upload of a running or finalizing job.

## Mã nguồn mở có sẵn (open source)

- **Dagster** (Apache-2.0): "code version / data version" and staleness of assets. Take the idea of a stage output that carries the hash of its inputs; no code to copy.
- **Bazel / BuildKit** action cache keys: the input hash is the identity of a build step. Idea only.
- **tus resumable upload protocol 1.0** (spec, MIT reference servers such as `tus-node-server`): follow the offset/PATCH core. No package.
- **restic / git "have" negotiation**: send hashes first, transfer only what is missing. Idea only.

## Rules

- README rules 1–11. Migration only through drizzle-kit.
- Never approve gates or render on project `56374fb2-…`.
- No network in tests; fake nodes call the API in process (see `workerNodes` tests).
- Behaviour for a project that never sees a concurrent edit must not change: same stages, same outputs. Snapshot tests that change must be explained one by one.

## Tests

- **Registry:** a table with `project_id` and no entry → test fails (prove it with a temporary fake table in the test).
- **Input version:** stable across two calls; changes when an upstream row or file content changes; does not change for a downstream-only edit; timestamps alone do not change it.
- **Guard:**
  - edit the script while RENDER is RUNNING → the job succeeds, RENDER becomes `STALE`, it is not published, run-all re-enqueues it once;
  - no edit → `DONE` with `input_version` stored;
  - a `markStaleFrom` call on a running stage sets `invalidated_at`.
- **Remote finalize:**
  - lease lost before the claim → no render row, no moved file;
  - two concurrent `complete` calls → exactly one finalizes;
  - a crash after the claim → recovery finalizes from the stored uploads without a new render.
- **Uploads:**
  - control restart between upload and `complete` → `complete` succeeds;
  - an upload cut at 40 % resumes at the right offset and passes the sha256 check;
  - a wrong offset → 409;
  - `have` skips known files.

## Done

- [ ] registry + guard test; input versions; completion guard; `markStaleFrom` on running stages
- [ ] lease-first finalize; `node_uploads`; resume + `have` in agent and API; cleanup
- [ ] tests; shared + server + web suites; typecheck; build
- [ ] user guide (stage "sẽ chạy lại", worker upload resume) + changelog
- [ ] report with the input-version timing → `docs/tasks/TASK-134.done`
