import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LIVENESS_FILE, NodeAgent } from "../src/node/agent.js";

// TASK-150 C: the worker liveness file is written only after a successful heartbeat.
const desired = { concurrency: 1, drain: false, capabilities: ["render"] };
const okProbe = async () => ({ render: { ok: true, checkedAt: new Date().toISOString(), ms: 5 } });
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Runs one heartbeat with the given status, then stops the loop from inside the fetch.
async function oneHeartbeat(heartbeatStatus: number): Promise<string> {
  const dataDir = mkdtempSync(join(tmpdir(), "vg-liveness-"));
  dirs.push(dataDir);
  let agent: NodeAgent | undefined;
  agent = new NodeAgent({ VG_CONTROL_URL: "http://127.0.0.1:1", VG_JOIN_TOKEN: "vgj_fixture", DATA_DIR: dataDir }, {
    log: () => undefined,
    checkCapabilities: async () => ["render"],
    probe: okProbe,
    heartbeatMs: 10,
    pollMs: 10,
    fetch: (async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/join")) return json({ nodeId: "n1", nodeToken: "vgn_fixture", desiredConfig: desired });
      if (path.endsWith("/heartbeat")) {
        (agent as unknown as { stopping: boolean }).stopping = true;
        return heartbeatStatus === 200 ? json({ desiredConfig: desired, targetVersion: null, cancel: [] }) : new Response("fixture", { status: heartbeatStatus });
      }
      return json({ code: "NOT_FIXTURED" }, 404);
    }) as typeof fetch,
  });
  await agent.run();
  const file = join(dataDir, LIVENESS_FILE);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

describe("worker liveness file (TASK-150 C)", () => {
  it("writes an ISO timestamp after a successful heartbeat", async () => {
    const stamp = await oneHeartbeat(200);
    expect(stamp).not.toBe("");
    expect(Number.isNaN(Date.parse(stamp))).toBe(false);
  });

  it("does not write the file after a failed heartbeat", async () => {
    expect(await oneHeartbeat(500)).toBe("");
  });
});
