import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { controlUrlProblem, EXIT_FOR_UPDATE_CODE, isPrivateHost, NodeAgent } from "../src/node/agent.js";
import { probeReason, runRenderProbe } from "../src/node/probe.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vg-agent-test-"));
  dirs.push(dir);
  return dir;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const okProbe = async () => ({ render: { ok: true, checkedAt: new Date().toISOString(), ms: 5 } });
const desired = { concurrency: 1, drain: false, capabilities: ["render"] };

describe("control url rules", () => {
  it("allows private addresses over http and refuses public ones", () => {
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.9", "100.101.102.103"]) {
      expect(isPrivateHost(host)).toBe(true);
    }
    for (const host of ["8.8.8.8", "example.com", "172.32.0.1", "100.128.0.1"]) expect(isPrivateHost(host)).toBe(false);
    expect(controlUrlProblem("https://control.example.com", false)).toBeNull();
    expect(controlUrlProblem("http://100.64.0.2:3000", false)).toBeNull();
    expect(controlUrlProblem("http://example.com", false)).not.toBeNull();
    expect(controlUrlProblem("http://example.com", true)).toBeNull();
    expect(controlUrlProblem(undefined, false)).not.toBeNull();
  });
});

describe("NodeAgent", () => {
  it("exits 1 without calling anything when the control url is a public http address", async () => {
    let calls = 0;
    const agent = new NodeAgent(
      { VG_CONTROL_URL: "http://example.com", VG_JOIN_TOKEN: "vgj_x", DATA_DIR: tempDir() },
      { fetch: (async () => { calls += 1; return json({}); }) as typeof fetch, log: () => undefined, checkCapabilities: async () => ["render"], probe: okProbe },
    );
    expect(await agent.run()).toBe(1);
    expect(calls).toBe(0);
  });

  it("joins, saves the node token, and exits 0 removing it when the control plane answers 401 (revoked)", async () => {
    const dataDir = tempDir();
    const seen: string[] = [];
    const agent = new NodeAgent(
      { VG_CONTROL_URL: "http://127.0.0.1:1", VG_JOIN_TOKEN: "vgj_secret", DATA_DIR: dataDir },
      {
        log: (message) => seen.push(message),
        checkCapabilities: async () => ["render"], probe: okProbe,
        heartbeatMs: 10,
        pollMs: 10,
        fetch: (async (url: string | URL | Request) => {
          const path = new URL(String(url)).pathname;
          if (path.endsWith("/join")) return json({ nodeId: "n1", nodeToken: "vgn_secret", desiredConfig: desired });
          return json({ code: "NODE_UNAUTHORIZED" }, 401);
        }) as typeof fetch,
      },
    );
    expect(await agent.run()).toBe(0);
    expect(existsSync(join(dataDir, "secrets", "node.token"))).toBe(false);
    expect(seen.join("\n")).not.toContain("vgn_secret");
    expect(seen.join("\n")).not.toContain("vgj_secret");
  });

  it("reuses a saved token instead of joining again", async () => {
    const dataDir = tempDir();
    writeFileSync(join(dataDir, "node.seed"), "");
    const secrets = join(dataDir, "secrets");
    (await import("node:fs")).mkdirSync(secrets, { recursive: true });
    writeFileSync(join(secrets, "node.token"), "vgn_saved");
    const paths: string[] = [];
    const auth: string[] = [];
    const agent = new NodeAgent(
      { VG_CONTROL_URL: "http://127.0.0.1:1", DATA_DIR: dataDir },
      {
        log: () => undefined,
        checkCapabilities: async () => [],
        heartbeatMs: 10,
        pollMs: 10,
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          paths.push(new URL(String(url)).pathname);
          auth.push(String((init?.headers as Record<string, string>)?.authorization));
          return json({}, 401);
        }) as typeof fetch,
      },
    );
    expect(await agent.run()).toBe(0);
    expect(paths.some((path) => path.endsWith("/join"))).toBe(false);
    expect(auth[0]).toBe("Bearer vgn_saved");
    expect(readFileSync(join(dataDir, "node.seed"), "utf8")).toBe("");
  });

  it("exits 1 when it has no token and no join token", async () => {
    const agent = new NodeAgent(
      { VG_CONTROL_URL: "http://127.0.0.1:1", DATA_DIR: tempDir() },
      { log: () => undefined, checkCapabilities: async () => ["render"], probe: okProbe, fetch: (async () => json({})) as typeof fetch },
    );
    expect(await agent.run()).toBe(1);
  });
});

describe("probe and update exit", () => {
  const base = (dataDir: string, extra: Record<string, string> = {}) => ({ VG_CONTROL_URL: "http://127.0.0.1:1", VG_JOIN_TOKEN: "vgj_x", DATA_DIR: dataDir, ...extra });

  it("sends the probe with join and heartbeat, and does not lease when it failed", async () => {
    const bodies: Record<string, unknown>[] = [];
    const paths: string[] = [];
    const agent = new NodeAgent(base(tempDir()), {
      log: () => undefined, checkCapabilities: async () => ["render"], heartbeatMs: 10, pollMs: 10,
      probe: async () => ({ render: { ok: false, reason: "Thiếu ffmpeg", checkedAt: new Date().toISOString() } }),
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path.endsWith("/join")) { bodies.push(JSON.parse(String(init?.body))); return json({ nodeId: "n1", nodeToken: "vgn_t", desiredConfig: desired }); }
        if (path.endsWith("/heartbeat")) {
          bodies.push(JSON.parse(String(init?.body)));
          if (bodies.length > 2) return json({}, 401);
          return json({ desiredConfig: desired, targetVersion: null, cancel: [] });
        }
        return json({}, 204);
      }) as typeof fetch,
    });
    await agent.run();
    expect((bodies[0] as { probe: { render: { ok: boolean } } }).probe.render.ok).toBe(false);
    expect((bodies[1] as { probe: { render: { reason: string } } }).probe.render.reason).toBe("Thiếu ffmpeg");
    expect(paths.some((path) => path.endsWith("/lease"))).toBe(false);
  });

  it("with VG_EXIT_FOR_UPDATE=1 stops leasing on a target version mismatch, waits for the running job, then exits 75", async () => {
    let release: (() => void) | undefined;
    const finished = new Promise<void>((done) => { release = done; });
    let exited = false;
    let leases = 0;
    let beatsAfterMismatch = 0;
    const agent = new NodeAgent(base(tempDir(), { VG_EXIT_FOR_UPDATE: "1" }), {
      log: () => undefined, checkCapabilities: async () => ["render"], probe: okProbe, heartbeatMs: 10, pollMs: 10,
      fetch: (async (url: string | URL | Request) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/join")) return json({ nodeId: "n1", nodeToken: "vgn_t", desiredConfig: desired });
        if (path.endsWith("/heartbeat")) {
          beatsAfterMismatch += 1;
          return json({ desiredConfig: { ...desired, concurrency: 2 }, targetVersion: "9.9.9", cancel: [] });
        }
        if (path.endsWith("/lease")) leases += 1;
        return json({}, 204);
      }) as typeof fetch,
    });
    // A job that is already running (the real start() needs a full bundle, which is not what this test is about).
    (agent as unknown as { running: Map<string, unknown> }).running.set("job-1", {
      jobId: "job-1", leaseId: "l1", progress: 10, message: "", cancelled: false, controller: new AbortController(), promise: finished,
    });
    const result = agent.run().then((code) => { exited = true; return code; });
    await new Promise((done) => setTimeout(done, 150));
    expect(exited).toBe(false); // still waiting for the job
    expect(beatsAfterMismatch).toBeGreaterThan(2); // keeps heart-beating while it waits
    expect(leases).toBe(0); // does not take new work
    (agent as unknown as { running: Map<string, unknown> }).running.delete("job-1");
    release?.();
    expect(await Promise.race([result, new Promise<number>((done) => setTimeout(() => done(-1), 3000))])).toBe(EXIT_FOR_UPDATE_CODE);
  });

  it("without VG_EXIT_FOR_UPDATE it ignores a target version", async () => {
    let beats = 0;
    const agent = new NodeAgent(base(tempDir()), {
      log: () => undefined, checkCapabilities: async () => ["render"], probe: okProbe, heartbeatMs: 10, pollMs: 10,
      fetch: (async (url: string | URL | Request) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/join")) return json({ nodeId: "n1", nodeToken: "vgn_t", desiredConfig: desired });
        if (path.endsWith("/heartbeat")) { beats += 1; return beats > 3 ? json({}, 401) : json({ desiredConfig: desired, targetVersion: "9.9.9", cancel: [] }); }
        return json({}, 204);
      }) as typeof fetch,
    });
    expect(await agent.run()).toBe(0);
  });
});

describe("render probe", () => {
  const dataDir = () => tempDir();
  it("passes when ffmpeg, the render and ffprobe all succeed (injected)", async () => {
    const probe = await runRenderProbe(dataDir(), {
      ffmpegVersion: async () => true,
      render: async (_dir, out) => { writeFileSync(out, "x"); },
      duration: async () => 1,
    });
    expect(probe.render.ok).toBe(true);
  });
  it("fails with Vietnamese reasons", async () => {
    expect((await runRenderProbe(dataDir(), { ffmpegVersion: async () => false })).render.reason).toBe("Thiếu ffmpeg");
    const browser = await runRenderProbe(dataDir(), { ffmpegVersion: async () => true, render: async () => { throw new Error("Failed to launch chrome"); } });
    expect(browser.render.reason).toBe("Không mở được trình duyệt cho HyperFrames");
    const noFile = await runRenderProbe(dataDir(), { ffmpegVersion: async () => true, render: async () => undefined });
    expect(noFile.render.ok).toBe(false);
    const zero = await runRenderProbe(dataDir(), { ffmpegVersion: async () => true, render: async (_d, out) => { writeFileSync(out, "x"); }, duration: async () => 0 });
    expect(zero.render.ok).toBe(false);
    expect(probeReason(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("Hết thời gian");
  });
});
