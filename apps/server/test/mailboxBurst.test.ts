import { beforeEach, describe, expect, it } from "vitest";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { sendMessage, sweepQuestions, QUESTION_USER_MIN } from "../src/supervision/mailbox.js";
import { subscribeAgentEvents } from "../src/events/agentBus.js";

// TASK-129c burst rule: Telegram off → nothing sent, nothing stamped; two or more due → one summary, all stamped.
const WS = "ws-test";
const T0 = new Date("2026-11-18T10:00:00.000Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("question escalation burst rule", () => {
  let h: ReturnType<typeof createPipelineHarness>;
  beforeEach(() => { h = createPipelineHarness(); });

  const ask = (from: string, to: string, body: string) =>
    sendMessage(h.sqlite, { workspaceId: WS, from, to, kind: "question", body }, T0);
  const stamp = (id: string) => (h.sqlite.prepare("SELECT escalated_user_at AS e FROM agent_messages WHERE id = ?").get(id) as { e: string | null }).e;

  it("with Telegram off sends nothing and leaves escalated_user_at unset", () => {
    const q = ask("codex/a", "codex/b", "một");
    const notes: string[] = [];
    const res = sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_USER_MIN), { telegramReady: () => false });
    expect(res.toUser).toBe(0);
    expect(notes).toHaveLength(0);
    expect(stamp(q.id)).toBeNull();
  });

  it("with Telegram on and one question due sends one message for it", () => {
    const q = ask("codex/a", "codex/b", "một");
    const notes: string[] = [];
    const res = sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_USER_MIN), { telegramReady: () => true });
    expect(res.toUser).toBe(1);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("codex/a → codex/b");
    expect(stamp(q.id)).not.toBeNull();
  });

  it("with Telegram on and two due sends one summary and stamps both", () => {
    const q1 = ask("codex/a", "codex/b", "một");
    const q2 = ask("codex/c", "codex/d", "hai");
    const notes: string[] = [];
    const res = sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_USER_MIN), { telegramReady: () => true });
    expect(res.toUser).toBe(2);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^2 câu hỏi/);
    expect(stamp(q1.id)).not.toBeNull();
    expect(stamp(q2.id)).not.toBeNull();
    // Both stamped: a later sweep sends nothing more.
    expect(sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(QUESTION_USER_MIN + 30), { telegramReady: () => true }).toUser).toBe(0);
    expect(notes).toHaveLength(1);
  });

  it("publishes the user escalation after commit, never inside the stamping transaction", () => {
    ask("codex/a", "codex/b", "một");
    const inTx: boolean[] = [];
    const off = subscribeAgentEvents((event) => {
      if (event.type === "agent.question_escalated") inTx.push(h.sqlite.inTransaction);
    });
    try {
      sweepQuestions(h.sqlite, WS, () => undefined, at(QUESTION_USER_MIN), { telegramReady: () => true });
      expect(inTx.length).toBe(1);
      expect(inTx[0]).toBe(false);
    } finally { off(); }
  });

  it("with Telegram off, duty still escalates at 15 min and the user one waits", () => {
    const q = ask("codex/a", "codex/b", "một");
    const notes: string[] = [];
    const duty = sweepQuestions(h.sqlite, WS, (t) => notes.push(t), at(15), { telegramReady: () => false });
    expect(duty.toDuty).toBe(1);
    expect(notes).toHaveLength(0);
    expect(stamp(q.id)).toBeNull();
  });
});
