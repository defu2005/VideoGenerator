import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { inbox, sendMessage } from "../src/supervision/mailbox.js";

const WS = "ws-test";
const T0 = new Date("2026-11-18T10:00:00.000Z");

describe("TASK-129a step 4 inbox peek (recipient and workspace isolation)", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => {
    h = createPipelineHarness();
    const stamp = T0.toISOString();
    for (const instance of ["codex/a", "codex/b"]) {
      h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run(instance, "codex", stamp, 0);
    }
  });
  afterEach(() => h.close());

  it("shows a message only to its recipient", () => {
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/b", to: "codex/a", kind: "report", body: "secret body" }, T0);
    expect(inbox(h.sqlite, WS, "codex/a", { now: T0 })).toHaveLength(1);
    expect(inbox(h.sqlite, WS, "codex/b", { now: T0 })).toHaveLength(0);
  });

  it("returns nothing for an empty or foreign workspace (fail closed)", () => {
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/b", to: "codex/a", kind: "report", body: "x" }, T0);
    expect(inbox(h.sqlite, "", "codex/a", { now: T0 })).toHaveLength(0);
    expect(inbox(h.sqlite, "ws-other", "codex/a", { now: T0 })).toHaveLength(0);
  });

  it("stops listing a message once it is acked", () => {
    const row = sendMessage(h.sqlite, { workspaceId: WS, from: "codex/b", to: "codex/a", kind: "report", body: "x" }, T0);
    h.sqlite.prepare("UPDATE agent_messages SET acked_at = ?, acked_by = ? WHERE id = ?").run(T0.toISOString(), "codex/a", row.id);
    expect(inbox(h.sqlite, WS, "codex/a", { now: T0 })).toHaveLength(0);
  });
});

describe("peek starvation", () => {
  it("newest mode returns the latest 50 when 51 unacked rows exist", () => {
    const h = createPipelineHarness();
    try {
      h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run("codex/a", "codex", T0.toISOString(), 0);
      const ids: string[] = [];
      for (let i = 0; i < 51; i += 1) {
        const at = new Date(T0.getTime() + i * 1000);
        ids.push(sendMessage(h.sqlite, { workspaceId: WS, from: "user", to: "codex/a", kind: "report", body: `m${i}` }, at).id);
      }
      const oldest = inbox(h.sqlite, WS, "codex/a", { now: T0, limit: 50 }).map((r) => r.id);
      expect(oldest).not.toContain(ids[50]);
      const newest = inbox(h.sqlite, WS, "codex/a", { now: T0, limit: 50, newest: true }).map((r) => r.id);
      expect(newest).toContain(ids[50]);
      expect(newest).toHaveLength(50);
    } finally { h.close(); }
  });
});
