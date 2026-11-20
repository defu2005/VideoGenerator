import { describe, expect, it } from "vitest";
import { pollAgentEventsOnce, type PolledEvent } from "../src/eventPoller.js";

const ev = (id: string, type: string): PolledEvent => ({ id, type, summary: `secret ${id}` });

describe("agent event poller (TASK-129a step 4)", () => {
  it("primes the cursor on the first poll and wakes nothing from the backlog", async () => {
    const woken: PolledEvent[] = [];
    const result = await pollAgentEventsOnce({
      fetchEvents: async () => ({ events: [ev("e1", "stage_finished"), ev("e2", "stage_failed")] }),
      wake: (event) => woken.push(event),
      kinds: ["stage_finished", "stage_failed"],
    });
    expect(result).toEqual({ cursor: "e2", woke: 0, primed: true });
    expect(woken).toHaveLength(0);
  });

  it("wakes only on subscribed kinds after the cursor", async () => {
    const woken: PolledEvent[] = [];
    const result = await pollAgentEventsOnce({
      fetchEvents: async (since) => {
        expect(since).toBe("e2");
        return { events: [ev("e3", "stage_finished"), ev("e4", "render_finished")] };
      },
      wake: (event) => woken.push(event),
      kinds: ["stage_finished"],
    }, "e2");
    expect(woken.map((event) => event.id)).toEqual(["e3"]);
    expect(result).toEqual({ cursor: "e4", woke: 1, primed: false });
  });

  it("never wakes on mailbox events, even when their kind is listed", async () => {
    const woken: PolledEvent[] = [];
    await pollAgentEventsOnce({
      fetchEvents: async () => ({ events: [ev("m1", "agent.message"), ev("m2", "agent.question_escalated")] }),
      wake: (event) => woken.push(event),
      kinds: ["agent.message", "agent.question_escalated"],
    }, "m0");
    expect(woken).toHaveLength(0);
  });

  it("an empty first poll primes once; a later subscribed event wakes exactly once", async () => {
    const woken: PolledEvent[] = [];
    const deps = (events: PolledEvent[]) => ({
      fetchEvents: async () => ({ events }),
      wake: (event: PolledEvent) => woken.push(event),
      kinds: ["stage_finished"],
    });
    const first = await pollAgentEventsOnce(deps([]));
    expect(first).toEqual({ cursor: "", woke: 0, primed: true });
    const second = await pollAgentEventsOnce(deps([ev("e1", "stage_finished")]), first.cursor);
    expect(second.primed).toBe(false);
    expect(second.woke).toBe(1);
    expect(woken.map((event) => event.id)).toEqual(["e1"]);
  });

  it("keeps the old cursor and wakes nothing when no new events arrive, so idle costs no wakes", async () => {
    const woken: PolledEvent[] = [];
    const result = await pollAgentEventsOnce({
      fetchEvents: async () => ({ events: [] }),
      wake: (event) => woken.push(event),
      kinds: ["stage_finished"],
    }, "e9");
    expect(result).toEqual({ cursor: "e9", woke: 0, primed: false });
    expect(woken).toHaveLength(0);
  });
});
