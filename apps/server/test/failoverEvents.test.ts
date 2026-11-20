import { describe, expect, it } from "vitest";
import { listAgentEvents } from "../src/events/agentBus.js";
import { FailoverTracker } from "../src/providers/llm/failover.js";

describe("TASK-129a: quota_failover", () => {
  it("publishes one event per recorded provider switch and names only the provider labels", () => {
    const tracker = new FailoverTracker();
    const before = listAgentEvents({ types: ["quota_failover"] }).length;
    tracker.recordFailover({ task: "script", from: "providerA", to: "providerB", reason: "quota" });
    const events = listAgentEvents({ types: ["quota_failover"] });
    expect(events.length - before).toBe(1);
    expect(events.at(-1)?.summary).toContain("providerA");
    expect(events.at(-1)?.summary).toContain("providerB");
  });

  it("TASK-129a: repeated switches from the same provider in one window publish once", () => {
    const tracker = new FailoverTracker();
    const before = listAgentEvents({ types: ["quota_failover"] }).length;
    for (let i = 0; i < 5; i += 1) tracker.recordFailover({ task: "script", from: "providerC", to: "providerD", reason: "LLM_QUOTA_EXHAUSTED" });
    expect(listAgentEvents({ types: ["quota_failover"] }).length - before).toBe(1);
    tracker.recordFailover({ task: "script", from: "providerE", to: "providerD", reason: "LLM_RATE_LIMIT" });
    expect(listAgentEvents({ types: ["quota_failover"] }).length - before).toBe(2);
    // The history used for the storm check still records every switch.
    expect(tracker.recentFailovers().length).toBe(6);
  });
});
