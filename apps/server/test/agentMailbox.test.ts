import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import {
  ack, inbox, MAILBOX_RATE_PER_MIN, postAsUser, rankOf, sendMessage, sweepQuestions, thread, QUESTION_DUTY_MIN, QUESTION_USER_MIN,
} from "../src/supervision/mailbox.js";

const WS = "ws-test";
const T0 = new Date("2026-11-18T10:00:00.000Z");

describe("TASK-129a mailbox", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => {
    h = createPipelineHarness();
    // Duty is heartbeat-based and currentDuty reads the real clock, so the heartbeat is fresh now.
    h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty, duty_heartbeat_at) VALUES (?, ?, ?, ?, ?)").run("hermes/h", "hermes", T0.toISOString(), 1, T0.toISOString());
    h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run("codex/a", "codex", T0.toISOString(), 0);
    h.sqlite.prepare("INSERT INTO agent_instances (instance, kind, last_seen_at, on_duty) VALUES (?, ?, ?, ?)").run("codex/b", "codex", T0.toISOString(), 0);
    h.sqlite.prepare("INSERT INTO agent_assignments (id, workspace_id, instance, role, created_by) VALUES (?, ?, ?, ?, ?)").run("asg-1", WS, "codex/a", "music_scout", "user");
  });
  afterEach(() => h.close());

  const send = (from: string, to: string, kind: "directive" | "report" | "question" | "answer" | "handoff", body = "hi", now = T0) =>
    sendMessage(h.sqlite, { workspaceId: WS, from, to, kind, body }, now);

  it("delivers an instance message only to that instance", () => {
    send("codex/a", "codex/b", "report");
    expect(inbox(h.sqlite, WS, "codex/b", { now: T0 })).toHaveLength(1);
    expect(inbox(h.sqlite, WS, "codex/a", { now: T0 })).toHaveLength(0);
  });

  it("rejects bodies over 8 KB", () => {
    expect(() => send("codex/a", "codex/b", "report", "x".repeat(8193))).toThrow(/tối đa 8 KB/);
  });

  it("rate-limits a sender to 60 messages per minute", () => {
    for (let i = 0; i < MAILBOX_RATE_PER_MIN; i += 1) send("codex/a", "codex/b", "report");
    expect(() => send("codex/a", "codex/b", "report")).toThrow(/60 tin/);
    // A different minute window accepts again.
    expect(() => send("codex/a", "codex/b", "report", "later", new Date(T0.getTime() + 61_000))).not.toThrow();
  });

  it("turns a lower-rank directive to a higher rank into a question", () => {
    const row = send("codex/a", "hermes/h", "directive");
    expect(row.kind).toBe("question");
    const down = send("hermes/h", "codex/a", "directive");
    expect(down.kind).toBe("directive");
  });

  it("addresses a role to every instance holding it", () => {
    send("hermes/h", "role:music_scout", "directive");
    expect(inbox(h.sqlite, WS, "codex/a", { now: T0 })).toHaveLength(1);
    expect(inbox(h.sqlite, WS, "codex/b", { now: T0 })).toHaveLength(0);
  });

  it("addresses duty to the instance on duty only", () => {
    send("codex/a", "duty", "report");
    expect(inbox(h.sqlite, WS, "hermes/h", { now: T0 })).toHaveLength(1);
    expect(inbox(h.sqlite, WS, "codex/a", { now: T0 })).toHaveLength(0);
  });

  it("first ack wins; a second acker gets 409, the same acker gets the row back", () => {
    h.sqlite.prepare("UPDATE agent_instances SET on_duty = 0").run();
    const row = send("hermes/h", "role:music_scout", "directive");
    ack(h.sqlite, WS, "codex/a", row.id, T0);
    expect(() => ack(h.sqlite, WS, "codex/a", row.id, T0)).not.toThrow();
    expect(() => ack(h.sqlite, WS, "codex/b", row.id, T0)).toThrow();
    expect(inbox(h.sqlite, WS, "codex/a", { now: T0 })).toHaveLength(0);
  });

  it("refuses an ack from a non-recipient", () => {
    const row = send("codex/a", "codex/b", "report");
    expect(() => ack(h.sqlite, WS, "codex/a", row.id, T0)).toThrow(/không gửi cho bạn/);
  });

  it("shows a thread to its sender and recipients only", () => {
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/a", to: "codex/b", kind: "question", body: "q", threadId: "t-1" }, T0);
    sendMessage(h.sqlite, { workspaceId: WS, from: "codex/b", to: "codex/a", kind: "answer", body: "ok", threadId: "t-1" }, T0);
    expect(thread(h.sqlite, WS, "codex/a", "t-1", T0)).toHaveLength(2);
    expect(thread(h.sqlite, WS, "codex/b", "t-1", T0)).toHaveLength(2);
    expect(thread(h.sqlite, WS, "hermes/h", "t-1", T0)).toHaveLength(0);
  });

  it("escalates an unanswered question to duty at 15 min and to the user at 60 min, once each", () => {
    const q = send("codex/a", "codex/b", "question");
    expect(q.kind).toBe("question");
    const notes: string[] = [];
    const at = (min: number) => new Date(T0.getTime() + min * 60_000);
    expect(sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_DUTY_MIN - 1))).toEqual({ toDuty: 0, toUser: 0 });
    expect(sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_DUTY_MIN))).toEqual({ toDuty: 1, toUser: 0 });
    expect(sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_DUTY_MIN + 1))).toEqual({ toDuty: 0, toUser: 0 });
    expect(sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_USER_MIN))).toEqual({ toDuty: 0, toUser: 1 });
    expect(sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_USER_MIN + 30))).toEqual({ toDuty: 0, toUser: 0 });
    expect(notes).toHaveLength(1);
  });

  it("shows an escalated question to the duty holder after 15 min", () => {
    const q = send("codex/a", "codex/b", "question");
    expect(inbox(h.sqlite, WS, "hermes/h", { now: T0 })).toHaveLength(0);
    const at15 = new Date(T0.getTime() + QUESTION_DUTY_MIN * 60_000);
    sweepQuestions(h.sqlite, WS, () => undefined, at15);
    // The duty agent is alive at minute 15: its heartbeat is refreshed, as its poller would do.
    h.sqlite.prepare("UPDATE agent_instances SET last_seen_at = ?, duty_heartbeat_at = ? WHERE instance = ?").run(at15.toISOString(), at15.toISOString(), "hermes/h");
    const seen = inbox(h.sqlite, WS, "hermes/h", { now: at15 });
    expect(seen.map((row) => row.id)).toEqual([q.id]);
  });

  it("does not escalate an answered question", () => {
    const q = send("codex/a", "codex/b", "question");
    ack(h.sqlite, WS, "codex/b", q.id, T0);
    expect(sweepQuestions(h.sqlite, WS, () => undefined, new Date(T0.getTime() + 120 * 60_000))).toEqual({ toDuty: 0, toUser: 0 });
  });

  it("posts from the user as a directive from the top rank", () => {
    const row = postAsUser(h.sqlite, WS, { to: "codex/a", body: "làm đi" }, T0);
    expect(row.kind).toBe("directive");
    expect(row.fromInstance).toBe("user");
    expect(rankOf(h.sqlite, "user")).toBeGreaterThan(rankOf(h.sqlite, "hermes/h"));
    expect(inbox(h.sqlite, WS, "codex/a", { now: T0 })).toHaveLength(1);
  });
});
