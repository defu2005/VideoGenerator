import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { subscribeAgentEvents } from "../src/events/agentBus.js";
import { setState } from "../src/missions/checkpoints.js";

// TASK-129c: setState only moves a mission whose state still equals `from`. A lost race (state already moved on)
// changes nothing and must emit nothing. A real concurrent race cannot run in one test process, so the stale
// `from` stands in for it: the database has already moved the mission, as another writer would have done.
let opened: ReturnType<typeof openDatabase>;
const now = "2026-11-18T03:00:00.000Z";

beforeEach(() => {
  opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  opened.sqlite.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES ('A','A','A',1)").run();
  opened.sqlite.prepare(
    `INSERT INTO missions (id, workspace_id, created_by, command, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
     VALUES ('m-1', 'A', 'user', 'x', '[]', '[]', 'producing', NULL, 'assist', ?, ?)`,
  ).run(now, now);
});
afterEach(() => opened.sqlite.close());

const stateOf = () => (opened.sqlite.prepare("SELECT state FROM missions WHERE id = 'm-1'").get() as { state: string }).state;

it("a stale `from` changes nothing and emits no mission_state_changed event", () => {
  const seen: string[] = [];
  const off = subscribeAgentEvents((event) => { if (event.type === "mission_state_changed") seen.push(event.summary); });
  try {
    // The row is "producing", but the caller believes it is "planning": the update matches zero rows.
    setState(opened.sqlite, "A", "m-1", "planning", "failed", now);
    expect(stateOf()).toBe("producing");
    expect(seen).toHaveLength(0);
  } finally {
    off();
  }
});

it("a matching `from` moves the mission and emits exactly one event", () => {
  const seen: string[] = [];
  const off = subscribeAgentEvents((event) => { if (event.type === "mission_state_changed") seen.push(event.summary); });
  try {
    setState(opened.sqlite, "A", "m-1", "producing", "waiting_user", now);
    expect(stateOf()).toBe("waiting_user");
    expect(seen).toEqual(["Mission producing → waiting_user"]);
  } finally {
    off();
  }
});
