import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { sendMessage } from "../src/supervision/mailbox.js";
import { TEST_OTHER_WORKSPACE_ID, testActor } from "./testActor.js";

// TASK-129a §1 pull path: GET /api/events resumes from the Last-Event-ID header (the poller and SSE clients rely on it).
describe("agent events resume from Last-Event-ID", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

  it("returns only events after the Last-Event-ID the client already has", async () => {
    const root = mkdtempSync(join(tmpdir(), "vg-resume-"));
    const actor = { ...testActor, kind: "user" as "apikey" | "user", workspaceId: TEST_OTHER_WORKSPACE_ID };
    const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
    const app = buildApp({ config, testActor: actor });
    cleanups.push(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
    const sqlite = app.vgAssistant.service.toolContext().sqlite;

    sendMessage(sqlite, { workspaceId: TEST_OTHER_WORKSPACE_ID, from: "codex/r1", to: "codex/r2", kind: "report", body: "tin một" });
    sendMessage(sqlite, { workspaceId: TEST_OTHER_WORKSPACE_ID, from: "codex/r1", to: "codex/r2", kind: "report", body: "tin hai" });

    const all = await app.inject({ method: "GET", url: "/api/events?types=agent.message" });
    expect(all.statusCode).toBe(200);
    const events = (all.json() as { events: Array<{ id: string; summary?: string }> }).events;
    expect(events.length).toBeGreaterThanOrEqual(2);
    const first = events[0]!;

    const resumed = await app.inject({ method: "GET", url: "/api/events?types=agent.message", headers: { "last-event-id": first.id } });
    expect(resumed.statusCode).toBe(200);
    const after = (resumed.json() as { events: Array<{ id: string }> }).events.map((e) => e.id);
    expect(after).not.toContain(first.id);
    expect(after.length).toBe(events.length - 1);
  });
});
