import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { sendMessage, sweepQuestions, QUESTION_DUTY_MIN } from "../src/supervision/mailbox.js";
import { subscribe, unsubscribe } from "../src/supervision/subscriptions.js";
import { createWebhookEndpoint, deliverDueWebhooks } from "../src/events/webhooks.js";
import { TokenVault } from "../src/publishing/tokenVault.js";

const WS = "ws-test";
const T0 = new Date("2026-11-18T10:00:00.000Z");

describe("TASK-129a step 2 subscriptions", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  let vault: TokenVault;
  let endpointId: string;
  beforeEach(() => {
    h = createPipelineHarness();
    vault = new TokenVault(h.sqlite, h.config.DATA_DIR, Buffer.alloc(32, 7).toString("base64"));
    const stamp = T0.toISOString();
    h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run("codex/a", "codex", stamp, 0);
    h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run("codex/b", "codex", stamp, 0);
    h.sqlite.prepare("INSERT INTO agent_assignments (id, workspace_id, instance, role, created_by) VALUES (?, ?, ?, ?, ?)").run("asg-a", WS, "codex/a", "music_scout", "user");
    h.sqlite.prepare("INSERT INTO agent_assignments (id, workspace_id, instance, role, created_by, project_id) VALUES (?, ?, ?, ?, ?, ?)").run("asg-b", WS, "codex/b", "review", "user", h.projectId);
    // createWebhookEndpoint stores the signing secret the deliverer needs; the workspace is pinned to WS for the subscription checks.
    const created = createWebhookEndpoint(h.sqlite, vault, { name: "hook", url: "https://example.com/hook", eventTypes: [] }, T0);
    endpointId = created.endpoint.id;
    h.sqlite.prepare("UPDATE webhook_endpoints SET workspace_id = ? WHERE id = ?").run(WS, endpointId);
  });
  afterEach(() => h.close());

  const deliveries = () => h.sqlite.prepare("SELECT * FROM webhook_deliveries").all() as Array<{ id: string; endpoint_id: string; payload: string; attempt: number; next_attempt_at: string; status: string }>;
  const send = (from: string, to: string, kind: "directive" | "report" | "question" | "answer" | "handoff", body = "secret body", projectId?: string) =>
    sendMessage(h.sqlite, { workspaceId: WS, from, to, kind, body, projectId }, T0);

  it("refuses a subscription for an instance with no assignment", () => {
    expect(() => subscribe(h.sqlite, WS, { instance: "codex/none", webhookEndpointId: endpointId }, T0)).toThrow(/chưa có việc được giao/);
  });

  it("refuses a webhook from another workspace", () => {
    h.sqlite.prepare("INSERT INTO agent_assignments (id, workspace_id, instance, role, created_by) VALUES (?, ?, ?, ?, ?)").run("asg-other", "ws-other", "codex/a", "music_scout", "user");
    expect(() => subscribe(h.sqlite, "ws-other", { instance: "codex/a", webhookEndpointId: endpointId }, T0)).toThrow(/không thuộc workspace/);
  });

  it("queues one delivery for a matching message, with ids and no body", () => {
    subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId }, T0);
    const row = send("codex/b", "codex/a", "report");
    const rows = deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endpoint_id).toBe(endpointId);
    const payload = JSON.parse(rows[0]!.payload) as Record<string, unknown>;
    expect(payload.messageId).toBe(row.id);
    expect(payload.recipient).toBe("codex/a");
    expect(JSON.stringify(payload)).not.toContain("secret body");
  });

  it("never pushes a message addressed to a third instance", () => {
    subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId }, T0);
    send("codex/b", "codex/c", "report");
    expect(deliveries()).toHaveLength(0);
  });

  it("does not queue a message to the sender itself", () => {
    subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId }, T0);
    send("codex/a", "codex/b", "report");
    expect(deliveries()).toHaveLength(0);
  });

  it("pushes a no-project direct message to a project-assigned subscriber, matching its inbox", () => {
    subscribe(h.sqlite, WS, { instance: "codex/b", webhookEndpointId: endpointId }, T0);
    send("codex/a", "codex/b", "report");
    expect(deliveries()).toHaveLength(1);
  });

  it("filters by kind when kinds are set", () => {
    subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId, kinds: ["question"] }, T0);
    send("codex/b", "codex/a", "report");
    expect(deliveries()).toHaveLength(0);
    send("codex/b", "codex/a", "question");
    expect(deliveries()).toHaveLength(1);
  });

  it("filters by project scope", () => {
    subscribe(h.sqlite, WS, { instance: "codex/b", webhookEndpointId: endpointId, scope: { projectId: h.projectId } }, T0);
    // A message with no project does not match a project-scoped subscription.
    send("codex/a", "codex/b", "report", "x");
    expect(deliveries()).toHaveLength(0);
    send("codex/a", "codex/b", "report", "x", h.projectId);
    expect(deliveries()).toHaveLength(1);
  });

  it("refuses a profile or stage scope at subscribe time", () => {
    expect(() => subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId, scope: { profileId: "p" } }, T0)).toThrow(/chưa được hỗ trợ/);
    expect(() => subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId, scope: { stage: "render" } }, T0)).toThrow(/chưa được hỗ trợ/);
  });

  it("pushes a duty escalation only to the duty holder, with the escalated event type", () => {
    // Duty needs a heartbeat within DUTY_TTL_MS (3 min) of the sweep, so seed it at the sweep moment.
    const sweepAt = new Date(T0.getTime() + QUESTION_DUTY_MIN * 60_000);
    h.sqlite.prepare("UPDATE agent_instances SET on_duty = 1, duty_heartbeat_at = ? WHERE instance = ?").run(sweepAt.toISOString(), "codex/b");
    h.sqlite.prepare("INSERT INTO agent_assignments (id, workspace_id, instance, role, created_by) VALUES (?, ?, ?, ?, ?)").run("asg-c", WS, "codex/c", "review", "user");
    subscribe(h.sqlite, WS, { instance: "codex/b", webhookEndpointId: endpointId }, T0);
    subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId }, T0);
    subscribe(h.sqlite, WS, { instance: "codex/c", webhookEndpointId: endpointId }, T0);
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/a", to: "codex/c", kind: "question", body: "q" }, T0);
    const before = deliveries().filter((row) => (JSON.parse(row.payload) as { type: string }).type === "agent.question_escalated").length;
    expect(before).toBe(0);
    sweepQuestions(h.sqlite, WS, () => undefined, sweepAt);
    const escalations = deliveries().filter((row) => (JSON.parse(row.payload) as { type: string }).type === "agent.question_escalated");
    expect(escalations).toHaveLength(1);
    // Only the duty holder: not the sender (codex/a) and not the uninvolved subscriber (codex/c).
    expect((JSON.parse(escalations[0]!.payload) as { recipient: string }).recipient).toBe("codex/b");
  });

  it("stops routing after unsubscribe, and skips a disabled endpoint", () => {
    const sub = subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId }, T0);
    unsubscribe(h.sqlite, WS, sub.id, T0);
    send("codex/b", "codex/a", "report");
    expect(deliveries()).toHaveLength(0);
    h.sqlite.prepare("UPDATE agent_subscriptions SET enabled = 1 WHERE id = ?").run(sub.id);
    h.sqlite.prepare("UPDATE webhook_endpoints SET enabled = 0 WHERE id = ?").run(endpointId);
    send("codex/b", "codex/a", "report");
    expect(deliveries()).toHaveLength(0);
  });

  it("delivers through the existing deliverer: signed headers, body is the stored payload, status sent", async () => {
    subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId }, T0);
    send("codex/b", "codex/a", "report");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const sent = await deliverDueWebhooks(h.sqlite, vault, fetchStub, new Date(T0.getTime() + 60_000));
    expect(sent).toBe(1);
    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["webhook-signature"]).toBeTruthy();
    expect(headers["webhook-id"]).toMatch(/^msg_/);
    expect(calls[0]!.init.body).toBe(deliveries()[0]!.payload);
    expect(deliveries()[0]!.status).toBe("sent");
  });

  it("retries a network failure with a later next_attempt_at", async () => {
    subscribe(h.sqlite, WS, { instance: "codex/a", webhookEndpointId: endpointId }, T0);
    send("codex/b", "codex/a", "report");
    const failing = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    await deliverDueWebhooks(h.sqlite, vault, failing, new Date(T0.getTime() + 60_000));
    const [row] = deliveries();
    expect(row!.status).toBe("pending");
    expect(row!.attempt).toBe(1);
    expect(Date.parse(row!.next_attempt_at)).toBeGreaterThan(T0.getTime() + 60_000);
  });
});
