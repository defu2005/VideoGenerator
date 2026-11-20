import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pollInboxEventsOnce, readInboxSeen, INBOX_SEEN_PATH, type SyncOptions } from "../src/sync.js";
import type { InboxPeek } from "../src/eventPoller.js";

const API_KEY = "test-key-123";
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "vg-inbox-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function options(fetchImpl: typeof fetch, logs: string[]): SyncOptions {
  return { home, apiUrl: "http://127.0.0.1:3001", apiKey: API_KEY, hermesVersion: "t", fetchImpl, log: (line) => logs.push(line) };
}
const mail = (id: string): InboxPeek => ({ id, kind: "directive", fromInstance: "codex/b", createdAt: "2026-11-18T10:00:00.000Z" });
function peekServer(messages: InboxPeek[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    expect(new URL(String(url)).pathname).toBe("/api/agents/mailbox/peek");
    return new Response(JSON.stringify({ messages }), { status: 200 });
  }) as typeof fetch;
}

describe("inbox peek poll (TASK-129a step 4)", () => {
  it("primes on the first run, then wakes exactly once per new unacked message", async () => {
    const messages = [mail("m1")];
    const woken: string[] = [];
    const logs: string[] = [];
    await pollInboxEventsOnce(options(peekServer(messages), logs), (m) => woken.push(m.id));
    expect(woken).toHaveLength(0);
    expect(readInboxSeen(home)).toEqual(["m1"]);
    messages.push(mail("m2"));
    await pollInboxEventsOnce(options(peekServer(messages), logs), (m) => woken.push(m.id));
    await pollInboxEventsOnce(options(peekServer(messages), logs), (m) => woken.push(m.id));
    expect(woken).toEqual(["m2"]);
    expect(logs.at(-1)).toBe("vg-inbox-poll ok woke=0");
  });

  it("keeps the seen list and logs only an error code on failure", async () => {
    const logs: string[] = [];
    await pollInboxEventsOnce(options(peekServer([mail("m1")]), logs), () => undefined);
    const failing = (async () => new Response("secret " + API_KEY, { status: 503 })) as unknown as typeof fetch;
    await pollInboxEventsOnce(options(failing, logs), () => undefined);
    expect(readInboxSeen(home)).toEqual(["m1"]);
    expect(logs.at(-1)).toBe("vg-inbox-poll SYNC_HTTP_503; giữ danh sách đã báo");
    expect(logs.join("\n")).not.toContain(API_KEY);
    expect(INBOX_SEEN_PATH).toBe("vg-sync/inbox-seen.json");
  });
});
