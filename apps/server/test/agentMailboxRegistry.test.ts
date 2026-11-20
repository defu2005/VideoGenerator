import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { saveKeyProfile } from "../src/supervision/identity.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { testActor } from "./testActor.js";

const fixtures: Array<{ app: ReturnType<typeof buildApp>; root: string }> = [];
afterEach(async () => { for (const { app, root } of fixtures.splice(0)) { await app.close(); rmSync(root, { recursive: true, force: true }); } });

type Who = typeof testActor & { kind: "apikey" | "user"; keyId?: string; role: string };

/**
 * Two agent keys with fixed instance names, both at the editor role real agent keys get,
 * plus a viewer key and a keyless caller. Calls go through the tool registry, as the MCP path does.
 */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-agent-mailbox-registry-"));
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: { ...testActor, kind: "apikey", keyId: "mail-a" } as never }); fixtures.push({ app, root });
  const ctx = app.vgAssistant.service.toolContext();
  saveKeyProfile(ctx.sqlite, "mail-a", { agentKind: "codex", instanceName: "music" });
  saveKeyProfile(ctx.sqlite, "mail-b", { agentKind: "codex", instanceName: "review" });
  saveKeyProfile(ctx.sqlite, "mail-anon", { agentKind: "codex", instanceName: "unknown" });
  const base = { ...testActor };
  const a: Who = { ...base, kind: "apikey", keyId: "mail-a", role: "editor" };
  const b: Who = { ...base, kind: "apikey", keyId: "mail-b", role: "editor" };
  const viewer: Who = { ...base, kind: "apikey", keyId: "mail-b", role: "viewer" };
  const anon: Who = { ...base, kind: "apikey", keyId: "mail-anon", role: "editor" };
  const keyless: Who = { ...base, kind: "user", role: "editor" };
  const call = (who: Who, name: string, args: unknown) => runAsActor(who as never, () => invokeRegistryTool({
    name, args, source: "agent", ctx, actor: who as never,
    createPending: () => { throw new Error(`${name} is safe and must not create a pending action`); },
  }));
  return { app, ctx, a, b, viewer, anon, keyless, call };
}

describe("agent mailbox through the tool registry (TASK-129a)", () => {
  it("lets agent A send, agent B read and ack, and refuses a second acker with 409", async () => {
    const h = await setup();
    const sent = await h.call(h.a, "agent_send", { to: "codex/review", kind: "report", body: "xong" }) as { kind: string; result: { id: string; fromInstance: string } };
    expect(sent.kind).toBe("result");
    expect(sent.result.fromInstance).toBe("codex/music");
    const inboxB = await h.call(h.b, "agent_inbox", {}) as { result: Array<{ id: string }> };
    expect(inboxB.result.map((row) => row.id)).toContain(sent.result.id);
    const acked = await h.call(h.b, "agent_ack", { id: sent.result.id }) as { kind: string };
    expect(acked.kind).toBe("result");
    // A third agent that is not the recipient is refused, and the row no longer sits in B's inbox.
    const inboxA = await h.call(h.a, "agent_inbox", {}) as { result: Array<{ id: string }> };
    expect(inboxA.result.map((row) => row.id)).not.toContain(sent.result.id);
    await expect(h.call(h.a, "agent_ack", { id: sent.result.id })).rejects.toThrow(/không gửi cho bạn|đã có người nhận/);
  });

  it("refuses a viewer key on every mailbox tool", async () => {
    const h = await setup();
    const sent = await h.call(h.viewer, "agent_send", { to: "codex/music", kind: "report", body: "x" }) as { kind: string; message?: string };
    expect(sent.kind).toBe("refused");
    const read = await h.call(h.viewer, "agent_inbox", {}) as { kind: string };
    expect(read.kind).toBe("refused");
  });

  it("refuses a keyless call and a key with no instance name", async () => {
    const h = await setup();
    await expect(h.call(h.keyless, "agent_inbox", {})).rejects.toThrow();
    await expect(h.call(h.anon, "agent_send", { to: "codex/music", kind: "report", body: "x" })).rejects.toThrow(/cố định|STAGE_AGENT_KEY_REQUIRED/);
  });
});
