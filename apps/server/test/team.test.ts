import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import type { WorkspaceRole } from "../src/auth/roles.js";
import { actorWith, TEST_OTHER_WORKSPACE_ID, TEST_WORKSPACE_ID, testActor } from "./testActor.js";

const root = mkdtempSync(join(tmpdir(), "vg-team-"));
const dbPath = join(root, "team.db");
const actor = { ...testActor };
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;

const U = {
  owner: "00000000-0000-4000-8000-0000000000b1",
  admin: "00000000-0000-4000-8000-0000000000b2",
  editor: "00000000-0000-4000-8000-0000000000b3",
  viewer: "00000000-0000-4000-8000-0000000000b4",
};

function act(next: ReturnType<typeof actorWith>): void {
  for (const key of ["grants", "flags", "channelIds"] as const) delete (actor as Record<string, unknown>)[key];
  Object.assign(actor, next);
}
const as = (role: WorkspaceRole, flags?: Parameters<typeof actorWith>[0]["flags"]) => act(actorWith({ role, userId: U[role as keyof typeof U], flags }));

function addUser(id: string, name: string, role: WorkspaceRole, twoFactor = false): void {
  sqlite.prepare("INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at, two_factor_enabled) VALUES (?, ?, ?, 1, ?, ?, ?)")
    .run(id, name, `${id}@example.test`, Date.now(), Date.now(), twoFactor ? 1 : 0);
  sqlite.prepare("INSERT OR IGNORE INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), TEST_WORKSPACE_ID, id, role, Date.now());
}

beforeAll(() => {
  const config = parseConfig({
    DATA_DIR: join(root, "data"), DATABASE_PATH: dbPath, PORT: "3014", HOST: "127.0.0.1", LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173", WEB_BASE_URL: "http://localhost:5180", LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", WORKER_ENABLED: "false", FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  });
  app = buildApp({ config, testActor: actor });
  sqlite = new Database(dbPath);
  sqlite.prepare("INSERT OR IGNORE INTO organization (id, name, slug, created_at, metadata) VALUES (?, ?, ?, ?, ?)")
    .run(TEST_OTHER_WORKSPACE_ID, "Không gian khác", "other", Date.now(), "{}");
  addUser(U.owner, "Chủ", "owner");
  addUser(U.admin, "Quản trị", "admin");
  addUser(U.editor, "Biên tập", "editor");
  addUser(U.viewer, "Người xem", "viewer");
});

afterAll(async () => {
  await app.close();
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { origin: "http://localhost:5173" } });

describe("team: members and roles", () => {
  it("only owner and admin may read the member list", async () => {
    as("editor");
    expect((await call("GET", "/api/workspace/members")).statusCode).toBe(403);
    as("admin");
    const res = await call("GET", "/api/workspace/members");
    expect(res.statusCode).toBe(200);
    expect(res.json<{ members: unknown[] }>().members.length).toBeGreaterThanOrEqual(4);
  });

  it("an admin cannot change an owner or make anyone owner or admin", async () => {
    as("admin");
    expect((await call("PATCH", `/api/workspace/members/${U.owner}`, { role: "viewer" })).statusCode).toBe(403);
    expect((await call("PATCH", `/api/workspace/members/${U.viewer}`, { role: "owner" })).statusCode).toBe(403);
    expect((await call("PATCH", `/api/workspace/members/${U.viewer}`, { role: "admin" })).statusCode).toBe(403);
    expect((await call("DELETE", `/api/workspace/members/${U.owner}`)).statusCode).toBe(403);
    expect((await call("PATCH", `/api/workspace/members/${U.viewer}`, { role: "publisher" })).statusCode).toBe(200);
    expect((await call("PATCH", `/api/workspace/members/${U.viewer}`, { role: "viewer" })).statusCode).toBe(200);
  });

  it("the last owner cannot be demoted or removed, and nobody changes their own role", async () => {
    as("owner");
    expect((await call("PATCH", `/api/workspace/members/${U.owner}`, { role: "admin" })).statusCode).toBe(400);
    // An owner-role caller who is not a member row themself (for example a script) still cannot orphan the workspace.
    act(actorWith({ role: "owner", userId: "00000000-0000-4000-8000-0000000000c1" }));
    expect((await call("PATCH", `/api/workspace/members/${U.owner}`, { role: "viewer" })).statusCode).toBe(409);
    expect((await call("DELETE", `/api/workspace/members/${U.owner}`)).statusCode).toBe(409);
    // With a second owner present the first can be demoted.
    const second = "00000000-0000-4000-8000-0000000000b9";
    addUser(second, "Chủ hai", "owner");
    expect((await call("PATCH", `/api/workspace/members/${U.owner}`, { role: "admin" })).statusCode).toBe(200);
    sqlite.prepare("UPDATE member SET role = 'owner' WHERE user_id = ? AND organization_id = ?").run(U.owner, TEST_WORKSPACE_ID);
    expect((await call("DELETE", `/api/workspace/members/${second}`)).statusCode).toBe(200);
  });

  it("removing a member clears their channel grants and writes audit rows", async () => {
    as("owner");
    const victim = "00000000-0000-4000-8000-0000000000d1";
    addUser(victim, "Sẽ bị xoá", "editor");
    const created = await call("POST", "/api/profiles", { name: "Kênh A", direction: "Kênh thử nghiệm", language: "vi" });
    expect(created.statusCode).toBe(201);
    const profile = created.json<{ id: string }>().id;
    const grant = await call("PUT", `/api/workspace/members/${victim}/grants`, { grants: [{ profileId: profile, role: "viewer" }] });
    expect(grant.statusCode).toBe(200);
    const members = (await call("GET", "/api/workspace/members")).json<{ members: Array<{ userId: string; grants: unknown[] }> }>().members;
    expect(members.find((m) => m.userId === victim)?.grants).toHaveLength(1);
    expect((await call("PUT", `/api/workspace/members/${victim}/grants`, { grants: [{ profileId: randomUUID() }] })).statusCode).toBe(400);
    expect((await call("DELETE", `/api/workspace/members/${victim}`)).statusCode).toBe(200);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM channel_grants WHERE user_id = ?").get(victim)).toEqual({ n: 0 });
    const actions = (sqlite.prepare("SELECT action FROM audit_log WHERE action LIKE 'member.%'").all() as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["member.grants_changed", "member.removed", "member.role_changed"]));
  });

  it("owners and admins cannot be given channel limits", async () => {
    as("owner");
    const res = await call("PUT", `/api/workspace/members/${U.admin}/grants`, { grants: [{ profileId: randomUUID() }] });
    expect(res.statusCode).toBe(400);
  });
});

describe("team: invitations", () => {
  it("creates, lists and cancels an invitation, and refuses an existing member", async () => {
    as("admin");
    const created = await call("POST", "/api/workspace/invitations", { email: "Nguoi.Moi@Example.test", role: "editor" });
    expect(created.statusCode).toBe(201);
    const invite = created.json<{ id: string; link: string; email: string }>();
    expect(invite.email).toBe("nguoi.moi@example.test");
    expect(invite.link).toBe(`http://localhost:5173/invite/${invite.id}`);
    const list = (await call("GET", "/api/workspace/invitations")).json<{ invitations: Array<{ id: string }> }>().invitations;
    expect(list.map((i) => i.id)).toContain(invite.id);
    expect((await call("POST", "/api/workspace/invitations", { email: `${U.editor}@example.test`, role: "viewer" })).statusCode).toBe(409);
    expect((await call("POST", "/api/workspace/invitations", { email: "x@example.test", role: "admin" })).statusCode).toBe(403);
    expect((await call("DELETE", `/api/workspace/invitations/${invite.id}`)).statusCode).toBe(200);
    const after = (await call("GET", "/api/workspace/invitations")).json<{ invitations: Array<{ id: string }> }>().invitations;
    expect(after.map((i) => i.id)).not.toContain(invite.id);
  });
});

describe("team: workspace settings and required two-factor", () => {
  it("only the owner changes settings, and needs two-factor on first for the requirement", async () => {
    as("admin");
    expect((await call("PATCH", "/api/workspace/settings", { hideFinanceFromViewers: true })).statusCode).toBe(403);
    as("owner");
    expect((await call("PATCH", "/api/workspace/settings", { hideFinanceFromViewers: true })).statusCode).toBe(200);
    expect((await call("PATCH", "/api/workspace/settings", { requireTwoFactor: true })).statusCode).toBe(409);
    sqlite.prepare("UPDATE user SET two_factor_enabled = 1 WHERE id = ?").run(U.owner);
    const ok = await call("PATCH", "/api/workspace/settings", { requireTwoFactor: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ flags: { requireTwoFactor: boolean } }>().flags.requireTwoFactor).toBe(true);
    sqlite.prepare("UPDATE user SET two_factor_enabled = 0 WHERE id = ?").run(U.owner);
    sqlite.prepare("UPDATE organization SET metadata = '{}' WHERE id = ?").run(TEST_WORKSPACE_ID);
  });

  it("blocks an owner or admin without two-factor everywhere except /api/me", async () => {
    sqlite.prepare("UPDATE user SET two_factor_enabled = 0 WHERE id IN (?, ?, ?)").run(U.owner, U.admin, U.viewer);
    as("owner", { requireTwoFactor: true });
    const blocked = await call("GET", "/api/projects");
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe("TWO_FACTOR_REQUIRED");
    expect((await call("GET", "/api/workspace/members")).statusCode).toBe(403);
    const me = await call("GET", "/api/me");
    expect(me.statusCode).toBe(200);
    expect(me.json<{ twoFactorRequired: boolean; twoFactorEnabled: boolean }>()).toMatchObject({ twoFactorRequired: true, twoFactorEnabled: false });

    as("admin", { requireTwoFactor: true });
    expect((await call("GET", "/api/projects")).statusCode).toBe(403);

    // A viewer is not an owner or admin: not affected.
    act(actorWith({ role: "viewer", userId: U.viewer, flags: { requireTwoFactor: true } }));
    expect((await call("GET", "/api/projects")).statusCode).toBe(200);

    // With two-factor on, the owner works again; with the flag off nobody is blocked.
    sqlite.prepare("UPDATE user SET two_factor_enabled = 1 WHERE id = ?").run(U.owner);
    as("owner", { requireTwoFactor: true });
    expect((await call("GET", "/api/projects")).statusCode).toBe(200);
    sqlite.prepare("UPDATE user SET two_factor_enabled = 0 WHERE id = ?").run(U.owner);
    as("owner");
    expect((await call("GET", "/api/projects")).statusCode).toBe(200);
  });
});

describe("audit view filters", () => {
  it("filters by source and outcome and names the person", async () => {
    as("admin");
    const all = await call("GET", "/api/audit?source=api&limit=5");
    expect(all.statusCode).toBe(200);
    const items = all.json<{ items: Array<{ source: string; actorName: string | null }> }>().items;
    expect(items.every((i) => i.source === "api")).toBe(true);
    const denied = (await call("GET", "/api/audit?outcome=denied")).json<{ items: Array<{ outcome: string }> }>().items;
    expect(denied.every((i) => i.outcome === "denied")).toBe(true);
    expect((await call("GET", "/api/audit?outcome=weird")).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("team: service key revoke rules", () => {
  const K = { owner: "key-owner-1", ownerLocal: "key-owner-local", admin: "key-admin-1" };
  const addKey = (id: string, holder: string, name: string) =>
    sqlite.prepare("INSERT OR REPLACE INTO apikey (id, name, start, prefix, reference_id, key, enabled, created_at, updated_at) VALUES (?, ?, 'abcd', 'vg_', ?, ?, 1, ?, ?)")
      .run(id, name, holder, `hash-${id}`, Date.now(), Date.now());
  const enabled = (id: string) => (sqlite.prepare("SELECT enabled FROM apikey WHERE id = ?").get(id) as { enabled: number }).enabled;
  const list = async () => (await call("GET", "/api/workspace/service-keys")).json<{ keys: Array<{ id: string; canRevoke: boolean }> }>().keys;

  it("an admin cannot revoke the owner's key or the local service key, but can revoke their own", async () => {
    addKey(K.owner, U.owner, "owner-tool");
    addKey(K.ownerLocal, U.owner, "local-services");
    addKey(K.admin, U.admin, "admin-tool");
    as("admin");
    const otherKey = await call("DELETE", `/api/workspace/service-keys/${K.owner}`);
    expect(otherKey.statusCode).toBe(403);
    expect((await call("DELETE", `/api/workspace/service-keys/${K.ownerLocal}`)).statusCode).toBe(403);
    expect(enabled(K.owner)).toBe(1);
    expect(enabled(K.ownerLocal)).toBe(1);
    expect((await call("DELETE", `/api/workspace/service-keys/${K.admin}`)).statusCode).toBe(200);
    expect(enabled(K.admin)).toBe(0);
    const denied = sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'apikey.revoke_denied' AND outcome = 'denied'").get() as { n: number };
    expect(denied.n).toBe(2);
  });

  it("reports canRevoke per viewer and lets the owner revoke an admin's key", async () => {
    addKey(K.admin, U.admin, "admin-tool");
    as("admin");
    const asAdmin = Object.fromEntries((await list()).map((k) => [k.id, k.canRevoke]));
    expect(asAdmin[K.admin]).toBe(true);
    expect(asAdmin[K.owner]).toBe(false);
    expect(asAdmin[K.ownerLocal]).toBe(false);
    as("owner");
    const asOwner = Object.fromEntries((await list()).map((k) => [k.id, k.canRevoke]));
    expect(asOwner[K.admin]).toBe(true);
    expect(asOwner[K.owner]).toBe(true);
    expect(asOwner[K.ownerLocal]).toBe(true);
    expect((await call("DELETE", `/api/workspace/service-keys/${K.admin}`)).statusCode).toBe(200);
    expect(enabled(K.admin)).toBe(0);
  });
});
