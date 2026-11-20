# TASK-137 — Storage provider: workers move files directly, not through the control server 🗄📦

**Who:** a new Sonnet 5.5 session (or Cursor `grok-4.7-xhigh`). **Size:** L. **Migration:** one (drizzle-kit only). **New dependency:** none. Sign S3 requests with `node:crypto`; see "Open source".
**Depends on:** 134 (persisted uploads, `have`), 131 (MEDIA_FETCH). Run it alone among migration tasks. Do not run it beside a task that edits `node/leaseService.ts`, `node/agent.ts`, `node/uploadStore.ts` or `storage/paths.ts`.
**Source:** PROPOSAL-STORAGE-004 (`PROPOSALS_AND_BUGS.md` #18, part 1) and [SCALE-PLAN.md](SCALE-PLAN.md) row 2.

## Why

- Every file a worker reads or writes passes through the control server (`node/agent.ts` download/upload, `api/nodes.ts` agent routes, `node/uploadStore.ts`).
- A 2 GB `final.mp4`, footage prefetch and voice files all use the control machine's uplink and disk. With several workers, that uplink is the ceiling, and the control machine's disk fills up.
- An S3-compatible bucket (Cloudflare R2 has no egress fee) lets workers download and upload directly with short-lived signed URLs. Control only signs URLs and verifies hashes.

## Read first

- `apps/server/src/storage/paths.ts` (`projectDir`, `resolveAssetPath`).
- `node/artifactService.ts` (`register`, sha256 cache), `node/uploadStore.ts`, `node/leaseService.ts` (`receiveOutput`, `complete*`, finalize claim from 134), `node/agent.ts` (`download`, `upload`, cache, `have`), `node/remoteBundle.ts`, `node/mediaFetch.ts`.
- `api/nodes.ts` agent routes (lease response shape) and `packages/shared` node schemas.
- `settings/secrets.ts` (vault) and `node/leaseSecrets.ts` (what may leave the machine).

## Build

### 1. `StorageProvider` interface (server)

- `apps/server/src/storage/provider.ts`:

  ```ts
  interface StorageProvider {
    id: "local" | "s3";
    put(key, localPath, sha256): Promise<void>;
    getDownloadUrl(key, ttlSec): Promise<string | null>; // null = not reachable directly
    getUploadTarget(key, sha256, size, ttlSec): Promise<{ url; headers } | null>;
    head(key): Promise<{ size; sha256? } | null>;
    delete(key): Promise<void>;
    checkHealth(): Promise<{ ok; latencyMs; error? }>;
  }
  ```

- **Content-addressed keys:** `blobs/<sha256[0:2]>/<sha256>`. Project paths stay in the DB rows as today. A new `blobs` table maps `sha256 → size, provider, key, stored_at, verified_at`. That table is the migration.
- **`LocalStorageProvider`** wraps today's `DATA_DIR` behaviour and returns `null` for direct URLs. That keeps the current path unchanged when S3 is off.
- **`S3StorageProvider`** (S3, R2, MinIO):
  - endpoint, region, bucket, access key id and secret, all from the vault;
  - presigned `GET` and `PUT` with SigV4 query signing;
  - `x-amz-checksum-sha256` on PUT when the endpoint supports it; otherwise verify after upload with `head` + a server-side download hash in the background;
  - multipart upload is out of scope (keep files ≤ 5 GB; render outputs are below that).

### 2. Write-through and read path

- On control, every file registered by `ArtifactService.register` that belongs to a lease bundle (render inputs, footage, voice) is mirrored to the active provider in the background, once per sha256.
- The local copy stays: control still renders and reads locally.
- **Lease response:** each input file gets `artifactUrls: { preferredUrl, fallbackUrl }`.
  - `preferredUrl` is the signed provider URL (TTL = lease TTL + 5 min) when the blob is mirrored and healthy.
  - `fallbackUrl` is today's control route.
- **Outputs:** the agent asks for an upload target per output (`POST /api/nodes/agent/jobs/:id/upload-targets` with sha256 and size).
  - Control returns a signed PUT, or `null`. On `null` the agent uses the 134 resumable control upload.
  - After a direct PUT, the agent calls `complete` with `{ name, sha256, size, provider: "s3" }`.
  - Inside the finalize claim (134), control verifies with `head` and pulls the object into the local project dir with a hash check, then runs the same finalize as today. A mismatch fails the job with `STORAGE_HASH_MISMATCH` (retryable once).

### 3. Fallback and health

- The agent tries `preferredUrl` (2 tries), then `fallbackUrl`.
- It reports per-job transfer stats (`bytes`, `ms`, `route: direct|control`, `error`) in the completion payload.
- Control keeps `storage_provider_health` in `app_settings` (last ok, last error, rolling failure rate).
- An anomaly `storage_fallback_active` is raised through the existing anomaly path when more than 3 fallbacks happen in 30 min.
- When health is bad, control stops handing out `preferredUrl` for 10 min.

### 4. What may leave the machine

- Only signed URLs leave. The S3 credentials never do.
- Signed URLs are never logged in full: log the key and the expiry only.
- The protected project `56374fb2-…` keeps local-only storage: never mirrored.

### 5. Settings UI

- Settings → "Lưu trữ":
  - provider (local / S3-compatible);
  - endpoint, bucket, region, credentials (vault fields);
  - a test button (put, head, signed get, delete a 1 KB probe);
  - health;
  - bytes mirrored today and the direct versus fallback ratio.

## Mã nguồn mở có sẵn (open source)

- **aws4** by mhart (MIT, https://github.com/mhart/aws4): a small SigV4 signer. Either vendor the query-presign part into `apps/server/src/storage/vendor/aws4.ts` with its licence header and a `docs/THIRD_PARTY.md` entry, or write it from the AWS SigV4 spec. No npm package.
- **MinIO** (AGPL server, run as a separate binary only): use it in the manual check, not in tests and not in the repo.
- **rclone** / **restic**: content-addressed layout and "have" negotiation. Idea only.
- **Google Drive** provider from the proposal is left out: it needs per-user OAuth and has no presigned PUT. Report if you think it should come back.

## Rules

- README rules 1–11. Migration only through drizzle-kit.
- Tests: no network. Use a fake S3 (Fastify in process that checks the SigV4 signature with the vendored signer) or an injected fetch.
- With storage = local, behaviour and test snapshots must not change.

## Tests

- **Signer:** known AWS SigV4 test vectors pass (presigned GET, PUT with checksum).
- **Mirror:** a registered file is mirrored once per sha256; the second register does not upload again.
- **Lease:** the response carries `preferredUrl` + `fallbackUrl` when mirrored and healthy, only `fallbackUrl` when local or unhealthy.
- **Output:**
  - direct PUT then `complete` → finalize with a verified local copy;
  - hash mismatch → `STORAGE_HASH_MISMATCH`;
  - target `null` → 134 upload path.
- **Fallback:** direct GET fails twice → control route; 4 fallbacks → anomaly; health bad → no `preferredUrl` for 10 min.
- **Secrets:** no credential in lease response, logs, audit or snapshots; protected project never mirrored.

## Done

- [ ] provider interface, local + S3, `blobs` table
- [ ] mirror, lease URLs, upload targets, verified pull in finalize
- [ ] fallback, health, anomaly; settings UI with test button
- [ ] tests; server + web suites; typecheck; build
- [ ] `docs/ARCHITECTURE.md` (runtime + render), `docs/THIRD_PARTY.md`, `deploy/README.md` (R2 setup), user guide, changelog
- [ ] report → `docs/tasks/TASK-137.done`
