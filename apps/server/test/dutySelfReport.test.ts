import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { inbox, sendMessage } from "../src/supervision/mailbox.js";
import { TEST_WORKSPACE_ID } from "./testActor.js";

// TASK-150 B: inbox() drops the duty holder's own report to `duty`. A direct message to its own instance is still delivered.
describe("duty holder does not receive its own report to duty", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  const T0 = new Date("2026-11-19T10:00:00.000Z");
  beforeEach(() => {
    h = createPipelineHarness();
    h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty, duty_heartbeat_at) VALUES (?, ?, ?, ?, ?)")
      .run("codex/bound", "codex", T0.toISOString(), 1, T0.toISOString());
  });
  afterEach(() => h.close());

  it("the on-duty instance does not see its own duty report in its inbox", () => {
    sendMessage(h.sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/bound", to: "duty", kind: "report", body: "done" }, T0);
    const mine = inbox(h.sqlite, TEST_WORKSPACE_ID, "codex/bound", { now: T0 });
    expect(mine.map((m) => m.fromInstance)).not.toContain("codex/bound");
  });

  it("a direct message from an instance to itself is still returned", () => {
    sendMessage(h.sqlite, { workspaceId: TEST_WORKSPACE_ID, from: "codex/bound", to: "codex/bound", kind: "report", body: "note to self" }, T0);
    const mine = inbox(h.sqlite, TEST_WORKSPACE_ID, "codex/bound", { now: T0 });
    expect(mine.map((m) => m.body)).toContain("note to self");
  });
});
