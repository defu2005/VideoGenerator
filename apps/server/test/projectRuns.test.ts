import { afterEach, describe, expect, it } from "vitest";
import { ProjectRunService } from "../src/node/runService.js";
import { NodeService } from "../src/node/nodeService.js";
import { readAppVersion } from "../src/render/appVersion.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { actorWith } from "./testActor.js";
import { runAsActor } from "../src/auth/requestContext.js";

const fixtures: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.close()));

function setup() {
  const h = createPipelineHarness(); fixtures.push(h);
  h.sqlite.prepare("UPDATE projects SET workspace_id='A' WHERE id=?").run(h.projectId);
  const nodes = new NodeService(h.sqlite, h.config, h.repository, h.orchestrator, h.clock);
  const runs = new ProjectRunService(h.sqlite, h.orchestrator, h.clock);
  const node = (workspaceId?: string) => {
    const token = nodes.createJoinToken(workspaceId ? { workspaceId } : undefined);
    const joined = nodes.join({ joinToken: token.token, name: "Run node", version: readAppVersion(), capabilities: ["render"], resources: {} });
    return nodes.authenticate(joined.nodeToken)!;
  };
  const input = { projectId: h.projectId, fromStage: "RESEARCH" as const, stopBefore: ["VISUAL_REVIEW" as const], budgetCapUsd: 1 };
  return { ...h, nodes, runs, node, input };
}

describe("project run leases", () => {
  it("inherits a workspace restriction from the join token and fences every operation", () => {
    const h = setup(), a = h.node("A"), b = h.node("B");
    expect(a.workspace_id).toBe("A");
    expect(b.workspace_id).toBe("B");
    expect(() => h.runs.grant(b, h.input)).toThrowError(expect.objectContaining({ statusCode: 404 }));
    const run = h.runs.grant(a, h.input);
    expect(run).toMatchObject({ workspaceId: "A", nodeId: a.id, status: "GRANTED", lastSeq: 0 });
    expect(() => h.runs.grant(a, h.input)).toThrowError(expect.objectContaining({ code: "RUN_PROJECT_BUSY" }));
    expect(() => h.runs.heartbeat(b, run.id, run.leaseId)).toThrowError(expect.objectContaining({ code: "LEASE_STALE" }));
    expect(() => h.runs.heartbeat(a, run.id, "wrong")).toThrowError(expect.objectContaining({ code: "LEASE_STALE" }));
    h.advance(30_000);
    const heartbeat = h.runs.heartbeat(a, run.id, run.leaseId);
    expect(heartbeat.status).toBe("RUNNING");
    expect(heartbeat.leaseUntil > run.leaseUntil).toBe(true);
    h.advance(91_000);
    expect(h.runs.expire()).toBe(1);
    expect(h.runs.get(run.id)?.status).toBe("LOST");
    expect(() => h.runs.holding(a, run.id, run.leaseId)).toThrowError(expect.objectContaining({ code: "LEASE_STALE" }));
  });

  it("preserves legacy instance-wide nodes and rejects cancellation from another workspace", () => {
    const h = setup(), node = h.node();
    expect(node.workspace_id).toBeNull();
    const run = h.runs.grant(node, h.input);
    expect(() => runAsActor(actorWith({ workspaceId: "B", role: "owner" }), () => h.runs.cancel(h.projectId, "stop")))
      .toThrowError(expect.objectContaining({ statusCode: 404 }));
    expect(h.runs.holding(node, run.id, run.leaseId).status).toBe("GRANTED");
    expect(runAsActor(actorWith({ workspaceId: "A", role: "owner" }), () => h.runs.cancel(h.projectId, "User cancelled"))).toBe(1);
    expect(() => h.runs.heartbeat(node, run.id, run.leaseId)).toThrowError(expect.objectContaining({ code: "LEASE_STALE" }));
    const replacement = h.runs.grant(node, h.input);
    expect(replacement.id).not.toBe(run.id);
    expect(replacement.leaseId).not.toBe(run.leaseId);
  });
});
