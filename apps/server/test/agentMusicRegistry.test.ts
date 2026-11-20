import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { JobRepository } from "../src/jobs/jobRepository.js";
import { PipelineEventBus } from "../src/jobs/eventBus.js";
import { saveKeyProfile } from "../src/supervision/identity.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { testActor } from "./testActor.js";

const fixtures: Array<{ app: ReturnType<typeof buildApp>; root: string }> = [];
afterEach(async () => { for (const { app, root } of fixtures.splice(0)) { await app.close(); rmSync(root, { recursive: true, force: true }); } });

/** Registry-level path for music_submit_candidates: a key-authenticated agent holding a MUSIC_SEARCH lease. */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-agent-music-registry-"));
  const actor = { ...testActor, kind: "apikey" as "apikey" | "user", keyId: "music-key" };
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: actor }); fixtures.push({ app, root });
  const created = await app.inject({ method: "POST", url: "/api/projects", payload: { topic: "Music registry fixture", settings: { music: { enabled: true } } } });
  expect(created.statusCode).toBe(201);
  const projectId = created.json().id as string;
  const ctx = app.vgAssistant.service.toolContext();
  saveKeyProfile(ctx.sqlite, actor.keyId, { agentKind: "codex", instanceName: "music" });
  actor.kind = "user";
  const assignment = await app.inject({ method: "POST", url: "/api/settings/agent-assignments", payload: { instance: "codex/music", role: "music_scout" } });
  expect(assignment.statusCode).toBe(201);
  actor.kind = "apikey";
  const repo = new JobRepository(ctx.sqlite, new PipelineEventBus()); repo.ensureStages(projectId);
  const job = repo.createJob({ projectId, stage: "MUSIC_SEARCH", previousState: "PENDING", maxAttempts: 3 });
  ctx.agentStages!.handoff(job.id, "Hết quota nhạc");
  const claim = await app.inject({ method: "POST", url: "/api/stage-agents/claim", payload: { projectId } });
  const leaseId = claim.json().leaseId as string;
  const machine = { ...actor, kind: "apikey" as const };
  const call = (args: unknown) => runAsActor(machine as never, () => invokeRegistryTool({
    name: "music_submit_candidates", args, source: "agent", ctx, actor: machine as never,
    createPending: () => { throw new Error("music_submit_candidates is safe and must not create a pending action"); },
  }));
  return { app, ctx, projectId, job, leaseId, call };
}

const candidate = {
  title: "Registry track", artist: "Artist", sourceUrl: "https://freemusic.example/r", downloadUrl: "http://127.0.0.1/r.mp3",
  licence: "CC_BY", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", durationSec: 90,
};

describe("music_submit_candidates through the tool registry (TASK-147c)", () => {
  it("routes a valid call to submit and returns its result", async () => {
    const h = await setup();
    const out = await h.call({ jobId: h.job.id, leaseId: h.leaseId, candidates: [candidate] });
    expect(out.kind).toBe("result");
    if (out.kind !== "result") return;
    // The loopback download URL is refused by the screen, so nothing is stored; the point is that the call reached submit.
    expect(out.result).toMatchObject({ stored: 0, rejected: [{ index: 0, title: "Registry track" }] });
    expect((out.result as { rejected: Array<{ reason: string }> }).rejected[0].reason).toContain("máy nội bộ");
  });

  it("refuses a wrong leaseId with LEASE_LOST and stores nothing", async () => {
    const h = await setup();
    let outcome: unknown;
    try { outcome = await h.call({ jobId: h.job.id, leaseId: randomUUID(), candidates: [candidate] }); }
    catch (error) { outcome = error; }
    const text = outcome instanceof Error ? `${(outcome as { code?: string }).code} ${outcome.message}` : JSON.stringify(outcome);
    expect(text).toContain("LEASE_LOST");
    const rows = h.ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM music_candidates WHERE project_id=? AND provider='agent'").get(h.projectId) as { n: number };
    expect(rows.n).toBe(0);
  });
});
