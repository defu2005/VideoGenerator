import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";
import { ACTIONS, FORBIDDEN_MESSAGE, ROLE_ACTIONS, can } from "../src/auth/policy.js";
import { WORKSPACE_ROLES } from "../src/auth/roles.js";
import { TOOL_ACTIONS } from "../src/auth/toolActions.js";
import { findRule } from "../src/auth/routePermissions.js";
import { isAuthAllowlisted } from "../src/auth/guard.js";
import { WORKSPACE_ROOT_TABLES, ensureDefaultWorkspace } from "../src/auth/workspaces.js";
import { invokeRegistryTool } from "../src/registry/invoke.js";
import { actorWith, TEST_OTHER_WORKSPACE_ID, TEST_WORKSPACE_ID, testActor } from "./testActor.js";

const root = mkdtempSync(join(tmpdir(), "vg-workspaces-"));
const dbPath = join(root, "ws.db");
// One mutable actor: the app reads it by reference, so each test switches who is calling.
const actor = { ...testActor };
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;

function act(next: ReturnType<typeof actorWith> | typeof testActor): void {
  for (const key of ["grants", "flags", "channelIds"] as const) delete (actor as Record<string, unknown>)[key];
  Object.assign(actor, next);
}

beforeAll(() => {
  const config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: dbPath,
    PORT: "3013",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    WEB_BASE_URL: "http://localhost:5180",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "false",
    FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  });
  app = buildApp({ config, testActor: actor });
  sqlite = new Database(dbPath);
  sqlite.prepare(
    "INSERT OR IGNORE INTO organization (id, name, slug, created_at, metadata) VALUES (?, ?, ?, ?, ?)",
  ).run(TEST_OTHER_WORKSPACE_ID, "Không gian khác", "other", Date.now(), "{}");
});

afterAll(async () => {
  await app.close();
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

async function post(url: string, payload: unknown = {}) {
  return app.inject({ method: "POST", url, payload: payload as object });
}

async function makeProfile(name: string): Promise<string> {
  const response = await post("/api/profiles", { name, direction: "Kênh thử nghiệm", language: "vi" });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

async function makeProject(profileId: string): Promise<string> {
  const response = await post("/api/projects", { topic: "Lịch sử trận đấu AlphaGo và Lee Sedol", profileId });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

describe("policy matrix", () => {
  it("matches the role × action table for every role", () => {
    for (const role of WORKSPACE_ROLES) {
      for (const action of ACTIONS) {
        const decision = can(actorWith({ role }), action, {});
        const expected = action === "operator.use" ? role === "owner" : ROLE_ACTIONS[role].has(action);
        expect(decision.ok, `${role} ${action}`).toBe(expected);
      }
    }
  });

  it("answers 404 for a foreign workspace and for a channel the user cannot see", () => {
    const viewer = actorWith({ role: "viewer", grants: { "chan-a": "viewer" } });
    expect(can(viewer, "project.read", { workspaceId: TEST_OTHER_WORKSPACE_ID })).toMatchObject({ ok: false, status: 404 });
    expect(can(viewer, "project.read", { profileId: "chan-b" })).toMatchObject({ ok: false, status: 404 });
    expect(can(viewer, "project.read", { profileId: "chan-a" })).toMatchObject({ ok: true });
    expect(can(viewer, "stage.run", { profileId: "chan-a" })).toMatchObject({ ok: false, status: 403, reason: FORBIDDEN_MESSAGE });
  });

  it("lowers the role to the channel grant, but owners and admins ignore grants", () => {
    const publisher = actorWith({ role: "publisher", grants: { "chan-a": "viewer" } });
    expect(can(publisher, "publish", { profileId: "chan-a" })).toMatchObject({ ok: false, status: 403 });
    const admin = actorWith({ role: "admin", grants: { "chan-a": "viewer" } });
    expect(can(admin, "publish", { profileId: "chan-a" })).toMatchObject({ ok: true });
  });

  it("lets admins use the operator only once the workspace flag is on", () => {
    expect(can(actorWith({ role: "admin" }), "operator.use")).toMatchObject({ ok: false, status: 403 });
    expect(can(actorWith({ role: "admin", flags: { adminsCanUseOperator: true } }), "operator.use")).toMatchObject({ ok: true });
  });
});

describe("coverage", () => {
  it("maps every assistant tool to an action and nothing else", () => {
    expect(Object.keys(TOOL_ACTIONS).sort()).toEqual(Object.keys(ASSISTANT_TOOLS).sort());
  });

  it("gives every registered route a permission rule or an explicit allowlist entry", () => {
    const routes = (app as unknown as { vgRoutes: Array<{ method: string; url: string }> }).vgRoutes;
    expect(routes.length).toBeGreaterThan(100);
    const missing = routes.filter((r) => !isAuthAllowlisted(r.method, r.url) && !findRule(r.method, r.url));
    expect(missing).toEqual([]);
  });
});

describe("workspace isolation and roles", () => {
  let channelA = "";
  let channelB = "";
  let projectA = "";
  let projectB = "";
  let foreignProfile = "";
  let foreignProject = "";

  beforeAll(async () => {
    act(testActor);
    channelA = await makeProfile("Kênh A");
    channelB = await makeProfile("Kênh B");
    projectA = await makeProject(channelA);
    projectB = await makeProject(channelB);
    act(actorWith({ role: "owner", workspaceId: TEST_OTHER_WORKSPACE_ID, userId: "00000000-0000-4000-8000-0000000000b1" }));
    foreignProfile = await makeProfile("Kênh lạ");
    foreignProject = await makeProject(foreignProfile);
    act(testActor);
  });

  it("stamps created rows with the actor's workspace and leaves none unassigned", () => {
    for (const table of WORKSPACE_ROOT_TABLES) {
      const nulls = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id IS NULL`).get() as { n: number };
      expect(nulls.n, table).toBe(0);
    }
    const row = sqlite.prepare("SELECT workspace_id AS w FROM projects WHERE id = ?").get(foreignProject) as { w: string };
    expect(row.w).toBe(TEST_OTHER_WORKSPACE_ID);
  });

  it("hides another workspace's rows by id (404) and in lists", async () => {
    act(testActor);
    expect((await app.inject({ method: "GET", url: `/api/projects/${foreignProject}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/profiles/${foreignProfile}` })).statusCode).toBe(404);
    const projects = (await app.inject({ method: "GET", url: "/api/projects" })).json<{ items?: Array<{ id: string }> } | Array<{ id: string }>>();
    const ids = (Array.isArray(projects) ? projects : projects.items ?? []).map((p) => p.id);
    expect(ids).toContain(projectA);
    expect(ids).not.toContain(foreignProject);
    const profiles = (await app.inject({ method: "GET", url: "/api/profiles" })).json<{ items: Array<{ id: string }> }>();
    expect(profiles.items.map((p) => p.id)).not.toContain(foreignProfile);
    for (const url of ["/api/publications", "/api/comments", "/api/finance/revenue", "/api/finance/costs", "/api/dashboard/stats"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(200);
    }
  });

  it("refuses a stage run for a viewer and a gate approval for an editor", async () => {
    act(actorWith({ role: "viewer" }));
    const run = await post(`/api/projects/${projectA}/pipeline/run`);
    expect(run.statusCode).toBe(403);
    expect(run.json<{ message?: string; error?: { message?: string } }>()).toMatchObject({});
    act(actorWith({ role: "editor" }));
    expect((await post(`/api/projects/${projectA}/pipeline/gates/VISUAL_REVIEW/approve`)).statusCode).toBe(403);
    act(actorWith({ role: "reviewer" }));
    expect((await post(`/api/projects/${projectA}/pipeline/gates/VISUAL_REVIEW/approve`)).statusCode).not.toBe(403);
  });

  it("limits a viewer with one channel grant to that channel", async () => {
    act(actorWith({ role: "viewer", grants: { [channelA]: "viewer" } }));
    const list = (await app.inject({ method: "GET", url: "/api/projects" })).json<{ items?: Array<{ id: string }> } | Array<{ id: string }>>();
    const ids = (Array.isArray(list) ? list : list.items ?? []).map((p) => p.id);
    expect(ids).toContain(projectA);
    expect(ids).not.toContain(projectB);
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectB}` })).statusCode).toBe(404);
    expect((await post(`/api/projects/${projectA}/pipeline/run`)).statusCode).toBe(403);
  });

  it("keeps the operator closed to admins until the flag is on", async () => {
    act(actorWith({ role: "admin" }));
    expect((await app.inject({ method: "GET", url: "/api/operator/overview" })).statusCode).toBe(403);
    act(actorWith({ role: "admin", flags: { adminsCanUseOperator: true } }));
    expect((await app.inject({ method: "GET", url: "/api/operator/overview" })).statusCode).not.toBe(403);
  });

  it("answers 404 on the pipeline event stream of another workspace", async () => {
    act(testActor);
    expect((await app.inject({ method: "GET", url: `/api/projects/${foreignProject}/events` })).statusCode).toBe(404);
  });

  it("records writes and denials in the audit log and serves them to admins only", async () => {
    act(actorWith({ role: "viewer" }));
    await post(`/api/projects/${projectA}/pipeline/run`);
    act(testActor);
    const audit = (await app.inject({ method: "GET", url: "/api/audit?limit=100" })).json<{ items: Array<{ outcome: string; action: string; workspaceId: string }> }>();
    expect(audit.items.length).toBeGreaterThan(0);
    expect(audit.items.every((i) => i.workspaceId === TEST_WORKSPACE_ID)).toBe(true);
    expect(audit.items.some((i) => i.outcome === "denied")).toBe(true);
    expect(audit.items.some((i) => i.outcome === "ok")).toBe(true);
    act(actorWith({ role: "editor" }));
    expect((await app.inject({ method: "GET", url: "/api/audit" })).statusCode).toBe(403);
    act(testActor);
  });
});

describe("tool layer", () => {
  const call = (who: ReturnType<typeof actorWith>, name: string, args: unknown) =>
    invokeRegistryTool({
      actor: who,
      name,
      args,
      source: "assistant",
      ctx: app.vgAssistant.service.toolContext(),
      createPending: () => { throw new Error("no pending expected"); },
    });

  it("lets a viewer read, refuses a write tool, and audits the refusal", async () => {
    act(testActor);
    const read = await call(actorWith({ role: "viewer" }), "list_profiles", {});
    expect(read.kind).toBe("result");
    const before = (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE outcome = 'denied' AND target_type = 'tool_audit'").get() as { n: number }).n;
    const refused = await call(actorWith({ role: "viewer" }), "save_standing_order", { title: "Giữ nhịp đăng", prompt: "Giữ nhịp đăng bài đều đặn mỗi ngày" });
    expect(refused).toMatchObject({ kind: "refused", message: FORBIDDEN_MESSAGE });
    const after = (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE outcome = 'denied' AND target_type = 'tool_audit'").get() as { n: number }).n;
    expect(after).toBe(before + 1);
  });
});

describe("default workspace bootstrap", () => {
  it("is idempotent: a second run backfills nothing", () => {
    const owner = "00000000-0000-4000-8000-0000000000c1";
    sqlite.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).run(owner, "Chủ", "boot@example.com", Date.now(), Date.now());
    const first = ensureDefaultWorkspace(sqlite, owner);
    const second = ensureDefaultWorkspace(sqlite, owner);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(Object.values(second.backfilled).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
