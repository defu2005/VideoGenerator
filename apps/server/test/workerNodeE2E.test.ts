import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { TimelineSchema, type Timeline } from "@vg/shared";
import { registerNodeRoutes } from "../src/api/nodes.js";
import { probeDurationSec, runFfmpeg } from "../src/media/ffmpeg.js";
import { ArtifactService } from "../src/node/artifactService.js";
import { NodeAgent } from "../src/node/agent.js";
import { LeaseService } from "../src/node/leaseService.js";
import { NodeService } from "../src/node/nodeService.js";
import { saveRemoteRenderSettings } from "../src/node/settings.js";
import { RenderService } from "../src/services/renderService.js";
import { projectDir } from "../src/storage/paths.js";
import { createPipelineHarness } from "./pipelineFixtures.js";

/**
 * Opt-in end-to-end run of a real worker node. Skipped unless VG_E2E_NODE=1.
 * Loopback only, its own temp DATA_DIR and its own throwaway project (never the protected one).
 * It uses the real ffmpeg and the real HyperFrames probe: a failure here is a finding, not something to fake.
 */
const enabled = process.env.VG_E2E_NODE === "1";
const SCENE = "11111111-1111-4111-8111-111111111111";
const motion = { type: "kenburns" as const, from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.1, x: 0.5, y: 0.5 } };

describe.skipIf(!enabled)("worker node end to end (VG_E2E_NODE=1)", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterAll(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  it("joins over loopback, runs the real probe, renders one job remotely and records the node", async () => {
    const harness = createPipelineHarness();
    const agentDir = mkdtempSync(join(tmpdir(), "vg-e2e-agent-"));
    cleanups.push(() => { harness.close(); rmSync(agentDir, { recursive: true, force: true }); });
    expect(harness.projectId).not.toBe("56374fb2-54cf-48ff-9441-2e6c653295d4");

    // A tiny but real project: one image, one voice track, a 1.5 s scene.
    const dir = projectDir(harness.config.DATA_DIR, harness.projectId);
    for (const folder of ["visuals", "voice", "timeline"]) mkdirSync(join(dir, folder), { recursive: true });
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=0x336699:s=320x180", "-frames:v", "1", join(dir, "visuals/a.png")]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-ar", "44100", join(dir, "voice/a.wav")]);
    const timeline: Timeline = TimelineSchema.parse({
      formatVersion: 1,
      target: { width: 320, height: 180, fps: 30 },
      totalDurationSec: 1.5,
      scenes: [{
        sceneId: SCENE, order: 0, label: "Một", startSec: 0, endSec: 1.5, durationSec: 1.5, durationFrames: 45,
        voice: { trackId: "t1", path: "voice/a.wav", startSec: 0.1, durationSec: 1.2 },
        visuals: [{ kind: "IMAGE", candidateId: "c1", path: "visuals/a.png", startSec: 0, endSec: 1.5, motion, licenseKind: "CC0" }],
        fadeInSec: 0.2, fadeOutSec: 0.2,
      }],
      music: null,
      subtitles: null,
      warnings: [],
      licenseSummary: { CC0: 1 },
    });
    const timelines = { get: () => ({ timeline, inputHash: "e2e-timeline", updatedAt: "now" }) };
    const renderService = new RenderService(harness.sqlite, harness.config, timelines);
    const artifacts = new ArtifactService(harness.sqlite, harness.clock);
    const nodes = new NodeService(harness.sqlite, harness.config, harness.repository, harness.orchestrator, harness.clock);
    const leases = new LeaseService(
      harness.sqlite, harness.config, harness.repository, harness.orchestrator, nodes, renderService, artifacts,
      async () => ({ message: "xong" }), harness.clock,
    );

    const app = Fastify({ logger: false });
    registerNodeRoutes(app, harness.sqlite, harness.config, nodes, leases);
    await app.listen({ host: "127.0.0.1", port: 0 });
    cleanups.push(() => app.close());
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    saveRemoteRenderSettings(harness.sqlite, { mode: "only", remoteWaitSec: 30 });
    const { token } = nodes.createJoinToken(undefined);
    const agent = new NodeAgent(
      { VG_CONTROL_URL: `http://127.0.0.1:${port}`, VG_JOIN_TOKEN: token, DATA_DIR: agentDir, VG_NODE_NAME: "e2e-node" },
      { log: () => undefined, heartbeatMs: 500, pollMs: 300 },
    );
    const finished = agent.run();
    cleanups.push(async () => { agent.stop(); await finished; });

    // The node joins and the real probe runs.
    const deadline = Date.now() + 150_000;
    const waitFor = async <T,>(read: () => T | undefined | null | false, what: string): Promise<T> => {
      for (;;) {
        const value = read();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((done) => setTimeout(done, 300));
      }
    };
    const node = await waitFor(() => nodes.list().find((item) => item.name === "e2e-node" && item.probe), "the node and its probe");
    // eslint-disable-next-line no-console
    console.log("E2E probe:", JSON.stringify(node.probe));
    expect(node.probe?.render.ok, `probe failed: ${node.probe?.render.reason}`).toBe(true);

    // Queue a render; the node takes it, uploads the output, the control plane finalizes it.
    const job = harness.repository.createJob({
      projectId: harness.projectId, stage: "RENDER", maxAttempts: 1, previousState: "PENDING", runAfter: harness.clock(),
    });
    const done = await waitFor(() => {
      const current = harness.repository.getJob(job.id);
      return current && (current.status === "DONE" || current.status === "FAILED" || current.status === "SUCCEEDED") ? current : undefined;
    }, "the render job to finish");
    expect(done.status, `job ended as ${done.status}: ${JSON.stringify(done.error ?? done.message)}`).not.toBe("FAILED");

    const row = harness.sqlite.prepare("SELECT node_id FROM jobs WHERE id = ?").get(job.id) as { node_id: string | null };
    expect(row.node_id).toBe(node.id);

    const render = renderService.get(harness.projectId).render;
    expect(render?.status).toBe("DONE");
    const outputPath = join(dir, "render", "versions", render!.id, "output.mp4");
    expect(existsSync(outputPath)).toBe(true);
    // The control plane already verified the upload's sha256 against what the node declared (a mismatch is a 422),
    // then moved the file into place. Here we check the finished file is a real, playable video.
    const outputSha = createHash("sha256").update(readFileSync(outputPath)).digest("hex");
    expect(outputSha).toMatch(/^[0-9a-f]{64}$/);
    expect(await probeDurationSec(outputPath)).toBeGreaterThan(1);
    expect(render?.report.ok).toBe(true);
  }, 240_000);
});
