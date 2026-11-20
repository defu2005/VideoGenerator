import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { handleMissionCommand } from "../src/missions/telegramCommands.js";
import { testActor } from "./testActor.js";

// TASK-129c: the /mission Telegram command. Fakes only, no network, no Telegram API.
const apps: Array<{ close(): Promise<unknown> }> = [];
const roots: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vg-mission-tg-")); roots.push(root);
  const config = parseConfig({ DATA_DIR: root, DATABASE_PATH: join(root, "app.db"), WORKER_ENABLED: "false", LOG_LEVEL: "silent", LLM_ENABLE_MOCK: "true", LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", IMAGE_PROVIDERS: "mock" });
  const app = buildApp({ config, testActor: { ...testActor } as never });
  apps.push(app);
  const sqlite = app.vgAssistant.service.toolContext().sqlite;
  return { sqlite };
}

const stateOf = (sqlite: ReturnType<typeof setup>["sqlite"], id: string) =>
  (sqlite.prepare("SELECT state FROM missions WHERE id = ?").get(id) as { state: string }).state;
const idIn = (reply: string) => /<code>([0-9a-f-]{36})<\/code>/.exec(reply)?.[1] ?? "";

describe("/mission Telegram command", () => {
  it("creates a mission from the text after the command and lists it", () => {
    const { sqlite } = setup();
    const reply = handleMissionCommand(sqlite, "làm 3 video về Berserk cho kênh A");
    expect(reply).toMatch(/^Đã tạo mission:/);
    const id = idIn(reply);
    expect(stateOf(sqlite, id)).toBe("planning");
    const listed = handleMissionCommand(sqlite, "list");
    expect(listed).toContain("Mission gần đây");
    expect(listed).toContain(id);
  });

  it("an empty command lists missions, and an empty list says so", () => {
    const { sqlite } = setup();
    expect(handleMissionCommand(sqlite, "")).toBe("Chưa có mission nào.");
  });

  it("escapes user text echoed back in HTML", () => {
    const { sqlite } = setup();
    const reply = handleMissionCommand(sqlite, "<b>x</b> & y");
    expect(reply).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(reply).not.toContain("<b>x</b>");
  });

  it("resume clears a waiting_user hold only, and reports a wrong state readably", () => {
    const { sqlite } = setup();
    const id = idIn(handleMissionCommand(sqlite, "làm video"));
    const wrong = handleMissionCommand(sqlite, `resume ${id}`);
    expect(wrong).not.toMatch(/^Đã gỡ chờ/);
    expect(stateOf(sqlite, id)).toBe("planning");

    sqlite.prepare("UPDATE missions SET state = 'waiting_user' WHERE id = ?").run(id);
    expect(handleMissionCommand(sqlite, `resume ${id}`)).toMatch(/^Đã gỡ chờ:/);
    expect(stateOf(sqlite, id)).toBe("producing");
  });

  it("cancel moves an open mission to cancelled", () => {
    const { sqlite } = setup();
    const id = idIn(handleMissionCommand(sqlite, "làm video"));
    expect(handleMissionCommand(sqlite, `cancel ${id}`)).toMatch(/^Đã huỷ:/);
    expect(stateOf(sqlite, id)).toBe("cancelled");
  });

  it("an unknown id gets a readable reply and does not throw", () => {
    const { sqlite } = setup();
    const reply = handleMissionCommand(sqlite, "resume 00000000-0000-4000-8000-000000000000");
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toMatch(/^Đã/);
  });

  it("resume and cancel without an id ask for one", () => {
    const { sqlite } = setup();
    expect(handleMissionCommand(sqlite, "resume")).toContain("Thiếu mã mission");
    expect(handleMissionCommand(sqlite, "cancel")).toContain("Thiếu mã mission");
  });

  it("a mission in another workspace is not visible or changeable from this chat", () => {
    const { sqlite } = setup();
    const at = new Date().toISOString();
    const foreignId = "11111111-1111-4111-8111-111111111111";
    sqlite.prepare(
      `INSERT INTO missions (id, workspace_id, created_by, command, channel_profile_id, project_ids, plan, state, owner, autonomy_level, created_at, updated_at)
       VALUES (?, 'other-workspace', 'user', 'mission khác', NULL, '[]', '[]', 'waiting_user', NULL, 'assist', ?, ?)`,
    ).run(foreignId, at, at);
    expect(handleMissionCommand(sqlite, `resume ${foreignId}`)).not.toMatch(/^Đã gỡ chờ/);
    expect(handleMissionCommand(sqlite, `cancel ${foreignId}`)).not.toMatch(/^Đã huỷ/);
    expect(stateOf(sqlite, foreignId)).toBe("waiting_user");
    expect(handleMissionCommand(sqlite, "list")).not.toContain(foreignId);
  });
});

// TASK-129c: the chat tools (missionToolDefs) for the user. Same actions as /mission, with an API-key actor refused.
import { missionToolDefs } from "../src/missions/toolDefs.js";
import { runAsActor } from "../src/auth/requestContext.js";
describe("mission chat tools (user)", () => {
  const tool = (name: string) => {
    const found = missionToolDefs.find((t) => t.name === name);
    if (!found) throw new Error(`missing tool ${name}`);
    return found;
  };
  it("create, list, cancel and resume through the chat tools", async () => {
    const { sqlite } = setup();
    const ctx = { sqlite } as never;
    const created = await tool("mission_create").execute({ command: "làm video chat" }, ctx) as { mission: { id: string; state: string } };
    expect(created.mission.state).toBe("planning");
    const listed = await tool("mission_list").execute({}, ctx) as { missions: Array<{ id: string }> };
    expect(listed.missions.map((m) => m.id)).toContain(created.mission.id);
    sqlite.prepare("UPDATE missions SET state = 'waiting_user' WHERE id = ?").run(created.mission.id);
    const resumed = await tool("mission_resume").execute({ id: created.mission.id }, ctx) as { mission: { state: string } };
    expect(resumed.mission.state).toBe("producing");
    const cancelled = await tool("mission_cancel").execute({ id: created.mission.id }, ctx) as { mission: { state: string } };
    expect(cancelled.mission.state).toBe("cancelled");
  });
  it("an API-key actor cannot create or resume a mission from the chat tools", async () => {
    const { sqlite } = setup();
    const ctx = { sqlite } as never;
    const actor = { kind: "apikey", keyId: "agent-a", role: "owner" } as never;
    await expect(runAsActor(actor, () => tool("mission_create").execute({ command: "x" }, ctx))).rejects.toMatchObject({ code: "MISSION_USER_ONLY" });
  });
});
