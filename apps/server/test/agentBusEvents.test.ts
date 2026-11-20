import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { sendMessage, sweepQuestions, QUESTION_DUTY_MIN, QUESTION_USER_MIN } from "../src/supervision/mailbox.js";
import { listAgentEvents, publishAgentEvent, resetAgentEvents, subscribeAgentEvents } from "../src/events/agentBus.js";
import { agentEventInWorkspace } from "../src/api/agentEvents.js";

const WS = "ws-test";
const T0 = new Date("2026-11-18T10:00:00.000Z");

describe("TASK-129a step 3 live events", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => {
    resetAgentEvents();
    h = createPipelineHarness();
    const stamp = T0.toISOString();
    h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run("codex/a", "codex", stamp, 0);
    h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run("codex/b", "codex", stamp, 0);
  });
  afterEach(() => { h.close(); resetAgentEvents(); });

  it("publishes agent_message with sender and kind, never the body", () => {
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/a", to: "codex/b", kind: "report", body: "BÍ MẬT NỘI DUNG" }, T0);
    const events = listAgentEvents({ types: ["agent.message"] });
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toContain("codex/a");
    expect(JSON.stringify(events[0])).not.toContain("BÍ MẬT");
  });

  it("publishes one agent_question_escalated per escalation step", () => {
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/a", to: "codex/b", kind: "question", body: "q" }, T0);
    sweepQuestions(h.sqlite, WS, () => undefined, new Date(T0.getTime() + QUESTION_DUTY_MIN * 60_000));
    sweepQuestions(h.sqlite, WS, () => undefined, new Date(T0.getTime() + QUESTION_DUTY_MIN * 60_000 + 1000));
    sweepQuestions(h.sqlite, WS, () => undefined, new Date(T0.getTime() + QUESTION_USER_MIN * 60_000));
    const events = listAgentEvents({ types: ["agent.question_escalated"] });
    expect(events).toHaveLength(2);
  });

  it("hides another workspace's agent events from list, and shows them to their own workspace", () => {
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/a", to: "codex/b", kind: "report", body: "x" }, T0);
    expect(listAgentEvents({ types: ["agent.message"], workspaceId: "ws-other" })).toHaveLength(0);
    expect(listAgentEvents({ types: ["agent.message"], workspaceId: WS })).toHaveLength(1);
  });

  it("fails closed for a viewer with no workspace, and keeps unscoped events for everyone", () => {
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/a", to: "codex/b", kind: "report", body: "x" }, T0);
    publishAgentEvent({ type: "stage_finished", summary: "xong", projectId: undefined });
    expect(listAgentEvents({ types: ["agent.message"], workspaceId: "" })).toHaveLength(0);
    expect(listAgentEvents({ types: ["stage_finished"], workspaceId: "" })).toHaveLength(1);
    expect(agentEventInWorkspace(WS, "ws-other")).toBe(false);
    expect(agentEventInWorkspace(WS, null)).toBe(false);
    expect(agentEventInWorkspace(undefined, "ws-other")).toBe(true);
  });

  it("hands the workspace to live listeners as the second argument", () => {
    const seen: Array<string | undefined> = [];
    const unsubscribe = subscribeAgentEvents((_event, ws) => { seen.push(ws); });
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/a", to: "codex/b", kind: "report", body: "x" }, T0);
    unsubscribe();
    expect(seen).toEqual([WS]);
  });
});
