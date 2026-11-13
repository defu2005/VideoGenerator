import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerOverdueRoutes } from "../src/api/overdue.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

const harnesses: ReturnType<typeof createPipelineHarness>[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.close();
});

describe("overdue routes", () => {
  it("returns 409 when the job is not overdue and never reaches the decider", async () => {
    const harness = createPipelineHarness({});
    harnesses.push(harness);
    const decideOverdue = vi.fn();
    const app = Fastify();
    // Same error shape as the real app: AppError carries statusCode.
    registerOverdueRoutes(app, { sqlite: harness.sqlite, orchestrator: { decideOverdue } as never });
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/missing/overdue-decision",
      payload: { action: "wait" },
    });
    expect(res.statusCode).toBe(409);
    expect(decideOverdue).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists no overdue job and no checks for a project that is on time", async () => {
    const harness = createPipelineHarness({});
    harnesses.push(harness);
    const app = Fastify();
    registerOverdueRoutes(app, { sqlite: harness.sqlite, orchestrator: { decideOverdue: vi.fn() } as never });
    const res = await app.inject({ method: "GET", url: `/api/projects/${harness.projectId}/overdue` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ job: null, checks: [] });
    await app.close();
  });
});
