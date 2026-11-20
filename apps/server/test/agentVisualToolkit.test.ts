import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAsActor } from "../src/auth/requestContext.js";
import { AgentStageService } from "../src/agents/stageService.js";
import { saveAgentAssignment } from "../src/agents/assignments.js";
import { AgentVisualToolkit, agentLicense } from "../src/agents/visualToolkit.js";
import { VisualService } from "../src/services/visualService.js";
import { resolveAssetPath } from "../src/storage/paths.js";
import type { TrustedAgent } from "../src/supervision/identity.js";
import { parseImage } from "../src/services/imageStore.js";
import { setVisualCopyrightMode } from "../src/services/visualPolicy.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { actorWith } from "./testActor.js";
import { imageVerdictContext, reusableImageCheck } from "../src/agents/visualCache.js";
import { recordQueryOutcome } from "../src/learning/queryPatterns.js";
import { resolveBudget } from "@vg/shared";

const png = readFileSync(fileURLToPath(new URL("./fixtures/images/tiny.png", import.meta.url)));
const jpeg = readFileSync(fileURLToPath(new URL("./fixtures/images/tiny.jpg", import.meta.url)));
const agent: TrustedAgent = { kind: "hermes", name: "scout", instance: "hermes/scout", model: null, environment: "test", trusted: true, canSupervise: false };
const scoped = <T>(fn: () => T, workspaceId = "A") => runAsActor(actorWith({ role: "owner", kind: "apikey", workspaceId }), fn);
const input = { imageUrl: "https://images.example/image.png", sourcePageUrl: "https://www.pexels.com/photo/1", title: "River", why: "Đúng cảnh sông", licenseNote: "Pexels License" };
const verdict = { verdict: "pass", subjectMatch: true, reason: "Đúng chủ thể, rõ nét, không watermark", model: "external-vision" };
const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { fixtures.splice(0).forEach((h) => h.close()); });

function setup(realPreview = false) {
  const h = createPipelineHarness(); fixtures.push(h);
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
  saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: agent.instance, role: "visual_scout" });
  h.repository.ensureStages(h.projectId);
  const scenes = [randomUUID(), randomUUID()], at = h.clock().toISOString();
  const insert = h.sqlite.prepare(`INSERT INTO scenes (id,project_id,"order",kind,label,narration,visual_notes,visual_queries,music_mood,energy,est_duration_sec,start_sec,transition_note,origin,edited,input_hash,created_at,updated_at)
    VALUES (?,?,?,'section','River','A river at sunrise.','river sunrise',?,'','medium',4,?,'','AGENT',0,'fixture',?,?)`);
  scenes.forEach((id, i) => insert.run(id, h.projectId, i, JSON.stringify({ primary: "river sunrise", alternatives: ["sunrise river"], queryVariant: false }), i * 4, at, at));
  const visuals = new VisualService(h.sqlite, h.repository, h.config);
  let toolkit: AgentVisualToolkit;
  const stages = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, now: h.clock,
    context: (job) => toolkit.context(job), validateComplete: (job) => { toolkit.validateComplete(job); } });
  const fetch = vi.fn(async () => new Response(png, { headers: { "content-type": "image/png" } }));
  const hash = vi.fn(async () => ({ phash: "0000000000000000", phashCenter: "0000000000000000" }));
  const resize = vi.fn(async (path: string) => readFileSync(path));
  toolkit = new AgentVisualToolkit(h.repository, stages, visuals, h.config, { fetch: { fetchImpl: fetch, resolveHost: async () => ["93.184.216.34"] }, hash, resize: realPreview ? undefined : resize });
  const job = h.repository.createJob({ projectId: h.projectId, stage: "VISUAL_SEARCH", maxAttempts: 3, previousState: "PENDING" });
  stages.handoff(job.id, "vision_unavailable");
  const claim = scoped(() => stages.claim(agent))!;
  const submit = (item = input, sceneId = scenes[0]) => scoped(() => toolkit.submit(agent, job.id, claim.leaseId, sceneId, [item]));
  const judge = (candidateId: string, value = verdict) => scoped(() => toolkit.recordVerdict(agent, job.id, claim.leaseId, candidateId, value));
  const select = (candidateId: string, sceneId = scenes[0]) => scoped(() => toolkit.select(agent, job.id, claim.leaseId, sceneId, candidateId));
  return { ...h, visuals, stages, toolkit, fetch, hash, resize, scenes, job, claim, submit, judge, select };
}

describe("agent visual toolkit", () => {
  it("TASK-148d: scout context carries accepted query hints for the same workspace and topic only", () => {
    const h = setup();
    h.sqlite.prepare("UPDATE projects SET topic=? WHERE id=?").run("River Stories", h.projectId);
    expect(h.toolkit.context(h.job)).not.toHaveProperty("queryHints");
    recordQueryOutcome(h.sqlite, { workspaceId: "A", topic: "river stories", query: "Hue river at dawn 1960", accepted: true });
    expect(h.toolkit.context(h.job).queryHints).toEqual(["Hue river at dawn 1960"]);
    recordQueryOutcome(h.sqlite, { workspaceId: "B", topic: "river stories", query: "other workspace query 1999", accepted: true });
    expect(h.toolkit.context(h.job).queryHints).toEqual(["Hue river at dawn 1960"]);
    h.sqlite.prepare("UPDATE projects SET topic=? WHERE id=?").run("cooking", h.projectId);
    expect(h.toolkit.context(h.job)).not.toHaveProperty("queryHints");
  });
  it("shares agent fit with the app only for the scene context actually judged", async () => {
    const h = setup(), id = (await h.submit()).candidateIds[0];
    h.judge(id);
    const candidate = h.visuals.agentCandidate(id)!, project = h.repository.getProject(h.projectId)!;
    const input = { narration: "A river at sunrise.", visualDescription: "river sunrise", aspectRatio: project.settings.aspectRatio,
      visionThreshold: resolveBudget(project).visionThreshold };
    expect(reusableImageCheck(h.sqlite, "A", { phash: candidate.phash!, sha256: candidate.sha256! }, "river sunrise", imageVerdictContext(input))?.checkedBy?.instance).toBe(agent.instance);
    expect(reusableImageCheck(h.sqlite, "A", { phash: candidate.phash!, sha256: candidate.sha256! }, "river sunrise", imageVerdictContext({ ...input, narration: "The same river during a flood" }))).toBeNull();
    expect(reusableImageCheck(h.sqlite, "A", { phash: candidate.phash!, sha256: candidate.sha256! }, "river sunrise")).toBeNull();
  });
  it("keeps a valid selection awaiting review, but reopens it if the actual gate stops passing", async () => {
    const h = setup(), id = (await h.submit()).candidateIds[0];
    h.judge(id); await h.select(id);
    h.sqlite.prepare("UPDATE visual_selections SET status='DISCOVERED' WHERE scene_id=?").run(h.scenes[0]);
    expect(h.visuals.agentOpenScenes(h.projectId).map((scene) => scene.sceneId)).not.toContain(h.scenes[0]);
    h.sqlite.prepare("UPDATE visual_candidates SET watermark='SUSPECTED' WHERE id=?").run(id);
    expect(h.visuals.agentOpenScenes(h.projectId).map((scene) => scene.sceneId)).toContain(h.scenes[0]);
    expect(h.toolkit.context(h.job).openScenes.find((scene) => scene.sceneId === h.scenes[0])?.reason).toBe("Ảnh đã chọn chưa qua cổng chất lượng");
    h.sqlite.prepare("UPDATE visual_candidates SET watermark='NONE',download_error='HTTP 429' WHERE id=?").run(id);
    expect(h.visuals.agentOpenScenes(h.projectId).map((scene) => scene.sceneId)).toContain(h.scenes[0]);
  });
  it("returns only open scenes and the queries, constraints and copyright mode", () => {
    const h = setup();
    const context = h.claim.context as ReturnType<AgentVisualToolkit["context"]>;
    expect(context.openScenes).toHaveLength(2);
    expect(context.openScenes[0]).toMatchObject({ narration: "A river at sunrise.", queries: { primary: "river sunrise" } });
    expect(context).toMatchObject({ copyrightMode: "off", aspectRatio: "16:9", limits: { minShortSide: 320, previewMaxSide: 768 } });
    h.sqlite.prepare("UPDATE scenes SET no_visual=1 WHERE id=?").run(h.scenes[1]);
    expect(h.toolkit.context(h.job).openScenes.map((scene) => scene.sceneId)).toEqual([h.scenes[0]]);
    h.sqlite.prepare("INSERT INTO visual_search_checkpoints(scene_id,project_id,search_hash,queries,candidates,created_at) VALUES(?,?,'fixture',?,'[]',?)").run(h.scenes[0], h.projectId, JSON.stringify(["zero-hit river query"]), h.clock().toISOString());
    expect(h.toolkit.context(h.job).openScenes[0].queriesUsed).toContain("zero-hit river query");
  });

  it("stores attributed, downloaded candidates and drops hash duplicates", async () => {
    const h = setup(), result = await h.submit(), id = result.candidateIds[0];
    expect(h.visuals.agentCandidate(id)).toMatchObject({ origin: "agent", provider: "agent:hermes/scout", licenseVerified: true, sourceSite: "www.pexels.com", sourcePageUrl: input.sourcePageUrl, phash: "0000000000000000" });
    const duplicate = await h.submit();
    expect(duplicate).toMatchObject({ candidateIds: [], items: [{ candidateId: null, duplicateOf: id }] });
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM visual_candidates").get()).toEqual({ n: 1 });
  });

  it("can assign an unselected rejected hit to the scene it actually fits, without duplicating selected images", async () => {
    const h = setup(), first = (await h.submit()).candidateIds[0];
    h.judge(first, { ...verdict, verdict: "reject", subjectMatch: false, reason: "Không khớp cảnh đầu" });
    const second = (await h.submit(input, h.scenes[1])).candidateIds[0];
    expect(second).not.toBe(first);
    h.judge(second);
    expect((await h.select(second, h.scenes[1])).selection?.candidateId).toBe(second);
    const duplicate = await h.submit();
    expect(duplicate.candidateIds).toEqual([]);
    expect(h.visuals.agentCandidate(first)?.sha256).toBe(h.visuals.agentCandidate(second)?.sha256);
  });

  it("reads the actual stored file, binds the verdict to its SHA and uses ordinary approval", async () => {
    const h = setup(), id = (await h.submit()).candidateIds[0];
    const image = await scoped(() => h.toolkit.image(id));
    expect(Buffer.from(image.content[0].data, "base64")).toEqual(png);
    expect(h.resize).toHaveBeenCalledWith(expect.stringContaining("visuals"), 768);
    const candidate = h.judge(id);
    expect(candidate.visionCheck).toMatchObject({ verdict: "pass", sha256: candidate.sha256, checkedBy: { kind: "agent", instance: agent.instance, model: verdict.model } });
    const selected = await h.select(id);
    expect(selected.selection).toMatchObject({ selectedBy: "AGENT", status: "APPROVED", candidateId: id });
    expect(h.visuals.agentOpenScenes(h.projectId).map((scene) => scene.sceneId)).toEqual([h.scenes[1]]);
    await expect(h.submit()).rejects.toMatchObject({ code: "VISUAL_SCENE_CLOSED" });
  });

  it("resizes a real stored image through FFmpeg without upscaling", async () => {
    const h = setup(true);
    const bytes = execFileSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=640x480", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]);
    h.fetch.mockImplementation(async () => new Response(bytes, { headers: { "content-type": "image/png" } }));
    const id = (await h.submit()).candidateIds[0];
    const small = await scoped(() => h.toolkit.image(id, 128));
    expect(parseImage(Buffer.from(small.content[0].data, "base64"))).toMatchObject({ width: 128, height: 96 });
    const originalSize = await scoped(() => h.toolkit.image(id));
    expect(parseImage(Buffer.from(originalSize.content[0].data, "base64"))).toMatchObject({ width: 640, height: 480 });
  });

  it("rejects missing, rejected and subject-mismatched verdicts", async () => {
    const h = setup(), id = (await h.submit()).candidateIds[0];
    await expect(h.select(id)).rejects.toMatchObject({ code: "VISUAL_AGENT_VERDICT_REQUIRED" });
    h.judge(id, { ...verdict, verdict: "reject", subjectMatch: false });
    await expect(h.select(id)).rejects.toMatchObject({ code: "VISUAL_AGENT_VERDICT_REQUIRED" });
    expect(() => h.judge(id, { ...verdict, subjectMatch: false })).toThrow(/sai chủ thể/);
  });

  it("refuses changed disk bytes and a changed stored SHA after approval", async () => {
    const h = setup(), id = (await h.submit()).candidateIds[0], candidate = h.judge(id);
    const path = resolveAssetPath(h.config.DATA_DIR, h.projectId, candidate.localPath!);
    writeFileSync(path, jpeg);
    await expect(h.select(id)).rejects.toMatchObject({ code: "VISUAL_HASH_CHANGED" });
    await expect(scoped(() => h.toolkit.image(id))).rejects.toMatchObject({ code: "VISUAL_HASH_CHANGED" });
    writeFileSync(path, png);
    h.sqlite.prepare("UPDATE visual_candidates SET sha256=? WHERE id=?").run("f".repeat(64), id);
    await expect(h.select(id)).rejects.toMatchObject({ code: "VISUAL_AGENT_VERDICT_REQUIRED" });
  });

  it("enforces copyright off and preserves source-risk and watermark gates", async () => {
    const h = setup(), id = (await h.submit({ ...input, sourcePageUrl: "https://community.example/art", licenseNote: "all rights reserved" })).candidateIds[0];
    h.judge(id);
    await expect(h.select(id)).rejects.toMatchObject({ code: "VISUAL_COPYRIGHT_MODE" });
    h.sqlite.prepare("UPDATE visual_candidates SET license_verified=1,watermark='SUSPECTED' WHERE id=?").run(id);
    await expect(h.select(id)).rejects.toMatchObject({ code: "VISUAL_GATE_REJECTED" });
  });

  it("honours a user-configured commentary mode while retaining the normal image gate", async () => {
    const h = setup(), profileId = randomUUID();
    h.sqlite.prepare("INSERT INTO profiles(id,name,workspace_id,default_brief,guidelines,created_at,updated_at) VALUES(?,?,'A','{}','{}',?,?)").run(profileId, "Commentary fixture", h.clock().toISOString(), h.clock().toISOString());
    h.sqlite.prepare("UPDATE projects SET profile_id=? WHERE id=?").run(profileId, h.projectId);
    setVisualCopyrightMode(h.sqlite, profileId, "commentary");
    const id = (await h.submit({ ...input, sourcePageUrl: "https://community.example/art", licenseNote: "all rights reserved" })).candidateIds[0];
    expect(h.visuals.agentCandidate(id)?.licenseVerified).toBe(false);
    h.judge(id);
    expect((await h.select(id)).selection?.status).toBe("APPROVED");
    expect(h.toolkit.context(h.job).copyrightMode).toBe("commentary");
  });

  it("fences writes when the user takes over while downloading", async () => {
    const h = setup();
    h.fetch.mockImplementationOnce(async () => {
      runAsActor(actorWith({ role: "owner", workspaceId: "A" }), () => h.stages.takeBack(h.job.id));
      return new Response(png, { headers: { "content-type": "image/png" } });
    });
    await expect(h.submit()).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM visual_candidates").get()).toEqual({ n: 0 });
  });

  it("rejects private URLs, redirects, non-image bodies and oversized downloads", async () => {
    const h = setup();
    await expect(h.submit({ ...input, sourcePageUrl: "http://127.0.0.1/private" })).rejects.toMatchObject({ code: "SSRF" });
    await expect(h.submit({ ...input, imageUrl: "http://169.254.169.254/latest" })).rejects.toMatchObject({ code: "SSRF" });
    expect(h.fetch).not.toHaveBeenCalled();
    h.fetch.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/hidden" } }));
    await expect(h.submit()).rejects.toMatchObject({ code: "SSRF" });
    h.fetch.mockImplementationOnce(async () => new Response("<html/>", { headers: { "content-type": "text/html" } }));
    await expect(h.submit()).rejects.toMatchObject({ code: "VISUAL_IMAGE_TYPE" });
    h.fetch.mockImplementationOnce(async () => new Response(png, { headers: { "content-type": "image/png", "content-length": String(26 * 1024 * 1024) } }));
    await expect(h.submit()).rejects.toMatchObject({ code: "VISUAL_IMAGE_SIZE" });
  });

  it("blocks foreign scenes, candidates, workspace reads and attempts to alter copyright", async () => {
    const h = setup(), id = (await h.submit()).candidateIds[0];
    await expect(h.select(id, h.scenes[1])).rejects.toMatchObject({ code: "VISUAL_CANDIDATE_NOT_FOUND" });
    await expect(h.submit(input, randomUUID())).rejects.toMatchObject({ code: "VISUAL_SCENE_CLOSED" });
    await expect(scoped(() => h.toolkit.image(id), "B")).rejects.toMatchObject({ code: "VISUAL_CANDIDATE_NOT_FOUND" });
    expect(() => h.judge(id, { ...verdict, copyrightMode: "commentary" } as typeof verdict)).toThrow();
    await expect(scoped(() => h.toolkit.submit(agent, h.job.id, "wrong", h.scenes[0], [input]))).rejects.toMatchObject({ code: "LEASE_LOST" });
  });

  it("keeps user-owned selections untouched", async () => {
    const h = setup(), id = (await h.submit()).candidateIds[0];
    await h.visuals.selectCandidate(h.projectId, h.scenes[0], id);
    expect(h.toolkit.context(h.job).openScenes.map((scene) => scene.sceneId)).toEqual([h.scenes[1]]);
    expect(() => h.judge(id)).toThrow(/còn mở/);
    await expect(h.select(id)).rejects.toMatchObject({ code: "VISUAL_SCENE_CLOSED" });
  });

  it("requires all open scenes to pass before completion and retains a changed-file check", async () => {
    const h = setup(), id = (await h.submit()).candidateIds[0];
    await expect(scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "xong"))).rejects.toMatchObject({ code: "VISUAL_STAGE_INCOMPLETE" });
    h.judge(id); await h.select(id);
    h.sqlite.prepare("UPDATE scenes SET no_visual=1 WHERE id=?").run(h.scenes[1]);
    const candidate = h.visuals.agentCandidate(id)!;
    writeFileSync(resolveAssetPath(h.config.DATA_DIR, h.projectId, candidate.localPath!), jpeg);
    await expect(scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "xong"))).rejects.toMatchObject({ code: "VISUAL_HASH_CHANGED" });
    writeFileSync(resolveAssetPath(h.config.DATA_DIR, h.projectId, candidate.localPath!), png);
    expect((await scoped(() => h.stages.complete(agent, h.job.id, h.claim.leaseId, "xong"))).status).toBe("SUCCEEDED");
  });
});

it("verifies named licences only on existing provider sites", () => {
  expect(agentLicense("www.pexels.com", "Pexels License").verified).toBe(true);
  expect(agentLicense("commons.wikimedia.org", "CC BY SA").verified).toBe(true);
  expect(agentLicense("pexels.com.evil.example", "Pexels License").verified).toBe(false);
  expect(agentLicense("unknown.example", "CC0").verified).toBe(false);
  expect(agentLicense("www.pexels.com", "").verified).toBe(false);
});
