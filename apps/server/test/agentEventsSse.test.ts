import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { sendMessage } from "../src/supervision/mailbox.js";
import { TEST_WORKSPACE_ID, TEST_OTHER_WORKSPACE_ID, testActor } from "./testActor.js";

// Live SSE on GET /api/events: a stream opened in workspace B must receive only B's own agent.message.
describe("agent events SSE over HTTP is scoped to the viewer's workspace", () => {
  const cleanups: Array<() => Promise<void>> = [];
  let abort: (() => void) | undefined;
  afterEach(async () => { abort?.(); while (cleanups.length) await cleanups.pop()!(); });

  it("B's live stream gets B's message and never A's", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-sse-"));
    const actor = { ...testActor, kind: "user" as "apikey" | "user", workspaceId: TEST_OTHER_WORKSPACE_ID };
    const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
    const app = buildApp({ config, testActor: actor });
    cleanups.push(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const sqlite = app.vgAssistant.service.toolContext().sqlite;

    // Open B's stream while the actor is B; the route captures the viewer workspace at request start.
    const controller = new AbortController();
    abort = () => controller.abort();
    const openedAt = Date.now();
    const res = await fetch(`${address}/api/events?types=agent.message`, { headers: { accept: "text/event-stream" }, signal: controller.signal });
    expect(res.status).toBe(200);
    // Headers must reach the client at once; without flushHeaders() they wait for the 15 s heartbeat.
    expect(Date.now() - openedAt).toBeLessThan(3000);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const received: Array<{ summary?: string }> = [];
    const pump = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (line) received.push(JSON.parse(line.slice(6)));
          }
        }
      } catch { /* aborted */ }
    })();

    // Send in A (switch the shared actor), then in B.
    sendMessage(sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/a1", to: "codex/a2", kind: "report", body: "tin của A" });
    sendMessage(sqlite, { workspaceId: TEST_OTHER_WORKSPACE_ID, from: "codex/b1", to: "codex/b2", kind: "report", body: "tin của B" });

    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (received.some((e) => e.summary?.includes("codex/b1"))) { clearInterval(timer); resolve(); }
        else if (Date.now() - started > 5000) { clearInterval(timer); reject(new Error("B never received its own message")); }
      }, 20);
    });
    controller.abort();
    await pump;
    expect(received.filter((e) => e.summary?.includes("codex/a1"))).toHaveLength(0);
  });
});
