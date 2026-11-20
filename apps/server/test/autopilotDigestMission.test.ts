import { buildDigest } from "../src/operator/autopilot.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { actorWith } from "./testActor.js";

// TASK-129c: buildDigest must carry the mission data that the digest's "Mission:" line prints.
// Fixed clock, in-memory db, no network. The line text itself lives in supervisor.ts; this proves its inputs.
let opened: ReturnType<typeof openDatabase>;
beforeEach(() => {
  opened = openDatabase(":memory:"); migrateDatabase(opened.db, undefined, opened.sqlite);
  opened.sqlite.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES ('A','A','A',1)").run();
});
afterEach(() => opened.sqlite.close());
const run = <T>(fn: () => T) => runAsActor(actorWith({ role: "owner", workspaceId: "A" }), fn);

it("the digest carries the mission counts the Mission line prints", () => run(() => {
  const db = opened.sqlite;
  const today = "2026-11-18T05:00:00.000Z"; // 12:00 on 2026-11-18 in Vietnam
  const old = "2026-11-10T05:00:00.000Z";
  const insert = (id: string, state: string, updated: string) => db.prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, channel_profile_id, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES (?, 'A', 'user', ?, NULL, '[]', '[]', ?, NULL, 'assist', ?, ?)`,
  ).run(id, `lệnh ${id}`, state, updated, updated);
  insert("m-run", "producing", today);
  insert("m-wait", "waiting_user", today);
  insert("m-failed", "failed", today);
  insert("m-done", "done", today);
  insert("m-old", "done", old);
  db.prepare("INSERT INTO mission_checkpoints (mission_id, kind, at, metrics, report) VALUES ('m-run', 'published', ?, NULL, NULL)").run(today);

  const digest = buildDigest(db, () => new Date("2026-11-18T06:00:00.000Z"));
  expect(digest).toHaveProperty("missions");
  const m = digest.missions;
  expect(m.inFlight.map((row) => row.id).sort()).toEqual(["m-run", "m-wait"]);
  expect(m.endedToday.map((row) => row.id).sort()).toEqual(["m-done", "m-failed"]);
  expect(m.failedToday).toBe(1);
  expect(m.waitingUser).toBe(1);
  expect(m.publishedToday).toBe(1);
  // The Mission line is printed when this gate is truthy.
  expect(Boolean(m.inFlight.length || m.endedToday.length || m.publishedToday)).toBe(true);
}));
