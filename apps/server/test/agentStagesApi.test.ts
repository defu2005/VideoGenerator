import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STAGE_ORDER } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { saveKeyProfile } from "../src/supervision/identity.js";
import { stageReleaseLoops } from "../src/agents/releaseMonitor.js";
import { AutonomySupervisor } from "../src/operator/supervisor.js";
import { listAgentEvents } from "../src/events/agentBus.js";
import { buildSupervisionSnapshot } from "../src/supervision/snapshot.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { sendMessage } from "../src/supervision/mailbox.js";
import { testActor, TEST_WORKSPACE_ID, TEST_OTHER_WORKSPACE_ID } from "./testActor.js";
import { acquireLease } from "../src/supervision/leases.js";

const fixtures: Array<{ app: ReturnType<typeof buildApp>; root: string }> = [];
afterEach(async () => { for (const { app, root } of fixtures.splice(0)) { await app.close(); rmSync(root, { recursive: true, force: true }); } });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-agent-api-"));
  const actor = { ...testActor, kind: "apikey" as "apikey" | "user", keyId: "fixture-key" };
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: actor }); fixtures.push({ app, root });
  const created = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Agent API fixture", settings: { budget: { mode: "ECO" } } } });
  expect(created.statusCode).toBe(201);
  const projectId = created.json().id as string, ctx = app.vgAssistant.service.toolContext();
  saveKeyProfile(ctx.sqlite, actor.keyId, { agentKind: "codex", instanceName: "bound" });
  actor.kind = "user";
  const assignment = await app.inject({ method: "POST", url: "/api/settings/agent-assignments", payload: { instance: "codex/bound", role: "visual_scout" } });
  expect(assignment.statusCode).toBe(201);
  actor.kind = "apikey";
  const repo = new JobRepository(ctx.sqlite, new PipelineEventBus()); repo.ensureStages(projectId);
  const job = repo.createJob({ projectId, stage: "VISUAL_SEARCH", previousState: "PENDING", maxAttempts: 3 });
  ctx.agentStages!.handoff(job.id, "Hết quota vision");
  const post = (path: string, payload: unknown = {}, headers = {}) => app.inject({ method: "POST", url: `/api/stage-agents/${path}`, payload, headers });
  const claim = () => post("claim", { projectId });
  return { app, actor, ctx, repo, projectId, job, post, claim, assignment: assignment.json() };
}

describe("machine-key stage protocol through the real app", () => {
  it("keeps a channel manager's profile lease independent from a scout's job lease", async () => {
    const h = await setup();
    h.actor.kind = "user";
    const profile = await h.app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Scout channel" } });
    expect(profile.statusCode).toBe(201);
    const profileId = profile.json().id as string;
    h.ctx.sqlite.prepare("UPDATE projects SET profile_id=? WHERE id=?").run(profileId, h.projectId);
    expect((await h.app.inject({ method: "POST", url: "/api/settings/agent-assignments", payload: { instance: "hermes/manager", role: "channel_manager", profileId } })).statusCode).toBe(201);
    expect(acquireLease(h.ctx.sqlite, { kind: "profile", id: profileId }, { kind: "hermes", instance: "hermes/manager", rank: 50 })).toMatchObject({ ok: true });
    h.actor.kind = "apikey";
    const claim = await h.claim();
    expect(claim.json().job.id).toBe(h.job.id);
    const invalidScene = await h.post(`jobs/${h.job.id}/candidates`, { leaseId: claim.json().leaseId, sceneId: randomUUID(),
      items: [{ imageUrl: "https://example.invalid/a.png", sourcePageUrl: "https://example.invalid/source", title: "Fixture", why: "Wrong scene" }] });
    expect(invalidScene.statusCode).toBe(409);
    expect(h.ctx.sqlite.prepare("SELECT holder_instance FROM agent_leases WHERE resource_kind='profile' AND resource_id=?").get(profileId)).toEqual({ holder_instance: "hermes/manager" });
  });

  it("shows waiting and claimed jobs separately in the fleet overview", async () => {
    const h = await setup();
    h.ctx.sqlite.prepare("UPDATE jobs SET handoff_at=? WHERE id=?").run(new Date(Date.now() - 16 * 60_000).toISOString(), h.job.id);
    h.actor.kind = "user";
    const overview = () => h.app.inject({ method: "GET", url: "/api/operator/fleet" });
    expect((await overview()).json().stages).toMatchObject({ queueByRole: [{ role: "visual_scout", count: 1 }], claimedJobs: [], needsVisualScout: true });
    h.actor.kind = "apikey";
    expect((await h.claim()).json().job.id).toBe(h.job.id);
    h.actor.kind = "user";
    expect((await overview()).json().stages).toMatchObject({ queueByRole: [], claimedJobs: [{ instance: "codex/bound", count: 1 }], needsVisualScout: false });
  });
  it("lets a scout fill two slots but applies the more specific one-slot assignment", async () => {
    const h = await setup();
    const route = "/api/settings/agent-assignments";
    h.actor.kind = "user";
    expect((await h.app.inject({ method: "PUT", url: `${route}/${h.assignment.id}`, payload: { instance: "*", role: "visual_scout", maxConcurrent: 2 } })).statusCode).toBe(200);
    const specific = await h.app.inject({ method: "POST", url: route, payload: { instance: "codex/bound", role: "visual_scout", projectId: h.projectId, stage: "VISUAL_SEARCH" } });
    expect(specific.statusCode).toBe(201);
    const second = await h.app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Second scout job" } });
    expect(second.statusCode).toBe(201);
    const secondId = second.json().id as string;
    h.repo.ensureStages(secondId);
    const job = h.repo.createJob({ projectId: secondId, stage: "VISUAL_SEARCH", previousState: "PENDING", maxAttempts: 3 });
    h.ctx.agentStages!.handoff(job.id, "Fixture");
    h.actor.kind = "apikey";
    expect((await h.claim()).json().job.id).toBe(h.job.id);
    expect((await h.post("claim", { projectId: secondId })).json()).toBeNull();
    h.actor.kind = "user";
    expect((await h.app.inject({ method: "PUT", url: `${route}/${specific.json().id}`, payload: { instance: "codex/bound", role: "visual_scout", projectId: h.projectId, stage: "VISUAL_SEARCH", maxConcurrent: 2 } })).statusCode).toBe(200);
    h.actor.kind = "apikey";
    expect((await h.post("claim", { projectId: secondId })).json().job.id).toBe(job.id);
  });
  it("requires an active matching assignment and a user to manage it", async () => {
    const h = await setup();
    const url = `/api/settings/agent-assignments/${h.assignment.id}`;
    const payload = { instance: "codex/bound", role: "visual_scout", stage: "VISUAL_SEARCH", maxConcurrent: 2, active: false };
    expect((await h.app.inject({ method: "PUT", url, payload })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "POST", url: "/api/settings/agent-assignments", payload })).statusCode).toBe(403);
    h.actor.kind = "user";
    expect((await h.app.inject({ method: "PUT", url, payload })).statusCode).toBe(200);
    h.actor.kind = "apikey";
    expect((await h.claim()).json()).toBeNull();
    h.actor.kind = "user";
    expect((await h.app.inject({ method: "PUT", url, payload: { ...payload, active: true, projectId: randomUUID() } })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "PUT", url, payload: { ...payload, active: true, projectId: h.projectId } })).statusCode).toBe(200);
    h.actor.kind = "apikey";
    expect((await h.claim()).json().job.id).toBe(h.job.id);
  });
  it("routes configured agent work at enqueue with the local worker disabled", async () => {
    const h = await setup();
    const created = await h.app.inject({ method: "POST", url: "/api/projects", payload: { topic: "External-only execution", settings: { stageExecution: { VISUAL_SEARCH: "agent" } } } });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().id as string;
    h.repo.ensureStages(projectId);
    for (const stage of STAGE_ORDER.slice(0, STAGE_ORDER.indexOf("VISUAL_SEARCH"))) h.repo.updateStage(projectId, stage, { state: "DONE" });
    const queued = await h.app.inject({ method: "POST", url: `/api/projects/${projectId}/pipeline/run`, payload: { stage: "VISUAL_SEARCH" } });
    expect(queued.statusCode).toBe(202);
    const job = h.repo.getActiveJobs(projectId).find((job) => job.stage === "VISUAL_SEARCH")!;
    expect(job).toMatchObject({ executor: "agent", status: "QUEUED" });
    expect(h.repo.getStage(projectId, "VISUAL_SEARCH").message).toContain("Chờ agent nhận");
    const claim = await h.post("claim", { projectId });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().job.id).toBe(job.id);
  });
  it("inherits current profile settings, preserves explicit overrides, and can reset them", async () => {
    const h = await setup();
    const profile = (await h.app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Execution defaults", defaultBrief: { stageExecution: { VISUAL_SEARCH: "agent" }, agentWaitMinutes: 45 } } })).json();
    expect(profile.id).toBeTruthy();
    const project = (await h.app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Inherited execution", profileId: profile.id } })).json();
    expect(project.settings.stageExecution).toBeUndefined();
    expect(project.settings.agentWaitMinutes).toBeUndefined();
    const job = { ...h.job, projectId: project.id };
    expect(h.ctx.agentStages!.mode(job)).toBe("agent");
    const change = await h.app.inject({ method: "PATCH", url: `/api/profiles/${profile.id}`, payload: { defaultBrief: { stageExecution: { VISUAL_SEARCH: "app_then_agent" }, agentWaitMinutes: 15 } } });
    expect(change.statusCode).toBe(200);
    expect(h.ctx.agentStages!.mode(job)).toBe("app_then_agent");
    const override = await h.app.inject({ method: "PATCH", url: `/api/projects/${project.id}`, payload: { settings: { stageExecution: { VISUAL_SEARCH: "app" }, agentWaitMinutes: 5 } } });
    expect(override.statusCode).toBe(200);
    expect(h.ctx.agentStages!.mode(job)).toBe("app");
    const reset = await h.app.inject({ method: "PATCH", url: `/api/projects/${project.id}`, payload: { resetToRecommended: ["stageExecution.VISUAL_SEARCH", "agentWaitMinutes"] } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().settings.stageExecution).toBeUndefined();
    expect(reset.json().settings.agentWaitMinutes).toBeUndefined();
    expect(h.ctx.agentStages!.mode(job)).toBe("app_then_agent");
    expect((await h.app.inject({ method: "PATCH", url: `/api/projects/${project.id}`, payload: { settings: { stageExecution: { SUBTITLE: "agent" } } } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "PATCH", url: `/api/projects/${project.id}`, payload: { settings: { stageExecution: { SCRIPT: "agent" } } } })).statusCode).toBe(200);
    await h.app.inject({ method: "PATCH", url: `/api/profiles/${profile.id}`, payload: { defaultBrief: { stageExecution: { VISUAL_SEARCH: "agent" }, agentWaitMinutes: 45 } } });
    const cleared = await h.app.inject({ method: "PATCH", url: `/api/profiles/${profile.id}`, payload: { defaultBrief: { stageExecution: null, agentWaitMinutes: null } } });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().defaultBrief.stageExecution).toBeUndefined();
    expect(cleared.json().defaultBrief.agentWaitMinutes).toBeUndefined();
    expect(h.ctx.agentStages!.mode(job)).toBe("app_then_agent");
  });
  it("uses the key-bound identity, returns null after a claim, and checks every fence", async () => {
    const h = await setup();
    const response = await h.post("claim", { projectId: h.projectId }, { "x-vg-agent-kind": "hermes", "x-vg-agent-name": "spoof" });
    expect(response.statusCode).toBe(200);
    const claim = response.json();
    expect(claim.job.agentInstance).toBe("codex/bound");
    expect(claim.context).toMatchObject({ stage: "VISUAL_SEARCH", copyrightMode: "off" });
    expect((await h.claim()).json()).toBeNull();
    const heartbeat = await h.post(`jobs/${h.job.id}/heartbeat`, { leaseId: claim.leaseId, progress: 23 });
    expect(heartbeat.statusCode).toBe(200);
    const stale = await h.post(`jobs/${h.job.id}/heartbeat`, { leaseId: randomUUID() });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("LEASE_LOST");
    expect((await h.post(`jobs/${h.job.id}/take-back`)).statusCode).toBe(403);
  });

  it("cannot bypass a held agent stage through the old manual selection API", async () => {
    const h = await setup(), sceneId = randomUUID(), at = new Date().toISOString();
    h.ctx.sqlite.prepare(`INSERT INTO scenes(id,project_id,"order",kind,label,narration,visual_notes,visual_queries,music_mood,energy,est_duration_sec,start_sec,transition_note,origin,edited,input_hash,created_at,updated_at)
      VALUES(?,?,0,'section','Fixture','River','river',?,'','medium',4,0,'','AGENT',0,'fixture',?,?)`).run(sceneId, h.projectId, JSON.stringify({ primary: "river", alternatives: [], queryVariant: false }), at, at);
    const claim = (await h.claim()).json();
    const response = await h.app.inject({ method: "POST", url: `/api/projects/${h.projectId}/scenes/${sceneId}/visuals/select`, payload: { candidateId: randomUUID() } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("JOB_ACTIVE");
    expect(h.repo.getExecutionLease(h.job.id)?.leaseId).toBe(claim.leaseId);
    expect(h.ctx.sqlite.prepare("SELECT 1 FROM visual_selections WHERE scene_id=?").get(sceneId)).toBeUndefined();
  });

  it("makes the same tools available through registry and rejects header-only identities", async () => {
    const h = await setup();
    const catalog = (await h.app.inject({ method: "GET", url: "/api/registry/tools" })).json().tools;
    expect(catalog.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(["stage_claim_next", "stage_heartbeat", "stage_complete", "stage_release", "visual_submit_candidates", "visual_get_candidate_image", "visual_record_verdict", "visual_select"]));
    const request = () => h.app.inject({ method: "POST", url: "/api/registry/invoke", payload: { name: "stage_claim_next", args: { projectId: h.projectId } }, headers: { "x-vg-tool-source": "agent", "x-vg-agent-kind": "hermes" } });
    saveKeyProfile(h.ctx.sqlite, h.actor.keyId, { agentKind: "codex", instanceName: "unknown" });
    expect((await h.claim()).statusCode).toBe(403);
    expect((await request()).statusCode).toBe(403);
    h.ctx.sqlite.prepare("DELETE FROM agent_key_profiles WHERE key_id=?").run(h.actor.keyId);
    expect((await request()).statusCode).toBe(403);
    saveKeyProfile(h.ctx.sqlite, h.actor.keyId, { agentKind: "codex", instanceName: "bound" });
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.json().result.job.agentInstance).toBe("codex/bound");
  });

  it("preempts an agent job on a user project edit and leaves reads alone", async () => {
    const h = await setup(), claim = (await h.claim()).json();
    h.actor.kind = "user";
    expect((await h.app.inject({ method: "GET", url: `/api/projects/${h.projectId}/pipeline` })).statusCode).toBe(200);
    expect(h.repo.getExecutionLease(h.job.id)?.leaseId).toBe(claim.leaseId);
    const edit = await h.app.inject({ method: "PATCH", url: `/api/projects/${h.projectId}`, payload: { title: "User took over" } });
    expect(edit.statusCode).toBe(200);
    expect(h.repo.getExecutionLease(h.job.id)).toBeNull();
    h.actor.kind = "apikey";
    expect((await h.post(`jobs/${h.job.id}/heartbeat`, { leaseId: claim.leaseId })).json().error.code).toBe("LEASE_LOST");
  });

  it("does not preempt a lease when a user names a foreign workspace project", async () => {
    const h = await setup(), claim = (await h.claim()).json();
    h.actor.kind = "user";
    const originalWorkspace = h.actor.workspaceId;
    h.actor.workspaceId = "different-workspace";
    const result = await h.app.inject({ method: "POST", url: "/api/registry/invoke", payload: { name: "run_pipeline", args: { projectId: h.projectId } } });
    expect(result.statusCode).toBe(403);
    expect(h.repo.getExecutionLease(h.job.id)?.leaseId).toBe(claim.leaseId);
    expect(h.repo.getJob(h.job.id)?.status).toBe("RUNNING");
    h.actor.workspaceId = originalWorkspace;
    h.ctx.sqlite.prepare("UPDATE projects SET workspace_id=NULL WHERE id=?").run(h.projectId);
    await h.app.inject({ method: "POST", url: "/api/registry/invoke", payload: { name: "run_pipeline", args: { projectId: h.projectId } } });
    expect(h.repo.getExecutionLease(h.job.id)?.leaseId).toBe(claim.leaseId);
  });

  it("forbids a machine key from changing copyright mode through REST", async () => {
    const h = await setup();
    const created = await h.app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Copyright fixture" } });
    expect(created.statusCode).toBe(201);
    const url = `/api/profiles/${created.json().id}/visual-copyright`;
    expect((await h.app.inject({ method: "PUT", url, payload: { allowCopyrightedStills: "commentary" } })).statusCode).toBe(403);
    expect((await h.app.inject({ method: "GET", url })).json().allowCopyrightedStills).toBe("off");
    h.actor.kind = "user";
    expect((await h.app.inject({ method: "PUT", url, payload: { allowCopyrightedStills: "commentary" } })).statusCode).toBe(200);
  });

  it("completes via normal pipeline advancement after actual postchecks", async () => {
    const h = await setup(), at = new Date().toISOString(), sceneId = randomUUID();
    h.ctx.sqlite.prepare(`INSERT INTO scenes(id,project_id,"order",kind,label,narration,visual_notes,visual_queries,music_mood,energy,est_duration_sec,start_sec,transition_note,origin,edited,input_hash,created_at,updated_at,no_visual)
      VALUES(?,?,0,'section','No image','Explicitly skipped','',?,'','medium',4,0,'','USER',1,'fixture',?,?,1)`).run(sceneId, h.projectId, JSON.stringify({ primary: "skip", alternatives: [], queryVariant: false }), at, at);
    for (const stage of STAGE_ORDER.slice(0, STAGE_ORDER.indexOf("VISUAL_SEARCH"))) h.repo.updateStage(h.projectId, stage, { state: "DONE" });
    h.repo.setRunMode(h.projectId, "ALL");
    const claim = (await h.claim()).json();
    const response = await h.post(`jobs/${h.job.id}/complete`, { leaseId: claim.leaseId, summary: "Đã kiểm cảnh không cần ảnh." });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("SUCCEEDED");
    expect(h.repo.getStage(h.projectId, "VISUAL_REVIEW").state).toBe("WAITING_USER");
    expect(h.repo.getExecutionLease(h.job.id)).toBeNull();
  });

  it("rejects a stage with no scenes and counts repeated claim/release loops", async () => {
    const h = await setup();
    const claim = (await h.claim()).json();
    expect((await h.post(`jobs/${h.job.id}/complete`, { leaseId: claim.leaseId, summary: "Chưa có cảnh" })).json().error.code).toBe("VISUAL_STAGE_INCOMPLETE");
    let leaseId = claim.leaseId;
    for (let i = 0; i < 4; i++) {
      expect((await h.post(`jobs/${h.job.id}/release`, { leaseId, reason: "retry" })).statusCode).toBe(200);
      if (i < 3) leaseId = (await h.claim()).json().leaseId;
    }
    expect(stageReleaseLoops(h.ctx.sqlite)).toMatchObject([{ jobId: h.job.id, count: 4 }]);
    const supervisor = new AutonomySupervisor({ repository: h.repo, usage: h.ctx.usage, stageTimeoutMs: 600_000, logger: h.app.log });
    try {
      // TASK-129a §1 anomaly: the opened finding's event is scoped to its profile's workspace.
      const profileId = "22222222-2222-4222-8222-222222222222";
      const ts = new Date().toISOString();
      h.ctx.sqlite.prepare(`INSERT INTO profiles (id, name, description, direction, language, default_brief, voice, guidelines, llm, avatar_path, color, archived_at, created_at, updated_at)
        VALUES (?, 'scoped', '', '', 'vi', '{}', NULL, '{}', NULL, NULL, '#3B82F6', NULL, ?, ?)`).run(profileId, ts, ts);
      h.ctx.sqlite.prepare("UPDATE projects SET profile_id = ? WHERE id = ?").run(profileId, h.job.projectId);
      h.ctx.sqlite.prepare("UPDATE profiles SET workspace_id = 'ws-a' WHERE id = ?").run(profileId);
      const loopIn = (ws: string) => listAgentEvents({ types: ["supervisor_finding"], workspaceId: ws })
        .filter((event) => event.summary === "Phát hiện stage_release_loop").length;
      const aBefore = loopIn("ws-a");
      const bBefore = loopIn("ws-b");
      supervisor.runPass();
      expect(loopIn("ws-a") - aBefore).toBe(1);
      expect(loopIn("ws-b") - bBefore).toBe(0);
      expect(listAgentEvents({ types: ["supervisor_finding"], projectId: h.job.projectId }).some((event) => event.summary === "Phát hiện stage_release_loop")).toBe(true);
      const finding = () => h.ctx.sqlite.prepare("SELECT status FROM supervisor_findings WHERE dedupe_key=?").get(`stage_release_loop:${h.job.id}`);
      expect(finding()).toMatchObject({ status: "open" });
      const snapshot = runAsActor(h.actor, () => buildSupervisionSnapshot(h.ctx.sqlite));
      expect(snapshot.anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "stage_release_loop", ref: `job:${h.job.id}` })]));
      const workspace = h.actor.workspaceId;
      h.actor.workspaceId = "foreign-workspace";
      const hidden = await h.app.inject({ method: "GET", url: "/api/autonomy/app/supervisor" });
      expect(hidden.statusCode).toBe(200);
      expect(hidden.json().findings.some((row: { kind: string }) => row.kind === "stage_release_loop")).toBe(false);
      expect(runAsActor(h.actor, () => buildSupervisionSnapshot(h.ctx.sqlite)).anomalies).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "stage_release_loop", ref: `job:${h.job.id}` })]));
      h.actor.workspaceId = workspace;
      h.repo.updateJob(h.job.id, { status: "SUCCEEDED" });
      supervisor.runPass();
      expect(finding()).toMatchObject({ status: "resolved" });
    } finally { supervisor.stop(); }
  });
});

describe("TASK-129a step 5 over HTTP", () => {
  it("a claim through the real route sends one duty report from the key's fixed instance, ignoring x-agent-name", async () => {
    const s = await setup();
    const res = await s.app.inject({ method: "POST", url: "/api/stage-agents/claim", payload: { projectId: s.projectId }, headers: { "x-agent-name": "spoof" } });
    expect(res.statusCode).toBe(200);
    const rows = s.ctx.sqlite.prepare("SELECT from_instance, to_kind, kind, project_id FROM agent_messages").all() as Array<Record<string, string>>;
    expect(rows).toEqual([{ from_instance: "codex/bound", to_kind: "duty", kind: "report", project_id: s.projectId }]);
  });
});

describe("HTTP stage claim with mailbox and workspace edges", () => {
  it("claims through HTTP even when the mailbox rate limit refuses the duty report", async () => {
    const h = await setup();
    const count = () => (h.ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM agent_messages WHERE from_instance = 'codex/bound'").get() as { n: number }).n;
    for (let i = 0; i < 60; i++) {
      sendMessage(h.ctx.sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/bound", to: "duty", kind: "report", body: `filler ${i}` }, new Date());
    }
    const before = count();
    const res = await h.claim();
    expect(res.statusCode).toBe(200);
    expect(res.json().job.id).toBe(h.job.id);
    expect(count()).toBe(before);
  });

  it("another workspace's key cannot claim the job over HTTP, and the job stays unclaimed", async () => {
    const h = await setup();
    h.actor.workspaceId = TEST_OTHER_WORKSPACE_ID;
    const res = await h.claim();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    expect(h.repo.getJob(h.job.id)?.status).toBe("QUEUED");
    expect(h.ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM agent_messages WHERE from_instance = 'codex/bound'").get()).toEqual({ n: 0 });
  });
});

describe("a stage report is visible only to its own workspace over HTTP", () => {
  it("workspace A sees the claim report in the thread list; workspace B does not", async () => {
    const h = await setup();
    const res = await h.claim();
    expect(res.statusCode).toBe(200);
    h.actor.kind = "user";
    const listA = await h.app.inject({ method: "GET", url: "/api/operator/fleet/threads" });
    expect(listA.statusCode).toBe(200);
    const fromA = (listA.json().threads as Array<{ lastFrom: string }>).map((t) => t.lastFrom);
    expect(fromA).toContain("codex/bound");
    h.actor.workspaceId = TEST_OTHER_WORKSPACE_ID;
    const listB = await h.app.inject({ method: "GET", url: "/api/operator/fleet/threads" });
    expect(listB.statusCode).toBe(200);
    const fromB = (listB.json().threads as Array<{ lastFrom: string }>).map((t) => t.lastFrom);
    expect(fromB).not.toContain("codex/bound");
  });
});

describe("agent events list over HTTP is scoped to the viewer's workspace", () => {
  it("workspace A's list shows the agent.message; workspace B's list does not", async () => {
    const h = await setup();
    h.actor.kind = "user";
    sendMessage(h.ctx.sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/bound", to: "duty", kind: "report", body: "scoped" }, new Date());
    const typesOf = (body: { events: Array<{ type: string }> }) => body.events.map((e) => e.type);
    const listA = await h.app.inject({ method: "GET", url: "/api/events?types=agent.message" });
    expect(listA.statusCode).toBe(200);
    expect(typesOf(listA.json())).toContain("agent.message");
    h.actor.workspaceId = TEST_OTHER_WORKSPACE_ID;
    const listB = await h.app.inject({ method: "GET", url: "/api/events?types=agent.message" });
    expect(listB.statusCode).toBe(200);
    expect(typesOf(listB.json())).not.toContain("agent.message");
  });
});
