import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendWakeSignal, pollEventsOnce, readEventCursor, EVENT_CURSOR_PATH, WAKE_SIGNAL_CAP, WAKE_SIGNAL_PATH, type SyncOptions } from "../src/sync.js";
import type { PolledEvent } from "../src/eventPoller.js";

const API_KEY = "test-key-123";
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "vg-poll-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function options(fetchImpl: typeof fetch, logs: string[]): SyncOptions {
  return { home, apiUrl: "http://127.0.0.1:3001", apiKey: API_KEY, hermesVersion: "t", fetchImpl, log: (line) => logs.push(line) };
}

/** Stub server: returns events whose id is after `since` (or all when no since), like the real bus. */
function stubServer(events: PolledEvent[], seenQueries: string[][] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    const query = new URL(String(url)).searchParams;
    seenQueries.push([query.get("since") ?? "", query.get("types") ?? ""]);
    const since = query.get("since");
    const index = since ? events.findIndex((event) => event.id === since) : -1;
    return new Response(JSON.stringify({ events: events.slice(index + 1) }), { status: 200 });
  }) as typeof fetch;
}

describe("event poll loop wiring (TASK-129a step 4)", () => {
  it("keeps the cursor across two cycles and wakes once per new subscribed event", async () => {
    const events: PolledEvent[] = [{ id: "e1", type: "stage_finished", summary: "a" }];
    const logs: string[] = [];
    const woken: PolledEvent[] = [];
    const seen: string[][] = [];
    const fetchImpl = stubServer(events, seen);
    // Cycle 1: priming, nothing woken.
    await pollEventsOnce(options(fetchImpl, logs), ["stage_finished"], (e) => woken.push(e));
    expect(readEventCursor(home)).toBe("e1");
    expect(woken).toHaveLength(0);
    // New event arrives; cycle 2 wakes on it and moves the cursor.
    events.push({ id: "e2", type: "stage_finished", summary: "b" });
    await pollEventsOnce(options(fetchImpl, logs), ["stage_finished"], (e) => woken.push(e));
    expect(woken.map((e) => e.id)).toEqual(["e2"]);
    expect(readEventCursor(home)).toBe("e2");
    expect(seen[1]![0]).toBe("e1");
    expect(seen[1]![1]).toBe("stage_finished");
    expect(readFileSync(join(home, EVENT_CURSOR_PATH), "utf8")).toContain("e2");
    expect(logs.at(-1)).toBe("vg-events-poll ok woke=1");
  });

  it("keeps the cursor and logs only an error code when the server fails", async () => {
    const logs: string[] = [];
    const failing = (async () => new Response("secret stack trace " + API_KEY, { status: 503 })) as unknown as typeof fetch;
    await pollEventsOnce(options(failing, logs), ["stage_finished"], () => undefined);
    expect(readEventCursor(home)).toBeUndefined();
    expect(logs.at(-1)).toBe("vg-events-poll SYNC_HTTP_503; giữ con trỏ");
    expect(logs.join("\n")).not.toContain(API_KEY);
  });

  it("persists an empty primed cursor and does not re-prime on the next poll", async () => {
    const events: PolledEvent[] = [];
    const woken: PolledEvent[] = [];
    const seen: string[][] = [];
    const fetchImpl = stubServer(events, seen);
    await pollEventsOnce(options(fetchImpl, []), ["stage_finished"], (e) => woken.push(e));
    expect(readEventCursor(home)).toBe("");
    events.push({ id: "e1", type: "stage_finished", summary: "a" });
    await pollEventsOnce(options(fetchImpl, []), ["stage_finished"], (e) => woken.push(e));
    expect(woken.map((e) => e.id)).toEqual(["e1"]);
    expect(readEventCursor(home)).toBe("e1");
    expect(seen[1]![0]).toBe("");
  });

  it("keeps an existing cursor unchanged after a failure", async () => {
    const logs: string[] = [];
    const okFetch = stubServer([{ id: "e1", type: "stage_finished", summary: "a" }]);
    await pollEventsOnce(options(okFetch, logs), ["stage_finished"], () => undefined);
    expect(readEventCursor(home)).toBe("e1");
    const failing = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await pollEventsOnce(options(failing, logs), ["stage_finished"], () => undefined);
    expect(readEventCursor(home)).toBe("e1");
  });
});

describe("wake signal file (TASK-129a step 4, skill read path)", () => {
  it("writes woken events beside the cursor, deduped and bounded, never into vg-skills", async () => {
    const events: PolledEvent[] = [{ id: "e1", type: "stage_finished", summary: "a" }];
    const fetchImpl = stubServer(events);
    await pollEventsOnce(options(fetchImpl, []), ["stage_finished"], () => undefined);
    events.push({ id: "e2", type: "stage_finished", summary: "b" });
    await pollEventsOnce(options(fetchImpl, []), ["stage_finished"], () => undefined);
    const signal = JSON.parse(readFileSync(join(home, WAKE_SIGNAL_PATH), "utf8")) as { events: { id: string; type: string; summary: string }[] };
    expect(signal.events.map((row) => row.id)).toEqual(["e2"]);
    expect(Object.keys(signal.events[0]).sort()).toEqual(["at", "id", "summary", "type"]);
  });

  it("dedupes by id and keeps only the newest WAKE_SIGNAL_CAP rows", () => {
    const rows = Array.from({ length: WAKE_SIGNAL_CAP + 5 }, (_, i) => ({ id: `x${i}`, type: "stage_finished", summary: "s".repeat(300) }));
    appendWakeSignal(home, rows);
    appendWakeSignal(home, [rows[rows.length - 1]]); // still in the file: must be deduped
    const signal = JSON.parse(readFileSync(join(home, WAKE_SIGNAL_PATH), "utf8")) as { events: { id: string; summary: string }[] };
    expect(signal.events).toHaveLength(WAKE_SIGNAL_CAP);
    expect(signal.events.at(-1)?.id).toBe(`x${WAKE_SIGNAL_CAP + 4}`);
    expect(signal.events.every((row) => row.summary.length <= 200)).toBe(true);
    expect(signal.events.some((row) => row.id === "x0")).toBe(false);
    expect(signal.events.filter((row) => row.id === `x${WAKE_SIGNAL_CAP + 4}`)).toHaveLength(1);
  });
});

