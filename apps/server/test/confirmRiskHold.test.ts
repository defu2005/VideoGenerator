import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { holdForPendingAction, releaseAfterPendingAction } from "../src/missions/checkpoints.js";

// TASK-129c: a confirm-risk action on a project holds that project's producing missions and resumes them
// once no pending action still targets the project. Fakes only: in-memory db, fixed clock.
let opened: ReturnType<typeof openDatabase>;
const now = new Date("2026-11-18T03:00:00Z");
const projectArgs = JSON.stringify({ projectId: "P1" });

beforeEach(() => {
  opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  const db = opened.sqlite;
  db.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES ('A','A','A',1)").run();
  db.prepare("INSERT INTO assistant_conversations (id, workspace_id, channel, title, created_at, updated_at) VALUES ('c1','A','web','t',?,?)")
    .run(now.toISOString(), now.toISOString());
});
afterEach(() => opened.sqlite.close());

const insertMission = (id: string, state: string, projectIds: string[]) => opened.sqlite.prepare(
  `INSERT INTO missions (id, workspace_id, created_by, command, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
   VALUES (?, 'A', 'user', 'x', ?, '[]', ?, NULL, 'assist', ?, ?)`,
).run(id, JSON.stringify(projectIds), state, now.toISOString(), now.toISOString());

const stateOf = (id: string) => (opened.sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(id) as { state: string }).state;

const insertAction = (id: string, tool: string, args: string, status: "pending" | "confirmed" | "expired") => opened.sqlite.prepare(
  `INSERT INTO assistant_pending_actions (id, conversation_id, tool, args, summary, status, created_at, expires_at)
   VALUES (?, 'c1', ?, ?, 's', ?, ?, ?)`,
).run(id, tool, args, status, now.toISOString(), now.toISOString());

it("holds the project's producing missions when a confirm-risk action is created", () => {
  insertMission("m-run", "producing", ["P1"]);
  insertMission("m-other", "producing", ["P2"]);
  expect(holdForPendingAction(opened.sqlite, "publish_video", projectArgs, now)).toEqual(["m-run"]);
  expect(stateOf("m-run")).toBe("waiting_user");
  expect(stateOf("m-other")).toBe("producing");
});

it("resumes held missions when the only pending action is confirmed or rejected", () => {
  insertMission("m-run", "producing", ["P1"]);
  holdForPendingAction(opened.sqlite, "publish_video", projectArgs, now);
  insertAction("a1", "publish_video", projectArgs, "pending");
  opened.sqlite.prepare("UPDATE assistant_pending_actions SET status = 'confirmed' WHERE id = 'a1'").run();
  expect(releaseAfterPendingAction(opened.sqlite, "a1", "publish_video", projectArgs, now)).toEqual(["m-run"]);
  expect(stateOf("m-run")).toBe("producing");
});

it("keeps the mission held while a second pending action still targets the same project", () => {
  insertMission("m-run", "producing", ["P1"]);
  holdForPendingAction(opened.sqlite, "publish_video", projectArgs, now);
  insertAction("a1", "publish_video", projectArgs, "pending");
  insertAction("a2", "delete_video", projectArgs, "pending");
  expect(releaseAfterPendingAction(opened.sqlite, "a1", "publish_video", projectArgs, now)).toEqual([]);
  expect(stateOf("m-run")).toBe("waiting_user");
});

it("a mission_* tool holds nothing, because it has no project to hold", () => {
  insertMission("m-run", "producing", ["P1"]);
  expect(holdForPendingAction(opened.sqlite, "mission_cancel", projectArgs, now)).toEqual([]);
  expect(stateOf("m-run")).toBe("producing");
});

it("an action with no projectId in its args holds nothing and never throws on bad JSON", () => {
  insertMission("m-run", "producing", ["P1"]);
  expect(holdForPendingAction(opened.sqlite, "publish_video", "{}", now)).toEqual([]);
  expect(holdForPendingAction(opened.sqlite, "publish_video", "not json", now)).toEqual([]);
  expect(stateOf("m-run")).toBe("producing");
});
