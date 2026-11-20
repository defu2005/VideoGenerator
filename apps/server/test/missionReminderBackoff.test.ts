import { afterEach, beforeEach, expect, it } from "vitest";
import type { NotificationEvent } from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { deliverMissionNotices, RETRY_BACKOFF_MS } from "../src/missions/delivery.js";

// TASK-129c: a waiting-user reminder that fails is retried only after the 5-minute backoff, not on every 30 s tick.
// Fakes only: in-memory db, fixed clock, a notifier that always reports "failed" (Telegram down).
let opened: ReturnType<typeof openDatabase>;
const t0 = new Date("2026-11-18T03:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const TICK_MS = 30_000;

beforeEach(() => {
  opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  const db = opened.sqlite;
  db.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES ('A','A','A',1)").run();
  db.prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES ('m-wait', 'A', 'user', 'lệnh', '["P1"]', '[]', 'waiting_user', NULL, 'assist', ?, ?)`,
  ).run(t0.toISOString(), t0.toISOString());
});
afterEach(() => opened.sqlite.close());

it("a failing reminder is retried only after the 5-minute backoff across many 30 s ticks", async () => {
  const sent: NotificationEvent[] = [];
  const notifier = { deliver: async (event: NotificationEvent) => { sent.push(event); return "failed" as const; } };
  const tick = (now: Date) => deliverMissionNotices(opened.sqlite, notifier, [], now, "http://localhost");

  await tick(at(0));
  expect(sent).toHaveLength(1);

  // Every 30 s tick inside the backoff window sends nothing.
  for (let ms = TICK_MS; ms < RETRY_BACKOFF_MS; ms += TICK_MS) await tick(at(ms));
  expect(sent).toHaveLength(1);

  // At the end of the window the reminder is retried, and fails again, so the window restarts.
  await tick(at(RETRY_BACKOFF_MS));
  expect(sent).toHaveLength(2);
  await tick(at(RETRY_BACKOFF_MS + TICK_MS));
  expect(sent).toHaveLength(2);
  await tick(at(2 * RETRY_BACKOFF_MS));
  expect(sent).toHaveLength(3);
});

it("a reminder that is sent clears the backoff and records the ping", async () => {
  let outcome: "failed" | "sent" = "failed";
  const sent: NotificationEvent[] = [];
  const notifier = { deliver: async (event: NotificationEvent) => { sent.push(event); return outcome; } };
  await deliverMissionNotices(opened.sqlite, notifier, [], at(0), "http://localhost");
  outcome = "sent";
  await deliverMissionNotices(opened.sqlite, notifier, [], at(RETRY_BACKOFF_MS), "http://localhost");
  expect(sent).toHaveLength(2);
  const ping = opened.sqlite.prepare("SELECT at FROM mission_checkpoints WHERE mission_id = 'm-wait' AND kind = 'ping'").get() as { at: string } | undefined;
  expect(ping?.at).toBe(at(RETRY_BACKOFF_MS).toISOString());
});
