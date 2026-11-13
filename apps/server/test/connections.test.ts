import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig } from "../src/lib/config.js";
import { messageForError, messageForStatus } from "../src/api/connections.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";

const root = mkdtempSync(join(tmpdir(), "vg-connections-"));
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  rmSync(root, { recursive: true, force: true });
});

function makeApp(env: Record<string, string> = {}) {
  const dataDir = join(root, randomUUID());
  const app = buildApp({ testActor, 
    config: parseConfig({
      DATA_DIR: dataDir,
      DATABASE_PATH: join(dataDir, "app.db"),
      WORKER_ENABLED: "false",
      LOG_LEVEL: "silent",
      TTS_PROVIDER: "mock",
      IMAGE_PROVIDERS: "mock",
      ...env,
    }),
  });
  apps.push(app);
  return { app, dbPath: join(dataDir, "app.db") };
}

type Row = { id: string; ready: boolean; enabled: boolean; secret: { source: string; configured: boolean; error?: string } | null };

async function llmRow(app: ReturnType<typeof buildApp>, id: string): Promise<Row> {
  const response = await app.inject({ method: "GET", url: "/api/settings/llm-providers" });
  expect(response.statusCode).toBe(200);
  return response.json<{ providers: Row[] }>().providers.find((row) => row.id === id)!;
}

describe("Kết nối API", () => {
  it("a key saved in the app wins over .env, is never returned, and removing it falls back", async () => {
    const envKey = "env-openrouter-key-1234";
    const appKey = "app-openrouter-key-5678";
    const { app } = makeApp({ OPENROUTER_API_KEY: envKey });
    expect((await llmRow(app, "openrouter")).secret?.source).toBe("env");

    const saved = await app.inject({ method: "PUT", url: "/api/settings/llm-providers/openrouter", payload: { apiKey: appKey } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(appKey);
    expect(saved.json()).toMatchObject({ ready: true, secret: { source: "app", configured: true } });

    for (const url of ["/api/settings/llm-providers", "/api/connections/overview", "/api/connections/secrets", "/api/llm/providers"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.body).not.toContain(appKey);
      expect(response.body).not.toContain(envKey);
    }

    const removed = await app.inject({ method: "DELETE", url: "/api/settings/llm-providers/openrouter/key" });
    expect(removed.json()).toMatchObject({ secret: { source: "env" } });
  });

  it("saving a key makes the provider ready without a restart, and disabling hides it", async () => {
    const { app } = makeApp();
    expect((await llmRow(app, "groq")).ready).toBe(false);
    await app.inject({ method: "PUT", url: "/api/settings/llm-providers/groq", payload: { apiKey: "groq-key-abcd" } });
    expect((await llmRow(app, "groq")).ready).toBe(true);

    const off = await app.inject({ method: "PUT", url: "/api/settings/llm-providers/groq", payload: { enabled: false } });
    expect(off.json()).toMatchObject({ enabled: false, ready: false });
  });

  it("adds, uses and removes a custom OpenAI-compatible provider", async () => {
    const { app } = makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/settings/llm-providers/custom",
      payload: { slug: "my-proxy", label: "Proxy riêng", baseUrl: "https://proxy.example.test/v1", defaultModel: "m1", apiKey: "proxy-key-9999" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.body).not.toContain("proxy-key-9999");
    expect(created.json()).toMatchObject({ id: "custom-my-proxy", kind: "custom", ready: true, defaultModel: "m1" });

    const dup = await app.inject({
      method: "POST",
      url: "/api/settings/llm-providers/custom",
      payload: { slug: "my-proxy", label: "Again", baseUrl: "https://proxy.example.test/v1" },
    });
    expect(dup.statusCode).toBe(409);

    const removed = await app.inject({ method: "DELETE", url: "/api/settings/llm-providers/custom/my-proxy" });
    expect(removed.statusCode).toBe(200);
    expect(await llmRow(app, "custom-my-proxy")).toBeUndefined();
  });

  it("Kiểm tra maps provider errors to short messages and keeps the key out of the URL", async () => {
    const { app } = makeApp();
    await app.inject({ method: "PUT", url: "/api/settings/llm-providers/gemini", payload: { apiKey: "gemini-key-xyz" } });
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const responses = [
      new Response("{}", { status: 401 }),
      new Response("{}", { status: 429 }),
      new Response(JSON.stringify({ models: [{ name: "a" }, { name: "b" }] }), { status: 200 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string> });
      const next = responses.shift();
      if (!next) throw new TypeError("fetch failed");
      return next;
    }));
    const run = async () => (await app.inject({ method: "POST", url: "/api/settings/llm-providers/gemini/test" })).json();
    expect(await run()).toMatchObject({ ok: false, message: "Sai key" });
    expect(await run()).toMatchObject({ ok: false, message: "Hết hạn mức" });
    expect(await run()).toMatchObject({ ok: true, models: 2 });
    expect(await run()).toMatchObject({ ok: false, message: "Không kết nối được tới địa chỉ" });
    for (const call of calls) {
      expect(call.url).not.toContain("gemini-key-xyz");
      expect(call.headers["x-goog-api-key"]).toBe("gemini-key-xyz");
    }
    // The last result is remembered for the overview.
    const row = await llmRow(app, "gemini");
    expect(row).toMatchObject({ ready: true });
    const overview = (await app.inject({ method: "GET", url: "/api/connections/overview" })).json();
    const gemini = overview.sections[0].rows.find((entry: { id: string }) => entry.id === "gemini");
    expect(gemini.state).toBe("error");

    const noKey = await app.inject({ method: "POST", url: "/api/settings/llm-providers/anthropic/test" });
    expect(noKey.json()).toMatchObject({ ok: false, message: "Chưa có key." });
  });

  it("maps statuses and thrown errors", () => {
    expect(messageForStatus(403)).toBe("Sai key");
    expect(messageForStatus(500)).toContain("500");
    const timeout = new Error("x");
    timeout.name = "TimeoutError";
    expect(messageForError(timeout)).toBe("Hết thời gian chờ");
    expect(messageForError(new TypeError("fetch failed"))).toBe("Không kết nối được tới địa chỉ");
  });

  it("OpenRouter login uses PKCE S256, saves the returned key and refuses a reused state", async () => {
    const { app } = makeApp();
    const start = await app.inject({ method: "POST", url: "/api/settings/llm-providers/openrouter/start" });
    const url = new URL(start.json<{ url: string }>().url);
    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const callback = new URL(url.searchParams.get("callback_url")!);
    expect(callback.hostname).toBe("127.0.0.1");
    const state = callback.searchParams.get("state")!;

    let sentBody: Record<string, string> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ key: "sk-or-from-login-1111" }), { status: 200 });
    }));
    const done = await app.inject({ method: "GET", url: `/api/settings/llm-providers/openrouter/callback?code=abc&state=${state}` });
    expect(done.statusCode).toBe(302);
    expect(done.headers.location).toContain("connected=openrouter");
    expect(done.headers.location).not.toContain("sk-or-from-login");
    expect(sentBody).toMatchObject({ code: "abc", code_challenge_method: "S256" });
    expect(sentBody.code_verifier).toBeTruthy();
    expect(await llmRow(app, "openrouter")).toMatchObject({ ready: true, secret: { source: "app" } });

    const again = await app.inject({ method: "GET", url: `/api/settings/llm-providers/openrouter/callback?code=abc&state=${state}` });
    expect(again.statusCode).toBe(400);
  });

  it("imports keys from .env into the app", async () => {
    const { app } = makeApp({ PEXELS_API_KEY: "pexels-env-key-0001" });
    const preview = await app.inject({ method: "GET", url: "/api/settings/import-env" });
    expect(preview.json().ids).toContain("image.pexels.apiKey");
    const result = await app.inject({ method: "POST", url: "/api/settings/import-env" });
    expect(result.json().copied).toContain("image.pexels.apiKey");
    expect(result.body).not.toContain("pexels-env-key-0001");
    const secrets = (await app.inject({ method: "GET", url: "/api/connections/secrets" })).json();
    const pexels = secrets.secrets.find((row: { id: string }) => row.id === "image.pexels.apiKey");
    expect(pexels.status.source).toBe("app");
    expect((await app.inject({ method: "GET", url: "/api/settings/import-env" })).json().ids).not.toContain("image.pexels.apiKey");
  });

  it("reports a stored key that cannot be decrypted as UNREADABLE and falls back to .env", async () => {
    const { app, dbPath } = makeApp({ DEEPSEEK_API_KEY: "deepseek-env-key" });
    await app.inject({ method: "PUT", url: "/api/settings/llm-providers/deepseek", payload: { apiKey: "deepseek-app-key" } });
    const raw = new Database(dbPath);
    raw.prepare("UPDATE app_secrets SET auth_tag = ? WHERE key = ?").run(Buffer.alloc(16).toString("base64"), "connections.llm.deepseek.apiKey");
    raw.close();
    const row = await llmRow(app, "deepseek");
    expect(row.secret).toMatchObject({ error: "UNREADABLE", configured: false });
  });

  it("refuses LLM keys on the generic secrets route and unknown ids", async () => {
    const { app } = makeApp();
    const llm = await app.inject({ method: "PUT", url: "/api/connections/secrets/llm.groq.apiKey", payload: { value: "x" } });
    expect(llm.statusCode).toBe(400);
    const unknown = await app.inject({ method: "PUT", url: "/api/connections/secrets/nope", payload: { value: "x" } });
    expect(unknown.statusCode).toBe(400);
    const brave = await app.inject({ method: "PUT", url: "/api/connections/secrets/web.brave.apiKey", payload: { value: "brave-key-7777" } });
    expect(brave.statusCode).toBe(200);
    expect(brave.body).not.toContain("brave-key-7777");
  });
});

describe("Tài khoản nền tảng API", () => {
  async function setup() {
    const { app, dbPath } = makeApp();
    const profile = async (name: string) =>
      (await app.inject({ method: "POST", url: "/api/profiles", payload: { name } })).json<{ id: string }>();
    const a = await profile("Kênh A");
    const b = await profile("Kênh B");
    const account = (await app.inject({
      method: "POST",
      url: `/api/profiles/${a.id}/accounts`,
      payload: { platform: "mock", displayName: "Mock", handle: "@mock" },
    })).json<{ id: string }>();
    return { app, dbPath, a, b, account };
  }

  it("lists accounts across profiles and moves one to another profile", async () => {
    const { app, a, b, account } = await setup();
    const list = (await app.inject({ method: "GET", url: "/api/accounts" })).json();
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0]).toMatchObject({ id: account.id, profileId: a.id, profileName: "Kênh A", tokenExpiresAt: null });

    const moved = await app.inject({ method: "POST", url: `/api/accounts/${account.id}/move`, payload: { profileId: b.id } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ profileId: b.id, profileName: "Kênh B" });

    const missing = await app.inject({ method: "POST", url: `/api/accounts/${account.id}/move`, payload: { profileId: randomUUID() } });
    expect(missing.statusCode).toBe(404);
  });

  it("refuses to move an account while it is uploading", async () => {
    const { app, dbPath, b, account } = await setup();
    const raw = new Database(dbPath);
    raw.pragma("foreign_keys = OFF");
    const now = new Date().toISOString();
    raw.prepare(
      `INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'UPLOADING', 'public', 'public', ?, ?)`,
    ).run(randomUUID(), randomUUID(), randomUUID(), account.id, now, now);
    raw.close();
    const moved = await app.inject({ method: "POST", url: `/api/accounts/${account.id}/move`, payload: { profileId: b.id } });
    expect(moved.statusCode).toBe(409);
  });

  it("finds the same channel connected in another profile", async () => {
    const { app, dbPath, b, account } = await setup();
    const other = (await app.inject({
      method: "POST",
      url: `/api/profiles/${b.id}/accounts`,
      payload: { platform: "mock", displayName: "Mock 2" },
    })).json<{ id: string }>();
    const raw = new Database(dbPath);
    raw.prepare("UPDATE platform_accounts SET external_id = 'chan-1' WHERE id IN (?, ?)").run(account.id, other.id);
    raw.close();
    const dup = await app.inject({ method: "GET", url: `/api/accounts/duplicates?platform=mock&externalId=chan-1&excludeId=${other.id}` });
    expect(dup.json().duplicates).toEqual([expect.objectContaining({ id: account.id, profileName: "Kênh A" })]);
  });

  it("platform app status follows profile → app → env order and never returns the secret", async () => {
    const { app, a } = await setup();
    const empty = (await app.inject({ method: "GET", url: `/api/connections/platform-apps/youtube?profileId=${a.id}` })).json();
    expect(empty).toMatchObject({ configured: false, source: "none" });
    expect(empty.redirectUri).toContain("/api/oauth/youtube/callback");

    const appScope = await app.inject({
      method: "PUT",
      url: "/api/connections/platform-apps/youtube",
      payload: { clientId: "1234-fixture.apps.googleusercontent.com", clientSecret: "client-secret-app", scope: "app" },
    });
    expect(appScope.json()).toMatchObject({ configured: true, source: "app" });
    expect(appScope.body).not.toContain("client-secret-app");

    const profileScope = await app.inject({
      method: "PUT",
      url: "/api/connections/platform-apps/youtube",
      payload: { clientId: "5678-fixture.apps.googleusercontent.com", clientSecret: "client-secret-prof", scope: "profile", profileId: a.id },
    });
    expect(profileScope.json()).toMatchObject({ configured: true, source: "profile" });
    expect(profileScope.body).not.toContain("client-secret-prof");
  });

  it("rejects an email and reports a legacy bad client ID without exposing it", async () => {
    const { app } = makeApp();
    const url = "/api/connections/platform-apps/youtube";
    const profile = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Legacy OAuth fixture" } })).json();
    const account = (await app.inject({ method: "POST", url: `/api/profiles/${profile.id}/accounts`, payload: {
      platform: "youtube", displayName: "Fixture channel",
    } })).json();
    app.vgPublish.vault.storeAppCredentials({ profileId: profile.id, platform: "youtube", credentials: {
      clientId: "legacy@example.test", clientSecret: "fixture-secret",
    } });
    const status = await app.inject({ method: "GET", url: `${url}?accountId=${account.id}` });
    expect(status.json()).toMatchObject({ configured: true, source: "profile" });
    expect(status.json().problems[0]).toContain("Client ID đã lưu không đúng dạng");
    expect(status.body).not.toContain("legacy@example.test");
    const rejected = await app.inject({ method: "PUT", url, payload: {
      clientId: "legacy@example.test", clientSecret: "fixture-secret", scope: "app",
    } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("INVALID_APP_CREDENTIALS");
    expect(rejected.body).not.toContain("fixture-secret");
  });

  it.each([["invalid_client", false], ["invalid_grant", true], ["redirect_uri_mismatch", false]])(
    "maps Google verify error %s without returning the upstream payload", async (error, ok) => {
      const { app } = makeApp({
        YOUTUBE_CLIENT_ID: "1234-fixture.apps.googleusercontent.com", YOUTUBE_CLIENT_SECRET: "fixture-secret",
      });
      const fetchMock = vi.fn(async () => Response.json({ error, error_description: "fixture-secret" }, { status: 400 }));
      vi.stubGlobal("fetch", fetchMock);
      const result = await app.inject({ method: "POST", url: "/api/connections/platform-apps/youtube/verify" });
      expect(result.json()).toMatchObject({ ok });
      expect(result.body).not.toContain("fixture-secret");
      expect(fetchMock).toHaveBeenCalledOnce();
      if (error === "redirect_uri_mismatch") expect(result.json().reason).toContain("/api/oauth/youtube/callback");
    },
  );
});

describe("read-only connection tools", () => {
  it("are read-only and return no key", async () => {
    expect(ASSISTANT_TOOLS.list_connections?.risk).toBe("read");
    expect(ASSISTANT_TOOLS.list_platform_accounts?.risk).toBe("read");
    const { app } = makeApp({ GROQ_API_KEY: "groq-env-key-for-tool" });
    const response = await app.inject({ method: "POST", url: "/api/registry/invoke", payload: { name: "list_connections", args: {} } });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("groq-env-key-for-tool");
    expect(response.body).toContain("groq");
    const accounts = await app.inject({ method: "POST", url: "/api/registry/invoke", payload: { name: "list_platform_accounts", args: {} } });
    expect(accounts.statusCode).toBe(200);
  });
});
