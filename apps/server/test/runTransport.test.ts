import { createHash } from "node:crypto";
import { ProfileDefaultBriefSchema, GuidelineSettingsSchema } from "@vg/shared";
import { Readable } from "node:stream";
import { unlinkSync, writeFileSync } from "node:fs";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { ProjectRunService } from "../src/node/runService.js";
import { RunTransportService } from "../src/node/runTransport.js";
import { NodeService } from "../src/node/nodeService.js";
import { readAppVersion } from "../src/render/appVersion.js";
import { registerNodeRoutes } from "../src/api/nodes.js";
import type { LeaseService } from "../src/node/leaseService.js";
import { ProjectLeaseSecrets, type LeaseSecretService } from "../src/node/leaseSecrets.js";
import { newBoxKeyPair, openSecret } from "../src/node/secretBox.js";
import { AppError } from "../src/lib/errors.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
function setup() {
  const h = createPipelineHarness(); cleanups.push(h.close);
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
  const nodes = new NodeService(h.sqlite, h.config, h.repository, h.orchestrator, h.clock);
  const token = nodes.createJoinToken({ workspaceId: "A" }).token;
  const joined = nodes.join({ joinToken: token, name: "node", version: readAppVersion(), capabilities: ["render"], resources: {} });
  const node = nodes.authenticate(joined.nodeToken)!;
  const runs = new ProjectRunService(h.sqlite, h.orchestrator, h.clock); nodes.projectRuns = runs;
  const run = runs.grant(node, { projectId: h.projectId, fromStage: "RESEARCH", stopBefore: ["VISUAL_REVIEW"], budgetCapUsd: 1 });
  const after = vi.fn();
  const transport = () => new RunTransportService(h.sqlite, h.config, runs, h.orchestrator, after, h.clock);
  return { ...h, nodes, node, nodeToken: joined.nodeToken, runs, run, transport, after };
}

describe("project run transport", () => {
  it("seals only opted-in provider keys for a live run and never reads platform credentials", () => {
    const h = setup();
    const transport = h.transport();
    const load = vi.fn(() => "fixture-provider-key");
    const service = new ProjectLeaseSecrets(h.sqlite, load);
    const pair = newBoxKeyPair();
    const allowed = new Set(["llm:gemini", "tts:elevenlabs", "platform.youtube.app"]);
    transport.lend = (run, scopes, publicKey) => service.seal(run, scopes, allowed, publicKey);
    expect(transport.providerSecrets(h.node, h.run.id, h.run.leaseId, [...allowed], pair.publicKey)).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    h.sqlite.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES ('execution.lendProviders',?,?)")
      .run(JSON.stringify(["llm:gemini", "tts:elevenlabs", "platform.youtube.app", "llm:anthropic"]), h.clock().toISOString());
    const sealed = transport.providerSecrets(h.node, h.run.id, h.run.leaseId, [...allowed, "llm:anthropic"], pair.publicKey);
    // TASK-136: LLM keys are never lent any more; the old setting is ignored and one audit row says so.
    expect(sealed.map(({ scope }) => scope)).toEqual(["tts:elevenlabs"]);
    expect(load.mock.calls.flat().join(" ")).not.toMatch(/llm\./);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='llm.lend_ignored'").get()).toEqual({ n: 1 });
    const plain = openSecret(sealed[0]!, pair.privateKey);
    expect(plain.toString("utf8")).toBe("fixture-provider-key");
    plain.fill(0);
    expect(JSON.stringify(sealed)).not.toContain("fixture-provider-key");
    h.advance(91_000);
    expect(() => transport.providerSecrets(h.node, h.run.id, h.run.leaseId, [...allowed], pair.publicKey)).toThrow(/hết hạn/);
  });
  it("does not return a foreign workspace's RAG text even when its chunk points to the same profile", () => {
    const h = setup(), at = h.clock().toISOString();
    h.sqlite.prepare("INSERT INTO profiles(id,workspace_id,name,default_brief,guidelines,created_at,updated_at) VALUES ('channel','A','Channel',?,?,?,?)")
      .run(JSON.stringify(ProfileDefaultBriefSchema.parse({})), JSON.stringify(GuidelineSettingsSchema.parse({})), at, at);
    h.sqlite.prepare("UPDATE projects SET profile_id='channel' WHERE id=?").run(h.projectId);
    h.sqlite.prepare(`INSERT INTO projects(id,workspace_id,title,topic,mode,settings,status,stage,created_at,updated_at)
      SELECT 'foreign','B',title,topic,mode,settings,status,stage,created_at,updated_at FROM projects WHERE id=?`).run(h.projectId);
    const put = h.sqlite.prepare(`INSERT INTO retrieval_chunks(profile_id,project_id,kind,source_id,source_version,content_hash,title,text,created_at,updated_at)
      VALUES ('channel',?,'memory',?,'1','hash','fixture',?,?,?)`);
    put.run(h.projectId, 'own', 'orchid reference', at, at);
    put.run('foreign', 'foreign', 'orchid foreign', at, at);
    const result = h.transport().context(h.node, h.run.id, h.run.leaseId, 'retrieve', { query: 'orchid' });
    expect(result.matches.map(({ sourceId }) => sourceId)).toEqual(['own']);
  });

  it("resumes run uploads across restart, reuses them, and applies verified content in a checkpoint", async () => {
    const h = setup(), bytes = Buffer.from("subtitle bytes"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const output = { jobId: h.run.id, leaseId: h.run.leaseId, name: `files/${sha256}.srt`, sha256, size: bytes.length };
    expect(await h.transport().append(h.node, output, 0, Readable.from([bytes.subarray(0, 3)]))).toMatchObject({ receivedBytes: 3, status: "partial" });
    expect(await h.transport().offset(h.node, h.run.id, h.run.leaseId, output.name)).toMatchObject({ receivedBytes: 3 });
    expect(await h.transport().append(h.node, output, 3, Readable.from([bytes.subarray(3)]))).toMatchObject({ status: "ready" });
    h.repository.ensureStages(h.projectId); h.repository.updateStage(h.projectId, "VOICE", { state: "DONE" });
    const body = { leaseId: h.run.leaseId, seq: 1, stage: "SUBTITLE", inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "SUBTITLE"),
      tables: { subtitle_tracks: [{ id: "subtitles", project_id: h.projectId, cues: "[]", srt_path: output.name, ass_path: output.name, input_hash: "hash", created_at: h.clock().toISOString(), updated_at: h.clock().toISOString() }] }, costs: [] };
    expect(h.transport().checkpoints.apply(h.node, h.run.id, body)).toMatchObject({ ok: true, duplicate: false });
    expect(h.transport().have(h.node, h.run.id, h.run.leaseId, [output])).toEqual([output.name]);
    const snapshot = h.transport().snapshot(h.node, h.run.id, h.run.leaseId);
    expect(snapshot.files).toEqual([{ name: output.name, sha256, size: bytes.length }]);
    expect(h.transport().artifact(h.node, h.run.id, h.run.leaseId, sha256).size).toBe(bytes.length);
    h.runs.cancel(h.projectId, "test");
    expect(() => h.transport().append(h.node, output, bytes.length, Readable.from([]))).toThrowError(expect.objectContaining({ code: "LEASE_STALE" }));
  });

  it("checks upload content again before a checkpoint and never trusts an altered file", async () => {
    const h = setup(), bytes = Buffer.from("verified"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const output = { jobId: h.run.id, leaseId: h.run.leaseId, name: `files/${sha256}.srt`, sha256, size: bytes.length };
    const stored = await h.transport().append(h.node, output, 0, Readable.from([bytes]));
    writeFileSync(stored.path, "tampered");
    h.repository.ensureStages(h.projectId); h.repository.updateStage(h.projectId, "VOICE", { state: "DONE" });
    const body = { leaseId: h.run.leaseId, seq: 1, stage: "SUBTITLE", inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "SUBTITLE"),
      tables: { subtitle_tracks: [{ id: "subtitles", project_id: h.projectId, cues: "[]", srt_path: output.name, ass_path: output.name, input_hash: "hash", created_at: h.clock().toISOString(), updated_at: h.clock().toISOString() }] }, costs: [] };
    expect(() => h.transport().checkpoints.apply(h.node, h.run.id, body)).toThrowError(expect.objectContaining({ code: "RUN_FILE_CHANGED" }));
    expect(h.runs.get(h.run.id)?.lastSeq).toBe(0);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM subtitle_tracks").get()).toEqual({ n: 0 });
  });

  it("maps a checkpoint file deleted after upload to RUN_FILE_CHANGED, not a raw ENOENT", async () => {
    const h = setup(), bytes = Buffer.from("removed"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const output = { jobId: h.run.id, leaseId: h.run.leaseId, name: `files/${sha256}.srt`, sha256, size: bytes.length };
    const stored = await h.transport().append(h.node, output, 0, Readable.from([bytes]));
    unlinkSync(stored.path);
    h.repository.ensureStages(h.projectId); h.repository.updateStage(h.projectId, "VOICE", { state: "DONE" });
    const body = { leaseId: h.run.leaseId, seq: 1, stage: "SUBTITLE", inputVersion: h.orchestrator.inputVersions.inputVersion(h.projectId, "SUBTITLE"),
      tables: { subtitle_tracks: [{ id: "subtitles", project_id: h.projectId, cues: "[]", srt_path: output.name, ass_path: output.name, input_hash: "hash", created_at: h.clock().toISOString(), updated_at: h.clock().toISOString() }] }, costs: [] };
    expect(() => h.transport().checkpoints.apply(h.node, h.run.id, body)).toThrowError(expect.objectContaining({ code: "RUN_FILE_CHANGED", statusCode: 409 }));
    expect(h.runs.get(h.run.id)?.lastSeq).toBe(0);
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM subtitle_tracks").get()).toEqual({ n: 0 });
  });

  it("renews runs with the node heartbeat and asks a cancelled run to stop", () => {
    const h = setup(); h.advance(30_000);
    const body = { version: readAppVersion(), capabilities: ["render"], resources: {}, running: [], projectRuns: [{ runId: h.run.id, leaseId: h.run.leaseId }] };
    expect(h.nodes.heartbeat(h.node, body).cancelRuns).toEqual([]);
    expect(h.runs.get(h.run.id)!.leaseUntil > h.run.leaseUntil).toBe(true);
    h.nodes.revoke(h.node.id);
    expect(h.runs.get(h.run.id)).toMatchObject({ status: "CANCELLED", endReason: "NODE_REVOKED" });
  });

  it("serves snapshot routes only to the fenced node and denies unknown context kinds and excessive retrieval", async () => {
    const h = setup(), app = Fastify(); cleanups.push(() => app.close());
    app.setErrorHandler((error, _request, reply) => error instanceof AppError
      ? reply.code(error.statusCode).send({ code: error.code }) : reply.code(500).send({ error: String(error) }));
    registerNodeRoutes(app, h.sqlite, h.config, h.nodes, {} as LeaseService, {} as LeaseSecretService, h.transport());
    const path = `/api/nodes/agent/runs/${h.run.id}`;
    const headers = { authorization: `Bearer ${h.nodeToken}`, "x-lease-id": h.run.leaseId };
    expect((await app.inject({ method: "GET", url: `${path}/snapshot` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `${path}/snapshot`, headers: { ...headers, "x-lease-id": "stale" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: `${path}/snapshot`, headers })).json()).toMatchObject({ projectId: h.projectId, snapshotVersion: 1 });
    expect((await app.inject({ method: "POST", url: `${path}/context/sql`, headers, payload: {} })).statusCode).toBe(404);
    for (let index = 0; index < 60; index++) expect((await app.inject({ method: "POST", url: `${path}/context/retrieve`, headers, payload: { query: "example" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${path}/context/retrieve`, headers, payload: { query: "example" } })).statusCode).toBe(429);
  });
});
