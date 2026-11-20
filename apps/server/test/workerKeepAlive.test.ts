import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Regression for TASK-143: sleep() uses unref'd timers. Without the keep-alive in runWorkerAgent,
// a worker child exits (code 13, unsettled top-level await) after its first heartbeat.
// vitest keeps the event loop alive itself, so this runs in a real child Node process
// that loads the TypeScript source through tsx. The capability probe and checkCapabilities are
// stubbed inside the child (no ffmpeg needed). Set VG_E2E_KEEPALIVE=0 to skip.
const root = resolve(__dirname, "..");
const agentSource = join(root, "src", "node", "agent.ts");
const tsxLoader = resolve(root, "..", "..", "node_modules", "tsx", "dist", "esm", "index.mjs");
const enabled = process.env.VG_E2E_KEEPALIVE !== "0";

describe.skipIf(!enabled)("worker keep-alive (child process)", () => {
  let server: Server;
  let base = "";
  let heartbeats = 0;
  let dir = "";

  beforeAll(() => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url?.startsWith("/api/nodes/agent/join")) {
          res.end(JSON.stringify({ nodeId: "node-keepalive-test", nodeToken: "t".repeat(48), desiredConfig: { concurrency: 1, drain: false, capabilities: ["render"] } }));
        } else if (req.url?.startsWith("/api/nodes/agent/heartbeat")) {
          heartbeats += 1;
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.statusCode = 204;
          res.end();
        }
      });
    });
    return new Promise<void>((done) =>
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
        dir = mkdtempSync(join(tmpdir(), "vg-keepalive-"));
        done();
      }),
    );
  });

  afterAll(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the worker alive between heartbeats", async () => {
    expect(existsSync(agentSource)).toBe(true);
    expect(existsSync(tsxLoader), "tsx loader missing; run npm install at the repo root").toBe(true);
    const script = `
      const { runWorkerAgent } = await import(${JSON.stringify(pathToFileURL(agentSource).href)});
      const stub = {
        heartbeatMs: 200,
        pollMs: 200,
        checkCapabilities: async () => ["render"],
        probe: async () => ({ render: { ok: true, checkedAt: new Date().toISOString(), ms: 5 } }),
      };
      const code = await runWorkerAgent(process.env, stub);
      process.exit(code);
    `;
    const child = spawn(process.execPath, ["--import", pathToFileURL(tsxLoader).href, "--input-type=module", "-e", script], {
      env: {
        ...process.env,
        VG_ROLE: "worker",
        VG_CONTROL_URL: base,
        VG_ALLOW_INSECURE_CONTROL: "true",
        VG_JOIN_TOKEN: "join-test",
        VG_NODE_NAME: "keepalive-test",
        VG_NODE_MEDIA: "false",
        DATA_DIR: dir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    let exited: number | null | undefined;
    child.on("exit", (code) => (exited = code));
    try {
      // Wait for 3 heartbeats, or stop early if the child exits. Give up after 15 s.
      const deadline = Date.now() + 15_000;
      while (heartbeats < 3 && exited === undefined && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 100));
      }
      await new Promise((done) => setTimeout(done, 1000));
      expect(exited, output).toBeUndefined();
      expect(heartbeats, output).toBeGreaterThanOrEqual(3);
    } finally {
      child.kill("SIGKILL");
    }
  }, 30_000);
});
