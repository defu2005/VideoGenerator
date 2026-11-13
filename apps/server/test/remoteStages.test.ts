import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@vg/shared";
import { parseConfig } from "../src/lib/config.js";
import { TtsProviderRegistry } from "../src/providers/tts/registry.js";
import { readAppVersion } from "../src/render/appVersion.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { LeaseSecretService, SECRET_GRACE_MS } from "../src/node/leaseSecrets.js";
import { LeaseService, type RenderPort } from "../src/node/leaseService.js";
import { MediaFetchService } from "../src/node/mediaFetch.js";
import { NodeService, type NodeRow } from "../src/node/nodeService.js";
import { localMayTake } from "../src/node/placement.js";
import { createNodeTtsRegistry, detectTtsCapabilities, runMediaBundle, runVoiceBundle, SecretHolder } from "../src/node/remoteRunners.js";
import { newBoxKeyPair, openSecret } from "../src/node/secretBox.js";
import { getNodePlacement, getRemoteStagesSettings, saveNodePlacement } from "../src/node/settings.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const H1 = "a".repeat(64);
const PLAIN_KEY = "AIza-super-secret-key-123";
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function sha(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function setup(options: { provider?: string; vault?: Record<string, string> } = {}) {
  const harness = createPipelineHarness();
  const root = mkdtempSync(join(tmpdir(), "vg-remote-stage-"));
  cleanups.push(() => { harness.close(); rmSync(root, { recursive: true, force: true }); });
  const vault: Record<string, string> = { ...(options.vault ?? { "tts.google_cloud.apiKey": PLAIN_KEY }) };
  const secrets = new LeaseSecretService(harness.sqlite, () => harness.config.NODE_LEASE_SEC, (key) => vault[key] ?? null, harness.clock);
  const artifacts = new ArtifactService(harness.sqlite, harness.clock);
  const nodes = new NodeService(harness.sqlite, harness.config, harness.repository, harness.orchestrator, harness.clock);
  const media = new MediaFetchService(harness.repository, join(root, "data"));
  const provider = { current: options.provider ?? "google_cloud" };
  const voice = {
    collectWork: vi.fn(async () => ({
      provider: provider.current, voice: "vi-VN-A", rate: "+0%", language: "vi", wordTimings: true,
      scenes: [{ sceneId: "s1", hash: H1, text: "xin chao" }],
    })),
    runWithRemote: vi.fn(async () => ({ message: "xong giọng" })),
  };
  const renders: RenderPort = {
    renderDir: (projectId) => join(root, "render", projectId),
    versionDir: (projectId, renderId) => join(root, "render", projectId, "versions", renderId),
    prepare: async () => { throw new Error("no render in this test"); },
    finalize: async () => ({ render: { id: "r" } as never, reused: false }),
  };
  const leases = new LeaseService(
    harness.sqlite, harness.config, harness.repository, harness.orchestrator, nodes, renders, artifacts,
    async () => ({ message: "xong" }), harness.clock, undefined,
    { secrets, voice: voice as never, planProvider: () => provider.current, media },
  );

  function joinNode(name: string, capabilities: string[]): { row: NodeRow } {
    const { token: joinToken } = nodes.createJoinToken(undefined);
    const joined = nodes.join({
      joinToken, name, version: readAppVersion(), capabilities,
      capabilityInfo: Object.fromEntries(capabilities.map((c) => [c, readAppVersion()])),
      resources: { cpus: 2, ramMb: 4096, freeDiskMb: 50_000 },
    });
    return { row: nodes.authenticate(joined.nodeToken)! };
  }

  function queueVoice(): Job {
    return harness.repository.createJob({ projectId: harness.projectId, stage: "VOICE", maxAttempts: 3, previousState: "PENDING", runAfter: harness.clock() });
  }

  return { harness, root, secrets, nodes, leases, media, voice, provider, vault, joinNode, queueVoice };
}

describe("placement defaults", () => {
  it("keeps every stage on this machine and RENDER-only by default", () => {
    const { harness, nodes, queueVoice } = setup();
    expect(getRemoteStagesSettings(harness.sqlite)).toEqual({ VOICE: "off", MEDIA_FETCH: "off" });
    expect(getNodePlacement(harness.sqlite).mode).toBe("off");
    const job = queueVoice();
    expect(localMayTake(harness.sqlite, nodes, job, harness.clock(), () => ({ capability: "tts:google_cloud" }))).toBe(true);
    const render = harness.repository.createJob({ projectId: harness.projectId, stage: "RENDER", maxAttempts: 3, previousState: "PENDING", runAfter: harness.clock() });
    expect(localMayTake(harness.sqlite, nodes, render, harness.clock())).toBe(true);
  });

  it("VOICE 'only' keeps the job off this machine only while a capable node exists", () => {
    const { harness, nodes, joinNode, queueVoice } = setup();
    saveNodePlacement(harness.sqlite, { stages: { VOICE: "only" } });
    const job = queueVoice();
    const need = () => ({ capability: "tts:piper" });
    expect(localMayTake(harness.sqlite, nodes, job, harness.clock(), need)).toBe(true); // no node yet
    joinNode("a", ["render"]);
    expect(localMayTake(harness.sqlite, nodes, job, harness.clock(), need)).toBe(true); // node cannot do piper
    joinNode("b", ["tts:piper"]);
    expect(localMayTake(harness.sqlite, nodes, job, harness.clock(), need)).toBe(false);
    expect(localMayTake(harness.sqlite, nodes, job, harness.clock(), () => null)).toBe(true); // key must stay local
  });

  it("only saves the vault key names that may be marked local-only", () => {
    const { harness } = setup();
    const saved = saveNodePlacement(harness.sqlite, { localOnlyKeys: ["tts.google_cloud.apiKey", "tts.google_cloud.apiKey"] });
    expect(saved.localOnlyKeys).toEqual(["tts.google_cloud.apiKey"]);
  });
});

describe("capability placement", () => {
  it("a node without tts:piper never gets a piper job", async () => {
    const { harness, leases, joinNode, queueVoice, provider } = setup({ provider: "piper" });
    saveNodePlacement(harness.sqlite, { stages: { VOICE: "prefer" } });
    const job = queueVoice();
    const plain = joinNode("only-render", ["render", "tts:mock"]);
    expect(await leases.lease(plain.row, 1)).toBeUndefined();
    expect(harness.repository.getJob(job.id)?.status).toBe("QUEUED");
    const piper = joinNode("has-piper", ["tts:piper"]);
    const lease = await leases.lease(piper.row, 1);
    expect(lease?.stage).toBe("VOICE");
    expect(provider.current).toBe("piper");
    expect(lease?.secret).toBeUndefined(); // piper is a local tool, no key travels
  });

  it("a stage set to off is never leased", async () => {
    const { leases, joinNode, queueVoice } = setup({ provider: "piper" });
    queueVoice();
    expect(await leases.lease(joinNode("n", ["tts:piper"]).row, 1)).toBeUndefined();
  });
});

describe("lease-scoped secrets", () => {
  async function leased() {
    const ctx = setup();
    saveNodePlacement(ctx.harness.sqlite, { stages: { VOICE: "prefer" } });
    const job = ctx.queueVoice();
    const node = ctx.joinNode("may-tts", ["tts:google_cloud"]);
    const pair = newBoxKeyPair();
    const lease = await ctx.leases.lease(node.row, 1, pair.publicKey);
    return { ...ctx, job, node: node.row, pair, lease: lease! };
  }

  it("the key is only in the lease response, sealed for that node, with lease TTL + 5 minutes", async () => {
    const { lease, pair, harness } = await leased();
    expect(lease.secret).toBeDefined();
    expect(JSON.stringify(lease)).not.toContain(PLAIN_KEY);
    expect(lease.secret!.scope).toBe("tts:google_cloud");
    expect(Date.parse(lease.secret!.expiresAt)).toBe(harness.clock().getTime() + harness.config.NODE_LEASE_SEC * 1000 + SECRET_GRACE_MS);
    expect(openSecret(lease.secret!, pair.privateKey).toString("utf8")).toBe(PLAIN_KEY);
    // another node's key pair cannot open it
    expect(() => openSecret(lease.secret!, newBoxKeyPair().privateKey)).toThrow();
  });

  it("stores only a hash and metadata, never the key (db dump and audit contain no plain text)", async () => {
    const { harness, secrets, job } = await leased();
    const rows = harness.sqlite.prepare("SELECT * FROM node_lease_secrets").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.secret_hash).toBe(sha(PLAIN_KEY));
    const dump = JSON.stringify(rows) + JSON.stringify(harness.sqlite.prepare("SELECT * FROM audit_log").all()) + JSON.stringify(secrets.list());
    expect(dump).not.toContain(PLAIN_KEY);
    expect(rows[0]!.job_id).toBe(job.id);
  });

  it("writes an audit row that names the node, the key, the job and the expiry", async () => {
    const { secrets, job } = await leased();
    const [grant] = secrets.list();
    expect(grant!.summary).toMatch(new RegExp(`^Node may-tts nhận khoá Google Cloud TTS cho job ${job.id}, hết hạn lúc \\d{2}:\\d{2}:\\d{2} \\d{2}/\\d{2}/\\d{4}$`));
    expect(grant!.revokedAt).toBeNull();
  });

  it("is revoked when the lease is cancelled and then answers 410", async () => {
    const { nodes, node, job, lease, secrets, leases, pair } = await leased();
    nodes.onCancelled?.(job.id, lease.leaseId);
    expect(secrets.list()[0]!.revokedReason).toBe("cancelled");
    expect(() => leases.refetchSecret(node, job.id, lease.leaseId, pair.publicKey)).toThrowError(expect.objectContaining({ statusCode: 410 }));
  });

  it("is revoked when the lease fails", async () => {
    const { node, job, lease, secrets, leases } = await leased();
    leases.fail(node, job.id, { leaseId: lease.leaseId, code: "X", message: "lỗi", retryable: true });
    expect(secrets.list()[0]!.revokedAt).not.toBeNull();
  });

  it("answers 410 after expiry even though the lease is still held", async () => {
    const { harness, node, job, lease, leases, pair } = await leased();
    harness.advance(harness.config.NODE_LEASE_SEC * 1000 + SECRET_GRACE_MS + 1000);
    expect(() => leases.refetchSecret(node, job.id, lease.leaseId, pair.publicKey)).toThrowError(expect.objectContaining({ statusCode: 410 }));
  });

  it("a regrant never extends the expiry", async () => {
    const { harness, node, job, lease, leases } = await leased();
    harness.advance(60_000);
    const second = newBoxKeyPair();
    const again = leases.refetchSecret(node, job.id, lease.leaseId, second.publicKey);
    expect(again.expiresAt).toBe(lease.secret!.expiresAt);
    expect(openSecret(again, second.privateKey).toString("utf8")).toBe(PLAIN_KEY);
  });

  it("a key marked 'không gửi ra node' keeps the stage local: no lease, no grant, no audit", async () => {
    const ctx = setup();
    saveNodePlacement(ctx.harness.sqlite, { stages: { VOICE: "prefer" }, localOnlyKeys: ["tts.google_cloud.apiKey"] });
    const job = ctx.queueVoice();
    const node = ctx.joinNode("n", ["tts:google_cloud"]);
    expect(await ctx.leases.lease(node.row, 1, newBoxKeyPair().publicKey)).toBeUndefined();
    expect(ctx.harness.repository.getJob(job.id)?.status).toBe("QUEUED");
    expect(ctx.secrets.list()).toHaveLength(0);
    expect(ctx.secrets.blockedReason("google_cloud")).toContain("không gửi ra node");
    expect(ctx.secrets.grant({ node: node.row, leaseId: "l", jobId: job.id, stage: "VOICE", providerId: "google_cloud", nodePublicKey: newBoxKeyPair().publicKey })).toBeNull();
  });

  it("never sends a key without a node public key, and never a non-TTS key", () => {
    const ctx = setup({ vault: { "tts.google_cloud.apiKey": PLAIN_KEY, "youtube.refreshToken": "tok" } });
    const node = { id: "n", name: "x" };
    expect(ctx.secrets.grant({ node, leaseId: "l", jobId: "j", stage: "VOICE", providerId: "google_cloud", nodePublicKey: undefined })).toBeNull();
    expect(ctx.secrets.grant({ node, leaseId: "l", jobId: "j", stage: "VOICE", providerId: "youtube", nodePublicKey: newBoxKeyPair().publicKey })).toBeNull();
    expect(ctx.secrets.list()).toHaveLength(0);
  });

  it("the node holder wipes the key", () => {
    const holder = new SecretHolder(Buffer.from("abc"), "tts:x", new Date(Date.now() + 1000).toISOString());
    expect(holder.get()).toBe("abc");
    holder.wipe();
    expect(holder.get()).toBeNull();
    expect(new SecretHolder(Buffer.from("a"), "s", new Date(Date.now() - 1).toISOString()).expired()).toBe(true);
  });
});

describe("remote results are verified", () => {
  it("rejects TTS audio whose bytes do not match the declared sha256", async () => {
    const ctx = setup({ provider: "mock" });
    saveNodePlacement(ctx.harness.sqlite, { stages: { VOICE: "prefer" } });
    ctx.queueVoice();
    const node = ctx.joinNode("n", ["tts:mock"]);
    const lease = (await ctx.leases.lease(node.row, 1))!;
    await expect(
      ctx.leases.receiveOutput(node.row, lease.jobId, lease.leaseId, "audio/s1.wav", sha("expected"), Readable.from([Buffer.from("different")])),
    ).rejects.toMatchObject({ statusCode: 422, code: "SHA256_MISMATCH" });
    // a render-style name is refused for a voice job
    await expect(
      ctx.leases.receiveOutput(node.row, lease.jobId, lease.leaseId, "final.mp4", sha("x"), Readable.from([Buffer.from("x")])),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("completes a voice job with the node's audio and timings, and revokes", async () => {
    const ctx = setup({ provider: "mock" });
    saveNodePlacement(ctx.harness.sqlite, { stages: { VOICE: "prefer" } });
    ctx.queueVoice();
    const node = ctx.joinNode("n", ["tts:mock"]);
    const lease = (await ctx.leases.lease(node.row, 1))!;
    const audio = Buffer.from("fake-audio");
    const result = JSON.stringify({
      scenes: [{ sceneId: "s1", hash: H1, file: "audio/s1.wav", provider: "mock", voice: "vi-VN-A", rate: "+0%", durationSec: 1.2, cues: [{ startSec: 0, endSec: 1.2, text: "xin chao" }], timingSource: "estimated", characters: 8 }],
    });
    await ctx.leases.receiveOutput(node.row, lease.jobId, lease.leaseId, "audio/s1.wav", sha(audio), Readable.from([audio]));
    await ctx.leases.receiveOutput(node.row, lease.jobId, lease.leaseId, "result.json", sha(result), Readable.from([Buffer.from(result)]));
    const done = await ctx.leases.complete(node.row, lease.jobId, {
      leaseId: lease.leaseId,
      outputs: [{ name: "audio/s1.wav", sha256: sha(audio) }, { name: "result.json", sha256: sha(result) }],
    });
    expect(done.message).toBe("xong giọng");
    expect(ctx.voice.runWithRemote).toHaveBeenCalledTimes(1);
    expect(ctx.harness.repository.getJob(lease.jobId)?.status).toBe("SUCCEEDED");
  });

  it("media: place() refuses a file that does not match the report or is not an MP4", () => {
    const ctx = setup();
    const dir = mkdtempSync(join(tmpdir(), "vg-media-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const good = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
    const path = join(dir, "a.mp4");
    writeFileSync(path, good);
    expect(() => ctx.media.place("media/pexels-1.mp4", path, { sha256: sha("other"), size: good.length })).toThrow(/không khớp/);
    expect(() => ctx.media.place("media/pexels-1.mp4", path, { sha256: sha(good), size: good.length + 1 })).toThrow(/không khớp/);
    const bad = join(dir, "b.mp4");
    writeFileSync(bad, "not a video at all");
    expect(() => ctx.media.place("media/pexels-2.mp4", bad, { sha256: sha("not a video at all"), size: 18 })).toThrow(/MP4/);
    ctx.media.place("media/pexels-1.mp4", path, { sha256: sha(good), size: good.length });
    expect(existsSync(join(ctx.root, "data", "footage", "pexels-1.mp4"))).toBe(true);
  });
});

describe("node runners", () => {
  it("remote TTS gives the same cues and word timings as local for the mock provider", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-tts-parity-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const bundle = {
      kind: "tts" as const, provider: "mock", voice: "vi-VN-HoaiMyNeural", rate: "+0%", language: "vi", timingMode: "provider" as const,
      scenes: [{ sceneId: "s1", hash: H1, text: "Xin chào các bạn, hôm nay chúng ta nói về video." }],
    };
    const remote = await runVoiceBundle({
      bundle: bundle as never, workDir: join(dir, "remote"), registry: createNodeTtsRegistry({}, () => null),
      signal: new AbortController().signal, onProgress: () => undefined,
    });
    const local = new TtsProviderRegistry(parseConfig({} as NodeJS.ProcessEnv));
    const direct = await local.synthesizeSingle({
      providerId: "mock", text: bundle.scenes[0]!.text, language: "vi", outPath: join(dir, "local.wav"), voice: bundle.voice, rate: bundle.rate,
    });
    const scene = remote.result.scenes[0]!;
    expect(scene.cues).toEqual(direct.cues);
    expect(scene.words).toEqual(direct.words);
    expect(scene.durationSec).toBe(direct.durationSec);
    expect(scene.timingSource).toBe(direct.timingSource);
    expect(remote.files.map((f) => f.name)).toEqual(["audio/s1.wav", "result.json"]);
    expect(JSON.parse(readFileSync(remote.files[1]!.path, "utf8"))).toEqual(remote.result);
  });

  it("detects only the providers that really work, and never a key-based one without VG_NODE_TTS", () => {
    const none = createNodeTtsRegistry({}, () => null);
    expect(detectTtsCapabilities({}, none)).not.toContain("tts:google_cloud");
    const declared = detectTtsCapabilities({ VG_NODE_TTS: "google_cloud, nonsense!" }, none);
    expect(declared).toContain("tts:google_cloud");
    expect(declared.some((c) => c.includes("nonsense"))).toBe(false);
  });

  it("media bundle downloads over https, reports hashes and skips a bad item without failing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-media-run-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const body = Buffer.from("video-bytes");
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("ok") ? new Response(body, { status: 200 }) : new Response("no", { status: 404 })) as unknown as typeof fetch;
    const item = (name: string, url: string) => ({ url, target: `media/${name}` });
    const out = await runMediaBundle({
      bundle: { kind: "media", maxBytes: 1000, targetShortSide: 720, items: [item("ok.mp4", "https://x.test/ok"), item("bad.mp4", "https://x.test/bad"), item("http.mp4", "http://x.test/ok")] } as never,
      workDir: dir, fetchImpl, signal: new AbortController().signal, onProgress: () => undefined,
    });
    expect(out.report.fetched).toEqual([{ target: "media/ok.mp4", sha256: sha(body), size: body.length }]);
    expect(out.report.skipped.map((s) => s.target).sort()).toEqual(["media/bad.mp4", "media/http.mp4"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
