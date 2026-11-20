import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStageService } from "../src/agents/stageService.js";
import { saveAgentAssignment } from "../src/agents/assignments.js";
import { runAsActor } from "../src/auth/requestContext.js";
import type { AuthActor } from "../src/auth/actor.js";
import type { TrustedAgent } from "../src/supervision/identity.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { actorWith } from "./testActor.js";
import { sendMessage } from "../src/supervision/mailbox.js";

// TASK-129a step 5: claim/finish/release each send exactly one `report` to the duty agent after success.
const agent = (name = "one"): TrustedAgent => ({ kind: "hermes", name, instance: `hermes/${name}`, trusted: true, canSupervise: false, model: null, environment: "test" });
const asAgent = <T>(fn: () => T, workspaceId = "A", keyId = "key-one") => runAsActor({ ...actorWith({ role: "owner", kind: "apikey", workspaceId }), keyId } as AuthActor, fn);
const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => { fixtures.splice(0).forEach((h) => h.close()); });

function setup(workspace: string | null = "A") {
  const h = createPipelineHarness(); fixtures.push(h);
  const now = new Date().toISOString();
  h.sqlite.prepare("INSERT INTO agent_key_profiles (key_id, agent_kind, instance_name, can_supervise, updated_at) VALUES ('key-one','hermes','one',0,?)").run(now);
  h.sqlite.prepare("INSERT INTO agent_key_profiles (key_id, agent_kind, instance_name, can_supervise, updated_at) VALUES ('key-unnamed','hermes','unknown',0,?)").run(now);
  h.sqlite.prepare("UPDATE projects SET workspace_id=? WHERE id=?").run(workspace, h.projectId);
  saveAgentAssignment(h.sqlite, actorWith({ role: "owner", workspaceId: "A" }), { instance: "*", role: "visual_scout" });
  h.repository.ensureStages(h.projectId);
  const job = h.repository.createJob({ projectId: h.projectId, stage: "VISUAL_SEARCH", maxAttempts: 3, previousState: "PENDING" });
  const service = new AgentStageService({ repository: h.repository, orchestrator: h.orchestrator, now: h.clock, context: () => ({ openScenes: [] }), validateComplete: vi.fn(async () => {}) });
  h.service = service;
  h.service.handoff(job.id, "quota");
  return { ...h, job };
}
const reports = (h: ReturnType<typeof setup>) => h.sqlite.prepare("SELECT from_instance, to_kind, to_value, kind, workspace_id, project_id, body FROM agent_messages ORDER BY created_at, rowid").all() as Array<Record<string, string>>;

describe("TASK-129a step 5 stage reports", () => {
  it("sends one duty report per successful claim, release and completion", async () => {
    const h = setup();
    const claim = asAgent(() => h.service.claim(agent()))!;
    expect(reports(h)).toHaveLength(1);
    expect(reports(h)[0]).toMatchObject({ from_instance: "hermes/one", to_kind: "duty", kind: "report", workspace_id: "A", project_id: h.projectId });

    asAgent(() => h.service.release(agent(), h.job.id, claim.leaseId, "retry"));
    expect(reports(h)).toHaveLength(2);

    const second = asAgent(() => h.service.claim(agent()))!;
    await asAgent(() => h.service.complete(agent(), h.job.id, second.leaseId, "xong"));
    const all = reports(h);
    expect(all).toHaveLength(4);
    expect(all.every((r) => r.from_instance === "hermes/one" && r.workspace_id === "A")).toBe(true);
  });

  it("sends nothing when the transition is refused, and nothing on a repeated completion", async () => {
    const h = setup();
    const claim = asAgent(() => h.service.claim(agent()))!;
    expect(reports(h)).toHaveLength(1);
    expect(() => asAgent(() => h.service.release(agent(), h.job.id, "wrong-lease", "retry"))).toThrow(/Lease/);
    expect(reports(h)).toHaveLength(1);
    await asAgent(() => h.service.complete(agent(), h.job.id, claim.leaseId, "xong"));
    await expect(asAgent(() => h.service.complete(agent(), h.job.id, claim.leaseId, "xong lần hai"))).rejects.toThrow(/Lease/);
    expect(reports(h)).toHaveLength(2);
  });

  it("takes the sender from the key's fixed instance, not from the agent object passed in", () => {
    const h = setup();
    asAgent(() => h.service.claim({ ...agent("spoof"), instance: "hermes/spoof" }));
    expect(reports(h)).toHaveLength(1);
    expect(reports(h)[0].from_instance).toBe("hermes/one");
  });

  it("an unnamed key still claims, but sends no report (sender cannot be fixed)", () => {
    const h = setup();
    const claim = asAgent(() => h.service.claim(agent("header-name")), "A", "key-unnamed");
    expect(claim).not.toBeNull();
    expect(reports(h)).toHaveLength(0);
  });
  it("a key from workspace A never claims a workspace-B job, and sends no report", () => {
    const h = setup("B");
    expect(asAgent(() => h.service.claim(agent()), "A")).toBeNull();
    expect(h.repository.getJob(h.job.id)?.status).toBe("QUEUED");
    expect(reports(h)).toHaveLength(0);
  });

  it("still completes the claim when the mailbox rate limit refuses the report", () => {
    const h = setup();
    const now = new Date();
    for (let i = 0; i < 60; i++) {
      sendMessage(h.sqlite, { workspaceId: "A", from: "hermes/one", to: "duty", kind: "report", body: `filler ${i}` }, now);
    }
    const before = reports(h).length;
    const claim = asAgent(() => h.service.claim(agent()))!;
    expect(claim.leaseId).toBeTruthy();
    expect(reports(h).length).toBe(before);
  });
});
