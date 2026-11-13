import Database from "better-sqlite3";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { AUTONOMY_PRESETS, AutonomySettingsSchema, PROTECTED_PROJECT_ID, TOOL_GRANTS } from "@vg/shared";
import { registerAutonomyRoutes } from "../src/api/autonomy.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { autonomyDecision, shouldCreatePending } from "../src/registry/policy.js";
import { effectiveAutonomy, saveAutonomySettings } from "../src/operator/autonomy.js";

const full = AutonomySettingsSchema.parse({ level: "autonomous", grants: AUTONOMY_PRESETS.autonomous });
const supervised = AutonomySettingsSchema.parse({ level: "supervised", grants: AUTONOMY_PRESETS.supervised });
const profile = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setup() {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);"
    + "CREATE TABLE profiles (id TEXT PRIMARY KEY, archived_at TEXT);"
    + "CREATE TABLE projects (id TEXT PRIMARY KEY, profile_id TEXT);"
    + "CREATE TABLE platform_accounts (id TEXT PRIMARY KEY, profile_id TEXT)");
  db.prepare("INSERT INTO profiles VALUES (?, NULL)").run(profile);
  return db;
}

describe("autonomy grants", () => {
  it("classifies all confirmation tools and holds unknown ones", () => {
    for (const tool of Object.values(ASSISTANT_TOOLS)) {
      if (tool.risk === "confirm") expect(Object.hasOwn(TOOL_GRANTS, tool.name), tool.name).toBe(true);
    }
    expect(autonomyDecision("unknown", {}, full)).toBe("pending");
    expect(autonomyDecision("computer_act", {}, full)).toBe("pending");
    expect(autonomyDecision("publish_project", {}, supervised)).toBe("pending");
    expect(autonomyDecision("publish_project", { body: { visibility: "private" } }, supervised)).toBe("run");
    expect(autonomyDecision("publish_project", {}, full)).toBe("run");
    expect(autonomyDecision("approve_gate", { projectId: PROTECTED_PROJECT_ID, gate: "SCRIPT" }, full)).toBe("block");
    expect(autonomyDecision("update_llm_settings", { settings: { budgetUsd: 50 } }, full)).toBe("block");
  });

  it("applies the topic grant without enabling gated publication or screen actions", () => {
    for (const source of ["assistant", "operator", "mcp", "agent"] as const) {
      const context = { args: {}, risk: "confirm", source, autoConfirm: false, alwaysConfirm: true };
      expect(shouldCreatePending({ ...context, name: "delete_topic", autonomy: supervised })).toBe(false);
      expect(shouldCreatePending({ ...context, name: "delete_topic" })).toBe(source !== "agent");
      expect(shouldCreatePending({ ...context, name: "publish_project", autonomy: full })).toBe(false);
      expect(shouldCreatePending({ ...context, name: "computer_act", autonomy: full })).toBe(true);
      expect(shouldCreatePending({ ...context, name: "unclassified", autoConfirm: true, alwaysConfirm: false })).toBe(true);
    }
  });

  it("clips profile and account grants to the stricter app ceiling", () => {
    const db = setup();
    try {
      expect(effectiveAutonomy(db, {}).level).toBe("assist");
      saveAutonomySettings(db, supervised);
      saveAutonomySettings(db, full, profile);
      db.prepare("INSERT INTO platform_accounts VALUES ('account', ?)").run(profile);
      expect(effectiveAutonomy(db, { body: { accountIds: ["account"] } })).toEqual(supervised);
      db.prepare("INSERT INTO app_settings VALUES (?, ?, '') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(`autonomy.profile.${profile}`, '{"grants":{"topics":false}}');
      expect(effectiveAutonomy(db, { profileId: profile }).grants.topics).toBe(false);
      expect(effectiveAutonomy(db, { profileId: profile }).grants.providers).toBe(true);
    } finally { db.close(); }
  });

  it("rejects writes from tools and accepts local browser writes", async () => {
    const db = setup();
    const app = Fastify();
    registerAutonomyRoutes(app, db, "http://localhost:5180");
    const request = { method: "POST" as const, url: "/api/autonomy/app", payload: full };
    const headers = { origin: "http://localhost:5180", "sec-fetch-site": "same-origin" };
    try {
      expect((await app.inject(request)).statusCode).toBe(403);
      expect((await app.inject({ ...request, headers: { ...headers, "x-vg-tool-source": "agent" } })).statusCode).toBe(403);
      expect((await app.inject({ ...request, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/api/autonomy/${profile}` })).json().effective.level).toBe("assist");
      expect((await app.inject({ ...request, url: `/api/autonomy/${profile}`, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/api/autonomy/${profile}` })).json().effective.level).toBe("autonomous");
      const budget = { ...request, url: "/api/autonomy/app/budget", payload: { dailyUsd: 5 } };
      expect((await app.inject({ ...budget, headers: { ...headers, "x-vg-tool-source": "operator" } })).statusCode).toBe(403);
      expect((await app.inject({ ...budget, headers })).json().effective.dailyUsd).toBe(5);
      expect((await app.inject({ ...budget, url: `/api/autonomy/${profile}/budget`, headers, payload: { monthlyUsd: 20 } }))
        .json().effective).toMatchObject({ dailyUsd: 5, monthlyUsd: 20 });
    } finally { await app.close(); db.close(); }
  });
});
