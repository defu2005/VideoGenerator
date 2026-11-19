import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/lib/config.js";
import { testActor } from "./testActor.js";
import Database from "better-sqlite3";

const root = mkdtempSync(join(tmpdir(), "vg-auth-"));
const apps: ReturnType<typeof buildApp>[] = [];

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  rmSync(root, { recursive: true, force: true });
});

function makeApp(withActor = false) {
  const dataDir = join(root, randomUUID());
  const config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    WEB_BASE_URL: "http://localhost:5180",
    WORKER_ENABLED: "false",
    TTS_PROVIDER: "mock",
    IMAGE_PROVIDERS: "mock",
    LLM_ENABLE_MOCK: "true",
  });
  const app = buildApp(withActor ? { config, testActor } : { config });
  apps.push(app);
  return { app, dataDir };
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((item) => item.split(";")[0] ?? "").filter(Boolean).join("; ");
}

const owner = { name: "Chu so huu", email: "owner@example.com", password: "correct-horse" };

async function createOwner(app: ReturnType<typeof buildApp>, extra: { remoteAddress?: string; setupCode?: string; email?: string; name?: string } = {}) {
  return app.inject({
    method: "POST",
    url: "/api/setup/owner",
    remoteAddress: extra.remoteAddress,
    payload: {
      name: extra.name ?? owner.name,
      email: extra.email ?? owner.email,
      password: owner.password,
      ...(extra.setupCode ? { setupCode: extra.setupCode } : {}),
    },
  });
}

describe("auth", () => {
  it("keeps a fleet draft's support files when the user edits its selected version", async () => {
    const { app, dataDir } = makeApp();
    expect((await createOwner(app)).statusCode).toBe(201);
    const login = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", payload: { email: owner.email, password: owner.password } });
    const cookie = cookieHeader(login.headers["set-cookie"]);
    const key = await app.inject({ method: "POST", url: "/api/auth/api-key/create", headers: { cookie }, payload: { name: "fleet-edit" } });
    const db = new Database(join(dataDir, "app.db"));
    try {
      db.prepare("INSERT INTO agent_key_profiles (key_id,agent_kind,instance_name,can_supervise,updated_at) VALUES (?,'hermes','edit-fixture',0,'now')").run(key.json().id);
      const markdown = "---\nname: video-fleet-edit\ndescription: Đọc dự án để kiểm tra\noperator: true\narea: tu-van-hanh\ntriggers:\n  - kiểm thử video-fleet-edit\ntools:\n  - list_projects\nrisk: read\n---\n\n# Kiểm tra\n\n## Khi nào dùng\nKhi cần kiểm thử video-fleet-edit.\n\n## Các bước\nGọi list_projects.\n\n## Kiểm tra kết quả\nCó danh sách.\n\n## Lỗi hay gặp\nUNKNOWN_TOOL.\n\n## Không được làm\nKhông ghi dữ liệu.\n";
      const proposed = await app.inject({ method: "POST", url: "/api/agents/skills/drafts", headers: { "x-api-key": key.json().key }, payload: {
        name: "video-fleet-edit", markdown, files: { "references/check.md": "Bằng chứng của phiên bản một." }, evidence: { reason: "Kiểm thử giữ tệp" },
      } });
      expect(proposed.statusCode).toBe(200);
      const edited = await app.inject({ method: "PUT", url: "/api/operator/skills/video-fleet-edit/draft", headers: { cookie }, payload: { markdown: `${markdown}\nĐã gộp.`, baseVersion: proposed.json().version } });
      expect(edited.statusCode).toBe(200);
      const row = db.prepare("SELECT evidence FROM operator_skill_versions WHERE name=? AND version=?").get("video-fleet-edit", edited.json().version) as { evidence: string };
      expect(JSON.parse(row.evidence)).toMatchObject({ source: "user_edit", parentVersion: proposed.json().version, files: { "references/check.md": "Bằng chứng của phiên bản một." } });
    } finally { db.close(); }
  });
  it("binds keys to the active workspace, denies cross-workspace headers, and binds legacy keys", async () => {
    const { app, dataDir } = makeApp();
    expect((await createOwner(app)).statusCode).toBe(201);
    const login = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", payload: { email: owner.email, password: owner.password } });
    const cookie = cookieHeader(login.headers["set-cookie"]);
    const db = new Database(join(dataDir, "app.db"));
    try {
      const user = db.prepare("SELECT id FROM user LIMIT 1").get() as { id: string };
      const first = db.prepare("SELECT id FROM organization LIMIT 1").get() as { id: string };
      db.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES ('second','Second','second',?)").run(Date.now() + 1000);
      db.prepare("INSERT INTO member (id,organization_id,user_id,role,created_at) VALUES ('second-member','second',?,'owner',?)").run(user.id,Date.now());
      db.prepare("UPDATE session SET active_organization_id=?").run(first.id);
      const created = await app.inject({ method: "POST", url: "/api/auth/api-key/create", headers: { cookie }, payload: { name: "scoped", metadata: { workspaceId: "second" } } });
      expect(created.statusCode).toBe(200);
      const { key, id } = created.json();
      const trailing = await app.inject({ method: "POST", url: "/api/auth/api-key/create/", headers: { cookie }, payload: { name: "trailing", metadata: { workspaceId: "second" } } });
      // The plugin may reject a trailing slash; if accepted it must use the same binding rule.
      expect([200, 404]).toContain(trailing.statusCode);
      if (trailing.statusCode === 200) {
        expect((await app.inject({ method: "GET", url: "/api/me", headers: { "x-api-key": trailing.json().key } })).json().workspace.id).toBe(first.id);
      }
      const headers = { "x-api-key": key };
      db.prepare("UPDATE member SET role='viewer' WHERE user_id=? AND organization_id=?").run(user.id, first.id);
      const deniedAgent = await app.inject({ method: "POST", url: "/api/registry/invoke", headers: { ...headers, "x-vg-tool-source": "agent" }, payload: { name: "get_llm_settings", args: {} } });
      expect(deniedAgent.statusCode).toBe(403);
      db.prepare("UPDATE member SET role='owner' WHERE user_id=? AND organization_id=?").run(user.id, first.id);
      expect((await app.inject({ method: "GET", url: "/api/agents/bundle", headers })).statusCode).toBe(403);
      db.prepare("INSERT INTO agent_key_profiles (key_id,agent_kind,instance_name,can_supervise,updated_at) VALUES (?,'hermes','fleet-fixture',0,'now')").run(id);
      expect((await app.inject({ method: "GET", url: "/api/agents/bundle", headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "PUT", url: "/api/settings/hermes-fleet", headers, payload: { autoActivateReadOnlySkills: true } })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/operator/fleet", headers })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/projects", headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/projects", headers: { ...headers, "x-workspace-id": "second" } })).statusCode).toBe(403);
      expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='apikey.workspace_denied'").get()).toEqual({ n: 1 });
      db.prepare("UPDATE apikey SET metadata=NULL WHERE id=?").run(id);
      expect((await app.inject({ method: "GET", url: "/api/projects", headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/projects", headers: { ...headers, "x-workspace-id": "second" } })).statusCode).toBe(403);
      const bound = await app.inject({ method: "POST", url: "/api/auth/api-key/bind", headers: { cookie }, payload: { keyId: id } });
      expect(bound.statusCode).toBe(200);
      expect(JSON.parse((db.prepare("SELECT metadata FROM apikey WHERE id=?").get(id) as { metadata: string }).metadata).workspaceId).toBe(first.id);
      db.prepare("UPDATE session SET active_organization_id='second'").run();
      const secondKey = await app.inject({ method: "POST", url: "/api/auth/api-key/create", headers: { cookie }, payload: { name: "second-scoped" } });
      expect(secondKey.statusCode).toBe(200);
      const secondHeaders = { "x-api-key": secondKey.json().key };
      const identity = await app.inject({ method: "GET", url: "/api/me", headers: secondHeaders });
      expect(identity.statusCode).toBe(200);
      expect(identity.json().workspace.id).toBe("second");
      const changed = await app.inject({ method: "POST", url: "/api/auth/api-key/update", headers: { cookie }, payload: { keyId: secondKey.json().id, name: "renamed", metadata: { workspaceId: first.id } } });
      expect(changed.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/me", headers: secondHeaders })).json().workspace.id).toBe("second");
      expect((await app.inject({ method: "POST", url: "/api/auth/api-key/bind", headers: { cookie }, payload: { keyId: id } })).statusCode).toBe(409);
    } finally { db.close(); }
  });
  it("rejects an unauthenticated project list in Vietnamese", async () => {
    const { app } = makeApp();
    const response = await app.inject({ method: "GET", url: "/api/projects" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Bạn cần đăng nhập." } });
  });

  it("logs in with a session and logs out", async () => {
    const { app } = makeApp();
    expect((await createOwner(app)).statusCode).toBe(201);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "http://localhost:5173", "x-forwarded-for": "203.0.113.10" },
      payload: { email: owner.email, password: owner.password },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/;\s*Secure/i);
    const cookie = cookieHeader(login.headers["set-cookie"]);
    const projects = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie } });
    expect(projects.statusCode).toBe(200);

    const secure = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "http://localhost:5173", "x-forwarded-for": "203.0.113.11", "x-forwarded-proto": "https" },
      payload: { email: owner.email, password: owner.password },
    });
    expect(String(secure.headers["set-cookie"])).toMatch(/;\s*Secure/i);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { origin: "http://localhost:5173", cookie },
    });
    expect(logout.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/projects", headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("accepts the local API key and rejects it after revoke", async () => {
    const { app, dataDir } = makeApp();
    expect((await createOwner(app)).statusCode).toBe(201);
    const key = readFileSync(join(dataDir, "secrets", "local-services.key"), "utf8").trim();
    const ok = await app.inject({ method: "GET", url: "/api/projects", headers: { "x-api-key": key } });
    expect(ok.statusCode).toBe(200);
    const verified = await app.vgAuth.verifyApiKey(key);
    expect(verified.valid).toBe(true);
    expect(verified.keyId).toBeTruthy();
    await app.vgAuth.revokeApiKey(verified.keyId!);
    const revoked = await app.inject({ method: "GET", url: "/api/projects", headers: { "x-api-key": key } });
    expect(revoked.statusCode).toBe(401);
  });

  it("keeps the allowlist open and protects oauth start plus SSE", async () => {
    const { app } = makeApp();
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/get-session" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/setup/status" })).json()).toEqual({ userExists: false });
    expect((await app.inject({ method: "GET", url: "/api/oauth/youtube/callback" })).statusCode).not.toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/settings/llm-providers/openrouter/callback" })).statusCode).not.toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/knowledge/webhooks/tiktok", payload: {} })).statusCode).not.toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/oauth/youtube/start" })).statusCode).toBe(401);
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect((await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/events`,
      headers: { accept: "text/event-stream" },
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { accept: "text/event-stream" },
    })).statusCode).toBe(401);
  });

  it("creates the owner once, including a parallel race, and refuses a remote call without the code", async () => {
    const remote = makeApp();
    const denied = await createOwner(remote.app, { remoteAddress: "203.0.113.5" });
    expect(denied.statusCode).toBe(403);
    expect((await remote.app.inject({ method: "GET", url: "/api/setup/status" })).json()).toEqual({ userExists: false });
    const wrong = await createOwner(remote.app, { remoteAddress: "203.0.113.6", setupCode: "not-the-code" });
    expect(wrong.statusCode).toBe(403);
    const code = remote.app.vgAuth.setupCode();
    expect(code).toBeTruthy();
    expect((await createOwner(remote.app, { remoteAddress: "203.0.113.7", setupCode: code! })).statusCode).toBe(201);
    expect((await createOwner(remote.app, { remoteAddress: "203.0.113.7", setupCode: code! })).statusCode).toBe(409);

    const loopback = makeApp();
    expect((await createOwner(loopback.app, { remoteAddress: "::1", email: "loop@example.com" })).statusCode).toBe(201);

    const race = makeApp();
    const [first, second] = await Promise.all([
      createOwner(race.app, { email: "one@example.com", name: "Mot" }),
      createOwner(race.app, { email: "two@example.com", name: "Hai" }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
  });

  it("does not reveal whether an email exists", async () => {
    const { app } = makeApp();
    expect((await createOwner(app)).statusCode).toBe(201);
    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "x-forwarded-for": "203.0.113.21" },
      payload: { email: "missing@example.com", password: "correct-horse" },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "x-forwarded-for": "203.0.113.22" },
      payload: { email: owner.email, password: "wrong-password" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it("rate limits sign-in", async () => {
    const { app } = makeApp();
    const headers = { "x-forwarded-for": "203.0.113.44", origin: "http://localhost:5173" };
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers,
        payload: { email: "anyone@example.com", password: "wrong-password" },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 3).every((status) => status === 401)).toBe(true);
    expect(statuses[3]).toBe(429);
  });

  it("ignores the test actor in production and does not read it from the environment", async () => {
    const bypass = makeApp(true);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect((await bypass.app.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }

    process.env.VG_TEST_ACTOR = "1";
    process.env.AUTH_TEST_ACTOR = "1";
    try {
      const plain = makeApp(false);
      expect((await plain.app.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(401);
    } finally {
      delete process.env.VG_TEST_ACTOR;
      delete process.env.AUTH_TEST_ACTOR;
    }
  });
});
