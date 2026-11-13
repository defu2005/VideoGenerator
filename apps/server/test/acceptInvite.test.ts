import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";

const root = mkdtempSync(join(tmpdir(), "vg-invite-"));
const dbPath = join(root, "invite.db");
let app: ReturnType<typeof buildApp>;
let sqlite: Database.Database;
let ownerCookie = "";
let profileId = "";

const ORIGIN = { origin: "http://localhost:5173" };
const cookieOf = (setCookie: string | string[] | undefined) =>
  (Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []).map((c) => c.split(";")[0] ?? "").filter(Boolean).join("; ");

beforeAll(async () => {
  const config = parseConfig({
    DATA_DIR: join(root, "data"), DATABASE_PATH: dbPath, PORT: "3015", HOST: "127.0.0.1", LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173", WEB_BASE_URL: "http://localhost:5180", LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock", TTS_PROVIDER: "mock", WORKER_ENABLED: "false", FAKE_STAGE_DELAY_MS: "0",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  });
  app = buildApp({ config });
  sqlite = new Database(dbPath);
  const setup = await app.inject({
    method: "POST", url: "/api/setup/owner",
    payload: { name: "Chủ", email: "owner@example.test", password: "correct-horse" },
  });
  expect(setup.statusCode).toBe(201);
  const login = await app.inject({
    method: "POST", url: "/api/auth/sign-in/email", headers: ORIGIN,
    payload: { email: "owner@example.test", password: "correct-horse" },
  });
  expect(login.statusCode).toBe(200);
  ownerCookie = cookieOf(login.headers["set-cookie"]);
  const profile = await app.inject({
    method: "POST", url: "/api/profiles", headers: { ...ORIGIN, cookie: ownerCookie },
    payload: { name: "Kênh A", direction: "Kênh thử nghiệm", language: "vi" },
  });
  expect(profile.statusCode).toBe(201);
  profileId = profile.json<{ id: string }>().id;
  await app.inject({
    method: "POST", url: "/api/profiles", headers: { ...ORIGIN, cookie: ownerCookie },
    payload: { name: "Kênh B", direction: "Kênh thử nghiệm", language: "vi" },
  });
});

afterAll(async () => {
  await app.close();
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

async function invite(email: string, role = "viewer", grants: object[] = []) {
  const res = await app.inject({
    method: "POST", url: "/api/workspace/invitations", headers: { ...ORIGIN, cookie: ownerCookie },
    payload: { email, role, grants },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

describe("accept an invitation", () => {
  it("creates the user only for the invited email, applies channel grants, signs in, and works once", async () => {
    const id = await invite("new.person@example.test", "reviewer", [{ profileId, role: "viewer" }]);
    const info = await app.inject({ method: "GET", url: `/api/setup/invite/${id}` });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ email: "new.person@example.test", role: "reviewer", accountExists: false });

    const accept = await app.inject({
      method: "POST", url: "/api/setup/accept-invite", payload: { id, name: "Người mới", password: "a-long-password" },
    });
    expect(accept.statusCode).toBe(201);
    const cookie = cookieOf(accept.headers["set-cookie"]);
    expect(cookie).toMatch(/session/);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    const body = me.json<{ user: { email: string }; role: string; channelIds: string[] | "all"; workspace: { name: string } }>();
    expect(body.user.email).toBe("new.person@example.test");
    expect(body.role).toBe("reviewer");
    expect(body.channelIds).toEqual([profileId]);

    // The new member sees only the granted channel and cannot manage members.
    const profiles = (await app.inject({ method: "GET", url: "/api/profiles", headers: { cookie } })).json<{ items: unknown[] }>().items;
    expect(profiles).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/api/workspace/members", headers: { cookie } })).statusCode).toBe(403);

    // Used link: same answer as an unknown id.
    const again = await app.inject({ method: "POST", url: "/api/setup/accept-invite", payload: { id, name: "Kẻ thứ hai", password: "a-long-password" } });
    const unknown = await app.inject({ method: "POST", url: "/api/setup/accept-invite", payload: { id: randomUUID(), name: "X", password: "a-long-password" } });
    expect(again.statusCode).toBe(404);
    expect(again.json()).toEqual(unknown.json());

    const joined = sqlite.prepare("SELECT action FROM audit_log WHERE action = 'member.joined'").all();
    expect(joined).toHaveLength(1);
  });

  it("refuses an expired or cancelled invitation with the same text", async () => {
    const expired = await invite("late@example.test");
    sqlite.prepare("UPDATE invitation SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, expired);
    const cancelled = await invite("cancelled@example.test");
    const del = await app.inject({ method: "DELETE", url: `/api/workspace/invitations/${cancelled}`, headers: { ...ORIGIN, cookie: ownerCookie } });
    expect(del.statusCode).toBe(200);
    const texts = new Set<string>();
    for (const id of [expired, cancelled, randomUUID()]) {
      const res = await app.inject({ method: "POST", url: "/api/setup/accept-invite", payload: { id, name: "X", password: "a-long-password" } });
      expect(res.statusCode).toBe(404);
      texts.add(res.json<{ error: { message: string } }>().error.message);
    }
    expect(texts.size).toBe(1);
  });

  it("two submits at once create one account, the other fails", async () => {
    const id = await invite("race@example.test");
    const send = () => app.inject({ method: "POST", url: "/api/setup/accept-invite", payload: { id, name: "Đua", password: "a-long-password" } });
    const results = await Promise.all([send(), send()]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes[0]).toBe(201);
    expect([404, 409]).toContain(codes[1]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM user WHERE email = 'race@example.test'").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM member m JOIN user u ON u.id = m.user_id WHERE u.email = 'race@example.test'").get()).toEqual({ n: 1 });
  });

  it("an existing account joins only with its own login, and a different account is refused", async () => {
    // Pre-create a second account through an invite, then invite the same person to a fresh link? Use the owner's address for the other case.
    const forOther = await invite("someone.else@example.test");
    const wrong = await app.inject({ method: "POST", url: `/api/setup/invite/${forOther}/join`, headers: { ...ORIGIN, cookie: ownerCookie } });
    expect(wrong.statusCode).toBe(403);
    const anon = await app.inject({ method: "POST", url: `/api/setup/invite/${forOther}/join` });
    expect(anon.statusCode).toBe(401);
    // Inviting an address that already has an account (but is not a member here) shows accountExists and joins by login.
    const existing = "existing@example.test";
    sqlite.prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Có sẵn', ?, 1, ?, ?)")
      .run(randomUUID(), existing, Date.now(), Date.now());
    const id = await invite(existing);
    const info = await app.inject({ method: "GET", url: `/api/setup/invite/${id}` });
    expect(info.json<{ accountExists: boolean }>().accountExists).toBe(true);
    const blocked = await app.inject({ method: "POST", url: "/api/setup/accept-invite", payload: { id, name: "X", password: "a-long-password" } });
    expect(blocked.statusCode).toBe(409);
  });

  it("blocks the plugin's own organization endpoints", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/organization/invite-member", headers: { ...ORIGIN, cookie: ownerCookie }, payload: {} });
    expect(res.statusCode).toBe(404);
    const list = await app.inject({ method: "GET", url: "/api/auth/organization/list-members", headers: { cookie: ownerCookie } });
    expect(list.statusCode).toBe(404);
  });

  it("records account changes in the audit log without secrets", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/auth/change-password", headers: { ...ORIGIN, cookie: ownerCookie },
      payload: { currentPassword: "correct-horse", newPassword: "another-long-password", revokeOtherSessions: false },
    });
    expect(res.statusCode).toBe(200);
    const row = sqlite.prepare("SELECT action, payload, summary FROM audit_log WHERE action = 'account.password_changed'").get() as
      { action: string; payload: string | null; summary: string } | undefined;
    expect(row?.action).toBe("account.password_changed");
    expect(row?.payload ?? "").not.toMatch(/another-long-password|correct-horse/);
  });
});
