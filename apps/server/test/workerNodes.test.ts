import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@vg/shared";
import { readAppVersion } from "../src/render/appVersion.js";
import { listAgentEvents } from "../src/events/agentBus.js";
import { AppError } from "../src/lib/errors.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { LeaseService, type RenderPort } from "../src/node/leaseService.js";
import { NodeService, type NodeRow } from "../src/node/nodeService.js";
import { localMayTake } from "../src/node/placement.js";
import { getRemoteRenderSettings, saveRemoteRenderSettings } from "../src/node/settings.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { registerNodeRoutes } from "../src/api/nodes.js";
import { createProjectDir } from "../src/storage/paths.js";
import { BlobStore } from "../src/storage/blobStore.js";
import { S3StorageProvider } from "../src/storage/provider.js";

const fileSha = "a".repeat(64);
const registered = { path: "", sha: "", size: 0 };

vi.mock("../src/node/remoteBundle.js", () => ({
  RemoteBundleError: class RemoteBundleError extends Error {},
  logicalName: (sha: string) => sha,
  buildRemoteBundle: async () => ({
    bundle: { bundleVersion: 1, renderId: "render-1" },
    files: [{ name: "files/input.bin", sha256: registered.sha, size: registered.size }],
  }),
}));

type Harness = ReturnType<typeof createPipelineHarness>;
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function setup(provider?: S3StorageProvider) {
  const harness: Harness = createPipelineHarness();
  const root = mkdtempSync(join(tmpdir(), "vg-node-test-"));
  cleanups.push(() => { harness.close(); rmSync(root, { recursive: true, force: true }); });
  const input = join(root, "input.bin");
  writeFileSync(input, "input data");
  const artifacts = new ArtifactService(harness.sqlite, harness.clock);
  const reg = await artifacts.register(input);
  Object.assign(registered, { path: input, sha: reg.sha256, size: reg.size });

  const nodes = new NodeService(harness.sqlite, harness.config, harness.repository, harness.orchestrator, harness.clock);
  const finalize = vi.fn(async () => ({ render: { id: "render-1" } as never, reused: false }));
  const renders: RenderPort = {
    renderDir: (projectId) => join(root, "render", projectId),
    versionDir: (projectId, renderId) => join(root, "render", projectId, "versions", renderId),
    prepare: async () => ({
      prepared: {
        bundle: { renderId: "render-1" } as never,
        state: { renderId: "render-1" } as never,
        local: { resolvePath: (p: string) => p },
      },
    }),
    finalize,
  };
  const restartLeases = () => new LeaseService(
    harness.sqlite, harness.config, harness.repository, harness.orchestrator, nodes, renders, artifacts,
    async () => ({ message: "xong" }), harness.clock, undefined, undefined,
    provider ? new BlobStore(harness.sqlite, () => ({ provider, id: "fixture" }), () => undefined, harness.clock) : undefined,
  );
  const leases = restartLeases();

  function joinNode(name = "may-1"): { row: NodeRow; token: string } {
    const { token: joinToken } = nodes.createJoinToken(undefined);
    const joined = nodes.join({ joinToken, name, version: readAppVersion(), capabilities: ["render"], resources: { cpus: 2, ramMb: 4096, freeDiskMb: 50_000 } });
    return { row: nodes.authenticate(joined.nodeToken)!, token: joined.nodeToken };
  }

  function queueRender(): Job {
    return harness.repository.createJob({
      projectId: harness.projectId, stage: "RENDER", maxAttempts: 3, previousState: "PENDING", runAfter: harness.clock(),
    });
  }

  return { harness, root, nodes, leases, artifacts, finalize, joinNode, queueRender, restartLeases };
}

describe("direct S3 output", () => {
  it.each([false, true])("verifies bytes under the finalize claim, corrupt=%s", async (corrupt) => {
    const objects = new Map<string, Uint8Array>();
    const provider = new S3StorageProvider({
      endpoint: "https://s3.example.test", bucket: "test-bucket", region: "auto",
      accessKeyId: "fixture", secretAccessKey: "fixture-secret", checksumSha256: false,
    }, async (input, init) => {
      const key = new URL(String(input)).pathname;
      const object = objects.get(key);
      if (!object) return new Response(null, { status: 404 });
      const headers = { "content-length": String(object.length) };
      return new Response(init?.method === "HEAD" ? null : Uint8Array.from(object), { headers });
    });
    const { leases, joinNode, queueRender, harness, finalize, root } = await setup(provider);
    const { row } = joinNode();
    const other = joinNode("other").row;
    const job = queueRender();
    const lease = (await leases.lease(row, 1, undefined, true))!;
    expect(lease.storageUpload).toBe(true);
    expect(lease.manifest[0]?.artifactUrls).toEqual({
      fallbackUrl: `/api/nodes/agent/artifacts/${registered.sha}?jobId=${job.id}`,
    });
    const content = [
      { name: "final.mp4", text: "video bytes" },
      { name: "report.json", text: JSON.stringify({ clipsReused: 0, clipsRendered: 1, graphicShots: [], composeWarnings: [], joinWarnings: [] }) },
    ];
    const outputs = content.map(({ name, text }) => ({ name, sha256: sha(text), size: Buffer.byteLength(text), provider: "s3" as const }));
    for (const [index, output] of outputs.entries()) {
      const value = { jobId: job.id, leaseId: lease.leaseId, ...output };
      await expectApp(leases.outputTarget(other, value), 409, "LEASE_STALE");
      const signed = (await leases.outputTarget(row, value))!;
      const uri = new URL(signed.url);
      expect(uri.pathname).toMatch(/^\/test-bucket\/incoming\//);
      expect(signed.url).not.toContain("fixture-secret");
      objects.set(uri.pathname, Buffer.from(corrupt && index === 0 ? "video wrong" : content[index]!.text));
    }
    const request = leases.complete(row, job.id, { leaseId: lease.leaseId, outputs });
    if (corrupt) {
      await expectApp(request, 422, "STORAGE_HASH_MISMATCH");
      expect(finalize).not.toHaveBeenCalled();
      expect(harness.repository.getJob(job.id)?.error?.code).toBe("STORAGE_HASH_MISMATCH");
      expect(harness.repository.getJobLease(job.id)).toBeNull();
    } else {
      await request;
      expect(finalize).toHaveBeenCalledOnce();
      expect(readFileSync(join(root, "render", job.projectId, "versions", "render-1", "output.mp4"), "utf8")).toBe("video bytes");
      expect(harness.repository.getJob(job.id)?.status).toBe("SUCCEEDED");
    }
  });
});

function expectApp(promiseOrFn: unknown, status: number, code: string): Promise<void> | void {
  const check = (error: unknown) => {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(status);
    expect((error as AppError).code).toBe(code);
  };
  if (typeof promiseOrFn === "function") {
    try {
      (promiseOrFn as () => unknown)();
    } catch (error) {
      check(error);
      return;
    }
    throw new Error("expected AppError");
  }
  return (promiseOrFn as Promise<unknown>).then(() => { throw new Error("expected AppError"); }, check);
}

describe("join tokens", () => {
  it("works once: a second use answers 401 INVALID_JOIN_TOKEN", async () => {
    const { nodes } = await setup();
    const { token } = nodes.createJoinToken(undefined);
    const body = { joinToken: token, name: "a", version: readAppVersion(), capabilities: ["render"], resources: {} };
    expect(nodes.join(body).nodeToken.startsWith("vgn_")).toBe(true);
    expectApp(() => nodes.join(body), 401, "INVALID_JOIN_TOKEN");
  });

  it("refuses unknown and expired tokens with the same answer", async () => {
    const { nodes, harness } = await setup();
    const body = { name: "a", version: readAppVersion(), capabilities: ["render"], resources: {} };
    expectApp(() => nodes.join({ ...body, joinToken: "vgj_nope" }), 401, "INVALID_JOIN_TOKEN");
    const { token } = nodes.createJoinToken(undefined);
    harness.advance(61 * 60 * 1000);
    expectApp(() => nodes.join({ ...body, joinToken: token }), 401, "INVALID_JOIN_TOKEN");
  });

  it("stores only a hash of the token", async () => {
    const { nodes, harness } = await setup();
    const { token } = nodes.createJoinToken(undefined);
    const rows = harness.sqlite.prepare("SELECT token_hash FROM node_join_tokens").all() as Array<{ token_hash: string }>;
    expect(rows.some((row) => row.token_hash === token)).toBe(false);
  });
});

describe("revoked node", () => {
  it("loses its token and its running job is retried as NODE_LOST", async () => {
    const { nodes, leases, joinNode, queueRender, harness } = await setup();
    const { row, token } = joinNode();
    const job = queueRender();
    const lease = await leases.lease(row, 1);
    expect(lease?.jobId).toBe(job.id);
    nodes.revoke(row.id);
    expect(nodes.authenticate(token)).toBeUndefined();
    const error = JSON.parse((harness.sqlite.prepare("SELECT error FROM jobs WHERE id = ?").get(job.id) as { error: string }).error);
    expect(error.code).toBe("NODE_LOST");
    expect(harness.repository.getJobLease(job.id)).toBeNull();
  });
});

describe("lease and fencing", () => {
  it("uses persisted workspace binding for stage leases and rejects a lease after the project moves", async () => {
    const { leases, joinNode, queueRender, harness } = await setup();
    const { row } = joinNode();
    harness.sqlite.prepare("UPDATE nodes SET workspace_id='A' WHERE id=?").run(row.id);
    harness.sqlite.prepare("UPDATE projects SET workspace_id='B' WHERE id=?").run(harness.projectId);
    const job = queueRender();
    expect(await leases.lease(row, 1)).toBeUndefined();
    expect(harness.repository.getJob(job.id)?.status).toBe("QUEUED");
    harness.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(harness.projectId);
    const lease = (await leases.lease(row, 1))!;
    expect(lease.jobId).toBe(job.id);
    harness.sqlite.prepare("UPDATE projects SET workspace_id='B' WHERE id=?").run(harness.projectId);
    await expectApp(() => leases.fail(row, job.id, { leaseId: lease.leaseId, code: "TEST", message: "test", retryable: false }), 409, "LEASE_STALE");
  });

  it("gives a job once and nothing while the node is at its limit", async () => {
    const { leases, joinNode, queueRender } = await setup();
    const { row } = joinNode();
    queueRender();
    queueRender();
    expect(await leases.lease(row, 1)).toBeDefined();
    expect(await leases.lease(row, 1)).toBeUndefined();
  });

  it("answers 409 LEASE_STALE for a wrong lease id on fail and complete", async () => {
    const { leases, joinNode, queueRender } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    expectApp(() => leases.fail(row, job.id, { leaseId: "other", code: "X", message: "m", retryable: true }), 409, "LEASE_STALE");
    await expectApp(leases.complete(row, job.id, { leaseId: "other", outputs: [] }), 409, "LEASE_STALE");
    expect(lease.leaseId).not.toBe("other");
  });

  it("refuses a node that does not own the lease", async () => {
    const { leases, joinNode, queueRender } = await setup();
    const first = joinNode("a");
    const second = joinNode("b");
    const job = queueRender();
    const lease = (await leases.lease(first.row, 1))!;
    expectApp(() => leases.fail(second.row, job.id, { leaseId: lease.leaseId, code: "X", message: "m", retryable: true }), 409, "LEASE_STALE");
  });

  it("heartbeat does not reach a job after the sweep gave it away", async () => {
    const { leases, nodes, joinNode, queueRender, harness } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    harness.advance(61_000);
    nodes.sweep();
    expectApp(() => leases.fail(row, job.id, { leaseId: lease.leaseId, code: "X", message: "m", retryable: true }), 409, "LEASE_STALE");
  });
});

describe("expiry sweep", () => {
  it("fails an expired lease with NODE_LOST and marks the quiet node offline", async () => {
    const { leases, nodes, joinNode, queueRender, harness } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    await leases.lease(row, 1);
    harness.advance(61_000);
    nodes.sweep();
    const stored = harness.sqlite.prepare("SELECT error, node_id FROM jobs WHERE id = ?").get(job.id) as { error: string; node_id: string | null };
    expect(JSON.parse(stored.error).code).toBe("NODE_LOST");
    expect(stored.node_id).toBeNull();
    expect(nodes.get(row.id)?.status).toBe("offline");
  });

  it("leaves a live lease alone", async () => {
    const { leases, nodes, joinNode, queueRender, harness } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    await leases.lease(row, 1);
    harness.advance(20_000);
    nodes.sweep();
    expect(harness.repository.getJobLease(job.id)).not.toBeNull();
  });

  it("TASK-129a: node_offline fires once per transition and node_online when the worker returns", async () => {
    const { nodes, joinNode, harness } = await setup();
    const { row } = joinNode();
    const count = (type: "node_offline" | "node_online") => listAgentEvents({ types: [type] }).length;
    const offlineBefore = count("node_offline");
    const onlineBefore = count("node_online");
    // Give the node a real workspace so the filter assertions below are meaningful.
    harness.sqlite.prepare("UPDATE nodes SET workspace_id = 'ws-a' WHERE id = ?").run(row.id);
    const aBefore = listAgentEvents({ types: ["node_offline"], workspaceId: "ws-a" }).length;
    const bBefore = listAgentEvents({ types: ["node_offline"], workspaceId: "ws-b" }).length;
    harness.advance(61_000);
    nodes.sweep();
    expect(count("node_offline") - offlineBefore).toBe(1);
    expect(listAgentEvents({ types: ["node_offline"], workspaceId: "ws-a" }).length - aBefore).toBe(1);
    expect(listAgentEvents({ types: ["node_offline"], workspaceId: "ws-b" }).length - bBefore).toBe(0);
    nodes.sweep();
    expect(count("node_offline") - offlineBefore).toBe(1);
    nodes.heartbeat(nodes.get(row.id)!, { version: readAppVersion(), capabilities: ["render"], resources: { cpus: 2, ramMb: 4096, freeDiskMb: 1 }, running: [] });
    expect(nodes.get(row.id)?.status).toBe("online");
    expect(count("node_online") - onlineBefore).toBe(1);
  });
});

describe("artifacts and outputs", () => {
  it("resumes a 40% PATCH upload after control restart and links a known report", async () => {
    const { leases, restartLeases, harness, nodes, artifacts, joinNode, queueRender, finalize } = await setup();
    const { row, token } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const mount = (service: LeaseService) => {
      const app = Fastify();
      registerNodeRoutes(app, harness.sqlite, harness.config, nodes, service, null as never);
      return app;
    };
    const report = JSON.stringify({ clipsReused: 0, clipsRendered: 1, graphicShots: [], composeWarnings: [], joinWarnings: [] });
    const reportPath = join(createProjectDir(harness.config.DATA_DIR, job.projectId), "known-report.json");
    writeFileSync(reportPath, report);
    await artifacts.register(reportPath);
    const headers = { authorization: `Bearer ${token}`, "x-lease-id": lease.leaseId };
    const rootUrl = `/api/nodes/agent/jobs/${job.id}`;
    const uploadUrl = `${rootUrl}/outputs/final.mp4`;
    const video = "0123456789";
    const partHeaders = { ...headers, "x-sha256": sha(video), "upload-length": "10", "content-type": "application/offset+octet-stream" };
    const first = mount(leases);
    try {
      const partial = await first.inject({ method: "PATCH", url: uploadUrl, headers: { ...partHeaders, "upload-offset": "0" }, payload: Buffer.from(video.slice(0, 4)) });
      expect(partial.statusCode).toBe(204);
      expect(partial.headers["upload-offset"]).toBe("4");
    } finally { await first.close(); }
    const restarted = mount(restartLeases());
    try {
      const head = await restarted.inject({ method: "HEAD", url: uploadUrl, headers });
      expect(head.headers["upload-offset"]).toBe("4");
      const wrong = await restarted.inject({ method: "PATCH", url: uploadUrl, headers: { ...partHeaders, "upload-offset": "2" }, payload: Buffer.from(video.slice(4)) });
      expect(wrong.statusCode).toBe(409);
      const rest = await restarted.inject({ method: "PATCH", url: uploadUrl, headers: { ...partHeaders, "upload-offset": "4" }, payload: Buffer.from(video.slice(4)) });
      expect(rest.statusCode).toBe(204);
      expect(rest.headers["upload-offset"]).toBe("10");
      const have = await restarted.inject({ method: "POST", url: `${rootUrl}/have`, headers, payload: { leaseId: lease.leaseId, outputs: [{ name: "report.json", sha256: sha(report), size: Buffer.byteLength(report) }] } });
      expect(have.json()).toEqual({ have: ["report.json"] });
      const done = await restarted.inject({ method: "POST", url: `${rootUrl}/complete`, headers, payload: { leaseId: lease.leaseId, outputs: [{ name: "final.mp4", sha256: sha(video) }, { name: "report.json", sha256: sha(report) }] } });
      expect(done.statusCode).toBe(200);
      expect(finalize).toHaveBeenCalledOnce();
    } finally { await restarted.close(); }
  });

  it("rejects an expired finalizer and lets exactly one concurrent complete claim the lease", async () => {
    const { leases, harness, joinNode, queueRender, finalize, root } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const report = JSON.stringify({ clipsReused: 0, clipsRendered: 1, graphicShots: [], composeWarnings: [], joinWarnings: [] });
    const files = [{ name: "final.mp4", text: "video bytes" }, { name: "report.json", text: report }];
    for (const { name, text } of files) await leases.receiveOutput(row, job.id, lease.leaseId, name, sha(text), Readable.from([Buffer.from(text)]));
    const request = { leaseId: lease.leaseId, outputs: files.map(({ name, text }) => ({ name, sha256: sha(text) })) };
    const oldLease = harness.repository.getJobLease(job.id)!;
    harness.sqlite.prepare("UPDATE jobs SET lease_until=? WHERE id=?").run(harness.clock().toISOString(), job.id);
    await expectApp(leases.complete(row, job.id, request), 409, "LEASE_STALE");
    expect(finalize).not.toHaveBeenCalled();
    expect(existsSync(join(root, "render", job.projectId, "versions", "render-1", "output.mp4"))).toBe(false);
    harness.sqlite.prepare("UPDATE jobs SET lease_until=? WHERE id=?").run(oldLease.leaseUntil, job.id);
    const results = await Promise.allSettled([leases.complete(row, job.id, request), leases.complete(row, job.id, request)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "LEASE_STALE" } });
    expect(finalize).toHaveBeenCalledOnce();
  });

  it("recovers a claim left by a crashed control without another render lease", async () => {
    const { leases, restartLeases, nodes, harness, joinNode, queueRender, finalize } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const report = JSON.stringify({ clipsReused: 0, clipsRendered: 1, graphicShots: [], composeWarnings: [], joinWarnings: [] });
    for (const [name, text] of [["final.mp4", "video bytes"], ["report.json", report]] as const) {
      await leases.receiveOutput(row, job.id, lease.leaseId, name, sha(text), Readable.from([Buffer.from(text)]));
    }
    harness.sqlite.prepare("UPDATE jobs SET finalizing_at=? WHERE id=?").run(harness.clock().toISOString(), job.id);
    harness.advance(2 * harness.config.NODE_LEASE_SEC * 1000);
    nodes.sweep();
    harness.orchestrator.resumeRunningJobs();
    expect(harness.repository.getJob(job.id)?.status).toBe("RUNNING");
    await restartLeases().recoverFinalizing();
    expect(finalize).toHaveBeenCalledOnce();
    expect(harness.repository.getJob(job.id)?.status).toBe("SUCCEEDED");
  });
  it("serves only files in the job's manifest to the lease holder", async () => {
    const { leases, joinNode, queueRender } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const found = leases.artifactFor(row, job.id, lease.leaseId, registered.sha);
    expect(found.size).toBe(registered.size);
    expectApp(() => leases.artifactFor(row, job.id, lease.leaseId, fileSha), 404, "ARTIFACT_NOT_FOUND");
    expectApp(() => leases.artifactFor(row, job.id, "other", registered.sha), 404, "ARTIFACT_NOT_FOUND");
  });

  // TASK-172 follow-up, advisor 2026-11-21. Predictions written before the first run:
  // (a) same path, rewritten with a new mtime: locate misses on the stamp, 404, input still exists (by design).
  // (b) row repointed to a same-bytes copy by a later writer, copy deleted: 404 while the input still exists.
  it("(a) 404s on a stale stamp at the row's own path while the file still exists", async () => {
    const { leases, joinNode, queueRender } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    expect(leases.artifactFor(row, job.id, lease.leaseId, registered.sha).size).toBe(registered.size);
    const later = new Date(Date.now() + 5_000);
    utimesSync(registered.path, later, later);
    expectApp(() => leases.artifactFor(row, job.id, lease.leaseId, registered.sha), 404, "ARTIFACT_NOT_FOUND");
    expect(existsSync(registered.path)).toBe(true);
  });

  it("(b) 404s when the row was repointed to a copy that is then deleted, while the input still exists", async () => {
    const { leases, joinNode, queueRender, artifacts, root } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    expect(leases.artifactFor(row, job.id, lease.leaseId, registered.sha).path).toBe(registered.path);
    const copy = join(root, "copy.bin");
    writeFileSync(copy, "input data");
    artifacts.registerSync(copy);
    expect(leases.artifactFor(row, job.id, lease.leaseId, registered.sha).path).toBe(copy);
    rmSync(copy);
    expectApp(() => leases.artifactFor(row, job.id, lease.leaseId, registered.sha), 404, "ARTIFACT_NOT_FOUND");
    expect(existsSync(registered.path)).toBe(true);
  });

  // Heal measurement (advisor 2026-11-21). Predictions written before the first run:
  // H1 (a): after a retryable fail the job is QUEUED with attempts left; a re-lease plus register(P) heals the stamp, artifactFor returns P.
  // H2 (b): same; register(P) repoints S back to P, artifactFor returns P.
  // H0 (b) control: a re-lease WITHOUT register keeps the 404. Production re-lease calls register (remoteBundle.ts:53);
  // the module mock of buildRemoteBundle does not, so each heal case calls artifacts.register(P) itself.
  it("(a-heal) a retryable fail and re-lease heal the stale stamp once the input is re-registered", async () => {
    const { leases, joinNode, queueRender, harness, artifacts } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const later = new Date(Date.now() + 5_000);
    utimesSync(registered.path, later, later);
    expectApp(() => leases.artifactFor(row, job.id, lease.leaseId, registered.sha), 404, "ARTIFACT_NOT_FOUND");
    harness.orchestrator.failJob(job.id, { code: "NODE_RENDER_FAILED", message: "fixture", retryable: true });
    expect(harness.repository.getJob(job.id)?.status).toBe("QUEUED");
    // The retry sets runAfter = now + backoff (orchestrator.ts:800–810), so the job is not leasable until the clock passes it.
    harness.advance(24 * 60 * 60_000);
    const again = (await leases.lease(row, 1))!;
    await artifacts.register(registered.path);
    expect(leases.artifactFor(row, job.id, again.leaseId, registered.sha).path).toBe(registered.path);
  });

  it("(b-heal) a retryable fail and re-lease repoint the row back to the input once it is re-registered", async () => {
    const { leases, joinNode, queueRender, harness, artifacts, root } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const copy = join(root, "copy.bin");
    writeFileSync(copy, "input data");
    artifacts.registerSync(copy);
    rmSync(copy);
    expectApp(() => leases.artifactFor(row, job.id, lease.leaseId, registered.sha), 404, "ARTIFACT_NOT_FOUND");
    harness.orchestrator.failJob(job.id, { code: "NODE_RENDER_FAILED", message: "fixture", retryable: true });
    expect(harness.repository.getJob(job.id)?.status).toBe("QUEUED");
    // The retry sets runAfter = now + backoff (orchestrator.ts:800–810), so the job is not leasable until the clock passes it.
    harness.advance(24 * 60 * 60_000);
    const again = (await leases.lease(row, 1))!;
    await artifacts.register(registered.path);
    expect(leases.artifactFor(row, job.id, again.leaseId, registered.sha).path).toBe(registered.path);
  });

  it("(b-control) a re-lease without re-registering the input keeps the 404", async () => {
    const { leases, joinNode, queueRender, harness, artifacts, root } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const copy = join(root, "copy.bin");
    writeFileSync(copy, "input data");
    artifacts.registerSync(copy);
    rmSync(copy);
    harness.orchestrator.failJob(job.id, { code: "NODE_RENDER_FAILED", message: "fixture", retryable: true });
    harness.advance(24 * 60 * 60_000);
    const again = (await leases.lease(row, 1))!;
    expectApp(() => leases.artifactFor(row, job.id, again.leaseId, registered.sha), 404, "ARTIFACT_NOT_FOUND");
    expect(existsSync(registered.path)).toBe(true);
    expect(lease.leaseId).not.toBe(again.leaseId);
  });

  it("rejects an upload whose sha256 does not match and deletes the temp file", async () => {
    const { leases, joinNode, queueRender, root } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    await expectApp(
      leases.receiveOutput(row, job.id, lease.leaseId, "final.mp4", sha("expected"), Readable.from([Buffer.from("different")])),
      422, "SHA256_MISMATCH",
    );
    const dir = join(root, "render", job.projectId, "pending", `${job.id}.uploads`, lease.leaseId);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it("refuses names outside the allowed list", async () => {
    const { leases, joinNode, queueRender } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    await expectApp(
      leases.receiveOutput(row, job.id, lease.leaseId, "../evil.sh", sha("x"), Readable.from([Buffer.from("x")])),
      400, "OUTPUT_NAME_REFUSED",
    );
  });

  it("completes a job when both outputs arrive with matching hashes", async () => {
    const { leases, joinNode, queueRender, harness, finalize } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const video = "video bytes";
    const report = JSON.stringify({ clipsReused: 0, clipsRendered: 1, graphicShots: [], composeWarnings: [], joinWarnings: [] });
    await leases.receiveOutput(row, job.id, lease.leaseId, "final.mp4", sha(video), Readable.from([Buffer.from(video)]));
    await leases.receiveOutput(row, job.id, lease.leaseId, "report.json", sha(report), Readable.from([Buffer.from(report)]));
    await leases.complete(row, job.id, {
      leaseId: lease.leaseId,
      outputs: [{ name: "final.mp4", sha256: sha(video) }, { name: "report.json", sha256: sha(report) }],
    });
    expect(finalize).toHaveBeenCalledOnce();
    expect(harness.repository.getJob(job.id)?.status).toBe("SUCCEEDED");
  });

  it("refuses complete when a declared hash differs from what was uploaded", async () => {
    const { leases, joinNode, queueRender } = await setup();
    const { row } = joinNode();
    const job = queueRender();
    const lease = (await leases.lease(row, 1))!;
    const report = JSON.stringify({ clipsReused: 0, clipsRendered: 0, graphicShots: [], composeWarnings: [], joinWarnings: [] });
    await leases.receiveOutput(row, job.id, lease.leaseId, "final.mp4", sha("v"), Readable.from([Buffer.from("v")]));
    await leases.receiveOutput(row, job.id, lease.leaseId, "report.json", sha(report), Readable.from([Buffer.from(report)]));
    await expectApp(
      leases.complete(row, job.id, { leaseId: lease.leaseId, outputs: [{ name: "final.mp4", sha256: fileSha }, { name: "report.json", sha256: sha(report) }] }),
      422, "OUTPUTS_INCOMPLETE",
    );
  });
});

describe("remote render placement", () => {
  it("defaults to off: the local worker always takes a render", async () => {
    const { harness, nodes, queueRender, joinNode } = await setup();
    joinNode();
    expect(getRemoteRenderSettings(harness.sqlite)).toEqual({ mode: "off", remoteWaitSec: 30 });
    expect(localMayTake(harness.sqlite, nodes, queueRender(), harness.clock())).toBe(true);
  });

  it("only: the local worker never takes a render but still takes other stages", async () => {
    const { harness, nodes, queueRender } = await setup();
    saveRemoteRenderSettings(harness.sqlite, { mode: "only", remoteWaitSec: 30 });
    expect(localMayTake(harness.sqlite, nodes, queueRender(), harness.clock())).toBe(false);
    const other = harness.repository.createJob({ projectId: harness.projectId, stage: "SCRIPT", maxAttempts: 3, previousState: "PENDING", runAfter: harness.clock() });
    expect(localMayTake(harness.sqlite, nodes, other, harness.clock())).toBe(true);
  });

  it("prefer: waits for a free node, then falls back to local", async () => {
    const { harness, nodes, queueRender, joinNode } = await setup();
    saveRemoteRenderSettings(harness.sqlite, { mode: "prefer", remoteWaitSec: 30 });
    const job = queueRender();
    expect(localMayTake(harness.sqlite, nodes, job, harness.clock())).toBe(true); // no node at all
    joinNode();
    expect(localMayTake(harness.sqlite, nodes, job, harness.clock())).toBe(false);
    harness.advance(31_000);
    expect(localMayTake(harness.sqlite, nodes, job, harness.clock())).toBe(true);
  });
});

describe("capability probe (TASK-119)", () => {
  const failed = { render: { ok: false, reason: "Thiếu ffmpeg", checkedAt: "2026-01-01T00:00:00.000Z" } };
  const passed = { render: { ok: true, checkedAt: "2026-01-01T00:00:00.000Z", ms: 900 } };

  it("stores the probe sent with join and refreshes it on heartbeat", async () => {
    const { nodes, joinNode } = await setup();
    const { row } = joinNode();
    expect(nodes.list()[0]?.probe).toBeNull();
    nodes.heartbeat(row, { version: readAppVersion(), capabilities: ["render"], resources: { cpus: 2, ramMb: 4096, freeDiskMb: 1 }, running: [], probe: failed });
    expect(nodes.list()[0]?.probe?.render.reason).toBe("Thiếu ffmpeg");
    nodes.heartbeat(nodes.get(row.id)!, { version: readAppVersion(), capabilities: ["render"], resources: { cpus: 2, ramMb: 4096, freeDiskMb: 1 }, running: [], probe: passed });
    expect(nodes.list()[0]?.probe?.render.ok).toBe(true);
    // a heartbeat without a probe keeps the last result
    nodes.heartbeat(nodes.get(row.id)!, { version: readAppVersion(), capabilities: ["render"], resources: { cpus: 2, ramMb: 4096, freeDiskMb: 1 }, running: [] });
    expect(nodes.list()[0]?.probe?.render.ok).toBe(true);
  });

  it("does not lease a render job to a node whose probe failed, and does not count it as available", async () => {
    const { nodes, leases, joinNode, queueRender } = await setup();
    const { row } = joinNode();
    queueRender();
    nodes.heartbeat(row, { version: readAppVersion(), capabilities: ["render"], resources: { cpus: 2, ramMb: 4096, freeDiskMb: 1 }, running: [], probe: failed });
    expect(await leases.lease(nodes.get(row.id)!, 1)).toBeUndefined();
    expect(nodes.hasAvailableRenderNode()).toBe(false);
    nodes.heartbeat(nodes.get(row.id)!, { version: readAppVersion(), capabilities: ["render"], resources: { cpus: 2, ramMb: 4096, freeDiskMb: 1 }, running: [], probe: passed });
    expect((await leases.lease(nodes.get(row.id)!, 1))?.jobId).toBeTruthy();
  });

  it("rejects an unknown probe shape", async () => {
    const { HeartbeatRequestSchema } = await import("@vg/shared");
    expect(HeartbeatRequestSchema.safeParse({ version: "1", capabilities: [], resources: { cpus: 1, ramMb: 1, freeDiskMb: 1 }, running: [], probe: { render: { ok: true, checkedAt: "x", extra: 1 } } }).success).toBe(false);
  });
});

describe("node detail and job node names (TASK-119)", () => {
  it("shows running and recent jobs with outcome and keeps node_id after the job ends", async () => {
    const { nodes, leases, joinNode, queueRender, harness } = await setup();
    const { row } = joinNode("may-xa");
    const job = queueRender();
    await leases.lease(row, 1);
    expect(nodes.detail(row.id).running).toHaveLength(1);
    await leases.complete(nodes.get(row.id)!, job.id, { leaseId: harness.repository.getJobLease(job.id)!.leaseId, outputs: [] }).catch(() => undefined);
    const detail = nodes.detail(row.id);
    expect(detail.node.name).toBe("may-xa");
    expect(detail.failures24h).toBeGreaterThanOrEqual(0);
    expectApp(() => nodes.detail("nope"), 404, "NODE_NOT_FOUND");
  });

  it("adds nodeName to job lists with a single extra query, and null for the main machine", async () => {
    const { leases, joinNode, queueRender, harness } = await setup();
    const { row } = joinNode("may-xa");
    const remote = queueRender();
    queueRender();
    await leases.lease(row, 1);
    const prepare = vi.spyOn(harness.sqlite, "prepare");
    const jobs = harness.repository.listJobs(harness.projectId, 50);
    const nodeQueries = prepare.mock.calls.filter(([sql]) => /FROM nodes/i.test(String(sql)));
    prepare.mockRestore();
    expect(nodeQueries.length).toBeLessThanOrEqual(1);
    expect(jobs.find((job) => job.id === remote.id)?.nodeName).toBe("may-xa");
    expect(jobs.filter((job) => job.nodeName == null).length).toBeGreaterThanOrEqual(1);
  });
});

describe("node tools (TASK-119)", () => {
  it("list_nodes never returns token hashes and set_node_drain only drains", async () => {
    const { nodes, joinNode } = await setup();
    const { row, token } = joinNode("may-xa");
    const { ASSISTANT_TOOLS } = await import("../src/assistant/tools.js");
    const ctx = { nodes } as never;
    const listed = JSON.stringify(await ASSISTANT_TOOLS.list_nodes!.execute({}, ctx));
    expect(listed).toContain("may-xa");
    expect(listed).not.toContain(token);
    expect(listed).not.toMatch(/token_hash|tokenHash/i);
    expect(ASSISTANT_TOOLS.set_node_drain!.risk).toBe("confirm");
    await ASSISTANT_TOOLS.set_node_drain!.execute({ nodeId: row.id, drain: true }, ctx);
    expect(nodes.list()[0]?.desiredConfig.drain).toBe(true);
    expect(nodes.list()[0]?.status).toBe("draining");
    expect(ASSISTANT_TOOLS.set_node_drain!.argsSchema.safeParse({ nodeId: row.id, drain: true, revoke: true }).success).toBe(false);
    expect(Object.keys(ASSISTANT_TOOLS).filter((name) => /node/.test(name)).sort()).toEqual(["list_nodes", "set_node_drain"]);
  });
});
