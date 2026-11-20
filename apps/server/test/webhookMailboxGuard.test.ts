import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { createWebhookEndpoint, enqueueWebhookDeliveries } from "../src/events/webhooks.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import type { AgentEvent } from "@vg/shared";

const T0 = new Date("2026-11-18T10:00:00.000Z");

function makeEvent(type: AgentEvent["type"]): AgentEvent {
  return { id: `evt-${type}`, type, version: 1, at: T0.toISOString(), link: "/", summary: "s" };
}

describe("webhook fan-out leaves mailbox events out", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => {
    h = createPipelineHarness();
    const vault = new TokenVault(h.sqlite, h.config.DATA_DIR, Buffer.alloc(32, 7).toString("base64"));
    // Empty eventTypes means the endpoint would match every event type if the guard were missing.
    createWebhookEndpoint(h.sqlite, vault, { name: "all", url: "https://example.com/hook", eventTypes: [] }, T0);
  });
  afterEach(() => h.close());

  const count = () => (h.sqlite.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries").get() as { n: number }).n;

  it("queues nothing for agent.message", () => {
    enqueueWebhookDeliveries(h.sqlite, makeEvent("agent.message"), T0);
    expect(count()).toBe(0);
  });

  it("queues nothing for agent.question_escalated", () => {
    enqueueWebhookDeliveries(h.sqlite, makeEvent("agent.question_escalated"), T0);
    expect(count()).toBe(0);
  });

  it("still queues one delivery for a control event such as stage_finished", () => {
    enqueueWebhookDeliveries(h.sqlite, makeEvent("stage_finished"), T0);
    expect(count()).toBe(1);
  });
});
